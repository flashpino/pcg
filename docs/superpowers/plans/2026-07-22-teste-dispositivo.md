# Teste de Dispositivo (web + ESP32 + automático) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir disparar um teste que envia a temperatura atual de um sensor aos contatos do cliente — do painel web, do próprio ESP32 (PIN + botão), e automaticamente num dia/hora configuráveis.

**Architecture:** Um único `sendTest(sensor)` no servidor é o núcleo, chamado pelos três gatilhos. Ele reaproveita o pipeline `notifyContacts` do `alertService` (passando o tipo `'temperature'` para achar a pref/janela do contato), com o texto vindo do template `test`. O agendamento vive numa tabela `app_settings` e reprograma o cron do pg-boss em runtime.

**Tech Stack:** Node/TypeScript (Fastify, pg, pg-boss, vitest), React/TypeScript (web), C++/PlatformIO/LVGL (firmware ESP32 CYD).

## Global Constraints

- Respostas ao usuário sempre em **português**.
- Firmware compila com **`py -m platformio run`** dentro de `firmware/` — nunca `pio` puro.
- O teste **reaproveita a pref de `temperature`** de cada contato; **não** cria tipo novo em `contact_alert_prefs` (sem mudança de schema nessa tabela).
- Template `test` é **só WhatsApp** (sem voz — teste não é emergência).
- Agendamento automático padrão: **segunda-feira 09:00**, fuso `America/Sao_Paulo`.
- Endpoint de device (`/api/device/test`) autentica por header `X-Device-Token` e é **rota pública** (sem JWT), igual `/api/ingest`.
- `notifyContacts`, `renderMessage`, `clientNameOf` são privados de `alertService.ts` — `sendTest` mora nesse arquivo.

---

### Task 1: Template `test` (seed) + rótulo na tela Mensagens

**Files:**
- Modify: `server/src/db/index.ts` (dentro de `DEFAULT_MESSAGE_TEMPLATES`)
- Modify: `web/src/pages/MessagesPage.tsx` (`LABELS`, `LEGEND`)

**Interfaces:**
- Produces: chave de template `test` disponível via `getMessageTemplate('test')` e no GET `/api/message-templates`.

- [ ] **Step 1: Adicionar a chave `test` ao seed**

Em `server/src/db/index.ts`, dentro do objeto `DEFAULT_MESSAGE_TEMPLATES`, logo após a chave `welcome`, adicione:

```ts
  test: {
    whatsapp: 'Teste PCG — {{$sensor}} ({{$local}}): temperatura atual {{$temperatura}}°C ({{$quando}}).',
  },
```

- [ ] **Step 2: Adicionar rótulo e legenda na tela Mensagens**

Em `web/src/pages/MessagesPage.tsx`, adicione uma entrada em `LABELS` (após `welcome`):

```ts
  test: 'Teste de dispositivo (manual/automático)',
```

E em `LEGEND` (após `welcome`):

```ts
  test: ['sensor', 'local', 'cliente', 'temperatura', 'quando'],
```

- [ ] **Step 3: Build do servidor e do web**

Run: `cd server && npm run build`
Expected: compila sem erros.

Run: `cd web && npm run build`
Expected: compila sem erros.

- [ ] **Step 4: Commit**

```bash
git add server/src/db/index.ts web/src/pages/MessagesPage.tsx
git commit -m "feat: template de mensagem 'test' para teste de dispositivo"
```

---

### Task 2: `sendTest(sensor)` — núcleo em alertService

**Files:**
- Modify: `server/src/services/alertService.ts`

**Interfaces:**
- Consumes: `queryLatestReadings(sensorIds: number[]): Promise<Map<number, LatestReading>>` de `influx.js` (onde `LatestReading = { temperature: number | null; humidity: number | null; time: string }`); helpers privados existentes `renderMessage(key, vars)`, `clientNameOf(sensor)`, `notifyContacts(alert, contacts, prefs, type, channels, texts, kind)`; queries já importadas `createResolvedAlert`, `listContacts`, `listContactAlertPrefsByClient`.
- Produces: `export async function sendTest(sensor: Sensor): Promise<void>`.

- [ ] **Step 1: Importar `queryLatestReadings`**

