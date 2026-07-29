# TDD — portal do cliente: cards iguais ao admin + datalog em tela própria

**Data:** 2026-07-29
**Origem:** pedido direto do usuário, sem `*.plan.md` prévio — jornadas derivadas nesta sessão.

## Pedido

> "na tela do cliente deixa os cards igual ao do painel de admin e quando clicar no sensor abrir
> o grafico de datalog em outra tela somente daquele sensor"

## Jornadas

1. Como cliente, quero ver nos meus sensores o mesmo card rico do painel admin (temperatura,
   humidade, defeito de hardware, uptime, sinal), não só nome + online/offline.
2. Como cliente, quero clicar num sensor e ir para uma tela própria só com o gráfico de datalog
   (24h) daquele sensor, separada da lista.

## O que já existia (reuso, não recriação)

- `dashboardService.ts` já tinha `isSensorOnline`, `resolveOnlineSince`, `readingForDisplay`,
  todas testadas — só faltava a composição final do card.
- `GET /api/client/sensors/:id/readings` já existia e já era escopado por `client_id`.
- `SensorsPage.tsx` (admin) já usava `recharts` para o gráfico de 24h — mesma lib, sem nova
  dependência.
- O projeto não tem teste de frontend (nenhum `*.test.tsx` em `web/src`); convenção observada é
  TDD só no backend, com rota fina e lógica pura testada em `services/*.ts`. Segui essa convenção
  em vez de introduzir um harness de teste de UI só para esta tarefa.

## Execução por tarefa

### Tarefa 1 — `buildDeviceView` no `dashboardService.ts`

Função pura que monta o card de dispositivo (mesma forma para admin e cliente), composta a partir
das funções já testadas (`isSensorOnline`, `resolveOnlineSince`, `readingForDisplay`).

- **RED:** `npx vitest run src/services/dashboardService.test.ts` → 3 falhas,
  `TypeError: (0 , buildDeviceView) is not a function`
- **GREEN:** 15/15 em `dashboardService.test.ts`

### Tarefa 2 — `dashboard.ts` usa `buildDeviceView`

Refactor puro (sem mudar o contrato de `GET /api/dashboard`): o `devices.map` inline foi trocado
pela função extraída.

- **Validação:** `npm test` → 92/92 passando; `npx tsc --noEmit` → limpo.

### Tarefa 3 — `GET /api/client/sensors` devolve o mesmo shape

A rota passou a buscar `queryLatestReadings` + `getLastConnectivityResolutions` +
`listSensorIdsWithFiringAlert('hardware')` — mesmos dados de `dashboard.ts`, só filtrados pelos
sensores do cliente logado (`sub` do JWT) — e montar cada item com `buildDeviceView`.

- **Sem teste de rota dedicado**, seguindo a convenção do repo (`dashboard.ts` também não tem).
  A garantia comportamental está nos testes de `buildDeviceView` (Tarefa 1) + no fato de a rota
  já filtrar por `client_id` desde antes desta mudança (`listSensors(sub)`, `getSensor` valida
  `sensor.client_id !== sub` na rota de leituras).
- **Validação:** `npm test` → 92/92; `npx tsc --noEmit` → limpo.

### Tarefa 4 — `DeviceCard` compartilhado (frontend)

Extraído de `DashboardPage.tsx` para `web/src/components/DeviceCard.tsx`, com prop opcional
`secondaryLabel` (admin mostra `cliente — sensor`, portal do cliente não mostra nada extra) e prop
opcional `onClick` (só o portal do cliente usa, pra abrir a tela de detalhe).

- `DashboardPage.tsx`: card duplicado inline trocado por `<DeviceCard device={d}
  secondaryLabel={...} />` — visual idêntico ao anterior.
