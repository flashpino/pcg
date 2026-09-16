# Telegram como canal alternativo ao WhatsApp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a cada contato um canal de reserva (Telegram) que continue entregando alertas se o WhatsApp (Evolution) parar de vez, sem trocar nada em código/env pra ativar por contato.

**Architecture:** Telegram vira um 3º `Channel` por contato (`'whatsapp' | 'voice' | 'telegram'`), espelhando exatamente como `channel_voice`/`channel_whatsapp` já funcionam hoje — mesma fila/worker do pg-boss por canal, mesmo gate de preferência/janela em `notifyContacts`. Vinculação ao `chat_id` do Telegram por dois caminhos: colar manual no cadastro, ou um link de convite (`t.me/<bot>?start=<token>`) que um webhook público (autenticado por *secret token*) resolve sozinho.

**Tech Stack:** Fastify + node-postgres (server já existente), Telegram Bot API via `fetch` (sem SDK novo — mesmo padrão que Evolution/Twilio já usam), Vitest + `app.inject` do Fastify pros testes.

## Global Constraints

- Modelo por contato, não switch global — cada contato liga/desliga Telegram independente de voz/whatsapp.
- `channel_telegram` nasce `false` (default diferente de voz/whatsapp): sem `chat_id` vinculado não há pra onde mandar.
- Telegram espelha TODO ponto que hoje manda WhatsApp pro contato (alertas, teste, diária, aviso de teste, **e boas-vindas**) — nunca os avisos de admin (hardware/reboot/firmware), que ficam fora de escopo.
- Boas-vindas por WhatsApp continua **incondicional**, exatamente como hoje — Telegram é só **somado**, nunca substitui, e só quando `channel_telegram && telegram_chat_id` já existirem os dois.
- Mensagem enviada é sempre o texto já renderizado do template `whatsapp` (`message_templates`) — sem campo de template próprio pro Telegram, sem `parse_mode` (texto puro).
- Recurso inteiro é opcional: sem `TELEGRAM_BOT_TOKEN` no env, nada do Telegram roda (nem o registro do webhook no boot).
- Webhook (`POST /api/telegram/webhook`) é a única rota pública nova; sem `TELEGRAM_WEBHOOK_SECRET` configurado ela rejeita TUDO (nunca cai em "aberto" por falta de configuração).

---

### Task 1: Modelo de dados — schema + tipos + funções de vinculação

**Files:**
- Modify: `server/src/db/schema.sql:62-63` (bloco `contacts`), `server/src/db/schema.sql:147-148` (bloco `notifications`)
- Modify: `server/src/db/queries.ts:278-298` (`Contact`/`ContactInput`), `server/src/db/queries.ts:343-344` (novas funções após `deleteContact`), `server/src/db/queries.ts:438-449` (`Notification.channel`)
- Modify (fixture, pra manter a suíte existente compilando/passando): `server/src/services/alertService.test.ts:421-431`

**Interfaces:**
- Produces: `Contact.channel_telegram: boolean`, `Contact.telegram_chat_id: string | null`, `Contact.telegram_link_token: string | null`; `ContactInput.channel_telegram?: boolean`, `ContactInput.telegram_chat_id?: string`; `setTelegramLinkToken(id: number, token: string): Promise<void>`; `getContactByTelegramToken(token: string): Promise<Contact | undefined>`; `linkTelegramChat(id: number, chatId: string): Promise<Contact>`; `Notification.channel` ganha `'telegram'`.
- Consumes: nada (base do resto do plano).

- [ ] **Step 1: Colunas novas em `contacts` + comentários de `notifications`**

Em `server/src/db/schema.sql`, troque:

```sql
-- Liga/desliga geral do contato (independente das prefs por tipo abaixo).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
```

por:

```sql
-- Liga/desliga geral do contato (independente das prefs por tipo abaixo).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
-- Telegram como canal alternativo ao WhatsApp (bloqueio pela Meta, Evolution fora do ar etc.).
-- channel_telegram começa false (diferente de voz/whatsapp): sem chat_id vinculado não há pra
-- onde mandar. telegram_link_token é o token de uso único do link de convite (t.me/<bot>?start=);
-- limpo assim que o webhook vincula o chat_id.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS channel_telegram BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS telegram_link_token TEXT UNIQUE;
```

E troque:

```sql
  channel TEXT NOT NULL,                   -- 'voice' | 'whatsapp'
  status TEXT NOT NULL DEFAULT 'queued',   -- queued|sent|failed|skipped_window|skipped_pref|skipped_channel|skipped_no_voice_text|skipped_no_admin|skipped_alert_firing|skipped_already_sent
```

por:

```sql
  channel TEXT NOT NULL,                   -- 'voice' | 'whatsapp' | 'telegram'
  status TEXT NOT NULL DEFAULT 'queued',   -- queued|sent|failed|skipped_window|skipped_pref|skipped_channel|skipped_no_voice_text|skipped_no_telegram_chat_id|skipped_no_admin|skipped_alert_firing|skipped_already_sent
```

- [ ] **Step 2: `Contact`/`ContactInput`/`Notification` em `queries.ts`**

Em `server/src/db/queries.ts`, troque:

```ts
export interface Contact {
  id: number;
  client_id: number;
  name: string;
  phone: string;
  channel_voice: boolean;
  channel_whatsapp: boolean;
  timezone: string;
  active: boolean;
  created_at: string;
}

export interface ContactInput {
  client_id: number;
  name: string;
  phone: string;
  channel_voice?: boolean;
  channel_whatsapp?: boolean;
  timezone?: string;
  active?: boolean;
}
```

por:

```ts
export interface Contact {
  id: number;
  client_id: number;
  name: string;
  phone: string;
  channel_voice: boolean;
  channel_whatsapp: boolean;
  channel_telegram: boolean;
  telegram_chat_id: string | null;
  telegram_link_token: string | null;
  timezone: string;
  active: boolean;
  created_at: string;
}

export interface ContactInput {
  client_id: number;
  name: string;
  phone: string;
  channel_voice?: boolean;
  channel_whatsapp?: boolean;
  channel_telegram?: boolean;
  telegram_chat_id?: string;
  timezone?: string;
  active?: boolean;
}
```

(`telegram_link_token` fica de fora de `ContactInput` de propósito — é gerado/consumido só pelo servidor, o admin nunca edita direto.)

Troque:

```ts
  channel: 'voice' | 'whatsapp';
```

por:

```ts
  channel: 'voice' | 'whatsapp' | 'telegram';
```

- [ ] **Step 3: Funções de vinculação (token + link do chat_id)**

Em `server/src/db/queries.ts`, troque:

```ts
export const deleteContact = (id: number) =>
  pool.query('DELETE FROM contacts WHERE id = $1', [id]).then((r) => r.rowCount! > 0);

export interface ContactAlertPref {
```

por:

