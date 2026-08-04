# cheguei! Alerta

App de bandeja (system tray) pra Windows/desktop, que fica sempre rodando em segundo
plano na loja do parceiro e toca um alarme alto + mostra uma janela sempre-no-topo
quando chega uma **nova solicitação** ou um **pedido é pago** — resolve a fragilidade de
depender de uma aba do `cheguei-app` aberta no navegador (throttling de aba em segundo
plano, aba fechada sem querer, etc.).

Não reimplementa nada do painel do parceiro — é só o "telefone tocando". O botão "ver
detalhes" abre a página correspondente do `cheguei-app` (`chegueiapp.com.br`) no navegador
padrão.

## Como funciona

- Login com o mesmo e-mail/senha do portal de parceiro (Supabase Auth). Sessão persiste
  localmente, só precisa logar de novo se fizer logout manual.
- Assina o mesmo canal Realtime `parceiro:${empId}` e os mesmos eventos broadcast
  (`novo_pedido`, `pedido_pago`) que o `cheguei-app` já usa em `ParceirosLayout.tsx` —
  mesma lógica de reconexão com backoff crescente e refresh de sessão em caso de queda.
- **Diferente do web:** os alertas ficam numa fila (array), não um slot único — dois
  pedidos em sequência rápida não se sobrescrevem mais (bug identificado no `cheguei-app`
  web, corrigido aqui desde o início).
- Toque sintetizado via Web Audio API (`src/lib/ringtone.ts`) — sem depender de arquivo
  de áudio externo/licenciado.
- Fecha pelo X só esconde pra bandeja; só encerra de verdade pelo menu do tray ("Sair").
- Auto-inicia com o Windows (`tauri-plugin-autostart`).

## Limitações conhecidas (mesmas do mecanismo de base)

- Ainda é broadcast, não CDC — se a conexão cair no instante exato do evento, aquele
  aviso específico se perde (o pedido em si não, só o alerta sonoro). Ver
  `DESAFIOS.md`/histórico de conversa do monorepo pra mais contexto.
- Só ajuda quem usa o `cheguei-app` (web) num PC. Não cobre `mobile-parceiros` (celular).
- Precisa do PC ligado e do app rodando — troca uma falha silenciosa (aba em 2º plano)
  por uma falha óbvia (PC desligado), que foi a motivação de construir isso.

## Desenvolvimento

Precisa de Rust (`rustup`) + Node. No Windows, o toolchain MSVC do Rust também exige o
**Visual Studio Build Tools** com o workload "Desktop development with C++".

```
npm install
cp .env.example .env   # preencher com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run tauri dev       # roda em modo desenvolvimento
npm run tauri build     # gera o instalador (.msi/.exe) em src-tauri/target/release/bundle
```

## Status (em construção — ver histórico de conversa pra contexto completo)

- [x] Esqueleto Tauri v2 + React + TS criado
- [x] Login + resolução de `empId` (mesma query do `ParceirosLayout.tsx`)
- [x] Assinatura do canal realtime + fila de alertas + reconexão com backoff
- [x] Toque sintetizado (Web Audio API)
- [x] Tray icon (mostrar/sair) + janela que só esconde ao fechar
- [x] Autostart com o Windows configurado
- [ ] `cargo check` rodando pela primeira vez (toolchain acabou de ser instalado)
- [ ] Testar `npm run tauri dev` de ponta a ponta com login real
- [ ] Criar repositório novo no GitHub (`chegueiapp/cheguei-alerta`) e adicionar como
      submódulo no monorepo, no mesmo padrão de `cheguei-app`/`cheguei-mobile`
- [ ] Gerar o primeiro instalador (`npm run tauri build`) e definir onde disponibilizar
      o download pro parceiro (ex.: link dentro do próprio portal, aba "Meu Plano")
- [ ] Decidir se/quando travar o canal Realtime com autorização (hoje é público, sem
      RLS — funciona assim no `cheguei-app` web também, mas vale reforçar já que este
      app fica mais exposto rodando fora do navegador)
