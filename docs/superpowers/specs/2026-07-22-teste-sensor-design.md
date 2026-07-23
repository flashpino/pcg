# Teste de dispositivo (manual web + ESP32 + automático) — Design

**Data:** 2026-07-22
**Status:** aprovado para planejamento

## Problema

O técnico precisa disparar um teste que envia uma mensagem com a
**temperatura atual** de um sensor aos contatos do cliente, de dois lugares:

1. **Painel web** — botão "Testar dispositivo" na tela de Sensores.
2. **ESP32 (no local)** — o técnico digita o PIN e clica em "Testar
   dispositivo" na tela do próprio device.

Os dois fazem exatamente a mesma coisa. O módulo deve funcionar como os
outros tipos de alerta: mensagem personalizável (template) e respeitando a
preferência do contato. Além do manual, existe um teste automático agendado —
hoje um resumo semanal fixo em segunda 9h, disparado pelo **servidor** (cron
do pg-boss), não pelo sensor. Ele deve passar a enviar a temperatura atual de
cada sensor, com **dia da semana e horário configuráveis no painel** (padrão
mantido: segunda 9h).

## Decisões tomadas (via brainstorming)

- **Destino:** todos os contatos ativos do cliente do sensor, via WhatsApp
  (respeitando `active` + `channel_whatsapp`).
- **Preferência por contato:** o teste **reaproveita a pref de `temperature`**
  de cada contato (janela/dias/liga-desliga). Sem criar um 4º tipo de pref —
  nenhuma mudança de schema em `contact_alert_prefs`, contatos ou UI de
  contato.
- **Automático:** envia a temperatura atual de cada sensor, **uma mensagem por
  sensor**, com dia+horário configuráveis. Padrão segunda 9h.
- **Teste per-contato que já existe** (`POST /api/contacts/:id/test`, botão no
  contato): é outro recurso (testa "o canal desse contato funciona", texto
  fixo, voz+whatsapp). Fica como está; renomear só o botão para **"Testar
  canal"** para não confundir.

## Arquitetura

Um único `sendTest(sensor)` no servidor é o núcleo — chamado pelo botão web,
pelo device (ESP32) e pelo worker automático. Ele reaproveita o pipeline
`notifyContacts` de [alertService.ts](../../../server/src/services/alertService.ts),
passando o tipo `'temperature'` para o lookup de preferência/janela, mas com o
texto do template `test`. Assim herda janela, dias, liga/desliga e auditoria
sem duplicar lógica nem mexer no schema.

### 1. `sendTest(sensor)` — núcleo compartilhado (alertService.ts)

Nova função exportada:

1. Se `sensor.client_id === null` → não faz nada.
2. Lê a leitura atual via `queryLatestReadings([sensor.id])`.
3. Monta vars: `temperatura` = leitura ou `'--'` quando não há leitura recente
   (ainda envia — o teste também revela sensor mudo); `quando` = horário da
   leitura formatado pt-BR (ou `'--:--'`); mais `sensor, local, cliente`.
4. `renderMessage('test', vars)`.
5. `createResolvedAlert(sensor.id, 'test', texts.whatsapp)` (tipo `test` já é
   aceito pelo CHECK de `alerts`).
6. Carrega `contacts` + `prefs` do cliente e chama
   `notifyContacts(alert, contacts, prefs, 'temperature', ['whatsapp'], texts, 'fire')`.

*Nota: passar `'temperature'` a `notifyContacts` é o que faz o teste
reaproveitar a pref de temperatura. `notifyContacts` usa o `type` só para achar
a pref e auditar; o texto vem de `texts`, não da chave.*

### 2. Mensagem personalizável (template `test`)

- **db/index.ts** (`DEFAULT_MESSAGE_TEMPLATES`): nova chave `test` (só
  `whatsapp`, sem `voice` — teste não é emergência). Default:
  `Teste PCG — {{$sensor}} ({{$local}}): temperatura atual {{$temperatura}}°C ({{$quando}}).`
- **MessagesPage.tsx**: `LABELS.test` = "Teste de dispositivo (manual/automático)"
  e `LEGEND.test` = `['sensor', 'local', 'cliente', 'temperatura', 'quando']`.

### 3. Botão web (SensorsPage.tsx + sensors.ts)

- **sensors.ts**: `POST /api/sensors/:id/test` → carrega o sensor, chama
  `sendTest(sensor)`, retorna `{ ok: true }`.
- **SensorsPage.tsx**: botão **"Testar dispositivo"** por linha da tabela,
  usando o `runMutation` já existente para feedback de sucesso/erro.

### 4. Botão no ESP32 (firmware)

Fluxo: relógio → PIN (já existe, valida `storage::loadPin()` local) → menu.
Adiciona um item de menu **"Testar dispositivo"**.