```ts
export const deleteContact = (id: number) =>
  pool.query('DELETE FROM contacts WHERE id = $1', [id]).then((r) => r.rowCount! > 0);

// Token de uso único do link de convite (POST /api/contacts/:id/telegram-link) — não faz parte
// de ContactInput porque o admin não edita direto, só o servidor gera/consome.
export const setTelegramLinkToken = (id: number, token: string) =>
  pool.query('UPDATE contacts SET telegram_link_token = $2 WHERE id = $1', [id, token]).then(() => undefined);

export const getContactByTelegramToken = (token: string) =>
  pool.query<Contact>('SELECT * FROM contacts WHERE telegram_link_token = $1', [token]).then((r) => r.rows[0]);

// Chamado pelo webhook do Telegram (POST /api/telegram/webhook) quando o contato dá /start no
// bot: vincula o chat_id, liga o canal e consome o token (uso único).
export const linkTelegramChat = (id: number, chatId: string) =>
  pool
    .query<Contact>(
      `UPDATE contacts SET telegram_chat_id = $2, channel_telegram = true, telegram_link_token = NULL
       WHERE id = $1 RETURNING *`,
      [id, chatId],
    )
    .then((r) => r.rows[0]);

export interface ContactAlertPref {
```

- [ ] **Step 4: Atualizar a fixture `contatoAtivo` (senão a suíte para de compilar)**

Em `server/src/services/alertService.test.ts`, troque:

```ts
const contatoAtivo = {
  id: 5,
  client_id: 1,
  name: 'Fulano',
  phone: '+5511999999999',
  channel_voice: true,
  channel_whatsapp: true,
  timezone: 'America/Sao_Paulo',
  active: true,
  created_at: '2026-01-01',
} as queries.Contact;
```

por:

```ts
const contatoAtivo = {
  id: 5,
  client_id: 1,
  name: 'Fulano',
  phone: '+5511999999999',
  channel_voice: true,
  channel_whatsapp: true,
  channel_telegram: false,
  telegram_chat_id: null,
  telegram_link_token: null,
  timezone: 'America/Sao_Paulo',
  active: true,
  created_at: '2026-01-01',
} as queries.Contact;
```

- [ ] **Step 5: Verificar que nada quebrou**

Run: `cd server && npx tsc --noEmit`
Expected: sem erros novos (o repo já tem 1 erro pré-existente e não relacionado em `src/authz.test.ts` — se for o ÚNICO erro, está OK).

Run: `cd server && npx vitest run --exclude "**/authz.test.ts"`
Expected: todos os testes continuam PASS (mesma contagem de antes + 0 novos, já que este task não adiciona teste — só dado).

- [ ] **Step 6: Commit**

```bash
git add server/src/db/schema.sql server/src/db/queries.ts server/src/services/alertService.test.ts
git commit -m "feat(server): modelo de dados do Telegram como canal por contato"
```

---

### Task 2: Envio por Telegram — fila, worker e registro do webhook na Bot API

**Files:**
- Modify: `server/src/services/notifier.ts`
- Test: `server/src/services/notifier.test.ts`

**Interfaces:**
- Consumes: nenhum (independente do Task 1 — só mexe em `NotifyJob`/envio, não em `Contact`).
- Produces: `enqueueTelegram(job: NotifyJob, delaySeconds?: number): Promise<...>`; `registerTelegramWebhook(): Promise<void>` (exportada — Task 4 a chama no boot).

- [ ] **Step 1: Escrever o teste que falha primeiro**

Em `server/src/services/notifier.test.ts`, troque a linha de import:

```ts
import { getEvolutionConnectionState, spNow, voiceTwiml } from './notifier.js';
```

por:

```ts
import { getEvolutionConnectionState, registerTelegramWebhook, spNow, voiceTwiml } from './notifier.js';
```

E acrescente, no fim do arquivo (depois do último `});` do `describe('getEvolutionConnectionState', ...)`):

```ts

describe('registerTelegramWebhook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('não chama a Bot API quando TELEGRAM_BOT_TOKEN não está setado', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await registerTelegramWebhook();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registra o webhook na Bot API com a URL e o secret certos', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '123:abc');
    vi.stubEnv('PUBLIC_URL', 'https://proatus.app');
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'segredo');
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);

    await registerTelegramWebhook();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/bot123:abc/setWebhook',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'https://proatus.app/api/telegram/webhook', secret_token: 'segredo' }),
      }),
    );
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha (RED)**

Run: `cd server && npx vitest run src/services/notifier.test.ts`
Expected: FAIL — `registerTelegramWebhook` não existe ainda (`does not provide an export named 'registerTelegramWebhook'` ou similar erro de import/compilação).

- [ ] **Step 3: Implementar o mínimo**

Em `server/src/services/notifier.ts`, troque:

```ts
const WHATSAPP_QUEUE = 'notify-whatsapp';
const VOICE_QUEUE = 'notify-voice';
```

por:

```ts
const WHATSAPP_QUEUE = 'notify-whatsapp';
const VOICE_QUEUE = 'notify-voice';
const TELEGRAM_QUEUE = 'notify-telegram';
```

Troque:

```ts
export interface NotifyJob {
  notificationId: number;
  phone: string;
  text: string;
}

// delaySeconds usa o startAfter do pg-boss (agendamento no banco), não um timer em memória: o
// atraso sobrevive a restart/deploy do server, que é o que faz a ligação de teste sair mesmo
// quando o container reinicia entre o aviso e o teste.
export const enqueueWhatsapp = (job: NotifyJob, delaySeconds = 0) =>
  getBoss().send(WHATSAPP_QUEUE, job, { ...QUEUE_OPTS, startAfter: delaySeconds });
export const enqueueVoice = (job: NotifyJob, delaySeconds = 0) =>
  getBoss().send(VOICE_QUEUE, job, { ...QUEUE_OPTS, startAfter: delaySeconds });
```

por:

```ts
export interface NotifyJob {
  notificationId: number;
  // Destinatário: telefone (whatsapp/voice) ou chat_id do Telegram (telegram) — mesmo campo,
  // porque quem lê é só o `send*` do canal correspondente.
  phone: string;
  text: string;
}

// delaySeconds usa o startAfter do pg-boss (agendamento no banco), não um timer em memória: o
// atraso sobrevive a restart/deploy do server, que é o que faz a ligação de teste sair mesmo
// quando o container reinicia entre o aviso e o teste.
export const enqueueWhatsapp = (job: NotifyJob, delaySeconds = 0) =>
  getBoss().send(WHATSAPP_QUEUE, job, { ...QUEUE_OPTS, startAfter: delaySeconds });
export const enqueueVoice = (job: NotifyJob, delaySeconds = 0) =>
  getBoss().send(VOICE_QUEUE, job, { ...QUEUE_OPTS, startAfter: delaySeconds });
export const enqueueTelegram = (job: NotifyJob, delaySeconds = 0) =>
  getBoss().send(TELEGRAM_QUEUE, job, { ...QUEUE_OPTS, startAfter: delaySeconds });
```

Troque:

```ts
// Evolution usa WhatsApp Web por baixo — número sem '+' e sem formatação, texto livre.
async function sendWhatsapp(job: NotifyJob): Promise<void> {
  const instance = await evolutionInstance();
  const res = await fetch(`${process.env.EVOLUTION_URL}/message/sendText/${instance}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.EVOLUTION_APIKEY! },
    body: JSON.stringify({ number: job.phone.replace(/\D/g, ''), text: job.text }),
  });
  if (!res.ok) throw new Error(`evolution respondeu ${res.status}: ${await res.text()}`);
}
```

por:

```ts
// Evolution usa WhatsApp Web por baixo — número sem '+' e sem formatação, texto livre.
async function sendWhatsapp(job: NotifyJob): Promise<void> {
  const instance = await evolutionInstance();
  const res = await fetch(`${process.env.EVOLUTION_URL}/message/sendText/${instance}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.EVOLUTION_APIKEY! },
    body: JSON.stringify({ number: job.phone.replace(/\D/g, ''), text: job.text }),
  });
  if (!res.ok) throw new Error(`evolution respondeu ${res.status}: ${await res.text()}`);
}

