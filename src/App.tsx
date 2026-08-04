import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import { supabase } from './lib/supabase';
import { startRingtone, stopRingtone } from './lib/ringtone';
import './App.css';

const SITE_URL = 'https://www.chegueiapp.store';

interface AlertItem {
  key: string;
  pedidoId: string;
  type: 'novo' | 'pago';
  metodo?: string;
  modulo?: string;
  status?: string;
}

type Fase = 'carregando' | 'login' | 'monitorando';

export default function App() {
  const [fase, setFase] = useState<Fase>('carregando');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erroLogin, setErroLogin] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [lojaNome, setLojaNome] = useState<string | null>(null);
  const [fila, setFila] = useState<AlertItem[]>([]);

  const empIdRef = useRef<string | null>(null);
  const channelRef = useRef<any>(null);
  const seenRef = useRef<Set<string>>(new Set());

  const alertaAtual = fila[0] ?? null;

  // Toca/para o alarme conforme a fila tem itens ou nao, e garante que a janela fica
  // visivel e sempre-no-topo enquanto houver algo pra mostrar.
  useEffect(() => {
    const win = getCurrentWindow();
    if (alertaAtual) {
      startRingtone();
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
      .select('id, role, id_empresa, emp_grupo_empresarial(nome)')
      .eq('auth_id', user.id)
      .single();

    if (error || !profile || profile.role !== 'gerente' || !profile.id_empresa) {
      await supabase.auth.signOut();
      setErroLogin('Essa conta não é de um parceiro gerente. Confira o login.');
      setFase('login');
      return;
    }

    empIdRef.current = profile.id_empresa;
    setLojaNome((profile.emp_grupo_empresarial as any)?.nome ?? null);
    setFase('monitorando');
  }, []);

  useEffect(() => {
    resolverLoja();
  }, [resolverLoja]);

  // Assina o canal `parceiro:${empId}` -- mesmo canal e mesmos eventos do cheguei-app web
  // (ParceirosLayout.tsx). So escuta novo_pedido/pedido_pago, que e o escopo pedido; nao
  // reimplementa mensagens/SAC porque esse app e so o "telefone tocando", nao um painel.
  useEffect(() => {
    if (fase !== 'monitorando' || !empIdRef.current) return;
    const empId = empIdRef.current;

    let cancelled = false;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    const channelName = `parceiro:${empId}`;

    const empilhar = (item: AlertItem) => {
      if (seenRef.current.has(item.key)) return;
      seenRef.current.add(item.key);
      setFila((prev) => [...prev, item]);
    };

    const subscribeChannel = () => {
      if (cancelled) return;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

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
        });
      });

      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          retryCount = 0;
        }
        if (cancelled || channelRef.current !== channel) return;
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          retryCount++;
          const delay = Math.min(3000 * retryCount, 30000);
          channelRef.current = null;
          reconnectTimeout = setTimeout(async () => {
            if (cancelled) return;
            try {
              await supabase.auth.refreshSession();
            } catch {
              // sessao pode ter expirado de vez -- a proxima tentativa reporta o erro normal
            }
            if (!cancelled) subscribeChannel();
          }, delay);
        }
      });

      channelRef.current = channel;
    };

    subscribeChannel();

    return () => {
      cancelled = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [fase]);

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
    await openUrl(`${SITE_URL}${targetPath}`);
    fecharAlerta();
  };

  const sair = async () => {
    stopRingtone();
    await supabase.auth.signOut();
    empIdRef.current = null;
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
        <h1 className="titulo-login">cheguei! Alerta</h1>
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
    return (
      <div className={`tela-alerta ${isNovo ? 'novo' : 'pago'}`}>
        <div className="alerta-icone">{isNovo ? '📦' : '💰'}</div>
        <h1 className="alerta-titulo">{isNovo ? 'NOVA SOLICITAÇÃO!' : 'PEDIDO PAGO!'}</h1>
        <p className="alerta-pedido">Pedido #{alertaAtual.pedidoId.slice(-6).toUpperCase()}</p>
        <p className="alerta-desc">
          {isNovo ? 'Um novo cliente enviou um pedido.' : 'O pagamento do pedido foi confirmado.'}
        </p>
        {fila.length > 1 && <p className="alerta-fila">+{fila.length - 1} aguardando</p>}
        <div className="alerta-botoes">
          <button className="btn-detalhes" onClick={verDetalhes}>ver detalhes agora</button>
          <button className="btn-fechar" onClick={fecharAlerta}>fechar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tela-central">
      <div className="status-dot" />
      <h1 className="titulo-idle">cheguei! Alerta</h1>
      <p className="texto-fraco">{lojaNome || 'conectado'}</p>
      <p className="texto-fraco-menor">aguardando pedidos em segundo plano</p>
      <button className="btn-sair" onClick={sair}>trocar de conta</button>
    </div>
  );
}
