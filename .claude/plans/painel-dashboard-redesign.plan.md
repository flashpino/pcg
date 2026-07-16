# Plan: Dashboard consolidado

**Source PRD**: `.claude/prds/painel-dashboard-redesign.prd.md`
**Selected Milestone**: #1 — Dashboard consolidado
**Complexity**: Medium

## Summary
Nova aba **Dashboard** (primeira aba, default ao logar) com KPIs, cards por device (status/temp/umidade/WiFi/uptime) e feed de eventos recentes, agregando dados que hoje só existem espalhados entre `/api/sensors`, `/api/clients`, `/api/alerts` e o Influx. Sem mudança de firmware/ingest: RSSI já é gravado no Influx por leitura (`influx.ts:22`), e uptime é aproximado a partir do histórico de alertas de conectividade já existente — resolve a Open Question do PRD sem novo campo.

## Decisão sobre a Open Question (uptime)
Aproximação server-side, sem mudar `/api/ingest`: `online_since` = `resolved_at` do alerta `connectivity` resolvido mais recente daquele sensor; se nunca houve alerta de conectividade, cai para `sensor.created_at` (assume online desde a criação). Uptime exibido = `now - online_since` só quando o sensor está online; offline não mostra uptime. Consistente com o texto do PRD ("pode entrar como aproximação").

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Rota agregada | `server/src/routes/alerts.ts:4-12` | Handler fino, delega tudo pra `db/queries.ts`/serviços, lança `Object.assign(new Error(...), { statusCode })` pra erro |
| Cálculo online/offline | `server/src/services/connectivitySweep.ts:11` e `web/src/pages/SensorsPage.tsx:35-38` | Fórmula 1-linha repetida em vez de abstrair (`now - last_seen_at > offline_after_seconds*1000`) — mesma fórmula, não extrair util cross-camada |
| Lógica pura testável | `server/src/services/alertService.ts` + `alertService.test.ts` | Funções puras (sem I/O) exportadas e testadas com vitest, chamadas pelo handler que faz o I/O |
| Query sem N+1 | `server/src/db/queries.ts:264-282` (`listAlerts`) | 2 queries: uma para a lista, uma `ANY($1)` para os relacionados, depois `Map` pra juntar em memória |
| Página React | `web/src/pages/SensorsPage.tsx` | `useEffect` + `api.get` + `useState`, tipos de interface locais duplicando o shape do backend (sem lib de tipos compartilhada) |
| Estilo industrial | `web/src/index.css` (`--steel`, `--amber`, `--ok`, fonte Consolas/monospace, sem border-radius) | Tokens já definidos — reusar, não criar paleta nova |

## Files to Change
| File | Action | Why |
|---|---|---|
| `server/src/services/influx.ts` | UPDATE | Adicionar `queryLatestReadings(sensorIds)`: 1 query Flux `last()` por sensor, já incluindo `rssi` (hoje só `temperature`/`humidity` são lidos de volta) |
| `server/src/db/queries.ts` | UPDATE | Adicionar `listRecentAlerts(limit)` (variante de `listAlerts` com `LIMIT`), `countAlertsSince(hours)`, `getLastConnectivityResolutions(sensorIds)` (`DISTINCT ON` por sensor) |
| `server/src/services/dashboardService.ts` | CREATE | Funções puras: `isSensorOnline(sensor, now)`, `countSensorStatus(sensors, now)`, `resolveOnlineSince(sensor, lastResolvedAt)` — mesma separação I/O-fora que `alertService.ts`. Chamado por `routes/dashboard.ts` (Task 4). |
| `server/src/services/dashboardService.test.ts` | CREATE | Testes vitest das 3 funções puras acima (sensor nunca visto, exatamente no limiar, com/sem alerta de conectividade resolvido) |
| `server/src/routes/dashboard.ts` | CREATE | `GET /api/dashboard`: monta `{ kpis, devices, events }` chamando queries + influx + dashboardService. Registrado em `server/src/index.ts` (Task 5). |
| `server/src/index.ts` | UPDATE | Registrar `dashboardRoutes`, mesmo padrão de `alertsRoutes`/`sensorsRoutes` já registrados nas linhas 73-80 |
| `web/src/pages/DashboardPage.tsx` | CREATE | KPI tiles + grid de device cards + feed de eventos, consumindo `/api/dashboard`. Importado por `web/src/App.tsx` (Task 7). |
| `web/src/App.tsx` | UPDATE | Adicionar tab `dashboard` primeiro na lista (hoje `TABS` em `App.tsx:10-16`) e como aba inicial (`useState` default, hoje `'clients'` em `App.tsx:20`) |
| `web/src/index.css` | UPDATE | Classes novas: `.kpi-grid`, `.kpi-tile`, `.device-grid`, `.device-card`, `.signal-bars`, `.event-feed` — reusando as CSS vars existentes (`:root` em `index.css:2-10`) |