// job.phone aqui é o chat_id (vinculado via /api/contacts/:id/telegram-link ou colado manual no
// cadastro) — texto puro, sem parse_mode: o texto vem de template editado no painel, e Markdown/
// HTML interpretado abriria a mesma brecha que o escape de SSML da voz já evita.
async function sendTelegram(job: NotifyJob): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: job.phone, text: job.text }),
  });
  if (!res.ok) throw new Error(`telegram respondeu ${res.status}: ${await res.text()}`);
}

// Idempotente, chamado no boot (index.ts) — só faz algo se TELEGRAM_BOT_TOKEN estiver setado,
// pra instalação sem Telegram configurado não tentar nada. setWebhook da Bot API aceita ser
// chamado de novo com a mesma URL sem efeito colateral (mesmo espírito de migrate()/seedSettings()).
export async function registerTelegramWebhook(): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `${process.env.PUBLIC_URL}/api/telegram/webhook`,
        secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
      }),
    });
    if (!res.ok) console.error('setWebhook do Telegram falhou', res.status, await res.text());
  } catch (err) {
    console.error('setWebhook do Telegram falhou', err);
  }
}
```

Troque:

```ts
  const b = getBoss();
  await b.start();
  await b.createQueue(WHATSAPP_QUEUE);
  await b.createQueue(VOICE_QUEUE);
  await b.createQueue(SCHEDULE_TICK_QUEUE);
```

por:

```ts
  const b = getBoss();
  await b.start();
  await b.createQueue(WHATSAPP_QUEUE);
  await b.createQueue(VOICE_QUEUE);
  await b.createQueue(TELEGRAM_QUEUE);
  await b.createQueue(SCHEDULE_TICK_QUEUE);
```

Troque:

```ts
  // Voz não tem risco de spam Meta — paraleliza.
  await b.work<NotifyJob>(VOICE_QUEUE, { localConcurrency: 3 }, async ([job]) => {
    await runJob(job.data, sendVoice);
  });

  await b.work(SCHEDULE_TICK_QUEUE, async () => {
```

por:

```ts
  // Voz não tem risco de spam Meta — paraleliza.
  await b.work<NotifyJob>(VOICE_QUEUE, { localConcurrency: 3 }, async ([job]) => {
    await runJob(job.data, sendVoice);
  });

  // Telegram não bane por rajada (sem o risco de Meta do WhatsApp) — paraleliza como voz.
  await b.work<NotifyJob>(TELEGRAM_QUEUE, { localConcurrency: 5 }, async ([job]) => {
    await runJob(job.data, sendTelegram);
  });

  await b.work(SCHEDULE_TICK_QUEUE, async () => {
```

- [ ] **Step 4: Rodar e confirmar GREEN**

Run: `cd server && npx vitest run src/services/notifier.test.ts`
Expected: PASS (todos os testes do arquivo, incluindo os 2 novos).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/notifier.ts server/src/services/notifier.test.ts
git commit -m "feat(server): fila/worker de envio por Telegram + registro do webhook"
```

---

### Task 3: Telegram entra no fluxo de alertas (gate por contato + todos os pontos de envio)

**Files:**
- Modify: `server/src/services/alertService.ts`
- Modify: `server/src/services/notifier.ts:147-157` (`runScheduledTests`)
- Test: `server/src/services/alertService.test.ts`

**Interfaces:**
- Consumes: `Contact.channel_telegram`/`telegram_chat_id` (Task 1); `enqueueTelegram` (Task 2).
- Produces: `Channel` ganha `'telegram'`; todo call site de `notifyContacts`/`sendTest` passa a incluir `'telegram'` quando já incluía `'whatsapp'`.

- [ ] **Step 1: Escrever os testes que falham primeiro**

Em `server/src/services/alertService.test.ts`, troque a linha de import de `notifier.js`:

```ts
import { enqueueVoice, enqueueWhatsapp } from './notifier.js';
```

por:

```ts
import { enqueueTelegram, enqueueVoice, enqueueWhatsapp } from './notifier.js';
```

Troque o mock:

```ts
vi.mock('./notifier.js', () => ({ enqueueWhatsapp: vi.fn(), enqueueVoice: vi.fn() }));
```

por:

```ts
vi.mock('./notifier.js', () => ({ enqueueWhatsapp: vi.fn(), enqueueVoice: vi.fn(), enqueueTelegram: vi.fn() }));
```

E, no fim do arquivo, troque o último bloco:

```ts
  // Guarda a regra que importa: com canal ligado e texto configurado a ligação continua saindo,
  // uma só, junto do WhatsApp.
  it('canal ligado e texto configurado dispara WhatsApp e ligação', async () => {
    await evaluate(sensor, { temp: 31, hum: 50 });

    expect(enqueueWhatsapp).toHaveBeenCalledTimes(1);
    expect(enqueueVoice).toHaveBeenCalledTimes(1);
    // Alerta real liga na hora — o atraso de 2 min é exclusivo do teste, que tem aviso prévio.
    expect(enqueueVoice).toHaveBeenCalledWith(expect.objectContaining({ phone: '+5511999999999', text: 'alô' }), 0);
  });
});
```

por:

```ts
  // Guarda a regra que importa: com canal ligado e texto configurado a ligação continua saindo,
  // uma só, junto do WhatsApp.
  it('canal ligado e texto configurado dispara WhatsApp e ligação', async () => {
    await evaluate(sensor, { temp: 31, hum: 50 });

    expect(enqueueWhatsapp).toHaveBeenCalledTimes(1);
    expect(enqueueVoice).toHaveBeenCalledTimes(1);
    // Alerta real liga na hora — o atraso de 2 min é exclusivo do teste, que tem aviso prévio.
    expect(enqueueVoice).toHaveBeenCalledWith(expect.objectContaining({ phone: '+5511999999999', text: 'alô' }), 0);
  });

  it('canal telegram ligado e vinculado dispara enqueueTelegram com o chat_id', async () => {
    vi.mocked(queries.listContacts).mockResolvedValue([
      { ...contatoAtivo, channel_telegram: true, telegram_chat_id: '999888777' },
    ]);

    await evaluate(sensor, { temp: 31, hum: 50 });

    expect(enqueueTelegram).toHaveBeenCalledTimes(1);
    expect(enqueueTelegram).toHaveBeenCalledWith(expect.objectContaining({ phone: '999888777', text: 'fora do limite' }), 0);
  });

  it('canal telegram desligado registra skipped_channel e não chama enqueueTelegram', async () => {
    await evaluate(sensor, { temp: 31, hum: 50 });

    expect(queries.createNotification).toHaveBeenCalledWith(70, 5, 'telegram', 'skipped_channel');
    expect(enqueueTelegram).not.toHaveBeenCalled();
  });

  it('canal telegram ligado mas sem chat_id vinculado registra skipped_no_telegram_chat_id', async () => {
    vi.mocked(queries.listContacts).mockResolvedValue([
      { ...contatoAtivo, channel_telegram: true, telegram_chat_id: null },
    ]);

    await evaluate(sensor, { temp: 31, hum: 50 });

    expect(queries.createNotification).toHaveBeenCalledWith(70, 5, 'telegram', 'skipped_no_telegram_chat_id');
    expect(enqueueTelegram).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha (RED)**

Run: `cd server && npx vitest run src/services/alertService.test.ts`
Expected: FAIL nos 3 testes novos — hoje `channelEnabled` trata qualquer canal que não seja `'whatsapp'` como `voice` (então telegram cai em `contact.channel_voice`, que é `true` por padrão em `contatoAtivo`), e o dispatch final chama `enqueueVoice` pra qualquer canal que não seja `'whatsapp'`. O teste "desligado registra skipped_channel" falha porque o canal na prática se comporta como ligado (`channel_voice: true`); o teste "dispara enqueueTelegram" falha porque quem é chamado é `enqueueVoice`, não `enqueueTelegram`.

- [ ] **Step 3: Implementar o mínimo**

Em `server/src/services/alertService.ts`, troque:

```ts
import { enqueueVoice, enqueueWhatsapp } from './notifier.js';
```

por:

```ts
import { enqueueTelegram, enqueueVoice, enqueueWhatsapp } from './notifier.js';
```

Troque:

```ts
export type Channel = 'whatsapp' | 'voice';
```

por:

```ts
export type Channel = 'whatsapp' | 'voice' | 'telegram';
```

Troque:

```ts
      const channelEnabled = channel === 'whatsapp' ? contact.channel_whatsapp : contact.channel_voice;
      if (!channelEnabled) {
        await createNotification(alert.id, contact.id, channel, 'skipped_channel');
        continue;
      }
      // Sem texto de voz no template não há o que falar na ligação. A decisão mora aqui, e não
      // em quem monta `channels`, pra ficar no mesmo lugar que já audita os outros motivos — fora
      // daqui ela não deixava rastro e "não ligou" ficava idêntico a fila travada/Twilio fora.
      if (channel === 'voice' && !texts.voice) {
        await createNotification(alert.id, contact.id, channel, 'skipped_no_voice_text');
        continue;
      }
```

por:

```ts
      const channelEnabled = {
        whatsapp: contact.channel_whatsapp,
        voice: contact.channel_voice,
        telegram: contact.channel_telegram,
      }[channel];
      if (!channelEnabled) {
        await createNotification(alert.id, contact.id, channel, 'skipped_channel');
        continue;
      }
      // Sem texto de voz no template não há o que falar na ligação. A decisão mora aqui, e não
      // em quem monta `channels`, pra ficar no mesmo lugar que já audita os outros motivos — fora
      // daqui ela não deixava rastro e "não ligou" ficava idêntico a fila travada/Twilio fora.
      if (channel === 'voice' && !texts.voice) {
        await createNotification(alert.id, contact.id, channel, 'skipped_no_voice_text');
        continue;
      }
      // Canal ligado mas ainda sem chat_id vinculado (contato não deu /start no bot, ou o admin
      // ligou o canal antes de colar/gerar o link) — mesmo padrão de auditoria do guard acima.
      if (channel === 'telegram' && !contact.telegram_chat_id) {
        await createNotification(alert.id, contact.id, channel, 'skipped_no_telegram_chat_id');
        continue;
      }
```

Troque:

```ts
      // texts.voice garantido pelo guard de skipped_no_voice_text acima.
      const text = channel === 'voice' ? texts.voice! : texts.whatsapp;
      const notification = await createNotification(alert.id, contact.id, channel, 'queued');
      const job = { notificationId: notification.id, phone: contact.phone, text };
      if (channel === 'whatsapp') await enqueueWhatsapp(job, delaySeconds);
      else await enqueueVoice(job, delaySeconds);
    }
  }
}
```

por:

```ts
      // texts.voice garantido pelo guard de skipped_no_voice_text acima.
      const text = channel === 'voice' ? texts.voice! : texts.whatsapp;
      const notification = await createNotification(alert.id, contact.id, channel, 'queued');
      // telegram_chat_id garantido pelo guard de skipped_no_telegram_chat_id acima.
      const to = channel === 'telegram' ? contact.telegram_chat_id! : contact.phone;
      const job = { notificationId: notification.id, phone: to, text };
      if (channel === 'whatsapp') await enqueueWhatsapp(job, delaySeconds);
      else if (channel === 'voice') await enqueueVoice(job, delaySeconds);
      else await enqueueTelegram(job, delaySeconds);
    }
  }
}
```

Agora os 8 call sites em `alertService.ts` que já mandam `'whatsapp'` ganham `'telegram'` também. Troque cada um (são 8 trechos distintos — confira o texto exato de cada `old` antes de trocar, já que várias linhas se parecem):

```ts
    const channels: Channel[] = type === 'temperature' ? ['whatsapp', 'voice'] : ['whatsapp'];
