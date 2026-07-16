# Sessão Task 8 — Filas de notificação (pg-boss) — WhatsApp (Evolution) + Voz (Twilio) (2026-07-15)

## Feito
- `server/package.json`: dependências `pg-boss` (^12.26.0) e `twilio` (^6.0.2) instaladas.
- `server/src/services/notifier.ts`:
  - `PgBoss` instanciado **lazy** (`getBoss()`) — o construtor lança erro síncrono sem `DATABASE_URL`, o que quebraria `alertService.test.ts` (importa `notifier.ts` transitivamente) se fosse eager.
  - `startNotifier()`: `boss.start()`, `createQueue` para `notify-whatsapp`/`notify-voice`, registra os dois workers.
  - Fila **`notify-whatsapp`**: `localConcurrency: 1` (nome atual de `teamSize` no pg-boss v12) — serializada — com `finally { sleep(3000 + random(5000)) }` (jitter 3-8s) **sempre**, sucesso ou falha, antes do próximo job. Envia via `POST {EVOLUTION_URL}/message/sendText/{EVOLUTION_INSTANCE}`, número sem `+`/formatação (`phone.replace(/\D/g, '')`).
  - Fila **`notify-voice`**: `localConcurrency: 3` — paralela. `twilioClient.calls.create({ to, from, twiml })` com `<Say language="pt-BR">` (texto escapado para XML).
  - `runJob()`: grava `sent`/`failed` em `notifications` via `updateNotificationStatus` e **relança o erro** em caso de falha para o pg-boss reagendar (`retryLimit: 5, retryBackoff: true, expireInSeconds: 120`, passados em cada `send()`).
  - `getEvolutionConnectionState()`: GET `/instance/connectionState/{instance}`, devolve `{state: 'error'}` em qualquer falha de rede/HTTP (usado no `/health`).
- `server/src/db/queries.ts`: `updateNotificationStatus(id, status, detail?)`; `createResolvedAlert(sensorId, type, message)` — alerta sintético já `resolved` (usado por welcome/test/teste-semanal, que não representam um firing real mas precisam de um `alert_id` porque `notifications.alert_id` é `NOT NULL`).
- `server/src/services/alertService.ts` — reescrito o núcleo de notificação:
  - `notifyContacts()` substitui `notifyFire`/`notifyResolve`/`notifyRenotify` isolados: ponto único que aplica preferência de tipo (`contactPrefOk`) e **janela de horário** (`isWithinWindow`, da Task 7) por contato/canal, gravando `notifications.status = 'skipped_pref'`/`'skipped_window'` quando aplicável (auditável no painel, conforme GOTCHA da Task 8). Contato com o canal desligado (`channel_whatsapp`/`channel_voice = false`) não gera registro algum — não é uma "recusa", é canal inexistente.
  - Enfileira de verdade: `enqueueWhatsapp`/`enqueueVoice` do `notifier.ts`, só depois de criar a `notification` com `status: 'queued'` (o `notification.id` vai no job para o worker atualizar o status ao final).
  - Voz só é incluída na lista de `channels` para `kind: 'fire'` — nunca em `resolve`/`renotify` — garantindo "1 ligação por alerta" estruturalmente (não por checagem condicional).
- `server/src/routes/contacts.ts`: `POST /api/contacts/:id/welcome` (usa `WELCOME_TEMPLATE` com placeholder `{{name}}`, default embutido se a env não setar) e `POST /api/contacts/:id/test` (enfileira nos canais ativos do contato). Ambos usam `syntheticAlertFor()` — alerta `resolved` no primeiro sensor do cliente.
- `server/src/index.ts`: `EVOLUTION_URL`/`EVOLUTION_APIKEY`/`EVOLUTION_INSTANCE` adicionadas a `REQUIRED_ENVS`; `/health` agora inclui `evolution: {state}`; `startNotifier()` chamado após a migração/seed no boot.

## Divergências do plano (decisões tomadas e por quê)
- **`teamSize` → `localConcurrency`**: a API do pg-boss mudou esse nome de opção em versões recentes (o plano foi escrito citando a doc do README, que pode ter mudado desde então). Confirmado lendo `node_modules/pg-boss/dist/types.d.ts` instalado — `WorkOptions` não tem `teamSize`, tem `localConcurrency`. Mesmo efeito (1 worker = serializado; 3 = paralelo).
- **`alerts.sensor_id NOT NULL` para welcome/test**: o schema não tem uma tabela "eventos avulsos" — só `alerts` (por sensor) e `notifications` (por alerta). Como boas-vindas/teste são por **contato** (não por sensor), pendurei num alerta sintético `resolved` no **primeiro sensor do cliente** (`listSensors(clientId)[0]`). Se o cliente não tiver nenhum sensor cadastrado ainda, a rota responde 400 "cliente sem sensor cadastrado" — não há como contornar isso sem migração de schema (ex. tornar `sensor_id` nullable ou criar uma tabela separada). Documentando aqui para o usuário decidir se quer ajustar o schema depois; a Task 8b (teste semanal) vai bater no mesmo padrão.
- **Preferência de canal (`channel_whatsapp`/`channel_voice = false`) não gera notification alguma** — só `skipped_pref` (tipo) e `skipped_window` (janela) são auditados, porque o plano só menciona esses dois status como resultado do "filtro no enfileiramento". Contato com canal desligado nunca teria uma tentativa naquele canal, então não há nada a "pular" — decisão de não poluir a tabela.

## Validações
- `npx tsc --noEmit` → zero erros ✔
- `npx vitest run` → 14/14 (inalterado — `alertService.test.ts` continua passando sem depender de Postgres/pg-boss, graças ao `getBoss()` lazy) ✔
- **Pendência** (igual Tasks 1-7): sem Docker/Postgres/Influx/Evolution/Twilio reais nesta máquina, o fluxo fim a fim do GOTCHA da Task 8 (10 WhatsApp de teste espaçados 3-8s, retry com backoff, `failed` após 5 tentativas) não foi validado ao vivo.

## Contexto para a próxima sessão (Task 8b — Teste semanal automático)
- Reaproveitar `syntheticAlertFor()` (hoje em `contacts.ts`) ou promovê-la para `queries.ts`/novo helper compartilhado — a Task 8b também precisa de um alerta sintético `type='test'` por cliente.
- `boss.schedule(...)` ainda não foi chamado em lugar nenhum — a Task 8b precisa registrar o cron (`'0 9 * * 1'`, tz `America/Sao_Paulo`) idempotentemente no boot, dentro de `startNotifier()` ou logo depois.
- O texto do teste semanal deve listar status por sensor do cliente (online/offline com base em `last_seen_at`) — dado já disponível via `listSensors(clientId)`, sem precisar de nova query.