Confirmado por busca (Glob `web/src/pages/*.tsx`, `server/src/routes/*.ts`, `server/src/services/*.ts`): não existe hoje nenhum `DashboardPage`, `routes/dashboard.ts` nem `dashboardService.ts` — nenhum arquivo equivalente sendo duplicado.

## Tasks

### Task 1: `queryLatestReadings` no Influx
- **Action**: Em `influx.ts`, nova função que roda uma única Flux query com `filter(sensor_id em sensorIds) |> group(columns: ["sensor_id"]) |> last() |> pivot(...)`, retornando `Map<number, { temperature, humidity, rssi, time }>` (sensor sem leitura recente = ausente do Map).
- **Mirror**: mesma estrutura de `queryReadings` (linha 41-61) — range whitelist não se aplica aqui (sem `range` vindo de querystring), mas mantém o mesmo bucket/measurement/pivot.
- **Validate**: chamar manualmente com 1-2 sensor_id conhecidos contra o Influx do `docker-compose.yml` e conferir que RSSI vem populado.

### Task 2: Queries novas em `queries.ts`
- **Action**: `listRecentAlerts(limit: number)` (mesma forma de `listAlerts`, com `LIMIT $n`, sem quebrar a assinatura existente usada por `alerts.ts`); `countAlertsSince(hours: number)` (`SELECT COUNT(*) FROM alerts WHERE fired_at >= now() - ($1 || ' hours')::interval`); `getLastConnectivityResolutions(sensorIds: number[])` via `SELECT DISTINCT ON (sensor_id) sensor_id, resolved_at FROM alerts WHERE type='connectivity' AND state='resolved' AND sensor_id = ANY($1) ORDER BY sensor_id, resolved_at DESC`.
- **Mirror**: estilo de `queries.ts` — funções `pool.query` diretas, sem query builder.
- **Validate**: `npm test` (vitest) não quebra nada existente; smoke manual via `psql`/endpoint depois de subir o server.

### Task 3: `dashboardService.ts` (lógica pura)
- **Action**:
  - `isSensorOnline(sensor: Pick<Sensor,'last_seen_at'|'offline_after_seconds'>, now: number): boolean`
  - `countSensorStatus(sensors: Sensor[], now: number): { online: number; offline: number; activeClientIds: Set<number> }`
  - `resolveOnlineSince(sensor: Pick<Sensor,'created_at'>, lastResolvedAt: string | undefined): string`
- **Mirror**: `alertService.ts` — puro, sem `pool`/`fetch`, importável e testável isolado.
- **Validate**: `dashboardService.test.ts` cobrindo os 4 casos citados na coluna Files to Change.

### Task 4: Rota `/api/dashboard`
- **Action**: `dashboard.ts` — `app.get('/api/dashboard', async () => {...})`: busca `listClients()`, `listSensors()`, `queryLatestReadings(sensorIds)`, `getLastConnectivityResolutions(sensorIds)`, `listRecentAlerts(20)`, `countAlertsSince(168)`; monta `kpis = { activeClients: activeClientIds.size, sensorsOnline, sensorsOffline, alerts7d }`; `devices` = sensores com `client_id !== null` enriquecidos com nome do cliente (`Map` por `client_id`, sem N+1), leitura mais recente e `online`/`online_since`; `events` = `listRecentAlerts(20)` como veio.
- **Mirror**: `alerts.ts`/`sensors.ts` — handler fino, erro padrão do fastify error handler global (`index.ts:50-53`) cobre falhas.
- **Validate**: registrar em `index.ts`, subir `npm run dev` no server e bater `curl http://localhost:3000/api/dashboard` autenticado.