```
→
```ts
    const channels: Channel[] = type === 'temperature' ? ['whatsapp', 'voice', 'telegram'] : ['whatsapp', 'telegram'];
```

```ts
    await notifyContacts(firing!, contacts, prefs, type, ['whatsapp'], texts, 'resolve');
```
→
```ts
    await notifyContacts(firing!, contacts, prefs, type, ['whatsapp', 'telegram'], texts, 'resolve');
```

```ts
  await notifyContacts(firing!, contacts, prefs, type, ['whatsapp'], texts, 'renotify');
```
→
```ts
  await notifyContacts(firing!, contacts, prefs, type, ['whatsapp', 'telegram'], texts, 'renotify');
```

```ts
      await notifyContacts(alert, contacts, prefs, 'connectivity', ['whatsapp'], texts, 'fire');
```
→
```ts
      await notifyContacts(alert, contacts, prefs, 'connectivity', ['whatsapp', 'telegram'], texts, 'fire');
```

```ts
    await notifyContacts(firing!, contacts, prefs, 'connectivity', ['whatsapp'], texts, 'resolve');
```
→
```ts
    await notifyContacts(firing!, contacts, prefs, 'connectivity', ['whatsapp', 'telegram'], texts, 'resolve');
```

```ts
  await notifyContacts(firing!, contacts, prefs, 'connectivity', ['whatsapp'], texts, 'renotify');
```
→
```ts
  await notifyContacts(firing!, contacts, prefs, 'connectivity', ['whatsapp', 'telegram'], texts, 'renotify');
```

```ts
  await notifyContacts(alert, contacts, prefs, 'test', ['whatsapp'], warningTexts, 'fire');
```
→
```ts
  await notifyContacts(alert, contacts, prefs, 'test', ['whatsapp', 'telegram'], warningTexts, 'fire');