Em `server/src/services/alertService.ts`, adicione o import (junto dos outros imports de serviço):

```ts
import { queryLatestReadings } from './influx.js';
```

- [ ] **Step 2: Implementar `sendTest`**

Ao final de `server/src/services/alertService.ts`, adicione:

```ts
// Teste de dispositivo: mesma mensagem disparada pelo botão do painel, pelo device (ESP32) e
// pelo agendamento automático. Reaproveita a pref de 'temperature' de cada contato (janela/dias)
// via notifyContacts — o texto vem do template 'test', não da chave do tipo. Sem voz.
export async function sendTest(sensor: Sensor): Promise<void> {
  if (sensor.client_id === null) return; // sensor não reivindicado não tem contatos

  const latest = (await queryLatestReadings([sensor.id])).get(sensor.id);
  const cliente = await clientNameOf(sensor);
  const quando = latest?.time
    ? new Date(latest.time).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : '--:--';
  const vars = {
    sensor: sensor.name,
    cliente,
    local: sensor.local ?? '',
    temperatura: latest?.temperature ?? '--', // sem leitura recente ainda envia (revela sensor mudo)
    quando,
  };

  const texts = await renderMessage('test', vars);
  const alert = await createResolvedAlert(sensor.id, 'test', texts.whatsapp);
  const contacts = await listContacts(sensor.client_id);
  const prefs = await listContactAlertPrefsByClient(sensor.client_id);
  await notifyContacts(alert, contacts, prefs, 'temperature', ['whatsapp'], texts, 'fire');
}
```

- [ ] **Step 3: Build do servidor**

Run: `cd server && npm run build`
Expected: compila sem erros (confirma que os helpers privados e tipos batem).

- [ ] **Step 4: Commit**

```bash
git add server/src/services/alertService.ts
git commit -m "feat: sendTest() envia temperatura atual reusando pref de temperatura"
```

---

### Task 3: Botão web "Testar dispositivo" + rota + renomear botão do contato

**Files:**
- Modify: `server/src/routes/sensors.ts`
- Modify: `web/src/pages/SensorsPage.tsx`
- Modify: `web/src/pages/ClientContacts.tsx` (rename do botão antigo)

**Interfaces:**
- Consumes: `sendTest(sensor)` (Task 2); `getSensor(id)` já importado em `sensors.ts`.
- Produces: `POST /api/sensors/:id/test` → `{ ok: true }`.

- [ ] **Step 1: Adicionar import de `sendTest` na rota de sensores**

Em `server/src/routes/sensors.ts`, adicione:

```ts
import { sendTest } from '../services/alertService.js';
```

- [ ] **Step 2: Adicionar o endpoint**

Em `server/src/routes/sensors.ts`, dentro de `sensorsRoutes`, após o handler de `/calibrate`, adicione:

```ts
  app.post<{ Params: { id: string } }>('/api/sensors/:id/test', async (req) => {
    const sensor = await getSensor(Number(req.params.id));
    if (!sensor) throw Object.assign(new Error('sensor não encontrado'), { statusCode: 404 });
    await sendTest(sensor);
    return { ok: true };
  });
```

- [ ] **Step 3: Botão "Testar dispositivo" na SensorsPage**

Em `web/src/pages/SensorsPage.tsx`, na última `<td>` de cada linha (a que tem "Gráfico"/"Remover"), adicione um botão **antes** do "Gráfico", só quando o sensor tem cliente:

```tsx
                {s.client_id !== null && (
                  <>
                    <button
                      className="secondary"
                      onClick={() => runMutation(() => api.post(`/api/sensors/${s.id}/test`, {}), 'Teste enviado.')}
                    >
                      Testar dispositivo
                    </button>{' '}
                  </>
                )}
```

- [ ] **Step 4: Renomear o botão de teste do contato**

Em `web/src/pages/ClientContacts.tsx`, o botão que hoje mostra "Testar" (o que chama `sendTest(c)` local, `POST /api/contacts/:id/test`) passa a mostrar **"Testar canal"**:

```tsx
                <button className="secondary" onClick={() => sendTest(c)}>
                  Testar canal
                </button>{' '}
```

- [ ] **Step 5: Build servidor + web**

Run: `cd server && npm run build`
Expected: compila sem erros.

