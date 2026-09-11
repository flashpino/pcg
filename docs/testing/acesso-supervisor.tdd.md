# TDD — acesso de supervisor (só-leitura, sensores escolhidos pelo admin)

**Data:** 2026-09-11
**Origem:** pedido direto do usuário, sem `*.plan.md` prévio — jornadas derivadas nesta sessão.

## Pedido

> "preciso criar uma acesso para supervisor e esse acesso eu defino quais sensores ele pode
> visualizar, ele nao vai poder alterar nada vai ser basicamente a tela limitada igual a do
> cliente"

## Jornadas

1. Como admin, quero criar um acesso de supervisor e escolher, sensor a sensor, quais ele
   enxerga — sem depender de agrupar por cliente.
2. Como supervisor, quero logar num portal próprio e ver exatamente a mesma tela do cliente
   (cards + gráfico de 24h) só dos sensores que me foram atribuídos.
3. Como sistema, um token de supervisor nunca pode abrir rota de admin nem de cliente, e
   vice-versa — e nunca pode escrever nada (criar, editar, apagar).

## O que já existia (reuso, não recriação)

- `routes/clientPortal.ts` já era exatamente esse padrão (login + `/me` + `/sensors` +
  `/sensors/:id/readings` + `/alerts`, só leitura, escopado por um identificador do lado logado)
  — só faltava trocar o escopo de "um `client_id`" para "um conjunto de `sensor_id`".
- `ClientLoginPage`/`ClientPortalPage`/`ClientSensorDetailPage` (frontend) já eram a tela pedida
  ("igual à do cliente") — parametrizadas em vez de duplicadas.
- `GET /api/sensors` (admin) já lista todos os sensores — reusado no picker do admin, sem rota nova.
- O projeto não tem teste de frontend (nenhum `*.test.tsx` em `web/src`) nem teste de rota para
  CRUDs simples (`clients.ts`, `admins.ts`, `clientPortal.ts` não têm `.test.ts`). Segui essa
  convenção: TDD RED/GREEN completo só na peça nova e crítica de segurança (roteamento por role);
  as rotas CRUD e o frontend são cópias diretas de um padrão já em produção, sem teste dedicado.

## Execução por tarefa

### Tarefa 1 — `authz.ts` (extraído de `index.ts`) com a regra do role `supervisor`

Lógica pura (string de rota + role → boolean) que decide quais rotas cada token abre. Era
inline e não testada dentro de `index.ts`; extraída para ficar testável sem precisar subir o
servidor inteiro (que exige envs de produção — Postgres/Influx/Twilio/Evolution — no boot).

- **RED:** `npx vitest run src/authz.test.ts` → falha de compilação,
  `Error: Cannot find module './authz.js'` (módulo ainda não existia).
- **GREEN:** `npx vitest run src/authz.test.ts` → 7/7 passando, após implementar `isPublicRoute` e
  `isAuthorized` com a terceira ramificação (`/api/supervisor/*` só abre com `role === 'supervisor'`).

### Tarefa 2 — schema, queries e rotas do supervisor

Sem teste dedicado (convenção do repo, ver acima): `supervisors`/`supervisor_sensors` no
`schema.sql`, funções espelhando `clients`/`sensors` em `queries.ts`, e duas rotas —
`routes/supervisors.ts` (CRUD de admin + `PUT .../sensors` pra atribuir o conjunto) e
`routes/supervisorPortal.ts` (cópia de `clientPortal.ts` trocando `client_id` por
`getSupervisorSensorIds(sub)`, inclusive na checagem de posse do sensor na rota de leituras —
mesma defesa que `clientPortal.ts` faz com `sensor.client_id !== sub`).

- **Validação:** `npx vitest run` (server) → 152/152 passando (10 arquivos), sem regressão;
  `npx tsc --noEmit` (server) → limpo.

### Tarefa 3 — frontend: portal do supervisor + gestão no admin