```

```ts
// channels default é o teste manual (painel/device): whatsapp + voz. O agendamento automático
// (runScheduledTests em notifier.ts) passa ['whatsapp'] — teste semanal não liga.
export async function sendTest(sensor: Sensor, channels: Channel[] = ['whatsapp', 'voice']): Promise<void> {
```
→
```ts
// channels default é o teste manual (painel/device): whatsapp + voz + telegram. O agendamento
// automático (runScheduledTests em notifier.ts) passa ['whatsapp', 'telegram'] — sem voz, teste
// semanal não liga.
export async function sendTest(sensor: Sensor, channels: Channel[] = ['whatsapp', 'voice', 'telegram']): Promise<void> {
```

```ts
  await notifyContacts(alert, [contact], prefs, 'daily', ['whatsapp'], texts, 'fire');
```
→
```ts
  await notifyContacts(alert, [contact], prefs, 'daily', ['whatsapp', 'telegram'], texts, 'fire');
```

```ts
  await notifyContacts(alert, [contact], prefs, 'test', ['whatsapp', 'voice'], texts, 'fire', TEST_DELAY_SECONDS);
```
→
```ts
  await notifyContacts(alert, [contact], prefs, 'test', ['whatsapp', 'voice', 'telegram'], texts, 'fire', TEST_DELAY_SECONDS);
```

E em `server/src/services/notifier.ts`, troque:

```ts
// Roda a cada minuto (ver startNotifier); cada sensor tem seu próprio dow/time (ou herda o
// padrão global de app_settings quando NULL) — só dispara sendTest nos sensores cujo horário
// bate com o agora, em vez de um cron único disparando todos de uma vez.
// Só whatsapp: o teste manual (botão do painel/device) liga — o semanal automático não.
async function runScheduledTests(): Promise<void> {
  const { dow, time } = spNow(new Date());
  const defaultDow = (await getSetting('test_schedule_dow')) ?? '1';
  const defaultTime = (await getSetting('test_schedule_time')) ?? '09:00';

  for (const client of await listClients()) {
    for (const sensor of await listSensors(client.id)) {
      const sensorDow = sensor.test_schedule_dow ?? defaultDow;
      const sensorTime = sensor.test_schedule_time ?? defaultTime;
      if (sensorDow === dow && sensorTime === time) await sendTest(sensor, ['whatsapp']);
    }
  }
}
```

por:

```ts
// Roda a cada minuto (ver startNotifier); cada sensor tem seu próprio dow/time (ou herda o
// padrão global de app_settings quando NULL) — só dispara sendTest nos sensores cujo horário
// bate com o agora, em vez de um cron único disparando todos de uma vez.
// Whatsapp + telegram: ligação de voz fica só pro teste manual (botão do painel/device), o
// semanal automático não liga.
async function runScheduledTests(): Promise<void> {
  const { dow, time } = spNow(new Date());
  const defaultDow = (await getSetting('test_schedule_dow')) ?? '1';
  const defaultTime = (await getSetting('test_schedule_time')) ?? '09:00';

  for (const client of await listClients()) {
    for (const sensor of await listSensors(client.id)) {
      const sensorDow = sensor.test_schedule_dow ?? defaultDow;
      const sensorTime = sensor.test_schedule_time ?? defaultTime;
      if (sensorDow === dow && sensorTime === time) await sendTest(sensor, ['whatsapp', 'telegram']);
    }
  }
}
```

- [ ] **Step 4: Rodar e confirmar GREEN**

Run: `cd server && npx vitest run src/services/alertService.test.ts src/services/notifier.test.ts`
Expected: PASS (suíte inteira dos dois arquivos, incluindo os 3 testes novos).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/alertService.ts server/src/services/alertService.test.ts server/src/services/notifier.ts
git commit -m "feat(server): Telegram entra no fluxo de alertas/teste/diaria por contato"
```

---

### Task 4: Webhook do Telegram (recebe /start e vincula o chat_id) + boot

**Files:**
- Create: `server/src/routes/telegramWebhook.ts`
- Test: `server/src/routes/telegramWebhook.test.ts`
- Modify: `server/src/authz.ts`, `server/src/index.ts`, `.env.example`

**Interfaces:**
- Consumes: `getContactByTelegramToken`, `linkTelegramChat` (Task 1); `registerTelegramWebhook` (Task 2).
- Produces: rota `POST /api/telegram/webhook` (pública); `telegramWebhookRoutes(app): Promise<void>`.

- [ ] **Step 1: Escrever o teste que falha primeiro**

Crie `server/src/routes/telegramWebhook.test.ts`:

```ts
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { telegramWebhookRoutes } from './telegramWebhook.js';

const mocks = vi.hoisted(() => ({
  getContactByTelegramToken: vi.fn(),
  linkTelegramChat: vi.fn(),
}));

vi.mock('../db/queries.js', () => ({
  getContactByTelegramToken: mocks.getContactByTelegramToken,
  linkTelegramChat: mocks.linkTelegramChat,
}));

const SECRET = 'segredo-teste';

describe('POST /api/telegram/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('secret header errado responde 403 e não toca o banco', async () => {
    const app = Fastify();
    await app.register(telegramWebhookRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'errado' },
      payload: { message: { text: '/start tok123', chat: { id: 999 } } },
    });

    expect(res.statusCode).toBe(403);
    expect(mocks.linkTelegramChat).not.toHaveBeenCalled();
  });

  it('sem TELEGRAM_WEBHOOK_SECRET configurado, rejeita mesmo sem header (nunca abre)', async () => {
    vi.unstubAllEnvs();
    const app = Fastify();
    await app.register(telegramWebhookRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/telegram/webhook', payload: {} });

    expect(res.statusCode).toBe(403);
  });

  it('token não encontrado responde 200 sem alterar nada', async () => {
    mocks.getContactByTelegramToken.mockResolvedValue(undefined);
    const app = Fastify();
    await app.register(telegramWebhookRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      payload: { message: { text: '/start tok-invalido', chat: { id: 999 } } },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.linkTelegramChat).not.toHaveBeenCalled();
  });

  it('token válido vincula o chat_id do contato', async () => {
    mocks.getContactByTelegramToken.mockResolvedValue({ id: 5 });
    const app = Fastify();
    await app.register(telegramWebhookRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      payload: { message: { text: '/start tok-valido', chat: { id: 999888777 } } },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.getContactByTelegramToken).toHaveBeenCalledWith('tok-valido');
    expect(mocks.linkTelegramChat).toHaveBeenCalledWith(5, '999888777');
  });

  it('mensagem sem /start é ignorada (200, sem tocar o banco)', async () => {
    const app = Fastify();
    await app.register(telegramWebhookRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      payload: { message: { text: 'oi', chat: { id: 999 } } },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.getContactByTelegramToken).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha (RED)**

Run: `cd server && npx vitest run src/routes/telegramWebhook.test.ts`
Expected: FAIL — `server/src/routes/telegramWebhook.ts` não existe (erro de módulo não encontrado).

- [ ] **Step 3: Implementar o mínimo**

Crie `server/src/routes/telegramWebhook.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { getContactByTelegramToken, linkTelegramChat } from '../db/queries.js';

interface TelegramUpdate {
  message?: {
    text?: string;
    chat: { id: number };
  };
}

// Único endpoint público do Telegram (ver isPublicRoute em authz.ts). A única autenticação é o
// secret_token que a própria Bot API devolve no header — configurado em registerTelegramWebhook
// (notifier.ts). Sem TELEGRAM_WEBHOOK_SECRET setado, rejeita tudo (nunca cai em "aberto").
export async function telegramWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: TelegramUpdate }>('/api/telegram/webhook', async (req, reply) => {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (!expected || secret !== expected) return reply.status(403).send();

    // Telegram espera 200 mesmo pra updates que não são sobre nós (ex. token velho/inválido) —
    // devolver erro faria a Bot API ficar reenviando o mesmo update.
    const match = /^\/start (\S+)/.exec(req.body?.message?.text ?? '');
    if (!match) return reply.send();

    const contact = await getContactByTelegramToken(match[1]);
    if (!contact) return reply.send();

    await linkTelegramChat(contact.id, String(req.body.message!.chat.id));
    reply.send();
  });
}
```

Em `server/src/authz.ts`, troque:

```ts
export function isPublicRoute(url: string): boolean {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/')) return true;
  return PUBLIC_API_ROUTES.includes(path) || path.startsWith('/api/ota/') || path.startsWith('/api/twilio/');
}
```

por:

```ts
export function isPublicRoute(url: string): boolean {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/')) return true;
  return (
    PUBLIC_API_ROUTES.includes(path) ||
    path.startsWith('/api/ota/') ||
    path.startsWith('/api/twilio/') ||
    path.startsWith('/api/telegram/')
  );
}
```

Em `server/src/index.ts`, troque:

```ts
import { supervisorPortalRoutes } from './routes/supervisorPortal.js';
import { supervisorsRoutes } from './routes/supervisors.js';
import { twilioRoutes } from './routes/twilio.js';
import { startConnectivitySweep } from './services/connectivitySweep.js';
import { getEvolutionConnectionState, startNotifier } from './services/notifier.js';
```

por:

```ts
import { supervisorPortalRoutes } from './routes/supervisorPortal.js';
import { supervisorsRoutes } from './routes/supervisors.js';
import { telegramWebhookRoutes } from './routes/telegramWebhook.js';
import { twilioRoutes } from './routes/twilio.js';
import { startConnectivitySweep } from './services/connectivitySweep.js';
import { getEvolutionConnectionState, registerTelegramWebhook, startNotifier } from './services/notifier.js';
```

Troque:

```ts
await app.register(firmwareRoutes);
await app.register(twilioRoutes);
```

por:

```ts
await app.register(firmwareRoutes);
await app.register(twilioRoutes);
await app.register(telegramWebhookRoutes);
```

Troque:

```ts
await startNotifier();
app.log.info('notifier ok');
startConnectivitySweep(app.log);
```

por:

```ts
await startNotifier();
app.log.info('notifier ok');
await registerTelegramWebhook();
startConnectivitySweep(app.log);
```

Em `.env.example`, troque:

```
# Evolution API (WhatsApp — instância JÁ EXISTENTE, número conectado)
EVOLUTION_URL=http://localhost:8080
EVOLUTION_APIKEY=sua-apikey-evolution
EVOLUTION_INSTANCE=proatus

