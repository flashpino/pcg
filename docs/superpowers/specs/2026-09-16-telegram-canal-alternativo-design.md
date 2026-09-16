# Telegram como canal alternativo ao WhatsApp — Design

**Data:** 2026-09-16
**Status:** aprovado para planejamento

## Problema

Hoje toda notificação de texto ao cliente (alerta, teste, diária, boas-vindas)
sai só por WhatsApp via Evolution API. Se o número for bloqueado pela Meta (ou
a Evolution cair de vez), o cliente para de receber qualquer aviso até o admin
resolver manualmente (já existe a troca de instância Evolution, mas se o
WhatsApp como um todo parar, não há alternativa nenhuma). O pedido é dar ao
cliente um canal de reserva: Telegram, configurável por contato.

## Decisões tomadas (via brainstorming)

- **Modelo:** canal por contato, igual voz/whatsapp já funcionam hoje
  (`contact.channel_voice`, `contact.channel_whatsapp`) — não é um switch
  global. Cada contato liga/desliga Telegram independente dos outros dois.
- **Vinculação ao chat_id** (bot do Telegram só manda mensagem pra quem já deu
  `/start` nele) — os dois jeitos, à escolha do admin:
  - **Manual:** contato descobre o próprio chat_id (ex. bot @userinfobot) e
    admin cola no cadastro.
  - **Link automático:** botão no cadastro gera link `t.me/<bot>?start=<token>`;
    quando o contato clica e dá `/start`, um webhook do Telegram vincula o
    chat_id sozinho.
- **Escopo das mensagens:** Telegram espelha o WhatsApp em **todos** os pontos
  que já mandam WhatsApp pro contato — fire/resolve/renotify de
  temperatura/umidade/conectividade, teste (manual/automático), aviso antes do
  teste, diária, **e boas-vindas** (adicionado depois da 1ª proposta, ver
  abaixo). Fora do escopo: avisos pra **admins** (hardware/reboot/firmware) —
  hoje admins não têm sistema de preferência de canal, só telefone; continuam
  só WhatsApp.
- **Boas-vindas:** o envio por WhatsApp continua **incondicional**, exatamente
  como hoje (não passa a checar `channel_whatsapp`, pra não mudar
  comportamento existente). Telegram é **somado** em paralelo só quando
  `channel_telegram = true` **e** `telegram_chat_id` já estiver preenchido —
  na prática só dispara em boas-vindas reenviadas depois que o contato já
  linkou o Telegram, já que no cadastro inicial ainda não há vínculo.
- **Texto da mensagem:** reaproveita o texto já renderizado do template
  `whatsapp` (`message_templates`) — sem campo de template próprio pro
  Telegram. Enviado como texto puro, sem `parse_mode` (Markdown/HTML), pra não
  abrir brecha de injeção via texto editado no painel — mesma cautela que já
  existe no escape do SSML de voz (`voiceTwiml`/`escapeXml`).

## Arquitetura

### Dados (`contacts`)

```sql
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS channel_telegram BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS telegram_link_token TEXT UNIQUE;
```

`channel_telegram` começa `false` (diferente de voz/whatsapp, que começam
`true`): sem chat_id vinculado não há pra onde mandar, então não faz sentido
nascer ligado.

### Envio (`server/src/services/notifier.ts`)

- `Channel` (hoje `'whatsapp' | 'voice'`, em `alertService.ts`) ganha
  `'telegram'`.
- Nova fila pg-boss `notify-telegram` + `enqueueTelegram(job)`, espelhando
  `enqueueWhatsapp`/`enqueueVoice`. `job.phone` é reaproveitado como
  destinatário genérico (aqui carrega o `chat_id`, não um telefone — mesmo
  campo que `sendVoice`/`sendWhatsapp` já usam pro respectivo destinatário).
- `sendTelegram(job)`: `POST https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/sendMessage`
  com `{ chat_id: job.phone, text: job.text }`, sem `parse_mode`.
- Worker novo em `startNotifier()`: sem o throttle serializado do WhatsApp
  (não há risco de banimento tipo Meta); concorrência ~5, mesmo padrão de voz.
- Nova função exportada `registerTelegramWebhook()`, chamada no boot
  (`index.ts`, só se `TELEGRAM_BOT_TOKEN` estiver setado — instalação sem
  Telegram configurado não tenta nada): `setWebhook` da Bot API apontando pra
  `${PUBLIC_URL}/api/telegram/webhook` com `secret_token = TELEGRAM_WEBHOOK_SECRET`.
  Idempotente, mesmo espírito de `migrate()`/`seedSettings()` já rodando a
  cada start.

### Gate por contato (`server/src/services/alertService.ts`)

