import { PgBoss } from 'pg-boss';
import twilio from 'twilio';
import {
  createNotification,
  createResolvedAlert,
  listClients,
  listContacts,
  listSensors,
  updateNotificationStatus,
} from '../db/queries.js';

const WHATSAPP_QUEUE = 'notify-whatsapp';
const VOICE_QUEUE = 'notify-voice';
const WEEKLY_TEST_QUEUE = 'weekly-test';
const QUEUE_OPTS = { retryLimit: 5, retryBackoff: true, expireInSeconds: 120 };

// Lazy: o construtor do PgBoss lança erro síncrono sem DATABASE_URL — instanciar no module
// load quebraria qualquer arquivo que importe este módulo (ex. alertService.test.ts) fora do server.
let boss: PgBoss | undefined;
function getBoss(): PgBoss {
  if (!boss) boss = new PgBoss(process.env.DATABASE_URL!);
  return boss;
}

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export interface NotifyJob {
  notificationId: number;
  phone: string;
  text: string;
}

export const enqueueWhatsapp = (job: NotifyJob) => getBoss().send(WHATSAPP_QUEUE, job, QUEUE_OPTS);
export const enqueueVoice = (job: NotifyJob) => getBoss().send(VOICE_QUEUE, job, QUEUE_OPTS);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Evolution usa WhatsApp Web por baixo — número sem '+' e sem formatação, texto livre.
async function sendWhatsapp(job: NotifyJob): Promise<void> {
  const res = await fetch(`${process.env.EVOLUTION_URL}/message/sendText/${process.env.EVOLUTION_INSTANCE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.EVOLUTION_APIKEY! },
    body: JSON.stringify({ number: job.phone.replace(/\D/g, ''), text: job.text }),
  });
  if (!res.ok) throw new Error(`evolution respondeu ${res.status}: ${await res.text()}`);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendVoice(job: NotifyJob): Promise<void> {
  await twilioClient.calls.create({
    to: job.phone,
    from: process.env.TWILIO_VOICE_FROM!,
    twiml: `<Response><Say language="pt-BR">${escapeXml(job.text)}</Say></Response>`,
  });
}

// Registra o resultado antes de decidir reagendar: se falhar 5x (retryLimit), o estado final em
// `notifications` já reflete a última tentativa — sem status intermediário "retrying" no schema.
async function runJob(job: NotifyJob, send: (job: NotifyJob) => Promise<void>): Promise<void> {
  try {
    await send(job);
    await updateNotificationStatus(job.notificationId, 'sent');
  } catch (err) {
    await updateNotificationStatus(job.notificationId, 'failed', String(err instanceof Error ? err.message : err));
    throw err; // pg-boss reagenda com retryLimit/retryBackoff
  }
}

// Sem filtro de janela aqui (GOTCHA da Task 8b): segunda 09:00 já é horário comercial — se
// aplicasse a janela do contato, quem tem janela noturna nunca descobriria que o canal quebrou.
// Sem ligação de voz — é um teste de rotina, não uma emergência.
async function runWeeklyTest(): Promise<void> {
  const now = Date.now();
  for (const client of await listClients()) {
    const sensors = await listSensors(client.id);
    const contacts = await listContacts(client.id);
    if (sensors.length === 0 || contacts.length === 0) continue; // sem sensor: sem alert_id pra pendurar a notification

    const lines = sensors.map((s) => {
      const online = s.last_seen_at !== null && now - new Date(s.last_seen_at).getTime() < s.offline_after_seconds * 1000;
      const when = s.last_seen_at
        ? new Date(s.last_seen_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
        : '--:--';
      return online ? `✅ ${s.name}: ok — última leitura ${when}` : `⚠️ ${s.name}: sem leitura recente (última ${when})`;
    });
    const text = `Teste semanal PCG — ${client.name}:\n${lines.join('\n')}`;

    const alert = await createResolvedAlert(sensors[0].id, 'test', `Teste semanal de ${client.name}`);
    for (const contact of contacts) {
      if (!contact.active || !contact.channel_whatsapp) continue;
      const notification = await createNotification(alert.id, contact.id, 'whatsapp', 'queued', 'weekly-test');
      await enqueueWhatsapp({ notificationId: notification.id, phone: contact.phone, text });
    }
  }
}

export async function startNotifier(): Promise<void> {
  const b = getBoss();
  await b.start();
  await b.createQueue(WHATSAPP_QUEUE);
  await b.createQueue(VOICE_QUEUE);
  await b.createQueue(WEEKLY_TEST_QUEUE);

  // SERIALIZADA (localConcurrency 1) + jitter 3-8s: rajada de WhatsApp = bloqueio do número pela Meta.
  // Único caminho de saída de WhatsApp do sistema inteiro — alertas, boas-vindas e testes passam aqui.
  await b.work<NotifyJob>(WHATSAPP_QUEUE, { localConcurrency: 1 }, async ([job]) => {
    try {
      await runJob(job.data, sendWhatsapp);
    } finally {
      await sleep(3000 + Math.random() * 5000);
    }
  });

  // Voz não tem risco de spam Meta — paraleliza.
  await b.work<NotifyJob>(VOICE_QUEUE, { localConcurrency: 3 }, async ([job]) => {
    await runJob(job.data, sendVoice);
  });

  await b.work(WEEKLY_TEST_QUEUE, async () => {
    await runWeeklyTest();
  });

  // Idempotente: chamar em todo boot é o padrão do pg-boss (upsert pelo nome do schedule).
  await b.schedule(WEEKLY_TEST_QUEUE, '0 9 * * 1', {}, { tz: 'America/Sao_Paulo' });
}

export const getEvolutionConnectionState = () =>
  fetch(`${process.env.EVOLUTION_URL}/instance/connectionState/${process.env.EVOLUTION_INSTANCE}`, {
    headers: { apikey: process.env.EVOLUTION_APIKEY! },
  })
    .then((r) => (r.ok ? r.json() : { state: 'error' }))
    .catch(() => ({ state: 'error' }));
