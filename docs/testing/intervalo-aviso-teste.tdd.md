# Intervalo de 2 minutos entre o aviso e o teste — relatório TDD

**Data:** 2026-07-30 · **Branch:** master · **Runner:** `npm test` (vitest) em `server/`

## Relato

> "no teste depois do aviso informando q vai ser executado o teste deve aguardar 2 minutos e logo
> após fazer a ligacao e enviar a msg no whatsapp, hj esta fazendo sem intevalo e nao da tempo do
> usuario saber que vai ser executado um teste"

O `test_warning` e o teste em si eram enfileirados no mesmo instante. O aviso existe justamente
para a pessoa saber que a ligação automática não é emergência — sem intervalo, ele não cumpre essa
função.

## Solução

`startAfter` do pg-boss (agendamento no banco), não timer em memória: o atraso sobrevive a
restart/deploy do container entre o aviso e o teste. `enqueueWhatsapp`/`enqueueVoice` ganharam um
segundo parâmetro `delaySeconds = 0`, repassado por `notifyContacts`. Só o teste usa 120 s — alerta
real continua imediato.

Vale para os dois caminhos: `sendTest` (botão do painel, device e teste agendado) e
`sendContactTest` (botão "Testar canal" no cadastro do contato).

## Ciclo RED → GREEN

| Etapa | Commit | Comando | Resultado |
|---|---|---|---|
| RED | `0ff092d` | `npm test` | **3 failed / 107 passed** — `expected undefined to be 120` |
| GREEN | `2fd1a33` | `npm test` + `npm run build` | **110 passed (7 arquivos)**, `tsc` limpo |

## Especificação testada

| # | O que fica garantido | Teste | Tipo | Resultado |
|---|---|---|---|---|
| 1 | No teste por sensor, o aviso sai na hora e o WhatsApp/ligação de teste só 2 min depois | `alertService.test.ts:aguarda 2 minutos entre o aviso e o teste (WhatsApp e ligação)` | integração (mocks) | PASS |
| 2 | O botão "Testar canal" tem o mesmo intervalo | `alertService.test.ts:sendContactTest > aguarda 2 minutos entre o aviso e o teste` | integração (mocks) | PASS |
| 3 | Alerta real de temperatura continua ligando imediatamente (atraso é exclusivo do teste) | `alertService.test.ts:canal ligado e texto configurado dispara WhatsApp e ligação` | integração (mocks) | PASS |
| 4 | Mensagem diária continua imediata | `alertService.test.ts:tudo normal: um WhatsApp por contato` | integração (mocks) | PASS |

Comando de evidência: `npm test` em `server/`.

## Lacunas

- O intervalo é a constante `TEST_DELAY_SECONDS` em `alertService.ts`, não um campo de
  configuração. Se precisar ser ajustável por cliente, o lugar natural é `app_settings`, junto de
  `test_schedule_dow`/`test_schedule_time`.
- Não há teste de integração real contra o pg-boss (nenhum teste do projeto sobe Postgres); o que
  está coberto é que o valor correto chega ao `enqueue*`. O `startAfter` em si é comportamento da
  biblioteca.