### Task 5: Registrar rota
- **Action**: `import { dashboardRoutes } from './routes/dashboard.js'` + `await app.register(dashboardRoutes);` em `index.ts`, junto das outras `await app.register(...)`.
- **Mirror**: linhas 73-80 de `index.ts`.
- **Validate**: server sobe sem erro; `GET /health` continua ok.

### Task 6: `DashboardPage.tsx`
- **Action**: página com 3 blocos: (1) `.kpi-grid` com 4 `.kpi-tile` (clientes ativos, sensores online, sensores offline, alertas 7d); (2) `.device-grid` de `.device-card` por sensor — cliente, MAC, temp/hum grandes, badge online/offline (reusar `.status-online`/`.status-offline`), RSSI em dBm, uptime formatado (`Xh Ym`) só se online; (3) `.event-feed` com os 20 eventos recentes (mesma renderização de card que `AlertsPage.tsx`, mais compacta).
- **Mirror**: `SensorsPage.tsx` (fetch em `useEffect`, tipos locais) e `AlertsPage.tsx` (renderização de alerta).
- **Validate**: rodar `npm run dev` no `web/`, abrir o painel logado, conferir visualmente os 3 blocos com dados reais/seed.

### Task 7: Tab no `App.tsx`
- **Action**: adicionar `{ id: 'dashboard', label: 'Dashboard', Page: DashboardPage }` como primeiro item de `TABS`; mudar o `useState` inicial de `'clients'` para `'dashboard'`.
- **Mirror**: `App.tsx:10-16`.
- **Validate**: login abre direto no Dashboard.

### Task 8: CSS novo
- **Action**: adicionar as classes citadas em `index.css`, reusando `--steel`/`--steel-line`/`--amber`/`--ok`/`--danger` e a fonte monospace já padronizada — sem framework CSS novo.
- **Mirror**: bloco `.card`/`.status-online` já existentes.
- **Validate**: checar visualmente que os cards não estouram largura em `max-width: 1200px`. Tema é fixo (sem dark/light toggle — fora de escopo, conforme PRD).

## Validation
```bash
cd server && npm test
cd server && npm run build
cd web && npm run build
```
Manual: subir `docker-compose.yml` (Postgres+Influx), `npm run dev` em `server/` e `web/`, logar como admin, conferir KPIs batendo com o que existe em Clientes/Sensores/Alertas, e que os device cards mostram RSSI e uptime plausíveis para sensores que estão de fato reportando.

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Flux `last()` por grupo tem sintaxe fácil de errar (grouping/pivot) | Média | Testar a query isolada num sensor conhecido antes de plugar na rota (Task 1 validate) |
| `activeClientIds` (KPI "clientes ativos") pode não bater com a expectativa do usuário se ele esperava "todo cliente cadastrado" | Baixa | Definição documentada neste plano (cliente com ≥1 sensor online agora); ajustar em revisão se o usuário quiser outra definição |
| `/api/dashboard` sem paginação pode ficar pesado com muitos sensores/clientes | Baixa | MVP interno (poucos admins, escala pequena); revisitar só se `listSensors()`/`listClients()` virarem gargalo real |

## Acceptance
- [ ] Todas as tasks completas
- [ ] `server` e `web` buildam e `npm test` passa
- [ ] Admin loga e cai direto no Dashboard vendo KPIs + cards de device com status/RSSI/uptime + feed de eventos, sem trocar de aba
- [ ] Padrões mirrorados (rota fina, lógica pura testável, sem N+1, CSS reusando tokens existentes)