Run: `cd web && npm run build`
Expected: compila sem erros.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/sensors.ts web/src/pages/SensorsPage.tsx web/src/pages/ClientContacts.tsx
git commit -m "feat: botão 'Testar dispositivo' na tela de Sensores; renomeia teste de contato para 'Testar canal'"
```

---

### Task 4: Endpoint de device `POST /api/device/test`

**Files:**
- Modify: `server/src/routes/ingest.ts`
- Modify: `server/src/index.ts` (lista de rotas públicas)

**Interfaces:**
- Consumes: `sendTest(sensor)` (Task 2); `getSensorByToken(token)` já importado em `ingest.ts`.
- Produces: `POST /api/device/test` (auth por `X-Device-Token`) → `{ ok: true }`.

- [ ] **Step 1: Importar `sendTest` na rota de ingest**

Em `server/src/routes/ingest.ts`, ajuste o import de `alertService` para incluir `sendTest`:

```ts
import { evaluate, notifyAdminsReboot, sendTest } from '../services/alertService.js';
```

- [ ] **Step 2: Adicionar o endpoint**

Em `server/src/routes/ingest.ts`, dentro de `ingestRoutes`, após o handler de `/api/ingest`, adicione:

```ts
  // Disparado pelo botão "Testar dispositivo" na tela do ESP32 — mesma ação do botão do painel.
  app.post('/api/device/test', async (req) => {
    const token = req.headers['x-device-token'];
    if (typeof token !== 'string' || !token) {
      throw Object.assign(new Error('token ausente'), { statusCode: 401 });
    }
    const sensor = await getSensorByToken(token);
    if (!sensor) throw Object.assign(new Error('token inválido'), { statusCode: 401 });
    await sendTest(sensor);
    return { ok: true };
  });
```

- [ ] **Step 3: Tornar a rota pública (device usa token, não JWT)**

Em `server/src/index.ts`, adicione `'/api/device/test'` ao array `PUBLIC_API_ROUTES`:

```ts
const PUBLIC_API_ROUTES = ['/api/auth/login', '/api/client/login', '/api/ingest', '/api/provision', '/api/device/test'];
```

- [ ] **Step 4: Build do servidor**

Run: `cd server && npm run build`
Expected: compila sem erros.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/ingest.ts server/src/index.ts
git commit -m "feat: POST /api/device/test dispara teste a partir do ESP32 (token-auth)"
```

---

### Task 5: Firmware — botão "Testar dispositivo" no ESP32 + feedback na tela

**Files:**
- Modify: `firmware/src/net.h`
- Modify: `firmware/src/net.cpp`
- Modify: `firmware/src/ui.cpp`

**Interfaces:**
- Consumes: `SERVER_URL` (config.h), `storage::loadDeviceToken()`, `makeSecureClient()` (já em net.cpp).
- Produces: `net::requestDeviceTest()`, `enum class net::TestState`, `net::consumeTestResult()`.

- [ ] **Step 1: Declarar a API de teste em net.h**

Em `firmware/src/net.h`, dentro do `namespace net`, após a declaração de `pauseForScan`, adicione:

```cpp
// Resultado do teste disparado pela UI (core 1) e executado pela task de rede (core 0).
enum class TestState : uint8_t { IDLE, PENDING, SENT, FAILED };

// A UI chama para pedir um envio de teste (thread-safe, só seta um flag).
void requestDeviceTest();

// A UI faz poll do resultado; ao ler SENT/FAILED, o estado volta a IDLE (consumido).
TestState consumeTestResult();
```

- [ ] **Step 2: Implementar request/resultado em net.cpp**

Em `firmware/src/net.cpp`, logo após `void pauseForScan(bool pause) { scanPaused = pause; }`, adicione:

```cpp
// --- Teste de dispositivo (disparado pela UI) ------------------------------------------------
static volatile bool testRequested = false;
static volatile TestState testState = TestState::IDLE;

void requestDeviceTest() {
  testState = TestState::PENDING;
  testRequested = true;
}

TestState consumeTestResult() {
  TestState s = testState;
  if (s == TestState::SENT || s == TestState::FAILED) testState = TestState::IDLE;
  return s;
}
```

- [ ] **Step 3: Implementar `sendDeviceTest` após `makeSecureClient`**

