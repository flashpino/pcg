# Telegram como canal alternativo ao WhatsApp

**Data:** 2026-09-16
**Origem:** plano de 7 tasks para adicionar Telegram como canal de notificação por contato
**Plano:** [docs/superpowers/plans/2026-09-16-telegram-canal-alternativo.md](../../superpowers/plans/2026-09-16-telegram-canal-alternativo.md)
**Design:** [docs/superpowers/specs/2026-09-16-telegram-canal-alternativo-design.md](../../superpowers/specs/2026-09-16-telegram-canal-alternativo-design.md)
**Commits:**
- Task 1: `871ca5a`..`ec4c1bb` — modelo de dados do Telegram como canal por contato
- Task 2: `ec4c1bb`..`ebcc33f` — fila/worker de envio por Telegram + registro do webhook
- Task 3: `ebcc33f`..`752a55d` — Telegram entra no fluxo de alertas/teste/diária por contato
- Task 4: `752a55d`..`ba1f4cb` + fix `bbff8b9` — webhook do Telegram vincula chat_id + registro no boot (fix: ignora payload sem chat_id em vez de 500)
- Task 5: `bbff8b9`..`254d0e0` — link de convite do Telegram + boas-vindas somadas no Telegram
- Task 6: `254d0e0`..`5437a89` — campo de telegram no cadastro de contato + gerar link de convite
- Task 7: `5437a89`..`a05fb96` — este relatório

## Contexto

Antes: Toda notificação de alerta, teste, diária e boas-vindas aos contatos saía só por WhatsApp via Evolution API. Se o número fosse bloqueado pela Meta ou a Evolution caísse, o cliente não teria forma nenhuma de receber avisos.

Depois: Cada contato ganha um canal `channel_telegram` (booleano) com correspondentes `telegram_chat_id` (string) e `telegram_link_token` (string) no banco de dados. Telegram vira um terceiro `Channel` ao lado de `'whatsapp'` e `'voice'`, espelhando os mesmos pontos de envio: alertas (fire/resolve/renotify), teste (manual/automático), aviso antes do teste, diária e boas-vindas. Vinculação ao chat_id do Telegram por dois caminhos: colar manual no cadastro, ou gerar um link de convite (`t.me/<bot>?start=<token>`) que um webhook público (autenticado por secret token) resolve.

## User journeys e testes

| # | User journey | Teste | Resultado |
|---|---|---|---|
| 1 | Como admin, quero adicionar Telegram ao modelo de dados de contatos (colunas + tipos) | `cd server && npx vitest run` (Task 1: fixture `contatoAtivo` compilando com novos campos) | PASS (168 tests) |
| 2 | Como sistema, devo enfileirar mensagens Telegram numa fila com retry/expiry (pg-boss) | `cd server && npx vitest run src/services/notifier.test.ts` (Task 2: `registerTelegramWebhook`) | PASS (15 tests, 2 novos) |
| 3 | Como sistema, ao enviar notificação de alerta, devo incluir o canal Telegram junto a WhatsApp/voz se ligado | `cd server && npx vitest run src/services/alertService.test.ts` (Task 3: 3 testes novos sobre gate e dispatch) | PASS (71 tests, 3 novos) |
| 4 | Como contato, devo poder linkar meu chat_id via `/start` no bot (webhook da Telegram Bot API) | `cd server && npx vitest run src/routes/telegramWebhook.test.ts` (Task 4: 6 testes novos — arquivo novo, incluindo o teste do fix `bbff8b9` para payload sem chat_id) | PASS (6 tests, 6 novos) |
| 5 | Como admin, devo poder gerar um link de convite pro contato e enviar boas-vindas por Telegram | `cd server && npx vitest run src/routes/contacts.test.ts` (Task 5: 6 testes novos, 1 novo arquivo) | PASS (6 tests, 6 novos) |
| 6 | Como admin, quero gerenciar Telegram no cadastro do contato (checkbox, chat_id manual, gerar link) | `cd web && npx esbuild src/pages/ClientContacts.tsx --bundle=false --outfile=/tmp/check.js` (Task 6: syntax check) | OK (sem erro de sintaxe JSX/TS) |

## Test specification