- `notifyContacts`: o `channelEnabled` (hoje um ternário `whatsapp`/`voice`)
  passa a cobrir os três canais. Contato com `channel_telegram = true` mas sem
  `telegram_chat_id` ainda cai num motivo auditável novo,
  `skipped_no_telegram_chat_id` (mesmo padrão de `skipped_no_voice_text`).
- Todo call site que hoje passa `['whatsapp']` ou `['whatsapp', 'voice']` pra
  `notifyContacts`/`sendTest` ganha `'telegram'` na lista: fire/resolve/renotify
  de temperature/humidity/connectivity, `warnBeforeTest`, `sendTest` (default
  do teste manual), `sendDailyReport`. `runScheduledTests` (teste semanal
  automático, em `notifier.ts`) também ganha `'telegram'` ao lado do
  `'whatsapp'` que já manda.
- `sendContactTest`/`POST /api/contacts/:id/test` (botão "Testar canal") segue
  o mesmo `channels` default de `sendTest` — testa Telegram junto se o contato
  tiver o canal ligado.

### Boas-vindas (`server/src/routes/contacts.ts`)

`POST /api/contacts/:id/welcome` continua enfileirando WhatsApp sem condição
nenhuma (comportamento inalterado) e, **em paralelo**, se
`contact.channel_telegram && contact.telegram_chat_id`, cria uma 2ª
`notification` (`channel: 'telegram'`) e chama `enqueueTelegram`.

### Vinculação

- **Manual:** `channel_telegram`/`telegram_chat_id` entram em `ContactInput`
  (`db/queries.ts`) — o `PATCH /api/contacts/:id` já genérico (monta `SET`
  a partir das chaves do patch) passa a aceitar os dois campos sem lógica
  nova.
- **Link automático:** rota nova `POST /api/contacts/:id/telegram-link` gera
  um token (`crypto.randomUUID()`), grava em `telegram_link_token`, devolve
  `{ url: 'https://t.me/<TELEGRAM_BOT_USERNAME>?start=<token>' }`.
- **Webhook:** rota nova `POST /api/telegram/webhook`, pública (adicionar
  `path.startsWith('/api/telegram/')` em `isPublicRoute`, `authz.ts`), só
  aceita o request se o header `x-telegram-bot-api-secret-token` bater com
  `TELEGRAM_WEBHOOK_SECRET` (mesmo padrão de `POST
  /api/twilio/voice-status/:id`, que valida a assinatura da Twilio dentro do
  handler e devolve 403 se não bater). Extrai o token do payload
  `message.text` (`"/start <token>"`), acha o contato por
  `telegram_link_token`, seta `telegram_chat_id = message.chat.id`,
  `channel_telegram = true`, limpa `telegram_link_token` (uso único). Token
  não encontrado/inválido: responde 200 vazio (webhook do Telegram não deve
  receber erro por update que não é sobre nós) e não altera nada.

### Env novas

`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`
(reaproveita `PUBLIC_URL`, que já existe pro status callback da Twilio). Bot
em si é criado fora do sistema (BotFather), fora de escopo deste trabalho.

### UI (`web/src/pages/ClientContacts.tsx`)

- Checkbox "telegram" ao lado de "voz"/"whatsapp".
- Campo de texto pro `telegram_chat_id` (colar manual).
- Botão "Gerar link" que chama `POST /api/contacts/:id/telegram-link` e
  mostra a URL retornada (copiável) pro admin mandar ao contato.

## Testes

Mesmo padrão já usado nesta sessão (vitest + mocks de `db/queries.js`,
`app.inject` do Fastify):

- `notifier.test.ts`: `sendTelegram`/fila nova — request feito com
  `chat_id`/`text` corretos, sem `parse_mode`; erro de rede vira falha
  registrada (mesmo contrato de `sendWhatsapp`).
- `alertService.test.ts`: `notifyContacts` inclui/exclui Telegram conforme
  `channel_telegram` + presença de `telegram_chat_id`; novo motivo
  `skipped_no_telegram_chat_id` auditado corretamente.
- `routes/contacts.test.ts` (novo arquivo): `telegram-link` gera token e
  devolve a URL certa; `welcome` manda Telegram só quando canal ligado E
  chat_id presente, sem tocar o envio de WhatsApp existente.
- `routes/telegramWebhook.test.ts` (novo arquivo): token válido vincula
  chat_id e liga o canal; token inválido/ausente não altera nada e responde
  200; secret header errado responde 403.

## Fora de escopo

- Avisos pra admins (hardware/reboot/firmware) — continuam só WhatsApp.
- Template de mensagem dedicado pro Telegram — reaproveita o texto do
  WhatsApp.
- QR code pro link de convite — só a URL em texto por ora.
- Criação/configuração do bot no BotFather — passo manual do admin, fora do
  código.