- **net.h / net.cpp**: nova função thread-safe `net::requestDeviceTest()` que
  seta um `volatile` flag de pedido (mesmo padrão de `pauseForScan`). A task de
  rede (core 0), no topo do loop e se `connected`, consome o flag e faz
  `POST /api/device/test` com header `X-Device-Token` (reusa
  `makeSecureClient` + `HTTPClient`, igual `sendIngest`). O resultado é
  publicado num `volatile enum TestState { IDLE, PENDING, SENT, FAILED }`
  exposto por um getter thread-safe `net::consumeTestResult()` (não vai pela
  fila de `Event`, que é sobrescrita pela próxima leitura).
- **ui.cpp**: `buildMenu` ganha o botão "Testar dispositivo". O callback chama
  `net::requestDeviceTest()`, mostra um label/overlay **"enviando…"** e volta
  ao dashboard. Em `ui::tick()`, faz poll de `net::consumeTestResult()`: quando
  vira `SENT` mostra **"enviado ✓"**, quando `FAILED` mostra **"falha ao
  enviar"** — o aviso some sozinho após ~3s. A UI **não** toca em WiFi, só seta
  o flag e lê o resultado.
- **server**: `POST /api/device/test` (novo, em `ingest.ts` ou rota nova de
  device) — autentica por `X-Device-Token` (reusa `getSensorByToken`), chama
  `sendTest(sensor)`, retorna `{ ok: true }`.

### 5. Automático configurável (notifier.ts + settings)

- **schema.sql**: tabela nova
  `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)`.
- **db/index.ts**: seed idempotente de `test_schedule_dow` (default `'1'` =
  segunda) e `test_schedule_time` (default `'09:00'`).
- **queries.ts**: `getSetting(key)` / `setSetting(key, value)`.
- **notifier.ts**:
  - `runWeeklyTest` passa a iterar clientes × sensores chamando
    `sendTest(sensor)` (remove o resumo online/offline hardcoded). `sendTest`
    fica em alertService; notifier importa e chama.
  - Nova `scheduleWeeklyTest(dow, time)`: monta o cron `mm hh * * dow` a partir
    de `time` e agenda via
    `getBoss().schedule(WEEKLY_TEST_QUEUE, cron, {}, { tz: 'America/Sao_Paulo' })`
    (pg-boss faz upsert pelo nome da fila).
  - `startNotifier` lê as settings no boot e chama `scheduleWeeklyTest` em vez
    do cron fixo.
- **rota nova** (`settings.ts`): `GET /api/settings/test-schedule` →
  `{ dow, time }`; `PUT /api/settings/test-schedule` salva as duas chaves e
  chama `scheduleWeeklyTest` para reagendar em runtime.
- **SensorsPage.tsx**: card "Teste automático" no topo — `<select>` de dia
  (dom..sáb) + `<input type="time">` + botão Salvar.

*ponytail: volume por execução = sensores × contatos. A fila de WhatsApp já é
serializada (localConcurrency 1) com jitter 3–8s → ok pra escala atual; se um
cliente tiver dezenas de sensores, virar resumo por cliente é o upgrade.*

## Testes

Um teste unitário de `sendTest` (mockando influx + queries):

- respeita pref `temperature` desabilitada do contato (`skipped_pref`, não
  enfileira);
- respeita janela (`skipped_window` fora do horário);
- envia `temperatura = '--'` quando não há leitura recente.

## Arquivos tocados

**Servidor**
- `server/src/db/schema.sql` — tabela `app_settings`.
- `server/src/db/index.ts` — template `test`, seed das settings.
- `server/src/db/queries.ts` — `getSetting`/`setSetting`.
- `server/src/services/alertService.ts` — `sendTest`.
- `server/src/services/notifier.ts` — `runWeeklyTest`, `scheduleWeeklyTest`.
- `server/src/routes/sensors.ts` — `POST /:id/test`.
- `server/src/routes/ingest.ts` (ou rota nova) — `POST /api/device/test`.
- `server/src/routes/settings.ts` — **novo**, schedule do automático.
- ponto de registro de rotas — registrar `settingsRoutes`.

**Web**
- `web/src/pages/SensorsPage.tsx` — botão "Testar dispositivo" + card do
  agendamento.
- `web/src/pages/MessagesPage.tsx` — label/legenda `test`.
- `web/src/pages/ClientContacts.tsx` — renomear botão antigo para "Testar
  canal".

**Firmware**
- `firmware/src/net.h` / `net.cpp` — `requestDeviceTest()` + POST
  `/api/device/test`.
- `firmware/src/ui.cpp` — item de menu "Testar dispositivo".