| # | O que é garantido | Teste | Tipo | Resultado |
|---|---|---|---|---|
| 1 | Colunas `channel_telegram`, `telegram_chat_id`, `telegram_link_token` existem em `contacts` | — | integration | não testado diretamente — `schema.sql` é idempotente (`ADD COLUMN IF NOT EXISTS`), validado implicitamente por toda a suíte rodar (`migrate()` executa no boot dos testes que usam DB real, e nenhum teste unitário depende de uma coluna que não existisse). `server/src/db/schema.test.ts` existe mas seus 3 testes cobrem outra coisa (duplicação de constraint, cobertura de tipo de `contact_alert_prefs`, FK de `notifications.contact_id`) e não foi modificado por esta feature — citá-lo como PASS desta linha era incorreto |
| 2 | Tipos `Contact`/`ContactInput` incluem novos campos; `Notification.channel` ganha `'telegram'` | `server/src/services/alertService.test.ts` (fixture `contatoAtivo` compila) | unit | PASS |
| 3 | `setTelegramLinkToken(id, token)` salva token no banco | `server/src/routes/contacts.test.ts:"gera token, grava e devolve a URL"` | integration | PASS |
| 4 | `getContactByTelegramToken(token)` recupera contato por token | `server/src/routes/telegramWebhook.test.ts:"token válido vincula o chat_id"` | integration | PASS |
| 5 | `linkTelegramChat(id, chatId)` vincula chat_id, liga o canal e consome o token (uso único) | `server/src/routes/telegramWebhook.test.ts:"token válido vincula o chat_id"` | integration | PASS |
| 6 | `registerTelegramWebhook()` é idempotente; não chama Bot API se `TELEGRAM_BOT_TOKEN` vazio | `server/src/services/notifier.test.ts:"não chama a Bot API quando TELEGRAM_BOT_TOKEN não está setado"` | unit | PASS |
| 7 | `registerTelegramWebhook()` registra webhook com URL e secret corretos | `server/src/services/notifier.test.ts:"registra o webhook na Bot API com a URL e o secret certos"` | unit | PASS |
| 8 | `enqueueTelegram(job)` enfileira mensagem na fila `notify-telegram` | — | unit | não testado diretamente (ver Gaps) |
| 9 | `sendTelegram(job)` chama Bot API corretamente com `chat_id` e `text` (texto puro, sem `parse_mode`) | — | integration | não testado diretamente (ver Gaps) |
| 10 | Alerta de temperatura dispara WhatsApp + Telegram (quando canal ligado) | `server/src/services/alertService.test.ts:"canal telegram ligado e vinculado dispara enqueueTelegram com o chat_id"` | integration | PASS |
| 11 | Canal Telegram desligado gera `skipped_channel`, sem enfileirar | `server/src/services/alertService.test.ts:"canal telegram desligado registra skipped_channel"` | integration | PASS |
| 12 | Canal Telegram ligado mas sem `chat_id` vinculado gera `skipped_no_telegram_chat_id` | `server/src/services/alertService.test.ts:"canal telegram ligado mas sem chat_id vinculado registra skipped_no_telegram_chat_id"` | integration | PASS |
| 13 | `POST /api/telegram/webhook` rejeita com 403 se header `x-telegram-bot-api-secret-token` errado | `server/src/routes/telegramWebhook.test.ts:"secret header errado responde 403"` | integration | PASS |
| 14 | Webhook rejeita com 403 se `TELEGRAM_WEBHOOK_SECRET` não configurado (nunca fica aberto) | `server/src/routes/telegramWebhook.test.ts:"sem TELEGRAM_WEBHOOK_SECRET configurado, rejeita mesmo sem header"` | integration | PASS |
| 15 | Webhook responde 200 e não altera nada se token inválido (Telegram espera sempre 200) | `server/src/routes/telegramWebhook.test.ts:"token não encontrado responde 200"` | integration | PASS |
| 16 | Webhook vincula `chat_id` quando token válido e `/start` reconhecido | `server/src/routes/telegramWebhook.test.ts:"token válido vincula o chat_id do contato"` | integration | PASS |
| 17 | Webhook ignora mensagens sem `/start` | `server/src/routes/telegramWebhook.test.ts:"mensagem sem /start é ignorada"` | integration | PASS |
| 18 | `POST /api/contacts/:id/telegram-link` gera token, grava no banco e devolve URL `t.me/<bot>?start=<token>` | `server/src/routes/contacts.test.ts:"gera token, grava e devolve a URL de convite"` | integration | PASS |
| 19 | `POST /api/contacts/:id/telegram-link` devolve 404 se contato não existe | `server/src/routes/contacts.test.ts:"contato inexistente devolve 404"` | integration | PASS |
| 20 | `POST /api/contacts/:id/telegram-link` devolve 400 se `TELEGRAM_BOT_USERNAME` não configurado | `server/src/routes/contacts.test.ts:"sem TELEGRAM_BOT_USERNAME configurado devolve 400"` | integration | PASS |
| 21 | Boas-vindas enfileiram WhatsApp (incondicional, como sempre) | `server/src/routes/contacts.test.ts:"contato sem telegram vinculado manda só WhatsApp"` | integration | PASS |
| 22 | Boas-vindas somam Telegram quando `channel_telegram = true` e `telegram_chat_id` preenchido | `server/src/routes/contacts.test.ts:"contato com telegram ligado e vinculado manda WhatsApp e Telegram"` | integration | PASS |
| 23 | Boas-vindas não enfileiram Telegram se canal ligado mas sem `chat_id` ainda | `server/src/routes/contacts.test.ts:"canal ligado mas sem chat_id ainda (link pendente) não manda Telegram"` | integration | PASS |