# Auth do painel
```

por:

```
# Evolution API (WhatsApp — instância JÁ EXISTENTE, número conectado)
EVOLUTION_URL=http://localhost:8080
EVOLUTION_APIKEY=sua-apikey-evolution
EVOLUTION_INSTANCE=proatus

# Telegram (canal alternativo por contato, opcional — sem TELEGRAM_BOT_TOKEN o recurso fica
# inativo). Bot criado via @BotFather. TELEGRAM_WEBHOOK_SECRET é qualquer string aleatória sua
# (não vem do Telegram) — o server manda ela pro setWebhook e confere no header de cada request.
TELEGRAM_BOT_TOKEN=123456:seu-token-do-botfather
TELEGRAM_WEBHOOK_SECRET=gere-um-segredo-longo-aleatorio

# Auth do painel
```

- [ ] **Step 4: Rodar e confirmar GREEN**

Run: `cd server && npx vitest run src/routes/telegramWebhook.test.ts`
Expected: PASS (5 testes).

Run: `cd server && npx tsc --noEmit`
Expected: sem erros novos (mesma ressalva do Task 1 sobre `authz.test.ts` pré-existente).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/telegramWebhook.ts server/src/routes/telegramWebhook.test.ts server/src/authz.ts server/src/index.ts .env.example
git commit -m "feat(server): webhook do Telegram vincula chat_id + registro no boot"
```

---

### Task 5: Link de convite + boas-vindas por Telegram (`routes/contacts.ts`)

**Files:**
- Modify: `server/src/routes/contacts.ts`, `.env.example`
- Test: `server/src/routes/contacts.test.ts` (novo arquivo)

**Interfaces:**
- Consumes: `setTelegramLinkToken` (Task 1); `enqueueTelegram` (Task 2).
- Produces: `POST /api/contacts/:id/telegram-link` → `{ url: string }`.

- [ ] **Step 1: Escrever o teste que falha primeiro**

Crie `server/src/routes/contacts.test.ts`:

```ts
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contactsRoutes } from './contacts.js';

const mocks = vi.hoisted(() => ({
  getContact: vi.fn(),
  setTelegramLinkToken: vi.fn(async () => undefined),
  createNotification: vi.fn(async () => ({ id: 1 })),
  createResolvedAlert: vi.fn(async () => ({ id: 42 })),
  listSensors: vi.fn(async () => [{ id: 7, name: 'Sensor A', local: 'Sala 1' }]),
  getMessageTemplate: vi.fn(async () => ({ whatsapp: 'Olá {{$nome}}!', voice: null })),
  getClient: vi.fn(async () => ({ name: 'Cliente X' })),
  enqueueWhatsapp: vi.fn(),
  enqueueTelegram: vi.fn(),
}));

vi.mock('../db/queries.js', () => ({
  getContact: mocks.getContact,
  setTelegramLinkToken: mocks.setTelegramLinkToken,
  createNotification: mocks.createNotification,
  createResolvedAlert: mocks.createResolvedAlert,
  listSensors: mocks.listSensors,
  getMessageTemplate: mocks.getMessageTemplate,
  getClient: mocks.getClient,
}));
vi.mock('../services/influx.js', () => ({ queryLatestReadings: vi.fn(async () => new Map()) }));
vi.mock('../services/notifier.js', () => ({ enqueueWhatsapp: mocks.enqueueWhatsapp, enqueueTelegram: mocks.enqueueTelegram }));

const contatoBase = {
  id: 5,
  client_id: 1,
  name: 'Fulano',
  phone: '+5511999999999',
  channel_voice: true,
  channel_whatsapp: true,
  channel_telegram: false,
  telegram_chat_id: null,
  telegram_link_token: null,
  timezone: 'America/Sao_Paulo',
  active: true,
  created_at: '2026-01-01',
};

describe('POST /api/contacts/:id/telegram-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TELEGRAM_BOT_USERNAME', 'ProatusBot');
  });

  it('gera token, grava e devolve a URL de convite', async () => {
    mocks.getContact.mockResolvedValue(contatoBase);
    const app = Fastify();
    await app.register(contactsRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/contacts/5/telegram-link' });

    expect(res.statusCode).toBe(200);
    expect(mocks.setTelegramLinkToken).toHaveBeenCalledWith(5, expect.any(String));
    expect(res.json().url).toMatch(/^https:\/\/t\.me\/ProatusBot\?start=.+$/);
  });

  it('contato inexistente devolve 404', async () => {
    mocks.getContact.mockResolvedValue(undefined);
    const app = Fastify();
    await app.register(contactsRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/contacts/999/telegram-link' });

    expect(res.statusCode).toBe(404);
  });

  it('sem TELEGRAM_BOT_USERNAME configurado devolve 400', async () => {
    vi.unstubAllEnvs();
    mocks.getContact.mockResolvedValue(contatoBase);
    const app = Fastify();
    await app.register(contactsRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/contacts/5/telegram-link' });

    expect(res.statusCode).toBe(400);
    expect(mocks.setTelegramLinkToken).not.toHaveBeenCalled();
  });
});

describe('POST /api/contacts/:id/welcome', () => {
  beforeEach(() => vi.clearAllMocks());

  it('contato sem telegram vinculado manda só WhatsApp', async () => {
    mocks.getContact.mockResolvedValue(contatoBase);
    const app = Fastify();
    await app.register(contactsRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/contacts/5/welcome' });

    expect(res.statusCode).toBe(200);
    expect(mocks.enqueueWhatsapp).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueTelegram).not.toHaveBeenCalled();
  });

  it('contato com telegram ligado e vinculado manda WhatsApp e Telegram', async () => {
    mocks.getContact.mockResolvedValue({ ...contatoBase, channel_telegram: true, telegram_chat_id: '999888777' });
    const app = Fastify();
    await app.register(contactsRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/contacts/5/welcome' });

    expect(res.statusCode).toBe(200);
    expect(mocks.enqueueWhatsapp).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueTelegram).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueTelegram).toHaveBeenCalledWith(expect.objectContaining({ phone: '999888777' }));
  });

  it('canal ligado mas sem chat_id ainda (link pendente) não manda Telegram', async () => {
    mocks.getContact.mockResolvedValue({ ...contatoBase, channel_telegram: true, telegram_chat_id: null });
    const app = Fastify();
    await app.register(contactsRoutes);

    await app.inject({ method: 'POST', url: '/api/contacts/5/welcome' });

    expect(mocks.enqueueTelegram).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha (RED)**

Run: `cd server && npx vitest run src/routes/contacts.test.ts`
Expected: FAIL — `POST /api/contacts/:id/telegram-link` devolve 404 (rota não existe); os testes de `welcome` com Telegram falham porque `enqueueTelegram` nunca é chamado hoje.

- [ ] **Step 3: Implementar o mínimo**

Em `server/src/routes/contacts.ts`, troque o bloco de imports:

```ts
import type { FastifyInstance } from 'fastify';
import {
  createContact,
  createNotification,
  createResolvedAlert,
  deleteContact,
  getClient,
  getContact,
  getMessageTemplate,
  listContactAlertPrefs,
  listContacts,
  listSensors,
  updateContact,
  upsertContactAlertPref,
  type ContactAlertPref,
  type ContactInput,
} from '../db/queries.js';
import { sendContactTest } from '../services/alertService.js';
import { queryLatestReadings } from '../services/influx.js';
import { renderTemplate } from '../services/messageTemplates.js';
import { enqueueWhatsapp } from '../services/notifier.js';
```

por:

```ts
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  createContact,
  createNotification,
  createResolvedAlert,
  deleteContact,
  getClient,
  getContact,
  getMessageTemplate,
  listContactAlertPrefs,
  listContacts,
  listSensors,
  setTelegramLinkToken,
  updateContact,
  upsertContactAlertPref,
  type ContactAlertPref,
  type ContactInput,
} from '../db/queries.js';
import { sendContactTest } from '../services/alertService.js';
import { queryLatestReadings } from '../services/influx.js';
import { renderTemplate } from '../services/messageTemplates.js';
import { enqueueTelegram, enqueueWhatsapp } from '../services/notifier.js';
```

Troque:

```ts
    const notification = await createNotification(alert.id, contact.id, 'whatsapp', 'queued', 'welcome');
    await enqueueWhatsapp({ notificationId: notification.id, phone: contact.phone, text });
    return { ok: true };
  });

  // Respeita a pref dedicada 'test' do contato (liga/desliga, dias, janela de horário) — mesma
  // engrenagem do alerta real (notifyContacts em alertService.ts), não mais um envio incondicional.
  app.post<{ Params: { id: string } }>('/api/contacts/:id/test', async (req) => {
```

por:

```ts
    const notification = await createNotification(alert.id, contact.id, 'whatsapp', 'queued', 'welcome');
    await enqueueWhatsapp({ notificationId: notification.id, phone: contact.phone, text });
    // Somado ao WhatsApp (que continua incondicional, sem checar channel_whatsapp, igual sempre
    // foi) — só dispara se o contato já tiver Telegram ligado E vinculado (na maioria dos casos,
    // cadastro novo, ainda não vinculou nada; dispara em boas-vindas reenviadas depois do link).
    if (contact.channel_telegram && contact.telegram_chat_id) {
      const tg = await createNotification(alert.id, contact.id, 'telegram', 'queued', 'welcome');
      await enqueueTelegram({ notificationId: tg.id, phone: contact.telegram_chat_id, text });
    }
    return { ok: true };
  });

  // Gera o link de convite (t.me/<bot>?start=<token>) pro admin mandar ao contato — vinculação
  // manual (colar chat_id direto no cadastro) continua funcionando via PATCH normal, sem passar
  // por aqui. Token de uso único, consumido pelo webhook (routes/telegramWebhook.ts) quando o
  // contato dá /start no bot.
  app.post<{ Params: { id: string } }>('/api/contacts/:id/telegram-link', async (req) => {
    const contact = await getContact(Number(req.params.id));
    if (!contact) throw Object.assign(new Error('contato não encontrado'), { statusCode: 404 });
    if (!process.env.TELEGRAM_BOT_USERNAME) {
      throw Object.assign(new Error('TELEGRAM_BOT_USERNAME não configurado'), { statusCode: 400 });
    }

    const token = randomUUID();
    await setTelegramLinkToken(contact.id, token);
    return { url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${token}` };
  });

  // Respeita a pref dedicada 'test' do contato (liga/desliga, dias, janela de horário) — mesma
  // engrenagem do alerta real (notifyContacts em alertService.ts), não mais um envio incondicional.
  app.post<{ Params: { id: string } }>('/api/contacts/:id/test', async (req) => {
```

Em `.env.example`, troque (o bloco já criado no Task 4):

```
TELEGRAM_BOT_TOKEN=123456:seu-token-do-botfather
TELEGRAM_WEBHOOK_SECRET=gere-um-segredo-longo-aleatorio

# Auth do painel
```

por:

```
TELEGRAM_BOT_TOKEN=123456:seu-token-do-botfather
TELEGRAM_WEBHOOK_SECRET=gere-um-segredo-longo-aleatorio
# @usuario do bot (sem @), usado só pra montar o link de convite (t.me/<usuario>?start=...).
TELEGRAM_BOT_USERNAME=SeuBot

# Auth do painel
```

- [ ] **Step 4: Rodar e confirmar GREEN**

Run: `cd server && npx vitest run src/routes/contacts.test.ts`
Expected: PASS (6 testes).

Run: `cd server && npx vitest run --exclude "**/authz.test.ts"`
Expected: suíte inteira PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/contacts.ts server/src/routes/contacts.test.ts .env.example
git commit -m "feat(server): link de convite do Telegram + boas-vindas somadas no Telegram"
```

---

### Task 6: Painel — checkbox, chat_id manual e botão de gerar link (`ClientContacts.tsx`)

**Files:**
- Modify: `web/src/pages/ClientContacts.tsx`

**Interfaces:**
- Consumes: `POST /api/contacts/:id/telegram-link` (Task 5); `PATCH /api/contacts/:id` já genérico (Task 1 só amplia os campos aceitos, sem mudar a rota).

- [ ] **Step 1: `Contact` (frontend) ganha os campos novos**

Em `web/src/pages/ClientContacts.tsx`, troque:

```ts
interface Contact {
  id: number;
  client_id: number;
  name: string;
  phone: string;
  channel_voice: boolean;
  channel_whatsapp: boolean;
  timezone: string;
  active: boolean;
}
```

por:

```ts
interface Contact {
  id: number;
  client_id: number;
  name: string;
  phone: string;
  channel_voice: boolean;
  channel_whatsapp: boolean;
  channel_telegram: boolean;
  telegram_chat_id: string | null;
  timezone: string;
  active: boolean;
}
```

- [ ] **Step 2: `emptyForm` ganha os defaults**

Troque:

```ts
function emptyForm(clientId: number) {
  return { client_id: clientId, name: '', phone: '', channel_voice: true, channel_whatsapp: true, timezone: 'America/Sao_Paulo', active: true, welcome: false };
}
```

por:

```ts
function emptyForm(clientId: number) {
  return {
    client_id: clientId,
    name: '',
    phone: '',
    channel_voice: true,
    channel_whatsapp: true,
    channel_telegram: false,
    telegram_chat_id: '',
    timezone: 'America/Sao_Paulo',
    active: true,
    welcome: false,
  };
}
```

- [ ] **Step 3: Estado do link gerado + ajustes em `edit`/`cancelEdit`**

Troque:

```ts
export function ClientContacts({ clientId }: { clientId: number }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm(clientId));
  const [prefs, setPrefs] = useState<Record<AlertType, AlertPref>>(emptyPrefs());
```

por:

```ts
export function ClientContacts({ clientId }: { clientId: number }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm(clientId));
  const [prefs, setPrefs] = useState<Record<AlertType, AlertPref>>(emptyPrefs());
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
```

Troque:

```ts
  async function edit(c: Contact) {
    setEditingId(c.id);
    setForm({ ...c, welcome: false });
    const rows = await api.get<AlertPref[]>(`/api/contacts/${c.id}/alert-prefs`);
    const byType = emptyPrefs();
    for (const row of rows) byType[row.alert_type] = row;
    setPrefs(byType);
  }
```

por:

```ts
  async function edit(c: Contact) {
    setEditingId(c.id);
    setForm({ ...c, telegram_chat_id: c.telegram_chat_id ?? '', welcome: false });
    setTelegramLink(null);
    const rows = await api.get<AlertPref[]>(`/api/contacts/${c.id}/alert-prefs`);
    const byType = emptyPrefs();
    for (const row of rows) byType[row.alert_type] = row;
    setPrefs(byType);
  }
```

Troque:

```ts
  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm(clientId));
    setPrefs(emptyPrefs());
  }
```

por:

```ts
  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm(clientId));
    setPrefs(emptyPrefs());
    setTelegramLink(null);
  }
