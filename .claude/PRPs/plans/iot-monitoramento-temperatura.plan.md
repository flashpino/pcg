# Plan: Sistema de Monitoramento de Temperatura/Umidade Multi-cliente (ESP32 + DHT22)

## Summary
Sistema IoT completo: firmware para **ESP32-2432S028 (CYD — display TFT 2.8" ILI9341 + touch resistivo XPT2046)** com DHT22, exibindo temperatura/umidade em tela (layout da foto de referência: relógio, ícone de sinal, dois painéis com valor grande, sparkline e max/min) e enviando leituras via HTTPS para um backend Node/TypeScript, que grava no InfluxDB (já existente na VPS) e mantém cadastro relacional (clientes → sensores → contatos) em Postgres. Motor de alertas com fila persistente (pg-boss) dispara ligações Twilio e respeita janelas de horário por contato. Painel React para administração. OTA por HTTP pull para atualização remota do firmware.

## User Story
Como operador do serviço de monitoramento, quero cadastrar clientes, sensores e contatos com preferências individuais de alerta, para que cada contato receba apenas os alertas que quer (tipo, canal, horário) mesmo com dispositivos em locais remotos de difícil acesso.

## Problem → Solution
Nada existe (diretório vazio) → Monorepo com `firmware/`, `server/` e `web/`, deployado via Docker Compose na VPS ao lado do InfluxDB existente.

## Metadata
- **Complexity**: XL (greenfield, 3 subsistemas)
- **Source PRD**: N/A (descrição livre)
- **PRD Phase**: N/A
- **Estimated Files**: ~40

---

## Decisões de Arquitetura (confirmadas com o usuário)

| Decisão | Escolha | Motivo |
|---|---|---|
| Backend | Node.js + TypeScript + Fastify | Ecossistema maduro (Twilio SDK, @influxdata/influxdb-client) |
| Hardware | **ESP32-2432S028R "CYD"** — TFT ILI9341 240×320 + touch XPT2046 + DHT22 no GPIO 27 (conector CN1) | Definido pelo usuário; display integrado barato |
| UI do device | LVGL 8.3 + TFT_eSPI + XPT2046_Touchscreen | LVGL dá teclado touch (senha WiFi/PIN), telas e widgets de graça — desenhar isso na mão custaria mais |
| Firmware | **Binário único universal** — nada específico por device compilado | 1 .bin serve os 50 sensores; OTA publica um arquivo só |
| Provisionamento WiFi | **Na tela do device** (scan + teclado touch), credenciais em NVS (Preferences) | Elimina recompilar firmware por local; `config.h` só carrega SERVER_URL + FW_VERSION |
| Identidade do device | **Auto-provisionamento por MAC**: 1º boot → `POST /api/provision {mac}` → server cria sensor "não reivindicado" e devolve token → NVS. Painel: admin atribui a um cliente | Sem token compilado (quebraria o binário único) e sem digitar 48 chars no touch |
| Conectividade ESP32 | WiFi local | Locais têm internet |
| InfluxDB | **Já existe na VPS** — só consumir | Não provisionar; usar URL/token/org/bucket via env |
| Escala | ~50 sensores | Arquitetura de processo único, sem HA |
| Transporte device→server | HTTPS POST direto (sem MQTT) | A 50 sensores, HTTP basta; elimina um broker inteiro |
| DB relacional + fila | Postgres + pg-boss | Um serviço só cobre cadastro E fila com retry/backoff — evita Redis |
| Painel | React (Vite) SPA servida pelo próprio Fastify | Um processo, um deploy |
| OTA | HTTP pull (ESP32 `HTTPUpdate`), disparado pela resposta do ingest | Sem push, sem porta aberta no device |
| Alertas de temperatura | Avaliados **no ingest** (sem polling do Influx) | Dado já está na mão; menos uma rotina |
| Alertas de conectividade | Sweep de `last_seen_at` a cada 60s no Postgres | Simples, não depende do Influx |
| WhatsApp | **Evolution API** (já configurada, número conectado) — texto livre, sem templates Meta | Infra existente do usuário; Twilio fica SÓ para voz |
| Anti-spam Meta | Fila de WhatsApp **serializada** (1 por vez) + jitter aleatório 3–8s entre envios | Disparos simultâneos/rajada = bloqueio do número pela Meta |
| Voz | **1 ligação por alerta** (só no disparo inicial; re-alertas só por WhatsApp) | Requisito explícito; ligação repetida é intrusiva |
| Re-alerta | Intervalo configurável **por contato** (`renotify_minutes`, 0 = não repetir) | Requisito explícito |
| Teste semanal | `boss.schedule` (cron do pg-boss) — valida canal + pipeline por cliente | Requisito explícito; detecta credencial/número quebrado antes da emergência |

### Diagrama

```
ESP32+DHT22 ──HTTPS POST /api/ingest──> Fastify (server/)
  │ (OTA pull /api/ota)                    │
  │                                        ├─> InfluxDB (existente) ── leituras
  │                                        ├─> Postgres ── cadastro + estado de alertas + fila pg-boss
  │                                        └─> Worker pg-boss ──> Twilio (voz/SMS)
Painel React (web/) ──/api/*──────────> mesma Fastify
```

---

## UX Design

### Before
N/A — nada existe.

### After (painel)
```
┌─ Login (admin) ─────────────────────────────────────────┐
│ Clientes                                                 │
│ ├─ Cliente A                                             │
│ │   ├─ Sensores: [Câmara Fria 1: 4.2°C 78% ● online]     │
│ │   │   config: limites min/max, intervalo, firmware     │
│ │   └─ Contatos: [João — voz+whatsapp, temp only, seg-sex│
│ │                 07:00–18:00, TZ America/Sao_Paulo]     │
│ ├─ Alertas ativos / histórico                            │
│ └─ Firmware: upload .bin, versão por sensor              │
└──────────────────────────────────────────────────────────┘
```

### After (tela do device — réplica da foto de referência)
```
┌──────────────────────────────────────────────┐
│ ● 16:40  ter 16 jun                  cpd ▂▄▆█│  ← header: status, relógio (NTP), nome, sinal
├──────────────────────┬───────────────────────┤
│ TEMPERATURA          │ UMIDADE               │
│                      │                       │
│   21.1               │   69.9                │  ← valor grande (decimal menor)
│   ~~~~ sparkline     │   ~~~~ sparkline      │  ← últimas ~50 leituras
│ max 21.7   min 21.1  │ max 71%    min 69%    │  ← max/min do dia
└──────────────────────┴───────────────────────┘
 toque no relógio → PIN (teclado numérico) → Menu Configurações:
   [Redes WiFi (scan + senha)] [Nome do dispositivo]
   [IP: DHCP/estático] [Trocar PIN] [Calibrar touch] [Reiniciar]
 toque no ícone de sinal → tela Info de Rede:
   SSID, IP, máscara, gateway, DNS, MAC, RSSI dBm, versão do firmware
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Tela do device | — | Dashboard temp/umidade + sparklines + max/min | Layout da foto (Proatus) |
| Toque no relógio | — | PIN → menu de configurações | PIN em NVS, default trocável |
| Toque no sinal WiFi | — | Info de rede (IP, MAC, RSSI, SSID) | Sem PIN — só leitura |
| Cadastro | — | CRUD clientes/sensores/contatos | Admin only (single-role no MVP) |
| Alertas | — | Lista FIRING/RESOLVED + log de notificações | Mostra por que um contato não foi notificado (fora de janela, mudo) |
| Firmware | — | Upload de .bin + atribuição de versão-alvo por sensor | |

---

## Mandatory Reading

Greenfield — não há código para ler. Leituras externas obrigatórias:

| Priority | Fonte | Por quê |
|---|---|---|
| P0 | https://docs.influxdata.com/influxdb/v2/api/#operation/PostWrite | Line protocol + precisão de escrita |
| P0 | https://www.twilio.com/docs/voice/api/call-resource | Criar chamada com TwiML inline (`twiml=` param) |
| P1 | https://github.com/timgit/pg-boss (README) | `send()` com `retryLimit`/`retryBackoff`, `work()` |
| P1 | ESP32 Arduino `HTTPUpdate` docs | OTA: `httpUpdate.update(client, url)` retorna HTTP_UPDATE_OK/FAILED |
| P2 | DHT sensor library (Adafruit) | DHT22: leitura mín. a cada 2s; retorna NaN em falha |
| P0 | https://github.com/witnessmenow/ESP32-Cheap-Yellow-Display | Pinout do CYD, User_Setup do TFT_eSPI, exemplos LVGL+touch |
| P1 | LVGL 8.3 docs (lv_keyboard, lv_textarea, screens) | Teclado touch para senha WiFi e PIN |

## External Documentation — Key Insights

```
KEY_INSIGHT: DHT22 retorna NaN em leitura falha (~5% das leituras em cabos longos)
APPLIES_TO: firmware — retry até 3x com 2.5s de intervalo antes de desistir do ciclo
GOTCHA: ler mais rápido que 2s trava o sensor

KEY_INSIGHT: Twilio Voice aceita TwiML inline no POST de criação da chamada
APPLIES_TO: worker de notificação — não precisa hospedar endpoint TwiML
GOTCHA: <Say language="pt-BR"> para voz em português

KEY_INSIGHT: Evolution API — envio de texto: POST {EVOLUTION_URL}/message/sendText/{instance}
com header apikey e body { number: '5511999999999', text: '...' }; número sem '+' e sem
formatação. GET /instance/connectionState/{instance} verifica se o WhatsApp está conectado
APPLIES_TO: notifier (canal whatsapp) e /health (estado da instância)
GOTCHA: Evolution usa WhatsApp Web por baixo — rajadas de mensagens = banimento do número
pela Meta. Serializar (1 envio por vez) + jitter aleatório 3–8s entre envios. Sem templates,
texto livre OK. Se a instância desconectar (QR code expirado), envios falham: o retry da
fila segura, mas alertar o admin no painel via /health

KEY_INSIGHT: pg-boss cria seu próprio schema (pgboss) e faz retry com backoff exponencial nativo
APPLIES_TO: fila de notificações — retryLimit: 5, retryBackoff: true resolve "fila presa"
GOTCHA: chamar boss.start() antes de qualquer send/work; usar expireInSeconds para jobs zumbis

KEY_INSIGHT: InfluxDB client Node tem writeApi com flush automático; erros de escrita são assíncronos
APPLIES_TO: ingest — usar writeApi.flush() explícito e capturar erro para responder 500 ao device
GOTCHA: cardinalidade — usar tags client_id e sensor_id (baixa cardinalidade), NUNCA timestamp/valor como tag

KEY_INSIGHT: ESP32 Task Watchdog + esp_task_wdt_reset() reinicia a placa se o loop travar
APPLIES_TO: firmware — robustez em local remoto: watchdog de 30s sempre armado
GOTCHA: OTA demora >30s; alimentar o watchdog durante httpUpdate via callback de progresso

KEY_INSIGHT: No CYD, o touch XPT2046 fica em um barramento SPI SEPARADO do TFT
(touch: CLK=25, MOSI=32, MISO=39, CS=33, IRQ=36; TFT no VSPI padrão; backlight=GPIO 21)
APPLIES_TO: platformio.ini (build_flags do TFT_eSPI) e init do XPT2046_Touchscreen
GOTCHA: usar SPIClass dedicada para o touch; calibração do touch resistivo varia por unidade
— guardar calibração em NVS com tela de calibração no primeiro boot

KEY_INSIGHT: GPIOs livres no CYD são poucos (CN1: GPIO 22/27/35; P3: GPIO 21/22/35)
APPLIES_TO: DHT22 no GPIO 27 (CN1 tem 3V3 e GND no mesmo conector)
GOTCHA: GPIO 35 é input-only; GPIO 21 é o backlight — não usar

KEY_INSIGHT: LVGL 8 precisa de lv_timer_handler() a cada ~5ms e buffer de draw em DMA
APPLIES_TO: loop do firmware — rede (HTTPS POST) bloqueia; rodar o envio de forma que
a UI não congele (POST síncrono ok se < 2s, senão task FreeRTOS separada para rede)
GOTCHA: LVGL não é thread-safe — só tocar em widgets a partir da task da UI
```

---

## Patterns to Mirror

Greenfield — o plano DEFINE as convenções. Todo código novo segue isto:

### NAMING_CONVENTION
```
server/src/routes/ingest.ts        — rotas: kebab-case por recurso
server/src/services/alertService.ts — services: camelCase + sufixo Service
server/src/db/schema.sql            — SQL: snake_case
web/src/pages/SensorsPage.tsx       — componentes: PascalCase
firmware/src/main.cpp               — firmware: um main.cpp + headers por módulo
```

### ERROR_HANDLING (server)
```ts
// Fastify: lançar erro com statusCode; handler global loga e responde JSON
throw Object.assign(new Error('sensor não encontrado'), { statusCode: 404 });
// setErrorHandler: log estruturado + { error: message } — nunca engolir erro silenciosamente
```

### LOGGING_PATTERN
```ts
// Usar o logger nativo do Fastify (pino), JSON estruturado
app.log.info({ sensorId, temp, hum }, 'ingest ok');
app.log.error({ err, jobId }, 'twilio call failed');
```

### REPOSITORY_PATTERN
```ts
// SEM ORM. pg (node-postgres) + SQL puro em server/src/db/queries.ts
// ponytail: 8 tabelas não justificam Prisma
export const getSensorByToken = (token: string) =>
  pool.query<Sensor>('SELECT * FROM sensors WHERE device_token = $1', [token]);
```

### TEST_STRUCTURE
```ts
// vitest, arquivos *.test.ts ao lado do código testado
// Testar APENAS a lógica de decisão: alertEvaluator, scheduleWindow, dedup
import { describe, it, expect } from 'vitest';
describe('isWithinWindow', () => {
  it('seg 07:00 dentro de seg-sex 07:00-18:00 → true', () => { ... });
});
```

---

## Modelo de Dados (Postgres — `server/src/db/schema.sql`)

```sql
CREATE TABLE clients (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE sensors (
  id SERIAL PRIMARY KEY,
  client_id INT REFERENCES clients(id),    -- NULL = não reivindicado (auto-provisionado)
  name TEXT NOT NULL,                      -- default: 'novo-' || mac
  mac TEXT UNIQUE NOT NULL,                -- identidade física do device
  device_token TEXT UNIQUE NOT NULL,       -- auth do device (emitido no provision)
  temp_min NUMERIC, temp_max NUMERIC,      -- limites de alerta
  hum_min NUMERIC, hum_max NUMERIC,        -- opcionais
  interval_seconds INT NOT NULL DEFAULT 60,
  offline_after_seconds INT NOT NULL DEFAULT 300,
  target_firmware TEXT,                    -- versão OTA desejada (NULL = latest)
  last_seen_at TIMESTAMPTZ,
  last_firmware TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE contacts (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,                     -- E.164
  alert_temperature BOOLEAN NOT NULL DEFAULT true,
  alert_connectivity BOOLEAN NOT NULL DEFAULT true,
  channel_voice BOOLEAN NOT NULL DEFAULT true,
  channel_whatsapp BOOLEAN NOT NULL DEFAULT true,
  renotify_minutes INT NOT NULL DEFAULT 60,          -- re-alerta por whatsapp enquanto firing; 0 = só o disparo inicial
  days_of_week INT[] NOT NULL DEFAULT '{1,2,3,4,5}', -- 0=dom..6=sab
  window_start TIME NOT NULL DEFAULT '07:00',
  window_end TIME NOT NULL DEFAULT '18:00',
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE alerts (
  id SERIAL PRIMARY KEY,
  sensor_id INT NOT NULL REFERENCES sensors(id),
  type TEXT NOT NULL CHECK (type IN ('temperature','humidity','connectivity','test')),
  state TEXT NOT NULL CHECK (state IN ('firing','resolved')),
  value NUMERIC, message TEXT NOT NULL,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
-- dedup no banco: só 1 alerta firing por sensor+tipo
CREATE UNIQUE INDEX alerts_one_firing ON alerts (sensor_id, type) WHERE state = 'firing';
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  alert_id INT NOT NULL REFERENCES alerts(id),
  contact_id INT NOT NULL REFERENCES contacts(id),
  channel TEXT NOT NULL,                   -- 'voice' | 'whatsapp'
  status TEXT NOT NULL DEFAULT 'queued',   -- queued|sent|failed|skipped_window|skipped_pref
  detail TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE firmware (
  id SERIAL PRIMARY KEY,
  version TEXT UNIQUE NOT NULL,            -- semver "1.2.0"
  filename TEXT NOT NULL,                  -- caminho em server/firmware-bin/
  sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE users (
  id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL              -- bcrypt; admin only no MVP
);
```

**InfluxDB (já existe)**: measurement `readings`, tags `client_id`, `sensor_id`; fields `temperature`, `humidity`, `rssi`; env: `INFLUX_URL`, `INFLUX_TOKEN`, `INFLUX_ORG`, `INFLUX_BUCKET`.

---

## API (contrato)

| Rota | Auth | Descrição |
|---|---|---|
| `POST /api/provision` | — (aberto; TOFU) | body `{mac}` → se MAC desconhecido, cria sensor `client_id NULL` (não reivindicado) com token novo; se já existe, **404** (token não é reemitido — evita sequestro por MAC conhecido). Painel lista não-reivindicados para atribuir cliente/nome |
| `POST /api/ingest` | header `X-Device-Token` | body `{readings: [{temp, hum, rssi, ago_ms}], fw, device_name}` → grava Influx, atualiza `last_seen_at`+`last_firmware`, avalia alerta de temp/umidade, responde `{ok, ota?: {version, url}}` |
| `GET /api/ota/firmware/:version.bin` | `X-Device-Token` | download do binário |
| `POST /api/auth/login` | — | JWT (fastify-jwt), cookie httpOnly |
| CRUD `/api/clients`, `/api/sensors`, `/api/contacts` | JWT | painel |
| `POST /api/contacts/:id/welcome` | JWT | enfileira mensagem de boas-vindas (WhatsApp) |
| `POST /api/contacts/:id/test` | JWT | enfileira notificação de teste nos canais ativos |
| `GET /api/sensors/:id/readings?range=24h` | JWT | proxy de query Flux para gráficos |
| `GET /api/alerts?state=firing` | JWT | lista + notifications embutidas |
| `POST /api/firmware` (multipart .bin + version) | JWT | upload OTA |

**Resposta do ingest carrega a ordem de OTA** — o device não precisa de consulta periódica extra: se `fw` reportado ≠ `target_firmware` do sensor, o server inclui `ota` na resposta e o device atualiza na hora. Zero rotas extras de "check".

---

## Files to Change

| File | Action | Justificativa |
|---|---|---|
| `docker-compose.yml` | CREATE | server + postgres (Influx fica de fora — já existe) |
| `.env.example` | CREATE | todas as envs documentadas |
| `server/package.json`, `tsconfig.json` | CREATE | fastify, pg, pg-boss, @influxdata/influxdb-client, twilio, @fastify/jwt, @fastify/multipart, @fastify/static, bcryptjs, vitest |
| `server/src/index.ts` | CREATE | bootstrap: env-check, migrate, boss.start, rotas, static do web/dist |
| `server/src/db/schema.sql` + `server/src/db/index.ts` | CREATE | pool + migrate idempotente (executa schema.sql com IF NOT EXISTS) |
| `server/src/db/queries.ts` | CREATE | SQL puro tipado |
| `server/src/routes/{ingest,auth,clients,sensors,contacts,alerts,firmware}.ts` | CREATE | rotas |
| `server/src/services/influx.ts` | CREATE | writeApi + query Flux |
| `server/src/services/alertService.ts` | CREATE | avaliação, dedup, transição firing↔resolved, enfileiramento |
| `server/src/services/scheduleWindow.ts` | CREATE | janela por contato (dias, horário, timezone) — pura, testável |
| `server/src/services/notifier.ts` | CREATE | worker pg-boss → Twilio voice/SMS |
| `server/src/services/connectivitySweep.ts` | CREATE | setInterval 60s: sensores sem last_seen → alerta connectivity |
| `server/src/services/*.test.ts` (3 arquivos) | CREATE | vitest: scheduleWindow, alertService, dedup |
| `web/` (Vite + React + TS, ~10 arquivos) | CREATE | Login, ClientsPage, SensorsPage (com gráfico), ContactsPage, AlertsPage, FirmwarePage |
| `firmware/platformio.ini` | CREATE | board esp32dev, libs: lvgl@^8.3, TFT_eSPI, XPT2046_Touchscreen, DHT sensor library, ArduinoJson; build_flags com pinout CYD do TFT_eSPI |
| `firmware/src/main.cpp` | CREATE | setup + loop: watchdog, lv_timer_handler, ciclo de leitura/envio (ver Task 12) |
| `firmware/src/ui.cpp/.h` | CREATE | LVGL: dashboard (foto), tela PIN, menu config, scan WiFi, info de rede, calibração touch (ver Task 13) |
| `firmware/src/net.cpp/.h` | CREATE | WiFi (conexão/backoff/reconexão), NTP, POST ingest, buffer offline, OTA |
| `firmware/src/storage.cpp/.h` | CREATE | NVS (Preferences): ssid/senha, nome do device, PIN, IP estático, calibração touch |
| `firmware/src/config.h.example` | CREATE | SERVER_URL, FW_VERSION apenas — binário universal; WiFi e token vivem no NVS |
| `README.md` | CREATE | setup, provisionamento de device, deploy |

## NOT Building
- MQTT broker (HTTP basta em ~50 sensores; migrar se passar de ~500)
- Multi-tenancy com login por cliente (MVP: admin único opera o painel)
- SMS/e-mail/Telegram (só voz+WhatsApp Twilio; a coluna `channel` já comporta extensão)
- Config de credenciais Twilio pelo painel (ficam em env — segredo de infra, muda quase nunca; o que o admin gerencia no painel é por-contato: canais, tipos, janelas)
- HA/cluster/Redis (processo único + restart: always)
- App mobile
- Portal cativo/WiFiManager (o provisionamento WiFi é pela própria tela touch do CYD — melhor UX e sem AP exposto)
- Escalonamento em cadeia de alertas (re-alerta simples por cooldown cobre o MVP)

---

## Protocolo de Sessão (OBRIGATÓRIO — 1 task = 1 sessão)

Cada task deste plano é executada em uma sessão nova do Claude Code. Toda sessão segue este ritual:

1. **Início**: ler `STATUS.md` (raiz) → identifica a task atual; ler a task correspondente neste plano; ler `docs/sessions/task-NN.md` da task anterior (contexto de handoff). Se existir `graphify-out/`, usar `/graphify query` para dúvidas sobre o código já construído em vez de reler arquivos.
2. **Implementar** a task inteira, rodando os VALIDATE dela.
3. **Documentar**: escrever `docs/sessions/task-NN.md` com: o que foi feito, arquivos criados/alterados, decisões tomadas que divergiram do plano (e por quê), pendências deixadas, e instruções de contexto para a próxima sessão.
4. **Atualizar `STATUS.md`**: marcar a task como `done`, apontar a próxima.
5. **Mapear**: rodar `/graphify . --update` para incorporar as alterações ao knowledge graph (`graphify-out/`).
6. **Parar.** Não iniciar a próxima task na mesma sessão.

Ordem das sessões: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 8b → 9 → 10 → 11 → 12 → 13 → 14 → 15 (16 sessões).

## Step-by-Step Tasks

### Task 1: Scaffold do monorepo
- **ACTION**: criar estrutura `server/`, `web/`, `firmware/`, docker-compose, .env.example, .gitignore, `git init`.
- **IMPLEMENT**: compose com `postgres:16-alpine` (volume nomeado) e `server` (build ./server, `restart: always`, env_file). Influx NÃO entra — apontar via `INFLUX_URL`.
- **VALIDATE**: `docker compose config` sem erro.

### Task 2: Bootstrap do server + migração
- **ACTION**: Fastify app com env-check fatal no boot (todas as envs obrigatórias: DATABASE_URL, INFLUX_*, TWILIO_*, JWT_SECRET) e migração idempotente.
- **IMPLEMENT**: `db/index.ts` roda `schema.sql` (tudo `CREATE TABLE IF NOT EXISTS`) no start. Sem ferramenta de migração — ponytail: adicionar node-pg-migrate quando o schema mudar em produção.
- **GOTCHA**: se qualquer env faltar, `process.exit(1)` com mensagem clara — servidor meio-configurado em local remoto é o pior cenário.
- **VALIDATE**: `npm run dev` sobe, `GET /health` → 200 com `{db: 'ok', influx: 'ok'}`.

### Task 3: Auth admin
- **ACTION**: `POST /api/auth/login` com bcrypt + @fastify/jwt em cookie httpOnly; hook `onRequest` que protege tudo exceto `/api/ingest`, `/api/ota/*`, `/api/auth/login`, `/health`.
- **IMPLEMENT**: seed do admin via env `ADMIN_EMAIL`/`ADMIN_PASSWORD` no primeiro boot.
- **VALIDATE**: curl sem cookie em `/api/clients` → 401.

### Task 4: CRUD clients/sensors/contacts
- **ACTION**: rotas REST + queries SQL. Sensores NASCEM pelo `/api/provision` (token via `crypto.randomBytes(24).toString('hex')`); o CRUD de sensors é atribuir cliente/nome/limites e listar não-reivindicados (`client_id IS NULL`). Ingest de sensor não reivindicado grava no Influx mas não dispara alertas (não tem contatos ainda).
- **MIRROR**: REPOSITORY_PATTERN e ERROR_HANDLING acima.
- **VALIDATE**: sequência curl create/list/update/delete.

### Task 5: Ingest + escrita no Influx
- **ACTION**: `POST /api/ingest` — valida token, valida body (temp entre -60 e 100, hum 0–100, rejeita NaN/null), aceita lote (`readings[]` com `ago_ms` para leituras bufferizadas offline — timestamp = now - ago_ms), escreve line protocol, atualiza `last_seen_at`/`last_firmware`, chama `alertService.evaluate(sensor, latestReading)`, monta resposta com `ota` se `target_firmware` divergir.
- **IMPORTS**: `@influxdata/influxdb-client` → `new InfluxDB({url, token}).getWriteApi(org, bucket, 'ms')`.
- **GOTCHA**: `await writeApi.flush()` em try/catch → 500 se Influx cair (o device faz buffer e reenvia; ver Task 12). Validação de faixa é fronteira de confiança — não simplificar.
- **VALIDATE**: curl de ingest → ponto visível no Influx e `last_seen_at` atualizado.

### Task 6: alertService (o coração — máquina de estados + dedup)
- **ACTION**: transição de estado: leitura fora do limite E sem alerta `firing` do mesmo tipo → cria alerta + enfileira notificações; leitura normal E existe `firing` → marca `resolved` + enfileira notificação de resolução.
- **IMPLEMENT**: dedup garantido pelo índice parcial `alerts_one_firing` (INSERT com `ON CONFLICT DO NOTHING` — se conflitar, alerta já existe, não re-notifica). Re-alerta **por contato**: enquanto firing, re-notificar via WhatsApp a cada `contact.renotify_minutes` (comparar última notification `sent` daquele contato+alerta; `0` = nunca repetir). **Voz é SEMPRE 1x por alerta** — job de voz só no disparo inicial, nunca no re-alerta nem na resolução.
- **GOTCHA**: histerese — resolver só quando voltar 0.5°C para dentro do limite, senão flapping no limiar gera spam de ligações.
- **VALIDATE**: `alertService.test.ts` — casos: dispara 1x, não duplica, resolve com histerese, re-dispara após cooldown.

### Task 7: scheduleWindow (janelas por contato)
- **ACTION**: função pura `isWithinWindow(contact, now: Date): boolean` usando `Intl.DateTimeFormat` com a `timezone` do contato (zero dependências de data).
- **GOTCHA**: janela que cruza meia-noite (22:00–06:00) — `start > end` inverte a comparação. Testar explicitamente.
- **VALIDATE**: `scheduleWindow.test.ts` — dentro, fora, cruzando meia-noite, timezone ≠ do servidor, dia não incluído.

### Task 8: Filas de notificação (pg-boss) — WhatsApp (Evolution) + Voz (Twilio)
- **ACTION**: no enfileiramento, para cada contato do cliente: filtro por preferência de tipo (`alert_temperature`/`alert_connectivity`) e por janela → fora disso grava `notifications.status='skipped_*'` (auditável no painel). Dentro: **duas filas separadas** — `boss.send('notify-whatsapp', ...)` e `boss.send('notify-voice', ...)`, ambas com `{ retryLimit: 5, retryBackoff: true, expireInSeconds: 120 }`.
- **IMPLEMENT**:
  - **Fila WhatsApp SERIALIZADA**: `boss.work('notify-whatsapp', { teamSize: 1 }, handler)` — 1 mensagem por vez, e o handler termina com `sleep(3000 + random(5000))` (jitter 3–8s). Rajada simultânea = bloqueio do número pela Meta; essa fila é o único caminho de saída de WhatsApp do sistema inteiro (alertas, boas-vindas, testes — tudo passa por ela e herda o throttle).
  - **Envio**: `POST {EVOLUTION_URL}/message/sendText/{EVOLUTION_INSTANCE}` com header `apikey`, body `{ number: telefoneSemMais, text }`. Texto livre em pt-BR com nome do sensor, valor e limite.
  - **Fila de voz**: `boss.work('notify-voice', { teamSize: 3 })` → `client.calls.create({ to, from, twiml: '<Response><Say language="pt-BR">...</Say></Response>' })`. Voz não tem risco de spam Meta — pode paralelizar. Enfileirada SÓ no disparo inicial do alerta (1 ligação por alerta, garantido na Task 6).
  - **Boas-vindas**: `POST /api/contacts/:id/welcome` (e checkbox "enviar boas-vindas" no form de cadastro) → enfileira na fila WhatsApp com texto de `WELCOME_TEMPLATE` (env, placeholder `{{name}}`), grava em `notifications` com channel `whatsapp` e alerta tipo implícito de boas-vindas (detail: 'welcome').
  - **Health**: `/health` inclui `GET /instance/connectionState` da Evolution — instância desconectada (QR expirado) aparece como aviso no painel.
  - Sucesso/falha final gravado em `notifications`. Envs: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VOICE_FROM`, `EVOLUTION_URL`, `EVOLUTION_APIKEY`, `EVOLUTION_INSTANCE`, `WELCOME_TEMPLATE`.
  - Botão "testar contato" no painel → enfileira notificação de teste nos canais ativos do contato.
- **GOTCHA**: "fila presa" — o combo `retryLimit` + `expireInSeconds` + `restart: always` cobre os três modos de travamento (erro transiente, job zumbi, processo morto). pg-boss persiste em Postgres: reboot não perde jobs. Com teamSize 1 + jitter, o pior caso (300 mensagens de uma vez) drena em ~30min — aceitável, e é exatamente por isso que a LIGAÇÃO (imediata, paralela) é o canal de urgência.
- **VALIDATE**: enfileirar 10 WhatsApp de teste → logs mostram envios com 3–8s de espaçamento, nunca simultâneos; job falho reaparece com backoff; após 5 falhas → `notifications.status='failed'` com `detail`.

### Task 8b: Teste semanal automático
- **ACTION**: `boss.schedule('weekly-test', '0 9 * * 1', {}, { tz: 'America/Sao_Paulo' })` — toda segunda 09:00.
- **IMPLEMENT**: worker cria um alerta sintético `type='test'` por cliente (resolvido imediatamente) e enfileira **na fila WhatsApp normal** (herda serialização) para cada contato ativo: "✅ Teste semanal PCG: sensor(es) X ok — última leitura HH:MM, T °C". Sensores offline ou sem leitura recente entram na mensagem como ⚠. Sem ligação de voz no teste. Resultado fica em `notifications` como qualquer envio — o painel mostra o histórico do teste na tela de Alertas.
- **GOTCHA**: `boss.schedule` sobrevive a reboot (persistido no Postgres), mas registrar o schedule no boot é idempotente — sempre chamar no startup. Cron respeita janela? NÃO aplicar filtro de janela no teste (segunda 09:00 já é horário comercial) — senão contato com janela noturna nunca descobriria que o canal quebrou.
- **VALIDATE**: rodar o handler manualmente (`boss.send('weekly-test')`) → cada contato recebe 1 mensagem, espaçadas; registro aparece no painel.

### Task 9: connectivitySweep
- **ACTION**: `setInterval` de 60s: `SELECT * FROM sensors WHERE last_seen_at < now() - (offline_after_seconds || ' seconds')::interval` e sem alerta connectivity firing → `alertService.fire(sensor, 'connectivity')`. Volta a reportar → resolve.
- **GOTCHA**: envolver o corpo em try/catch com log — uma exceção não pode matar o interval (é exatamente o "problema de rotina" que o usuário teme). No boot, rodar imediatamente uma vez.
- **VALIDATE**: teste: sensor com last_seen antigo gera alerta; ingest posterior resolve.

### Task 10: Rotas de leitura + alertas para o painel
- **ACTION**: `GET /sensors/:id/readings?range=` roda query Flux (`from(bucket) |> range(-24h) |> filter(sensor_id)`) e devolve `[{time, temperature, humidity}]`; `GET /api/alerts` com join de notifications.
- **VALIDATE**: curl retorna série depois de alguns ingests.

### Task 11: Painel web
- **ACTION**: Vite+React+TS em `web/`, build servido por `@fastify/static`. Páginas: Login, Clients, Sensors (status online/offline + gráfico 24h com Recharts + form de limites), Contacts (form completo de preferências: tipos, canais, dias da semana, horário, timezone, intervalo de re-alerta, checkbox "enviar boas-vindas" no cadastro + botões "boas-vindas"/"testar contato"), Alerts (firing/histórico + log de notificações com motivo de skip), Firmware (upload + atribuir versão + botão "testar contato").
- **IMPLEMENT**: fetch nativo com wrapper de ~20 linhas (sem axios/react-query). Estado: useState/useEffect — 6 páginas não justificam store.
- **GOTCHA**: proxy do Vite dev server para `:3000` em dev.
- **VALIDATE**: fluxo manual completo: criar cliente → sensor → contato → ver leitura no gráfico.

### Task 12: Firmware ESP32 (CYD) — núcleo de rede e sensor
- **ACTION**: PlatformIO, Arduino framework, board esp32dev com build_flags do CYD (TFT_eSPI: ILI9341, pinos do repo Cheap-Yellow-Display). Módulos `net.cpp` + `storage.cpp`. Ciclo: ler DHT22 no GPIO 27 (retry 3x se NaN) → montar JSON → POST com `X-Device-Token` → tratar resposta.
- **IMPLEMENT** (robustez — cada item é requisito explícito do usuário, não opcional):
  - **Arquitetura de tasks**: rede em task FreeRTOS separada (core 0); LVGL/UI no loop principal (core 1). Comunicação por fila FreeRTOS de eventos — LVGL não é thread-safe, a task de rede nunca toca em widgets.
  - **Task Watchdog 30s** armado no setup; alimentado nas duas tasks e no callback de progresso do OTA.
  - **WiFi**: credenciais lidas do NVS (`storage`); reconexão com backoff (5s→10s→30s); 10 falhas consecutivas → `ESP.restart()`. Sem credencial no NVS → UI abre direto o scan de redes (Task 13).
  - **Identidade**: sem token no NVS → `POST /api/provision {mac}` após conectar; salva o token retornado em NVS e segue para o ciclo normal. Se provision retornar 404 (MAC já registrado com token perdido — ex. NVS apagado), UI mostra "contate o suporte" com o MAC na tela; admin deleta o sensor no painel e o device re-provisiona.
  - **NTP**: configTime no connect — o relógio do header da tela precisa dele; sem NTP ainda, header mostra `--:--`.
  - **Buffer offline**: falhou o POST → ring buffer na RAM (últimas 200 leituras ≈ 3h; struct de 16 bytes). Ao reconectar, drenar em lotes de 20 (array `readings[]` com `ago_ms` = millis() decorridos). `// ponytail: RAM only — leituras se perdem em reboot; mover para LittleFS se isso doer`.
  - **OTA**: resposta do ingest contém `ota.url` → `httpUpdate.update()`; em falha, loga e segue (tenta no próximo ingest). Nunca OTA com buffer não-drenado. UI mostra tela "Atualizando..." com progresso.
  - **IP estático opcional** do NVS (ip/gw/mask/dns) aplicado antes do `WiFi.begin()`.
  - **Deep sleep NÃO** — display sempre ligado + OTA responsivo; energia vem de tomada.
- **GOTCHA**: `FW_VERSION` é constante compilada e enviada em todo ingest — é ela que dispara o OTA. Incrementar a cada build publicado, senão loop infinito de OTA.
- **VALIDATE**: bancada — desligar WiFi por 10min e religar: leituras do período aparecem no Influx com timestamps corretos; publicar firmware novo no painel: device atualiza no ciclo seguinte.

### Task 13: Firmware ESP32 (CYD) — UI touch (LVGL)
- **ACTION**: `ui.cpp` com LVGL 8.3 + TFT_eSPI + XPT2046_Touchscreen (touch em SPIClass própria: CLK=25, MOSI=32, MISO=39, CS=33, IRQ=36).
- **IMPLEMENT**:
  - **Dashboard** (réplica da foto): header com bolinha de status (verde=online/cinza=offline), relógio NTP `HH:MM`, data curta pt-BR (`ter 16 jun`), nome do device, barras de RSSI; dois painéis — TEMPERATURA (fundo claro, label laranja) e UMIDADE (fundo azul claro) com valor grande (inteiro grande + decimal menor), `lv_chart` sparkline das últimas 50 leituras, max/min do dia (reset à meia-noite).
  - **Toque no relógio** → tela de PIN (lv_btnmatrix numérico; PIN do NVS, default `1234`) → **Menu Configurações**: Redes WiFi (scan `WiFi.scanNetworks()` em lista, teclado LVGL para senha, salva em NVS e reconecta), Nome do dispositivo (teclado LVGL → NVS, aparece no header e vai no ingest como `device_name`), Config de IP (DHCP ↔ estático com campos ip/gw/mask/dns), Trocar PIN, Calibrar touch, Reiniciar.
  - **Toque no ícone de sinal** → tela Info de Rede (só leitura, sem PIN): SSID, IP, máscara, gateway, DNS, MAC, RSSI dBm, `FW_VERSION`, uptime. Botão voltar.
  - **Calibração do touch**: no primeiro boot (sem calibração no NVS) roda tela de 4 pontos e salva.
- **GOTCHA**: scan de WiFi é bloqueante por ~2s — usar `WiFi.scanNetworks(true)` (async) e preencher a lista no callback de evento; alimentar o watchdog na tela de PIN/menus (usuário pode ficar minutos mexendo).
- **VALIDATE**: bancada — fluxo completo sem recompilar: ligar device zerado → calibrar touch → scan → conectar em rede nova pelo teclado → dashboard igual à foto → PIN abre menu → trocar nome reflete no header → tela de rede mostra IP/MAC corretos.

### Task 14: OTA server-side
- **ACTION**: upload multipart de .bin → salva em `server/firmware-bin/` (volume Docker), sha256, INSERT em firmware; `GET /api/ota/firmware/:version.bin` com auth por device token; dropdown no painel para setar `target_firmware` por sensor (e "aplicar a todos do cliente").
- **GOTCHA**: validar magic byte do binário ESP32 (primeiro byte `0xE9`) antes de aceitar o upload — um .bin errado brickaria um device a 2000km.
- **VALIDATE**: upload + curl do download com token confere sha256.

### Task 15: Deploy + README
- **ACTION**: Dockerfile multi-stage (build web → build server → runtime node:22-alpine copiando web/dist), README com: setup da VPS, envs, provisionamento de device novo (flash com token + configurar WiFi na tela), publicação de firmware.
- **VALIDATE**: `docker compose up` na VPS; ingest de teste externo chega no Influx.

---

## Testing Strategy

### Unit Tests (vitest — só a lógica de decisão)

| Test | Input | Expected | Edge? |
|---|---|---|---|
| isWithinWindow básico | seg 10:00, janela seg-sex 07–18 | true | |
| isWithinWindow fora | sáb 10:00, mesma janela | false | |
| janela cruza meia-noite | 23:00, janela 22:00–06:00 | true | ✓ |
| timezone | 10:00 UTC, contato em SP (07:00 local) | true | ✓ |
| alerta dispara 1x | 2 leituras acima do max | 1 alerta, 1 lote de notificações | ✓ |
| histerese | max=8, leituras 8.3→7.8 | continua firing (só resolve <7.5) | ✓ |
| re-alerta por contato | firing há 61min, contato com renotify=60 | re-notifica só WhatsApp (sem voz) | |
| re-alerta desligado | firing há 5h, contato com renotify=0 | nenhuma nova notificação | ✓ |
| voz 1x | alerta re-notificado 3x | exatamente 1 job de voz no total | ✓ |
| skip por preferência | contato alert_temperature=false | notification `skipped_pref` | |

### Edge Cases Checklist
- [x] DHT22 NaN (retry no firmware)
- [x] Influx fora do ar (500 → buffer no device)
- [x] Twilio fora do ar (retry pg-boss)
- [x] Reboot do server com jobs na fila (pg-boss persiste)
- [x] Sensor no limiar exato (histerese)
- [x] Janela cruzando meia-noite
- [ ] Concurrent access — N/A em processo único a 50 sensores

## Validation Commands

```bash
cd server && npx tsc --noEmit        # EXPECT: zero erros
cd server && npx vitest run          # EXPECT: todos passam
cd web && npx tsc --noEmit && npm run build   # EXPECT: build ok
cd firmware && pio run               # EXPECT: compila (hardware valida em bancada)
docker compose up -d && curl localhost:3000/health   # EXPECT: {"db":"ok","influx":"ok"}
```

### Manual Validation
- [ ] Fluxo painel: cliente → sensor → contato → limites
- [ ] Ingest real de um ESP32 em bancada → gráfico no painel
- [ ] Forçar temp acima do limite (aquecer o sensor) → ligação Twilio recebida
- [ ] Desligar o ESP32 5 min → alerta de conectividade; religar → resolvido
- [ ] Contato fora de janela → status `skipped_window` no log
- [ ] OTA de ponta a ponta (com tela de progresso no device)
- [ ] Device zerado provisionado 100% pela tela: calibração → scan WiFi → senha → auto-provision → aparece como "não reivindicado" no painel → atribuir cliente → online
- [ ] O MESMO .bin flashado em 2 placas gera 2 sensores distintos no painel
- [ ] PIN errado não abre o menu; PIN trocado persiste após reboot (NVS)

## Acceptance Criteria
- [ ] 15 tasks completas, validações passando
- [ ] Tela do device replica a foto de referência (relógio, sinal, painéis, sparklines, max/min)
- [ ] Menu de config com PIN funcional: WiFi por scan+teclado, nome, IP estático, troca de PIN
- [ ] Toque no sinal mostra SSID/IP/MAC/RSSI
- [ ] Leituras multi-sensor no Influx com tags client_id/sensor_id
- [ ] Alertas com dedup, histerese, cooldown e resolução
- [ ] Preferências por contato respeitadas (tipo, canal, dias, horário, timezone) com skip auditável
- [ ] Fila sobrevive a reboot e a falhas de Twilio/Evolution
- [ ] WhatsApp nunca sai em rajada: envios serializados com jitter 3–8s (anti-bloqueio Meta)
- [ ] Ligação de voz acontece exatamente 1x por alerta
- [ ] `renotify_minutes` por contato respeitado (0 = sem repetição)
- [ ] Boas-vindas opcional no cadastro do contato + botão manual
- [ ] Teste semanal (seg 09:00) envia status por WhatsApp a todos os contatos ativos
- [ ] OTA funcional via painel
- [ ] Firmware sobrevive a queda de WiFi/servidor sem perder leituras (janela ~3h) e sem travar (watchdog)

## Risks
| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| OTA com firmware quebrado bricka device remoto | Média | Alto | Validação de magic byte + testar todo .bin em bancada antes de publicar; watchdog reinicia em boot-loop parcial |
| Flapping de temperatura gera spam de ligações | Alta | Médio | Histerese 0.5°C + cooldown 60min |
| Cardinalidade Influx | Baixa | Médio | Só tags de baixa cardinalidade |
| WiFi do cliente instável mascara alerta de conectividade real | Média | Médio | `offline_after_seconds` configurável por sensor |
| Credencial Twilio/Influx inválida só descoberta na hora do alerta | Média | Alto | Health check no boot valida Influx; env-check fatal; botão "testar contato" no painel (Task 8/11) |
| Meta bloqueia o número WhatsApp por spam | Média | Alto | Fila serializada (1 por vez) + jitter 3–8s em TODO envio; ligação de voz é o canal de urgência imediato e independe da Meta |
| Instância Evolution desconecta (QR expirado) | Média | Alto | /health monitora connectionState + aviso no painel; retry da fila segura os envios até reconectar; teste semanal detecta em no máx. 7 dias |
| Touch resistivo descalibrado impede acesso ao menu em campo | Média | Médio | Calibração de 4 pontos salva em NVS + opção "Calibrar touch" no menu; segurar toque no boot força recalibração |
| UI congela durante POST/OTA (LVGL sem lv_timer_handler) | Média | Baixo | Rede em task FreeRTOS separada (core 0); UI nunca bloqueia |

## Notes
- Greenfield: seções de "patterns" definem convenções em vez de espelhar código existente.
- InfluxDB é infraestrutura existente do usuário — o plano só consome (env vars), nunca provisiona nem migra.
- Ordem de implementação segue a numeração; Tasks 12–14 (firmware/OTA) dependem só do contrato do ingest (Task 5) e podem correr em paralelo ao painel.
- Hardware alvo: ESP32-2432S028R (CYD). Pinout de referência: https://github.com/witnessmenow/ESP32-Cheap-Yellow-Display — DHT22 no GPIO 27 via conector CN1 (3V3/GND no mesmo conector). O ingest passa a incluir `device_name` (configurável na tela) para exibição no painel.
