# Sessão Task 4 — CRUD clients/sensors/contacts + provision (2026-07-15)

## Feito
- `server/src/db/queries.ts`: CRUD SQL puro para `clients`, `sensors`, `contacts` (REPOSITORY_PATTERN) — `listX/getX/createX/updateX/deleteX`. `updateSensor`/`updateContact` fazem UPDATE parcial montando `SET` a partir das chaves presentes no patch.
- `server/src/routes/provision.ts`: `POST /api/provision` (pública) — MAC desconhecido cria sensor `client_id NULL` com `device_token` via `crypto.randomBytes(24).toString('hex')`; MAC já existente → 404 (token não reemitido).
- `server/src/routes/clients.ts`: CRUD completo (`GET/POST/PUT/DELETE /api/clients[/:id]`).
- `server/src/routes/sensors.ts`: sem `POST` (sensores nascem via provision) — `GET /api/sensors?clientId=`, `GET/PATCH/DELETE /api/sensors/:id` para listar (inclui não-reivindicados com `client_id IS NULL`), atribuir cliente/nome/limites e remover.
- `server/src/routes/contacts.ts`: CRUD completo (`GET/POST/PATCH/DELETE /api/contacts[/:id]`), filtro opcional `?clientId=`.
- `server/src/index.ts`: registra as 4 rotas novas; `/api/provision` adicionado a `PUBLIC_ROUTES` (as demais já ficam protegidas pelo hook `onRequest` existente).

## Divergências do plano
- Nenhuma — seguiu REPOSITORY_PATTERN e ERROR_HANDLING do plano sem desvios.

## Validações
- `npx tsc --noEmit` → zero erros ✔
- **Pendência** (igual Tasks 1–3): sem Docker/Postgres nesta máquina Windows, a sequência curl create/list/update/delete não foi validada end-to-end. Validar quando houver Postgres disponível ou na Task 15.

## Contexto para a próxima sessão (Task 5)
- Ingest (`POST /api/ingest`) vai usar `getSensorByToken` (já existe em `queries.ts`) para autenticar o device via `X-Device-Token`.
- Sensor sem `client_id` (não reivindicado) deve gravar no Influx mas **não** avaliar alertas (sem contatos ainda) — checar `sensor.client_id !== null` antes de chamar `alertService`.
- `updateSensor`/`updateContact` já suportam patch parcial — a rota de ingest pode reaproveitar `updateSensor(id, { last_seen_at, last_firmware })` sem precisar de query nova.