`ClientLoginPage`/`ClientPortalPage`/`ClientSensorDetailPage` ganharam props opcionais
(`loginPath`/`brandLabel`/`title`/`apiBase`) com defaults idênticos ao comportamento atual do
cliente — nenhuma regressão visual pro portal do cliente. `SupervisorPortalApp.tsx` novo reusa
essas três telas contra `/api/supervisor`, roteado por subdomínio `supervisor.*` em `main.tsx`
(mesmo esquema de `cliente.*`). `SupervisorsPage.tsx` novo no painel admin: CRUD do supervisor,
credenciais do portal e um checkbox por sensor (via `GET /api/sensors`) que salva com
`PUT /api/supervisors/:id/sensors`.

- **Validação:** `npx tsc --noEmit` (web) → limpo.
- **Não testado manualmente em navegador** — ambiente sem Docker disponível pra subir
  Postgres/Influx locais (mesma limitação já registrada em
  `docs/testing/portal-cliente-cards-e-datalog.tdd.md`). Recomendo validar com `npm run dev`
  (server + web) contra o Postgres/Influx reais: criar um supervisor, atribuir sensores, logar no
  portal (`#/supervisor` local, ou subdomínio `supervisor.*` em produção) e confirmar que só os
  sensores atribuídos aparecem.

## Especificação de testes

| # | O que está garantido | Arquivo / teste | Tipo | Resultado |
|---|---|---|---|---|
| 1 | Rotas fora de `/api/*` e os 3 logins (`admin`/`client`/`supervisor`) são públicos, o resto de `/api/*` exige token | `authz.test.ts:isPublicRoute` | unit | PASS |
| 2 | Token de supervisor só abre `/api/supervisor/*` (não `/api/clients`, `/api/sensors` nem `/api/client/*`) | `authz.test.ts:isAuthorized > token de supervisor só abre...` | unit | PASS |
| 3 | Token de cliente não abre rotas de supervisor nem de admin | `authz.test.ts:isAuthorized > token de cliente não abre...` | unit | PASS |
| 4 | Token de admin (ou sessão antiga sem role) não abre rotas de supervisor nem de cliente, mas continua abrindo o resto do painel | `authz.test.ts:isAuthorized > token de admin...` (2 casos) | unit | PASS |

**Comando de validação (server):** `npm test` → **152/152 passando (10 arquivos)**, incluindo os
7 novos de `authz.test.ts` e os 145 pré-existentes sem regressão.
**Typecheck:** `npx tsc --noEmit` limpo em `server/` e em `web/`.

## Cobertura e lacunas conhecidas

- **Sem teste de rota** para `supervisors.ts`/`supervisorPortal.ts` — consistente com a convenção
  pré-existente (`clients.ts`/`admins.ts`/`clientPortal.ts` também não têm). A garantia
  comportamental de "supervisor só vê o que foi atribuído" está na extensão do mesmo padrão de
  escopo já usado (e não testado por rota) em `clientPortal.ts`, mais o teste de `authz.ts` que
  cobre a fronteira de mais alto risco (vazamento entre roles).
- **Sem teste de frontend** (repo não tem harness de UI) e **sem validação manual em navegador**
  nesta sessão, pelos motivos já registrados acima.
- `setSupervisorSensors` (transação DELETE+INSERT) não tem teste de integração dedicado — é uma
  função de banco real (não mockável de forma útil sem um Postgres de teste), mesma situação de
  `setClientCredentials`/`updateSensor` no restante do arquivo, nenhuma delas testada hoje.

## Checkpoints

| Commit | Estágio |
|---|---|
| `fbc76bd` | RED — `authz.test.ts`, falha por módulo `authz.ts` ausente |
| `2c968af` | GREEN — `authz.ts` implementado (com a regra de `supervisor`) + schema/queries/rotas do backend, suíte completa (152/152) sem regressão |
| `eee8c6b` | Feat — frontend: portal do supervisor + gestão de acesso no painel admin |