- `ClientPortalPage.tsx`: card simples (`nome` + `online/offline`) trocado por `<DeviceCard
  device={s} onClick={...} />`; a checagem de online que antes era feita no cliente
  (`isOnline(sensor)`) foi removida — o backend já entrega `online` calculado com a mesma lógica
  (`isSensorOnline`).

### Tarefa 5 — `ClientSensorDetailPage.tsx` (tela própria de datalog)

Nova tela — botão "voltar", título com o sensor, `LineChart` de temperatura/humidade (24h) via
`GET /api/client/sensors/:id/readings`, mesmo padrão visual do gráfico inline do admin
(`SensorsPage.tsx`), mas como tela cheia em vez de bloco expandido na lista.

`ClientPortalPage.tsx` ganhou o estado `openSensorId`: quando setado, a página inteira troca para
`ClientSensorDetailPage` (não é um card expandido — é "outra tela", como pedido).

- **Validação:** `npm run build` em `web/` (`tsc --noEmit && vite build`) → build limpo.

## Especificação de testes

| # | O que está garantido | Arquivo / teste | Tipo | Resultado |
|---|---|---|---|---|
| 1 | Sensor online monta view completa (leitura + online_since resolvido) | `dashboardService.test.ts:buildDeviceView > sensor online monta view completa...` | unit | PASS |
| 2 | Sensor offline não expõe online_since nem leitura, mesmo com dado velho no Influx | `dashboardService.test.ts:buildDeviceView > sensor offline não tem online_since...` | unit | PASS |
| 3 | Defeito de hardware suprime a leitura mesmo com o sensor online (heartbeat) | `dashboardService.test.ts:buildDeviceView > defeito de hardware suprime...` | unit | PASS |

Os demais 12 testes de `dashboardService.test.ts` (pré-existentes, `isSensorOnline`,
`countSensorStatus`, `resolveOnlineSince`, `readingForDisplay`) continuam garantindo o
comportamento que `buildDeviceView` só compõe.

**Comando de validação (server):** `npm test` → **92/92 passando (7 arquivos)**.
**Typecheck (server):** `npx tsc --noEmit` → limpo.
**Build (web):** `npm run build` (`tsc --noEmit && vite build`) → limpo.

## Cobertura e lacunas conhecidas

- **Sem teste de rota** para `/api/client/sensors` e `/api/dashboard` — consistente com a
  convenção pré-existente do repo (nenhuma das duas tinha teste de rota antes desta mudança).
- **Sem teste de frontend.** O repo não tem harness de teste de UI (`*.test.tsx`); a garantia veio
  de `tsc --noEmit` + `vite build` limpos. **Não testado manualmente em navegador nesta sessão** —
  o ambiente não tem Docker disponível (`docker: command not found`), então não deu pra subir
  Postgres/Influx locais e validar visualmente clique → tela de detalhe → gráfico. Recomendo
  validar isso com `npm run dev` (server + web) contra o Postgres/Influx reais antes de
  considerar fechado no cliente.
- **Existe infraestrutura de E2E Playwright** (`web/e2e/login.spec.ts`, `web/playwright.config.ts`,
  de uma sessão anterior, ainda não commitada) mas cobre só o login admin — não criei um spec novo
  para o portal do cliente porque exigiria seed de um cliente + sensor + leituras Influx de teste,
  e não há esse fixture no repo hoje. Vale um follow-up se o cliente virar fluxo crítico coberto
  por E2E.

## Checkpoints

| Commit | Estágio |
|---|---|
| `3e64f59` | RED — teste de `buildDeviceView`, 3 falhas por função ausente |
| `87fac17` | GREEN — `buildDeviceView` implementado, 15/15 em `dashboardService.test.ts` |
| `cf3eccd` | Refactor — `dashboard.ts` passa a usar `buildDeviceView` |
| `8ac62d5` | Feat — `/api/client/sensors` devolve o mesmo card do dashboard admin |
| `4faa387` | Feat — frontend: `DeviceCard` compartilhado + tela própria de datalog no portal do cliente |
