# Sessão Task 3 — Auth admin (2026-07-15)

## Feito
- `server/src/db/queries.ts`: `getUserByEmail` (REPOSITORY_PATTERN — SQL puro, sem ORM)
- `server/src/db/index.ts`: `seedAdmin(email, password)` — bcrypt hash + `INSERT ... ON CONFLICT (email) DO NOTHING`
- `server/src/routes/auth.ts`: `POST /api/auth/login` — valida email/senha com `bcrypt.compare`, assina JWT (`app.jwt.sign({sub, email})`), grava em cookie `token` httpOnly (`sameSite: lax`)
- `server/src/index.ts`:
  - `ADMIN_EMAIL`/`ADMIN_PASSWORD` adicionados a `REQUIRED_ENVS`
  - registra `@fastify/cookie` e `@fastify/jwt` (extração automática do cookie `token`)
  - hook `onRequest` global: rotas públicas (`/health`, `/api/auth/login`, `/api/ingest`, `/api/ota/*`) passam direto; todo o resto exige `req.jwtVerify()` — falha → 401 `{error: 'não autenticado'}`
  - `seedAdmin()` chamado após `migrate()`, antes do `listen`
- `server/package.json`: `@fastify/cookie`, `@fastify/jwt`, `bcryptjs` (+ `@types/bcryptjs`)

## Divergências do plano
- `@fastify/jwt` pinado em `^10.2.0` (não a última major disponível no momento da task) — a `^9.x` inicial trouxe `fast-jwt <=6.2.3` com 2 vulnerabilidades críticas (JWT algorithm confusion, auth bypass via secret vazio) via `npm audit`. `10.2.0` corrige a dependência transitiva; API usada (`app.jwt.sign`, `req.jwtVerify()`, opção `cookie.cookieName`) é a mesma.
- Rotas públicas verificadas por lista fixa de paths (`PUBLIC_ROUTES` + prefixo `/api/ota/`) comparando `req.raw.url` sem query string — simples o bastante para 4 exceções; se crescer, trocar por matcher de rota do Fastify.

## Validações
- `npm install` → 0 vulnerabilidades (`npm audit`)
- `npx tsc --noEmit` → zero erros ✔
- **Pendência** (igual Task 1/2): sem Docker/Postgres nesta máquina Windows, não validado end-to-end: boot real, seed do admin, `curl` login → cookie, `curl` sem cookie em `/api/clients` → 401. Validar quando houver Postgres disponível (compose só do postgres) ou na Task 15.

## Contexto para a próxima sessão (Task 4)
- CRUD `/api/clients`, `/api/sensors`, `/api/contacts` + `/api/provision` — todas (exceto provision, que é pública) já ficam protegidas automaticamente pelo hook `onRequest` de `index.ts` (não precisa repetir auth por rota).
- Sensores nascem por `/api/provision` (aberto, TOFU): token via `crypto.randomBytes(24).toString('hex')`.
- Seguir REPOSITORY_PATTERN: SQL puro em `queries.ts`, sem ORM.
- Se precisar decodificar o usuário logado numa rota, usar `req.jwtVerify()` (já roda no hook global) — o payload fica em `req.user` (`{sub, email}`).
