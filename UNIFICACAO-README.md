# Unificação: bandai-auth + bandai-history num Worker só

## Por que isso foi necessário

`bandai-auth.rdgosmartins.workers.dev` e `bandai-history.rdgosmartins.workers.dev`
são subdomínios diferentes de `workers.dev` — e `workers.dev` está na Public Suffix
List do navegador, então cada subdomínio é tratado como um **site totalmente
separado** pra fins de cookie. Isso significa que o cookie de sessão criado pelo
login (`bandai-auth`) **nunca conseguiria** ser lido pelo dashboard
(`bandai-history`), não importa a configuração. Era a causa real do login "não
funcionar" — confirmado no HAR: o `Set-Cookie` do callback existe, mas o
navegador não manda cookie nenhum nas requisições seguintes pro outro domínio.

A solução: uma única origem serve tudo — API e frontend.

## O que mudou

- **`worker.js`** (novo, na raiz) — é o `cloudflare/auth-worker.js` de antes, com:
  - Todas as URLs trocadas de `bandai-auth...` pra `bandai-history...`
  - A rota `/profile` renomeada pra **`/my-profile`** (colidia com a página
    `profile.html`, que também vira `/profile` como URL limpa — mesma lógica
    do `/my-matches` que já existia)
  - No final do roteamento: se nenhuma rota de API bater, repassa pro binding
    `env.ASSETS.fetch(request)` — ou seja, serve os arquivos estáticos
    normalmente, do jeito que o `bandai-history` já fazia antes
- **`wrangler.toml`** (novo, na raiz) — declara esse Worker como tendo código
  (`main = "worker.js"`) + assets estáticos (`[assets] directory = "."`)
- **`.assetsignore`** (novo) — impede que `worker.js`, `wrangler.toml` e a pasta
  `cloudflare/` (histórico, não usada mais) sejam servidos como se fossem
  páginas do site
- **`login.html`** e **`js/auth.js`** — trocado `bandai-auth...` por
  `bandai-history...`
- **`js/profile-page.js`** — as duas chamadas de `/profile` viraram `/my-profile`
- `cloudflare/auth-worker.js` (antigo) foi mantido só como histórico — não é
  mais usado, o Worker `bandai-auth` pode ficar parado/ser deletado depois que
  tudo estiver validado

## Passos pra aplicar (nessa ordem — importante)

### 1. Google Cloud Console (fazer ANTES do deploy)
Vá em **APIs & Services → Credentials** → seu OAuth Client ID → em
**Authorized redirect URIs**, adicione:
```
https://bandai-history.rdgosmartins.workers.dev/auth/google/callback
```
Pode deixar a URI antiga (`bandai-auth...`) lá também por enquanto, não atrapalha.

### 2. Bindings no projeto `bandai-history`
No Cloudflare Dashboard, vá em **Workers & Pages → bandai-history → Bindings**
e recrie os mesmos bindings que existiam no `bandai-auth`:
- **KV Namespace** `AUTH_KV` (o **mesmo namespace** que já existe — não crie um
  novo, senão perde todos os usuários/decks/torneios já salvos!)
- **Secrets**: `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `ANTHROPIC_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY_JWK`,
  `MATCHMAKER_SECRET` (mesmos valores de antes)
- **Var** (não-secreta) `ALLOWED_ORIGIN`, se você usava

### 3. Deploy
Suba a pasta **inteira** deste pacote pro `bandai-history` (substituindo o
deploy atual). Como o projeto era "Workers com apenas assets estáticos", ao
subir um `worker.js` + `wrangler.toml` junto, ele passa a rodar código também.
Se vocês usam o fluxo conectado ao GitHub (`rdgosmartins/bandai-history`), é
só dar push desses arquivos pro repo — o Cloudflare redeploya automaticamente.
Se for upload manual, sobe a pasta toda pelo dashboard/wrangler normalmente.

### 4. Bot Discord — atualizar a URL do Matchmaker
No `.env` do bot (`yoko-matchmaker`), troque:
```
YOKO_WORKER_URL=https://bandai-history.rdgosmartins.workers.dev
```
(antes apontava pro `bandai-auth`)

### 5. Testar
- Login com Google — deve completar e manter a sessão dessa vez
- Perfil (editar e visualizar) — testa salvar e recarregar, já que a rota mudou
  de nome
- Aba Matchmaker, Deck Builder, tudo mais — deve continuar igual

## Depois de validar tudo

O Worker `bandai-auth` fica sem uso — pode deixar parado por uns dias como
backup, e deletar depois que tiver certeza que está tudo funcionando no
`bandai-history` unificado.
