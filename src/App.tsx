import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import { supabase } from './lib/supabase';
import { startRingtone, stopRingtone } from './lib/ringtone';
import { isMetodoOffline } from './lib/pagamento';
import logoImg from './assets/cheguei-logo.png';
import './App.css';

const SITE_URL = 'https://chegueiapp.com.br';

interface AlertItem {
  key: string;
  pedidoId: string;
  type: 'novo' | 'pago';
  metodo?: string;
  modulo?: string;
  status?: string;
  lojaId: string;
  lojaNome: string;
}

interface LojaVinculada {
  id: string;
  nome: string;
}

type Fase = 'carregando' | 'login' | 'monitorando';

export default function App() {
  const [fase, setFase] = useState<Fase>('carregando');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erroLogin, setErroLogin] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [lojas, setLojas] = useState<LojaVinculada[]>([]);
  const [fila, setFila] = useState<AlertItem[]>([]);
  const [trocandoLoja, setTrocandoLoja] = useState(false);

  const channelsRef = useRef<Map<string, any>>(new Map());
  const seenRef = useRef<Set<string>>(new Set());

  const alertaAtual = fila[0] ?? null;

  // Toca/para o alarme conforme a fila tem itens ou nao, e garante que a janela fica
  // visivel e sempre-no-topo enquanto houver algo pra mostrar.
  useEffect(() => {
    const win = getCurrentWindow();
    if (alertaAtual) {
      startRingtone();
      win.unminimize();
      win.show();
      win.setFocus();
      win.setAlwaysOnTop(true);
    } else {
      stopRingtone();
      win.setAlwaysOnTop(false);
    }
  }, [alertaAtual]);

  const resolverLoja = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setFase('login');
      return;
    }

    const { data: profile, error } = await supabase
      .from('usuarios')
      .select('id, role, id_empresa')
      .eq('auth_id', user.id)
      .single();

    if (error || !profile || profile.role !== 'gerente' || !profile.id_empresa) {
      await supabase.auth.signOut();
      setErroLogin('Essa conta não é de um parceiro gerente. Confira o login.');
      setFase('login');
      return;
    }

    // Todas as marcas vinculadas a este login (ver PLANO_MULTI_LOJA_MESMO_CNPJ.md) --
    // o app-telefone toca pra pedido de QUALQUER uma delas, não só a "ativa" no portal.
    const { data: lojasData } = await supabase
      .from('usuarios_lojas')
      .select('grupo_empresarial_id, emp_grupo_empresarial(nome)')
      .eq('usuario_id', profile.id);

    const lojasResolvidas: LojaVinculada[] = (lojasData || []).map((l) => {
      const loja = l.emp_grupo_empresarial as unknown as { nome: string | null } | null;
      return { id: l.grupo_empresarial_id, nome: loja?.nome || '—' };
    });

    setLojas(lojasResolvidas.length > 0 ? lojasResolvidas : [{ id: profile.id_empresa, nome: '—' }]);
    setFase('monitorando');
  }, []);

  useEffect(() => {
    resolverLoja();
  }, [resolverLoja]);

  // Assina um canal `parceiro:${grupoId}` POR LOJA VINCULADA ao login -- mesmo canal e
  // mesmos eventos do cheguei-app web (ParceirosLayout.tsx), mas aqui não existe "loja
  // ativa": o telefone tem que tocar pra pedido de QUALQUER marca do dono (ver
  // PLANO_MULTI_LOJA_MESMO_CNPJ.md). Só escuta novo_pedido/pedido_pago; não reimplementa
  // mensagens/SAC porque esse app é só o "telefone tocando", não um painel.
  useEffect(() => {
    if (fase !== 'monitorando' || lojas.length === 0) return;

    let cancelled = false;
    const reconnectTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
    const retryCounts = new Map<string, number>();

    const empilhar = (item: AlertItem) => {
      if (seenRef.current.has(item.key)) return;
      seenRef.current.add(item.key);
      setFila((prev) => [...prev, item]);
    };

    const subscribeLoja = (loja: LojaVinculada) => {
      if (cancelled) return;
      const existing = channelsRef.current.get(loja.id);
      if (existing) {
        supabase.removeChannel(existing);
        channelsRef.current.delete(loja.id);
      }

      const channelName = `parceiro:${loja.id}`;
      const channel = supabase.channel(channelName);

      channel.on('broadcast', { event: 'novo_pedido' }, (payload: any) => {
        const data = payload.payload;
        empilhar({
          key: `novo-${data.pedido_id}`,
          pedidoId: data.pedido_id,
          type: 'novo',
          status: data.status,
          metodo: data.metodo,
          modulo: data.modulo || 'refeição',
          lojaId: loja.id,
          lojaNome: loja.nome,
        });
      });

      channel.on('broadcast', { event: 'pedido_pago' }, (payload: any) => {
        const data = payload.payload;
        empilhar({
          key: `pago-${data.pedido_id}`,
          pedidoId: data.pedido_id,
          type: 'pago',
          metodo: data.metodo,
          modulo: data.modulo,
          lojaId: loja.id,
          lojaNome: loja.nome,
        });
      });

      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          retryCounts.set(loja.id, 0);
        }
        if (cancelled || channelsRef.current.get(loja.id) !== channel) return;
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          const retryCount = (retryCounts.get(loja.id) || 0) + 1;
          retryCounts.set(loja.id, retryCount);
          const delay = Math.min(3000 * retryCount, 30000);
          channelsRef.current.delete(loja.id);
          const t = setTimeout(async () => {
            if (cancelled) return;
            try {
              await supabase.auth.refreshSession();
            } catch {
              // sessao pode ter expirado de vez -- a proxima tentativa reporta o erro normal
            }
            if (!cancelled) subscribeLoja(loja);
          }, delay);
          reconnectTimeouts.set(loja.id, t);
        }
      });

      channelsRef.current.set(loja.id, channel);
    };

    lojas.forEach(subscribeLoja);

    return () => {
      cancelled = true;
      reconnectTimeouts.forEach((t) => clearTimeout(t));
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current.clear();
    };
  }, [fase, lojas]);

  const realizarLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setEntrando(true);
    setErroLogin(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setEntrando(false);
    if (error) {
      setErroLogin('E-mail ou senha inválidos.');
      return;
    }
    setFase('carregando');
    resolverLoja();
  };

  const fecharAlerta = () => {
    setFila((prev) => prev.slice(1));
  };

  const verDetalhes = async () => {
    if (!alertaAtual) return;
    const basePath = alertaAtual.modulo === 'refeição' ? '/parceiros/refeicao' : '/parceiros/produto';
    const targetPath = alertaAtual.type === 'novo' && alertaAtual.status === 'solicitado'
      ? `${basePath}/solicitacoes`
      : `${basePath}/pedidos`;
    // O alerta pode ser de uma marca diferente da que está ativa no portal web agora --
    // troca a loja ativa (mesma conta, mesmo id_empresa lido pelo RLS) ANTES de abrir o
    // navegador, senão a tela de pedidos abriria filtrada pela loja errada (ver
    // PLANO_MULTI_LOJA_MESMO_CNPJ.md).
    if (lojas.length > 1) {
      setTrocandoLoja(true);
      await supabase.rpc('switch_active_loja', { p_grupo_id: alertaAtual.lojaId });
      setTrocandoLoja(false);
    }
    await openUrl(`${SITE_URL}${targetPath}`);
    fecharAlerta();
  };

  const sair = async () => {
    stopRingtone();
    await supabase.auth.signOut();
    setLojas([]);
    setFila([]);
    seenRef.current.clear();
    setFase('login');
  };

  if (fase === 'carregando') {
    return (
      <div className="tela-central">
        <p className="texto-fraco">carregando...</p>
      </div>
    );
  }

  if (fase === 'login') {
    return (
      <div className="tela-central">
        <img src={logoImg} alt="cheguei!" className="logo-marca" />
        <p className="subtitulo-marca">alerta</p>
        <p className="texto-fraco" style={{ marginBottom: 20 }}>
          entre com o login do seu portal de parceiro
        </p>
        <form onSubmit={realizarLogin} className="form-login">
          <input
            type="email"
            placeholder="e-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
          />
          {erroLogin && <p className="erro-login">{erroLogin}</p>}
          <button type="submit" disabled={entrando}>
            {entrando ? 'entrando...' : 'entrar'}
          </button>
        </form>
      </div>
    );
  }

  if (alertaAtual) {
    const isNovo = alertaAtual.type === 'novo';
    // Pedido pago na entrega/retirada nunca passa por confirmacao de pagamento de verdade
    // -- o status vira 'pago' no exato momento em que o PROPRIO parceiro aprova o pedido
    // (ver Solicitacoes.tsx:460-462), entao "PEDIDO PAGO!" seria enganoso aqui: quem
    // disparou o evento foi o parceiro, nao o cliente pagando algo.
    const isAprovacaoLocal = !isNovo && isMetodoOffline(alertaAtual.metodo);
    const variante = isNovo ? 'novo' : isAprovacaoLocal ? 'aprovado' : 'pago';
    const icone = isNovo ? '📦' : isAprovacaoLocal ? '🤝' : '💰';
    const titulo = isNovo ? 'NOVA SOLICITAÇÃO!' : isAprovacaoLocal ? 'PEDIDO APROVADO!' : 'PEDIDO PAGO!';
    const descricao = isNovo
      ? 'Um novo cliente enviou um pedido.'
      : isAprovacaoLocal
        ? 'Pagamento será feito na entrega/retirada.'
        : 'O pagamento do pedido foi confirmado.';

    return (
      <div className={`tela-alerta ${variante}`}>
        <img src={logoImg} alt="cheguei!" className="logo-marca logo-marca-alerta" />
        <div className="alerta-icone-wrapper">
          <span className="alerta-ring" />
          <span className="alerta-ring atraso" />
          <div className="alerta-icone">{icone}</div>
        </div>
        <h1 className="alerta-titulo">{titulo}</h1>
        <p className="alerta-pedido">Pedido #{alertaAtual.pedidoId.slice(-6).toUpperCase()}</p>
        {lojas.length > 1 && <p className="alerta-desc" style={{ fontWeight: 700 }}>{alertaAtual.lojaNome}</p>}
        <p className="alerta-desc">{descricao}</p>
        {fila.length > 1 && <p className="alerta-fila">+{fila.length - 1} aguardando</p>}
        <div className="alerta-botoes">
          <button className="btn-detalhes" onClick={verDetalhes} disabled={trocandoLoja}>
            {trocandoLoja ? 'trocando de loja...' : 'ver detalhes agora'}
          </button>
          <button className="btn-fechar" onClick={fecharAlerta}>fechar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tela-central">
      <img src={logoImg} alt="cheguei!" className="logo-marca" />
      <p className="subtitulo-marca">alerta</p>
      <div className="status-dot" />
      <p className="texto-fraco">
        {lojas.length === 1 ? (lojas[0].nome || 'conectado') : `${lojas.length} lojas vinculadas`}
      </p>
      {lojas.length > 1 && (
        <p className="texto-fraco-menor">{lojas.map((l) => l.nome).join(' · ')}</p>
      )}
      <p className="texto-fraco-menor">aguardando pedidos em segundo plano</p>
      <button className="btn-sair" onClick={sair}>trocar de conta</button>
    </div>
  );
}