```

- [ ] **Step 4: Função que chama a rota de gerar link**

Troque:

```ts
  async function sendTest(c: Contact) {
    await api.post(`/api/contacts/${c.id}/test`);
    window.alert('Teste enfileirado.');
  }
```

por:

```ts
  async function sendTest(c: Contact) {
    await api.post(`/api/contacts/${c.id}/test`);
    window.alert('Teste enfileirado.');
  }

  async function generateTelegramLink() {
    if (!editingId) return;
    const { url } = await api.post<{ url: string }>(`/api/contacts/${editingId}/telegram-link`);
    setTelegramLink(url);
  }
```

- [ ] **Step 5: Checkbox + campo de chat_id + botão de gerar link**

Troque:

```tsx
        <div className="inline">
          <label>
            <input type="checkbox" checked={form.channel_voice} onChange={(e) => setForm((f) => ({ ...f, channel_voice: e.target.checked }))} />{' '}
            voz
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.channel_whatsapp}
              onChange={(e) => setForm((f) => ({ ...f, channel_whatsapp: e.target.checked }))}
            />{' '}
            whatsapp
          </label>
          <label>
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />{' '}
            <strong>Contato ativo</strong>
          </label>
        </div>
```

por:

```tsx
        <div className="inline">
          <label>
            <input type="checkbox" checked={form.channel_voice} onChange={(e) => setForm((f) => ({ ...f, channel_voice: e.target.checked }))} />{' '}
            voz
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.channel_whatsapp}
              onChange={(e) => setForm((f) => ({ ...f, channel_whatsapp: e.target.checked }))}
            />{' '}
            whatsapp
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.channel_telegram}
              onChange={(e) => setForm((f) => ({ ...f, channel_telegram: e.target.checked }))}
            />{' '}
            telegram
          </label>
          <label>
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />{' '}
            <strong>Contato ativo</strong>
          </label>
        </div>
        <div className="inline">
          <label>
            chat_id do Telegram{' '}
            <input
              placeholder="colar manualmente, ou gerar link abaixo"
              value={form.telegram_chat_id}
              onChange={(e) => setForm((f) => ({ ...f, telegram_chat_id: e.target.value }))}
            />
          </label>
          {editingId && (
            <button type="button" className="secondary" onClick={generateTelegramLink}>
              Gerar link de convite
            </button>
          )}
          {telegramLink && (
            <small>
              Envie ao contato: <a href={telegramLink} target="_blank" rel="noreferrer">{telegramLink}</a>
            </small>
          )}
        </div>
```

- [ ] **Step 6: Validar a sintaxe (o painel não tem test runner — ver `package.json` de `web/`)**

Run: `cd web && npx esbuild src/pages/ClientContacts.tsx --bundle=false --outfile=scratch_check.js && rm -f scratch_check.js`
Expected: sem erro de sintaxe (o comando só falha se o JSX/TS estiver malformado; erros de tipo cross-file não aparecem aqui — é o mesmo teto que a sessão anterior já documentou, dado que `web/src/pages/SupervisorsPage.tsx` está corrompido no disco e derruba o `tsc --noEmit` completo do projeto).

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/ClientContacts.tsx
git commit -m "feat(web): campo de telegram no cadastro de contato + gerar link de convite"
```

---

### Task 7: Fechamento — suíte completa, relatório de evidência TDD

**Files:**
- Create: `docs/testing/telegram-canal-alternativo.tdd.md`

**Interfaces:**
- Consumes: nada (task de wrap-up).

- [ ] **Step 1: Rodar a suíte inteira do server**

Run: `cd server && npx vitest run --exclude "**/authz.test.ts"`
Expected: todos os testes PASS, incluindo os ~14 novos (2 em `notifier.test.ts`, 3 em `alertService.test.ts`, 5 em `telegramWebhook.test.ts`, 6 em `contacts.test.ts`).

Run: `cd server && npx tsc --noEmit`
Expected: nenhum erro novo (só o `authz.test.ts` pré-existente, se ainda estiver quebrado por conta alheia a este trabalho).

- [ ] **Step 2: Escrever o relatório de evidência**

Crie `docs/testing/telegram-canal-alternativo.tdd.md` seguindo o formato usado em `docs/testing/evolution-instance-trocavel.tdd.md`: link pra este plano e pra `docs/superpowers/specs/2026-09-16-telegram-canal-alternativo-design.md`, tabela de user journeys → teste → resultado (RED/GREEN reais, com o output dos comandos rodados nos Steps de cada task acima), e a seção de gaps conhecidos (webhook não testado contra a Bot API real — só contra o contrato documentado da Telegram; UI sem teste automatizado, só `esbuild`; corrupção pré-existente de `SupervisorsPage.tsx` continua bloqueando `npm run build` do painel).

- [ ] **Step 3: Commit**

```bash
git add docs/testing/telegram-canal-alternativo.tdd.md
git commit -m "docs: relatorio de evidencia TDD do Telegram como canal alternativo"
```