Em `firmware/src/net.cpp`, logo **após** a função `makeSecureClient()` (por volta da linha 140), adicione:

```cpp
static void sendDeviceTest() {
  WiFiClientSecure client = makeSecureClient();
  HTTPClient http;
  if (!http.begin(client, String(SERVER_URL) + "/api/device/test")) {
    testState = TestState::FAILED;
    return;
  }
  http.addHeader("X-Device-Token", storage::loadDeviceToken());
  int code = http.POST("");
  http.end();
  testState = (code == 200) ? TestState::SENT : TestState::FAILED;
}
```

- [ ] **Step 4: Consumir o request dentro da task de rede**

Em `firmware/src/net.cpp`, dentro de `task()`, logo após o bloco de provisionamento (depois do `if (!provisioned) { ... }` e antes do bloco `if (millis() - lastSendMs >= SEND_INTERVAL_MS)`), adicione:

```cpp
    // Teste pedido pela UI — só chega aqui já conectado e provisionado.
    if (testRequested) {
      testRequested = false;
      sendDeviceTest();
    }
```

- [ ] **Step 5: Widget de feedback no dashboard (ui.cpp)**

Em `firmware/src/ui.cpp`, junto às declarações de widgets do dashboard (após `humSeries`), adicione:

```cpp
// overlay de feedback do teste de dispositivo
static lv_obj_t* testFeedbackLabel;
static uint32_t testFeedbackHideAt = 0;  // 0 = fica visível até o resultado chegar
```

E adicione os forward-decls junto aos outros `static void showX();` (área ~linha 100):

```cpp
static void showTestFeedback(const char* msg, uint32_t holdMs);
static void onMenuTestDevice(lv_event_t* e);
```

No final de `buildDashboard()` (após criar `humMinMaxLabel`), crie o label escondido:

```cpp
  testFeedbackLabel = lv_label_create(scrDashboard);
  lv_obj_set_style_bg_color(testFeedbackLabel, lv_color_hex(0x041036), 0);
  lv_obj_set_style_bg_opa(testFeedbackLabel, LV_OPA_COVER, 0);
  lv_obj_set_style_text_color(testFeedbackLabel, lv_color_hex(0xFFFFFF), 0);
  lv_obj_set_style_pad_all(testFeedbackLabel, 8, 0);
  lv_obj_align(testFeedbackLabel, LV_ALIGN_CENTER, 0, 0);
  lv_obj_add_flag(testFeedbackLabel, LV_OBJ_FLAG_HIDDEN);
```

- [ ] **Step 6: Helper `showTestFeedback` e callback do menu**

Em `firmware/src/ui.cpp`, após a definição de `showDashboard()`, adicione:

```cpp
// holdMs = 0 mantém visível até chegar o resultado; > 0 esconde sozinho depois desse tempo.
static void showTestFeedback(const char* msg, uint32_t holdMs) {
  lv_label_set_text(testFeedbackLabel, msg);
  lv_obj_clear_flag(testFeedbackLabel, LV_OBJ_FLAG_HIDDEN);
  testFeedbackHideAt = holdMs ? millis() + holdMs : 0;
}

static void onMenuTestDevice(lv_event_t* e) {
  net::requestDeviceTest();
  showDashboard();
  showTestFeedback("enviando...", 0);
}
```

- [ ] **Step 7: Adicionar o item ao menu**

Em `firmware/src/ui.cpp`, dentro de `buildMenu()`, após a linha do item "Redes WiFi", adicione:

```cpp
  lv_obj_add_event_cb(lv_list_add_btn(list, LV_SYMBOL_BELL, "Testar dispositivo"), onMenuTestDevice, LV_EVENT_CLICKED, nullptr);
```

- [ ] **Step 8: Poll do resultado em `tick()`**

Em `firmware/src/ui.cpp`, dentro de `void tick()`, após `pollWifiScan();`, adicione:

```cpp
  // Resultado do teste de dispositivo (setado pela task de rede) — atualiza o overlay.
  net::TestState ts = net::consumeTestResult();
  if (ts == net::TestState::SENT) showTestFeedback("enviado " LV_SYMBOL_OK, 3000);
  else if (ts == net::TestState::FAILED) showTestFeedback("falha ao enviar", 3000);
  if (testFeedbackHideAt && millis() >= testFeedbackHideAt) {
    lv_obj_add_flag(testFeedbackLabel, LV_OBJ_FLAG_HIDDEN);
    testFeedbackHideAt = 0;
  }
```

