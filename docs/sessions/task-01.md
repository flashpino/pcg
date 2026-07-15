# Sessão Task 1 — Scaffold do monorepo (2026-07-15)

## Feito
- `git init` + `.gitignore` (node_modules, dist, .env, .pio, config.h, firmware-bin, graphify-out)
- Estrutura: `server/src/`, `web/`, `firmware/src/`, `docs/sessions/`
- `docker-compose.yml`: serviços `postgres` (16-alpine, healthcheck, volume pgdata) e `server` (build ./server, restart always, porta 3000, volume firmware-bin, depends_on postgres healthy). InfluxDB **não** está no compose — já existe na VPS, apontado via env.
- `.env.example`: todas as envs do sistema (Postgres, Influx, Twilio voz, Evolution API, JWT/admin, WELCOME_TEMPLATE, PORT)
- `README.md` com estrutura e ponteiros para plano/STATUS/sessões
- `STATUS.md` criado (rastreamento 1 task = 1 sessão)
- Protocolo de Sessão adicionado ao plano

## Divergências do plano
- `.gitkeep` descartados — desnecessários, cada task cria seus arquivos.
- `server/package.json`/`tsconfig.json` deixados para a Task 2 (pertencem ao bootstrap).

## Pendências
- **VALIDATE não executado**: `docker compose config` — Docker não está instalado nesta máquina Windows (roda na VPS). Validar na Task 15 (deploy) ou quando houver Docker local.

## Contexto para a próxima sessão (Task 2)
- Ler task 2 do plano: bootstrap Fastify + env-check fatal + migração idempotente (schema.sql com IF NOT EXISTS) + `/health` com `{db, influx}`.
- O schema Postgres completo está na seção "Modelo de Dados" do plano — copiar de lá, incluindo o índice parcial `alerts_one_firing` e `contacts.renotify_minutes`.
- `DATABASE_URL` vem do compose (injetada); em dev local usar Postgres próprio ou compose só do postgres.
- Aviso operacional: o hook GateGuard desta configuração exige apresentar "fatos" (1 consumidores, 2 ausência de duplicata, 3 schema de dados, 4 instrução verbatim) na MESMA mensagem, imediatamente antes de cada Write de arquivo novo.
