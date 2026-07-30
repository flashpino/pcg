# Mensagem diária "está tudo bem" — relatório TDD

**Data:** 2026-07-30 · **Branch:** master · **Runner:** `npm test` (vitest) em `server/`

## Origem

Sem `*.plan.md`. As jornadas abaixo foram derivadas do pedido do usuário:

> "precisamos colocar mais uma rotina de mensagens, todos os dias o sensor deve enviar uma
> mensagem falando que esta tudo bem com o sistema de climatizacao, entao seguindo o mesmo padrao
> dos alertas de conectividade e temperatura crie um de mensagem diaria com a opcao de dia da
> semana e horario para cada contato, e tbm o campo no template de mensagens para eu editar"

## Jornadas

1. Como cliente, quero receber todo dia uma mensagem dizendo que a climatização está normal, para
   saber que o monitoramento está de pé mesmo sem alerta nenhum.
2. Como admin, quero definir o dia da semana e o horário do envio **por contato**, para cada pessoa
   receber no horário em que ela realmente lê.
3. Como admin, quero editar o texto dessa mensagem em Painel > Mensagens, igual aos outros
   templates.
4. Como cliente, **não** quero receber "está tudo bem" enquanto existe um alarme aberto.

## Decisões de projeto

- Reusa `contact_alert_prefs` com o novo `alert_type = 'daily'` — mesma tabela, mesma rota
  (`PUT /api/contacts/:id/alert-prefs/:type`), mesma seção de UI dos outros tipos. Nenhuma tabela
  nova.
- Nessa pref, `window_start` é o **horário do envio** (minuto exato), não o início de uma janela;
  `window_end` e `renotify_minutes` não são usados. Documentado no schema e em `isDailySendTime`.
- O envio roda no tick de 1 minuto que já existia para o teste agendado (fila `weekly-test`,
  renomeada em código para `SCHEDULE_TICK_QUEUE` — a string da fila continua igual, senão o
  agendamento antigo do pg-boss ficaria órfão).
- Nasce **desligada** (seg–sex 08:00) para contatos existentes e novos: ligar sozinha significaria
  um WhatsApp diário para toda a base já cadastrada.

## Ciclo RED → GREEN

| Etapa | Commit | Comando | Resultado |
|---|---|---|---|
| RED | `94ac2d2` | `npm test` | **13 failed / 95 passed** — `isDailySendTime is not a function`, `sendDailyReport is not a function` |
| GREEN (servidor) | `eb4c75f` | `npm test` + `npm run build` | **108 passed (7 arquivos)**, `tsc` limpo |
| GREEN (web) | `f9fb8ec` | `npm run build` (web) | `tsc --noEmit` + `vite build` limpos |

Trecho do RED:

```
FAIL src/services/scheduleWindow.test.ts > isDailySendTime > dispara no minuto exato...
TypeError: (0 , isDailySendTime) is not a function
Test Files  2 failed | 5 passed (7)
      Tests  13 failed | 95 passed (108)
```

Trecho do GREEN:

```
✓ src/services/scheduleWindow.test.ts (15 tests)
✓ src/services/alertService.test.ts   (52 tests)
Test Files  7 passed (7)
      Tests  108 passed (108)
```

## Incidente pós-deploy: crash loop na migração

Primeiro boot com o código novo passou; o segundo entrou em crash loop:

```
error: check constraint "contact_alert_prefs_alert_type_check" of relation
       "contact_alert_prefs" is violated by some row
  at async migrate (file:///app/server/dist/db/index.js:12:5)
```

**Causa:** `schema.sql` roda inteiro a cada boot e passou a ter **duas** definições da mesma
constraint. A antiga (sem `'daily'`) vinha primeiro e, do segundo boot em diante, rejeitava as
linhas `'daily'` que o bloco novo tinha criado no boot anterior. Não era problema de dado — era a
migração deixando de ser idempotente.

**Correção:** uma única definição da constraint, com a lista completa, antes dos `INSERT` de
backfill (`e5d8949`). Tipo novo daqui pra frente = editar a lista existente, nunca acrescentar
outro `ADD CONSTRAINT` com o mesmo nome.

| Etapa | Commit | Comando | Resultado |
|---|---|---|---|
| RED | `8821634` | `npx vitest run src/db/schema.test.ts` | **2 failed** — constraint duplicada; a 1ª definição não contém `'daily'` |
| GREEN | `e5d8949` | `npm test` | **112 passed** |

