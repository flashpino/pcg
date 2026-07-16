# Plan: Portal do cliente final

**Source PRD**: `.claude/prds/painel-dashboard-redesign.prd.md`
**Selected Milestone**: #4 — Portal do cliente final
**Complexity**: Medium (nova superfície de autenticação)

## Decisões sobre as Open Questions do PRD
- **Mecanismo de login**: reaproveita o MESMO JWT/cookie (`@fastify/jwt`, cookie `token` httpOnly) do admin, só que com um campo `role` no payload (`'admin' | 'client'`). Não é um sistema de auth separado — evita duplicar toda a infra de sessão por uma segunda vez.
- **Autorização por role**: o hook global em `index.ts` passa a exigir `role === 'client'` pra qualquer rota `/api/client/*` e `role === 'admin'` (ou ausência de `role`, pra não invalidar sessões de admin já logadas antes deste deploy) pra todo o resto. Sem essa checagem, um token de cliente conseguiria bater em qualquer rota de admin hoje — é o núcleo da parte de segurança deste milestone.
- **Credencial do cliente**: 1 login por cliente (empresa), não por contato — `email`/`password_hash` novos na tabela `clients`, setados pelo admin pela tela de Clientes. Contato (Milestone 2) continua sendo só telefone pra notificação, não vira login.

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Login + cookie JWT | `server/src/routes/auth.ts` | Mesmo `app.jwt.sign`/`reply.setCookie`, só muda o payload (`role`, `sub` aponta pro `client.id`) |
| Rota pública explícita | `server/src/index.ts:38` (`PUBLIC_API_ROUTES`) | Adicionar `/api/client/login` na lista |
| Nunca devolver hash de senha | `server/src/db/queries.ts` (`listUsers` já faz isso pros admins) | Mesma disciplina pros `clients` — `SELECT *` de `clients` hoje vazaria `password_hash` assim que a coluna existir; corrigir pra colunas explícitas |
| Página de login | `web/src/pages/LoginPage.tsx` | Mirror quase 1:1 pro `ClientLoginPage.tsx` |
| Sem router lib instalada | N/A — projeto não tem `react-router` | Separar admin vs. portal por `location.hash` (`#/portal`) em `main.tsx`, sem adicionar dependência nova |

## Files to Change
| File | Action | Why |
|---|---|---|
| `server/src/db/schema.sql` | UPDATE | `ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;` + `... password_hash TEXT;` (idempotente, roda todo boot) |
| `server/src/db/queries.ts` | UPDATE | `Client` ganha `email: string \| null`; `listClients`/`getClient`/`createClient`/`updateClient` passam a selecionar colunas explícitas (nunca `password_hash`); novas `getClientByEmail` (server-only, inclui hash), `setClientCredentials`, `listAlertsByClient` |
| `server/src/routes/clients.ts` | UPDATE | `PUT /api/clients/:id/credentials` — admin define email+senha do portal do cliente |
| `server/src/routes/clientPortal.ts` | CREATE | `POST /api/client/login` (público), `GET /api/client/me`, `POST /api/client/logout`, `GET /api/client/sensors`, `GET /api/client/sensors/:id/readings`, `GET /api/client/alerts` — todas escopadas por `req.user.sub` (o `client_id` do token) |
| `server/src/index.ts` | UPDATE | `/api/client/login` público; hook `onRequest` passa a checar `role` além de `jwtVerify()` |
| `web/src/pages/ClientLoginPage.tsx` | CREATE | Mirror de `LoginPage.tsx`, postando pra `/api/client/login` |
| `web/src/pages/ClientPortalPage.tsx` | CREATE | Pós-login: cards dos próprios sensores (reusa classes `.device-card`/`.status-online` do Dashboard) + feed dos próprios alertas (reusa estilo de `AlertsPage.tsx`) |
| `web/src/ClientPortalApp.tsx` | CREATE | Componente raiz do portal (checa `/api/client/me`, alterna login/portal), mirror de `App.tsx` |
| `web/src/main.tsx` | UPDATE | `location.hash.startsWith('#/portal')` → renderiza `ClientPortalApp`, senão `App` (admin) |
| `web/src/pages/ClientsPage.tsx` | UPDATE | Form pequeno "credenciais do portal" (email/senha) dentro do painel já expansível do cliente |

## Tasks
1. **Schema + queries**: coluna nova em `clients`, corrigir `SELECT *`/`RETURNING *` pra excluir `password_hash` em todo lugar que hoje devolve `Client` pro admin.
2. **`clients.ts`**: rota de credenciais (hash com `bcryptjs`, mesmo custo 10 do resto do projeto).
3. **`clientPortal.ts`**: rotas do portal, cada uma verificando ownership (`sensor.client_id === req.user.sub`) antes de devolver qualquer dado — é a extensão do trust boundary novo.
4. **`index.ts`**: authorization por `role` no hook global (não só autenticação) — sem isso o resto do milestone não tem valor de segurança nenhum.
5. **Frontend do portal**: `ClientLoginPage`, `ClientPortalPage`, `ClientPortalApp`, branch em `main.tsx` por hash.
6. **Admin seta credenciais**: form em `ClientsPage.tsx`.
7. **Validar**: `npm test`/`tsc --noEmit`/`npm run build` nos dois lados; revisão focada em autorização antes de considerar pronto (ver Risks).

## Validation
```bash
cd server && npm test && npm run build
cd web && npx tsc --noEmit && npm run build
```
Manual (assim que houver ambiente): logar como admin, setar credenciais de um cliente, deslogar, acessar `/#/portal`, logar como esse cliente, confirmar que só vê os próprios sensores/alertas — e, especificamente, que um token de cliente recebe 403 ao chamar uma rota de admin (ex. `GET /api/clients`) e vice-versa.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Token de cliente acessando rota de admin (ou vice-versa) por falha na checagem de `role` | Baixa (é o foco #1 deste plano) | Alto — vazamento de dados entre clientes/admin | `role` checado no hook global, não rota por rota; testar os dois sentidos manualmente antes de considerar pronto |
| Cliente acessando sensor/leitura de outro cliente via ID adivinhado (IDOR) | Baixa | Alto | Toda rota `/api/client/*` que recebe um `:id` verifica `sensor.client_id === req.user.sub` antes de devolver dado, nunca confia só no `role` |
| Sessão de admin já aberta (token sem `role`) ser barrada logo após o deploy | Média | Baixo | Hook trata token sem `role` como admin (retrocompatível) — só re-login é exigido se o admin trocar de máquina/cookie depois |
| Coluna `password_hash` de `clients` vazando pro painel admin (`GET /api/clients`) | Baixa se não corrigido agora | Alto | `listClients`/`getClient` passam a selecionar colunas explícitas, nunca `*` |

## Acceptance
- [ ] Todas as tasks completas
- [ ] `server`/`web` buildam e testam sem erro
- [ ] Token de cliente não consegue chamar rota de admin (403) e vice-versa — verificado manualmente
- [ ] Cliente só vê seus próprios sensores/leituras/alertas