- [ ] **Step 9: Compilar o firmware**

Run: `cd firmware && py -m platformio run`
Expected: `SUCCESS` — compila sem erros.

- [ ] **Step 10: Commit**

```bash
git add firmware/src/net.h firmware/src/net.cpp firmware/src/ui.cpp
git commit -m "feat: botão 'Testar dispositivo' no ESP32 com feedback na tela"
```

---

### Task 6: Tabela `app_settings` + seed + queries

**Files:**
- Modify: `server/src/db/schema.sql`
- Modify: `server/src/db/index.ts` (nova `seedSettings`)
- Modify: `server/src/db/queries.ts`

**Interfaces:**
- Produces: `getSetting(key: string): Promise<string | null>`, `setSetting(key: string, value: string): Promise<void>`, `seedSettings(): Promise<void>`.

- [ ] **Step 1: Criar a tabela no schema**

Em `server/src/db/schema.sql`, ao final do arquivo, adicione:

```sql
-- Configurações globais chave-valor (ex. agendamento do teste automático).
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

- [ ] **Step 2: Queries get/set**

Em `server/src/db/queries.ts`, ao final do arquivo, adicione:

```ts
export const getSetting = (key: string) =>
  pool
    .query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [key])
    .then((r) => r.rows[0]?.value ?? null);