O guarda contra reincidência está em `src/db/schema.test.ts`: lê o SQL e falha se algum
`ADD CONSTRAINT` aparecer duas vezes, ou se o schema inserir um tipo que a constraint em vigor não
aceita. Sem banco, roda junto da suíte normal.

## Especificação testada

| # | O que fica garantido | Teste | Tipo | Resultado |
|---|---|---|---|---|
| 1 | Dispara no minuto exato do horário configurado | `scheduleWindow.test.ts:dispara no minuto exato do horário configurado` | unit | PASS |
| 2 | Não dispara 1 min antes nem 1 min depois (sem envio duplicado no mesmo dia) | `scheduleWindow.test.ts:não dispara um minuto antes nem um minuto depois` | unit | PASS |
| 3 | Segundos dentro do minuto ainda contam como o minuto do envio | `scheduleWindow.test.ts:segundos dentro do minuto ainda contam` | unit | PASS |
| 4 | Dia fora de `days_of_week` não envia, mesmo no horário certo | `scheduleWindow.test.ts:dia fora de days_of_week não dispara` | unit | PASS |
| 5 | O horário vale no fuso do contato, não no do servidor | `scheduleWindow.test.ts:usa o fuso do contato, não o do servidor` | unit | PASS |
| 6 | Aceita `HH:MM:SS` (formato que o Postgres devolve para TIME) | `scheduleWindow.test.ts:aceita HH:MM:SS` | unit | PASS |
| 7 | Sem horário configurado nunca envia (oposto da janela vazia dos alertas) | `scheduleWindow.test.ts:sem horário configurado nunca dispara` | unit | PASS |
| 8 | Cliente sem sensor não gera alerta nem mensagem | `alertService.test.ts:cliente sem sensor cadastrado não envia nada` | integração (mocks) | PASS |
| 9 | Tudo normal: 1 WhatsApp por contato, pendurado num alerta tipo `daily` | `alertService.test.ts:tudo normal: um WhatsApp por contato` | integração (mocks) | PASS |
| 10 | `{{$sensores}}` lista cada sensor com a temperatura atual; sem leitura vira `--` | `alertService.test.ts:{{$sensores}} lista cada sensor com a temperatura atual` | integração (mocks) | PASS |
| 11 | Com alerta disparado em curso não manda "tudo bem" e grava `skipped_alert_firing` | `alertService.test.ts:com alerta disparado em curso não manda "tudo bem"` | integração (mocks) | PASS |
| 12 | Pref `daily` desligada grava `skipped_pref` e não enfileira | `alertService.test.ts:pref daily desligada grava skipped_pref` | integração (mocks) | PASS |
| 13 | Contato inativo não recebe a diária | `alertService.test.ts:contato inativo não recebe a diária` | integração (mocks) | PASS |

Comando de evidência para todas: `npm test` em `server/`.

## Cobertura e lacunas

`npx vitest run --coverage` (server):

```
alertService.ts  |  91.3 % stmts | 86.2 % branch
notifier.ts      | 38.63 % stmts | 81.25 % branch
All files        | 32.74 % stmts
```

Lacunas conscientes:

- **`runDailyReports` (notifier.ts) não tem teste automatizado.** É a fiação entre o tick e
  `sendDailyReport`; toda a decisão que ela toma (`isDailySendTime`) está coberta. `notifier.test.ts`
  é, por decisão registrada no próprio arquivo, um teste sem mock nenhum — cobrir essa função
  exigiria mockar `../db/queries.js` e `./alertService.js` ali dentro. O `runScheduledTests`, irmão
  dela e mais antigo, também não é testado. Se essa fiação quebrar, o caminho é extrair o predicado
  de seleção para uma função pura.
- **Cobertura global de 32,74 %** é o número pré-existente do repositório (rotas e camada de banco
  não têm teste), não uma regressão desta mudança — o limiar de 80 % do workflow não é atingido no
  agregado.
- **Sem teste E2E/UI** — o projeto não tem Playwright configurado. A UI foi validada por
  `tsc --noEmit` + `vite build`.
- **Reinício do servidor no minuto exato do envio pode duplicar a mensagem** de um contato: o tick
  é comparação de minuto, sem marca de "já enviei hoje". Mesma característica do teste agendado que
  já existia. Se virar problema, gravar a última data de envio na pref.
