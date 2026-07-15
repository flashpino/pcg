# Sessão Task 2 — Bootstrap do server + migração (2026-07-15)

## Feito
- `server/package.json` (type module; scripts dev/build/start/test) e `server/tsconfig.json` (NodeNext, strict)
- `server/src/db/schema.sql`: schema completo do plano com `CREATE TABLE IF NOT EXISTS` + índice parcial `alerts_one_firing`
- `server/src/db/index.ts`: `pool` (pg) + `migrate()` que executa schema.sql no boot
- `server/src/index.ts`: env-check fatal (`DATABASE_URL`, `INFLUX_*`, `TWILIO_*`, `JWT_SECRET` → `process.exit(1)` com mensagem), Fastify com logger pino, `setErrorHandler` global (padrão ERROR_HANDLING do plano), `GET /health` → `{db, influx}`, `migrate()` antes do `listen`

## Divergências do plano
- Deps instaladas lazy: só `fastify` + `pg` agora. `@influxdata/influxdb-client`, `pg-boss`, `twilio`, `@fastify/*`, `bcryptjs` entram nas tasks que os usam.
- Health do Influx usa `fetch(INFLUX_URL/ping)` nativo (204 = ok) em vez do client — ping não valida token; o client da Task 5 valida na primeira escrita.
- `npm run build` copia `schema.sql` para `dist/db/` (tsc não copia assets).

## Validações
- `npx tsc --noEmit` → zero erros ✔
- Boot sem envs → `FATAL: envs obrigatórias ausentes: ...` + exit 1 ✔
- **Pendência**: `npm run dev` + `GET /health` 200 com `{db:'ok'}` NÃO validado — sem Docker/Postgres nesta máquina Windows (igual Task 1). Validar quando houver Postgres (compose só do postgres) ou na Task 15.

## Contexto para a próxima sessão (Task 3)
- Auth admin: `POST /api/auth/login` (bcryptjs + @fastify/jwt em cookie httpOnly), hook `onRequest` protegendo tudo exceto `/api/ingest`, `/api/ota/*`, `/api/auth/login`, `/health`. Seed do admin via `ADMIN_EMAIL`/`ADMIN_PASSWORD` no primeiro boot (adicionar essas envs ao REQUIRED_ENVS do index.ts).
- Instalar: `@fastify/jwt`, `@fastify/cookie`, `bcryptjs` (+@types).
- Tabela `users` já existe no schema.sql.
- Dev local: `npm run dev` usa `tsx watch --env-file=../.env` — precisa de `.env` na raiz.
- Aviso operacional: o hook GateGuard bloqueia SEMPRE a 1ª tentativa de Write de arquivo novo — apresentar os 4 fatos (chamadores, sem duplicata, schema de dados, instrução verbatim) e retentar o mesmo Write; a 2ª passa.