export const setSetting = (key: string, value: string) =>
  pool
    .query('INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, value])
    .then(() => undefined);
```

- [ ] **Step 3: Seed idempotente dos defaults**

Em `server/src/db/index.ts`, ao final do arquivo, adicione:

```ts
// Defaults do agendamento do teste automático — idempotente, não sobrescreve o que o admin salvou.
export async function seedSettings(): Promise<void> {
  const defaults: Record<string, string> = { test_schedule_dow: '1', test_schedule_time: '09:00' };
  for (const [key, value] of Object.entries(defaults)) {
    await pool.query(
      'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [key, value],
    );
  }
}
```

- [ ] **Step 4: Build do servidor**

Run: `cd server && npm run build`
Expected: compila sem erros.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/schema.sql server/src/db/queries.ts server/src/db/index.ts
git commit -m "feat: tabela app_settings com get/set e seed do agendamento"
```

---

### Task 7: notifier — cron configurável e teste automático por sensor

**Files:**
- Modify: `server/src/services/notifier.ts`
- Test: `server/src/services/notifier.test.ts` (novo)

**Interfaces:**
- Consumes: `sendTest(sensor)` (Task 2); `getSetting(key)` (Task 6); `listClients()`, `listSensors(clientId)` já importados.
- Produces: `export function buildTestCron(dow: string, time: string): string`; `export async function scheduleWeeklyTest(dow: string, time: string): Promise<void>`.

- [ ] **Step 1: Escrever o teste do cron builder (falha primeiro)**

Crie `server/src/services/notifier.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildTestCron } from './notifier.js';

describe('buildTestCron', () => {
  it('segunda 09:00 -> "0 9 * * 1"', () => {
    expect(buildTestCron('1', '09:00')).toBe('0 9 * * 1');
  });

  it('domingo 18:30 -> "30 18 * * 0"', () => {
    expect(buildTestCron('0', '18:30')).toBe('30 18 * * 0');
  });

  it('remove zero à esquerda de hora/minuto', () => {
    expect(buildTestCron('5', '07:05')).toBe('5 7 * * 5');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd server && npx vitest run src/services/notifier.test.ts`
Expected: FAIL — `buildTestCron` não existe / não exportado.

- [ ] **Step 3: Ajustar imports do notifier**

Em `server/src/services/notifier.ts`, troque o bloco de import de `../db/queries.js` por:

```ts
import {
  createNotification,
  getSetting,
  listClients,
  listSensors,
  updateNotificationStatus,
} from '../db/queries.js';
import { sendTest } from './alertService.js';
```

> `createNotification` e `updateNotificationStatus` continuam usados por `runJob`/enfileiramento; `createResolvedAlert` e `listContacts` deixam de ser usados aqui (eram só do resumo semanal antigo). O ciclo notifier↔alertService é seguro: as chamadas são em runtime, não no eval do módulo (mesmo padrão de ingest↔alertService).

- [ ] **Step 4: Implementar `buildTestCron` e `scheduleWeeklyTest`**

Em `server/src/services/notifier.ts`, após as constantes de fila (`QUEUE_OPTS`), adicione:

```ts
// 'HH:MM' + dia da semana (0-6) -> cron 'MM HH * * DOW'. A UI já valida os formatos.
export function buildTestCron(dow: string, time: string): string {
  const [hh, mm] = time.split(':');
  return `${Number(mm)} ${Number(hh)} * * ${Number(dow)}`;
}

export async function scheduleWeeklyTest(dow: string, time: string): Promise<void> {
  // pg-boss faz upsert pelo nome da fila — chamar de novo reprograma o cron em runtime.
  await getBoss().schedule(WEEKLY_TEST_QUEUE, buildTestCron(dow, time), {}, { tz: 'America/Sao_Paulo' });
}
```

- [ ] **Step 5: Reescrever `runWeeklyTest` (temperatura por sensor)**

Em `server/src/services/notifier.ts`, substitua todo o corpo de `runWeeklyTest` por:

```ts
// Antes era um resumo online/offline por cliente; agora envia a temperatura atual de cada
// sensor (uma msg por sensor), reusando sendTest — mesmo texto/pipeline do botão manual.
async function runWeeklyTest(): Promise<void> {
  for (const client of await listClients()) {
    for (const sensor of await listSensors(client.id)) {
      await sendTest(sensor);
    }
  }
}
```

- [ ] **Step 6: Ler as settings no boot em vez do cron fixo**

Em `server/src/services/notifier.ts`, dentro de `startNotifier`, substitua a linha do agendamento fixo:

```ts
  // Idempotente: chamar em todo boot é o padrão do pg-boss (upsert pelo nome do schedule).
  await b.schedule(WEEKLY_TEST_QUEUE, '0 9 * * 1', {}, { tz: 'America/Sao_Paulo' });
```

por:

```ts
  // Agendamento configurável (app_settings), com fallback pro padrão segunda 09:00.
  const dow = (await getSetting('test_schedule_dow')) ?? '1';
  const time = (await getSetting('test_schedule_time')) ?? '09:00';
  await scheduleWeeklyTest(dow, time);
```

- [ ] **Step 7: Rodar o teste e ver passar + build**

Run: `cd server && npx vitest run src/services/notifier.test.ts`
Expected: PASS (3 testes).

Run: `cd server && npm run build`
Expected: compila sem erros (confirma que os imports removidos não estão mais em uso).

- [ ] **Step 8: Commit**

```bash
git add server/src/services/notifier.ts server/src/services/notifier.test.ts
git commit -m "feat: teste automático envia temperatura por sensor com cron configurável"
```

---

### Task 8: Rota de agendamento + card na tela de Sensores

**Files:**
- Create: `server/src/routes/settings.ts`
- Modify: `server/src/index.ts` (import + registro + `seedSettings` no boot)
- Modify: `web/src/pages/SensorsPage.tsx`

**Interfaces:**
- Consumes: `getSetting`/`setSetting` (Task 6); `scheduleWeeklyTest` (Task 7); `seedSettings` (Task 6).
- Produces: `GET /api/settings/test-schedule` → `{ dow, time }`; `PUT /api/settings/test-schedule` (body `{ dow, time }`) → `{ ok: true }`.

- [ ] **Step 1: Criar a rota**

Crie `server/src/routes/settings.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { getSetting, setSetting } from '../db/queries.js';
import { scheduleWeeklyTest } from '../services/notifier.js';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings/test-schedule', async () => ({
    dow: (await getSetting('test_schedule_dow')) ?? '1',
    time: (await getSetting('test_schedule_time')) ?? '09:00',
  }));

  app.put<{ Body: { dow: string; time: string } }>('/api/settings/test-schedule', async (req) => {
    const { dow, time } = req.body ?? ({} as { dow: string; time: string });
    if (!/^[0-6]$/.test(String(dow)) || !/^\d{2}:\d{2}$/.test(String(time))) {
      throw Object.assign(new Error('dow deve ser 0-6 e time no formato HH:MM'), { statusCode: 400 });
    }
    await setSetting('test_schedule_dow', String(dow));
    await setSetting('test_schedule_time', String(time));
    await scheduleWeeklyTest(String(dow), String(time)); // reprograma o cron em runtime
    return { ok: true };
  });
}
```

- [ ] **Step 2: Registrar a rota e chamar `seedSettings` no boot**

Em `server/src/index.ts`, adicione o import:

```ts
import { settingsRoutes } from './routes/settings.js';
```

Ajuste o import de `./db/index.js` para incluir `seedSettings`:

```ts
import { migrate, pool, seedAdmin, seedMessageTemplates, seedSettings } from './db/index.js';
```

Registre a rota junto das outras (após `await app.register(messageTemplatesRoutes);`):

```ts
await app.register(settingsRoutes);
```

E chame o seed no boot, logo após `await seedMessageTemplates();`:

```ts
await seedSettings();
```

- [ ] **Step 3: Card "Teste automático" na SensorsPage**

Em `web/src/pages/SensorsPage.tsx`, adicione estado (junto dos outros `useState`):

```tsx
  const [schedDow, setSchedDow] = useState('1');
  const [schedTime, setSchedTime] = useState('09:00');
```

Na função `load()`, adicione a busca do agendamento:

```tsx
    api
      .get<{ dow: string; time: string }>('/api/settings/test-schedule')
      .then((s) => {
        setSchedDow(s.dow);
        setSchedTime(s.time);
      })
      .catch(() => {});
```

E logo após `<h2>Sensores em Campo</h2>` (antes do `kpi-grid`), adicione o card:

```tsx
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="inline">
          <strong>Teste automático:</strong>
          <label>
            dia{' '}
            <select value={schedDow} onChange={(e) => setSchedDow(e.target.value)}>
              <option value="0">domingo</option>
              <option value="1">segunda</option>
              <option value="2">terça</option>
              <option value="3">quarta</option>
              <option value="4">quinta</option>
              <option value="5">sexta</option>
              <option value="6">sábado</option>
            </select>
          </label>
          <label>
            hora <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} />
          </label>
          <button
            onClick={() =>
              runMutation(
                () => api.put('/api/settings/test-schedule', { dow: schedDow, time: schedTime }),
                'Agendamento salvo.',
              )
            }
          >
            Salvar
          </button>
        </div>
      </div>
```

- [ ] **Step 4: Build servidor + web**

Run: `cd server && npm run build`
Expected: compila sem erros.

Run: `cd web && npm run build`
Expected: compila sem erros.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/settings.ts server/src/index.ts web/src/pages/SensorsPage.tsx
git commit -m "feat: agendamento do teste automático configurável no painel"
```

---

## Notas de teste (por que não há mock de DB)

O repositório testa **funções puras** (ver `alertService.test.ts`, `scheduleWindow.test.ts`) — não há mock de `pool`/influx em nenhum teste. Mantemos esse padrão:

- `buildTestCron` (Task 7) é puro e tem teste unitário.
- `sendTest` é orquestração de I/O (DB + influx + fila), como `notifyAdminsReboot`/`notifyAdminsHardware` — que também não têm teste unitário. Validação end-to-end é manual: apertar "Testar dispositivo" e conferir a chegada no WhatsApp.

## Verificação manual (após implementar tudo)

1. `cd server && npm run build && npm test` — build e testes verdes.
2. `cd web && npm run build` — build verde.
3. `cd firmware && py -m platformio run` — firmware compila.
4. Subir o servidor, abrir o painel:
   - Sensores → "Testar dispositivo" num sensor com cliente → contatos recebem a temperatura atual no WhatsApp.
   - Mensagens → editar o template "Teste de dispositivo" → o texto muda no próximo teste.
   - Sensores → mudar dia/hora do "Teste automático" → salvar (sem erro).
   - Contato desativado ou fora da janela de `temperature` → não recebe (auditável em `notifications.status`).
5. No ESP32 (com device provisionado): relógio → PIN → "Testar dispositivo" → tela mostra "enviando..." e depois "enviado ✓"; contatos recebem no WhatsApp.