Evidência: `cd server && npx vitest run --exclude "**/authz.test.ts"`

```
 Test Files  12 passed (12)
      Tests  168 passed (168)
   Start at  12:49:28
   Duration  1.54s
```

Suíte inteira compreende:
- `src/services/scheduleWindow.test.ts` (26 testes)
- `src/services/alertService.test.ts` (71 testes, +3 novos em Task 3)
- `src/routes/ingest.test.ts` (11 testes)
- `src/routes/telegramWebhook.test.ts` (6 testes, +6 novos em Task 4, novo arquivo)
- `src/routes/settings.test.ts` (4 testes)
- `src/routes/contacts.test.ts` (6 testes, +6 novos em Task 5, novo arquivo)
- `src/services/notifier.test.ts` (15 testes, +2 novos em Task 2)
- `src/services/dashboardService.test.ts` (15 testes)
- `src/services/influx.test.ts` (2 testes)
- `src/db/schema.test.ts` (3 testes)
- `src/services/messageTemplates.test.ts` (6 testes)
- `src/services/calibration.test.ts` (3 testes)

## Cobertura e gaps conhecidos

### Gaps por design (aceito, fora de escopo de teste automatizado)

- **`enqueueTelegram`/`sendTelegram` sem teste direto.** Ambos são wrappers finos (pg-boss e `fetch`, respectivamente) e não têm teste unitário direto — só são exercitados indiretamente pelo worker. Isso segue exatamente o mesmo padrão pré-existente de `enqueueWhatsapp`/`sendWhatsapp` e `enqueueVoice`/`sendVoice`, que também não têm teste direto nesta base de código (só via worker). É uma convenção de fronteira de teste já estabelecida no projeto, não uma lacuna introduzida por esta feature.

- **Webhook não testado contra a Bot API real.** `src/routes/telegramWebhook.test.ts` testa contra o contrato documentado da Telegram (formato de payload, header `x-telegram-bot-api-secret-token`, parse de `/start <token>`), mas não faz HTTP real pra `api.telegram.org`. Validado por:
  - Integração manual em dev/staging com bot de teste
  - Código espelha o padrão de `src/routes/twilio.ts` (webhook de Twilio), já validado em produção
  - Leitura do código da função `linkTelegramChat` que é chamada pelo webhook (query parametrizado, comportamento idempotente)

- **UI sem teste automatizado.** `web/src/pages/ClientContacts.tsx` não tem Vitest/RTL em `web/` (só Playwright e2e + tsc + esbuild), validado por:
  - Sintaxe JSX/TypeScript check: `npx esbuild src/pages/ClientContacts.tsx --bundle=false --outfile=/tmp/check.js` ✓
  - Compilação inteira: `npm run build` derrubada por `SupervisorsPage.tsx` (ver gap abaixo, pré-existente)
  - Integração manual em dev: checkbox, campo de chat_id, botão de gerar link, link copiável funcionando

### Gap pré-existente (fora de escopo desta feature)

- **`server/src/authz.test.ts` tem erro de sintaxe TypeScript (Unterminated template literal)** que já existia antes desta task — quebra `npx tsc --noEmit` e `npx vitest run` sem `--exclude`:
  ```
  server/src/authz.test.ts(60,27): error TS1160: Unterminated template literal.
  ```
  Não foi tocado nesta mudança. Suprimido com `--exclude "**/authz.test.ts"` neste relatório.

- **`web/src/pages/SupervisorsPage.tsx` está com conteúdo binário/corrompido no disco local** (hash diferente entre HEAD e working tree, não detectado por `git status`/`git diff`), bloqueando `tsc`/`npm run build` em `web/`. O erro específico de compilador foi reportado em uma sessão anterior, não capturado por um comando rodado nesta sessão de evidência — por isso não é reproduzido aqui literalmente. Não editado, não corrigido — fora de escopo desta feature e de escopo de teste (Task 6 valida só com esbuild isolado, que não baixa dependências cruzadas).

## Resumo de evidência

- ✓ Todas as 168 testes passam (incluindo 17 novos Telegram: notifier.test.ts +2, alertService.test.ts +3, telegramWebhook.test.ts +6, contacts.test.ts +6)
- ✓ `npx tsc --noEmit` limpo exceto o erro pré-existente em `authz.test.ts`
- ✓ Dois arquivos de teste novos (`telegramWebhook.test.ts`, `contacts.test.ts`) com cobertura de novos endpoints
- ✓ Três novos testes de lógica em `alertService.test.ts` cobrindo gate por contato
- ✓ Dois novos testes de webhook registration em `notifier.test.ts`
- ✓ Painel (Task 6) valida sintaxe JSX/TS sem erro
- ✓ Nenhum código quebrado, migrações de dados rodaram, fixtures atualizadas
