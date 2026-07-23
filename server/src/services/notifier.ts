import { PgBoss } from 'pg-boss';
import twilio from 'twilio';
import {
  getSetting,
  listClients,
  listSensors,
  updateNotificationStatus,
} from '../db/queries.js';
import { sendTest } from './alertService.js';

const WHATSAPP_QUEUE = 'notify-whatsapp';
const VOICE_QUEUE = 'notify-voice';
const WEEKLY_TEST_QUEUE = 'weekly-test';
const QUEUE_OPTS = { retryLimit: 5, retryBackoff: true, expireInSeconds: 120 };

// 'HH:MM' + dia da semana (0-6) -> cron 'MM HH * * DOW'. A UI já valida os formatos.
export function buildTestCron(dow: string, time: string): string {
  const [hh, mm] = time.split(':');
  return `${Number(mm)} ${Number(hh)} * * ${Number(dow)}`;
}

export async function scheduleWeeklyTest(dow: string, time: string): Promise<void> {
  // pg-boss faz upsert pelo nome da fila — chamar de novo reprograma o cron em runtime.
  await getBoss().schedule(WEEKLY_TEST_QUEUE, buildTestCron(dow, time), {}, { tz: 'America/Sao_Paulo' });
}

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

// Antes era um resumo online/offline por cliente; agora envia a temperatura atual de cada
// sensor (uma msg por sensor), reusando sendTest — mesmo texto/pipeline do botão manual.
async function runWeeklyTest(): Promise<void> {
  for (const client of await listClients()) {
    for (const sensor of await listSensors(client.id)) {
      await sendTest(sensor);
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

  // Agendamento configurável (app_settings), com fallback pro padrão segunda 09:00.
  const dow = (await getSetting('test_schedule_dow')) ?? '1';
  const time = (await getSetting('test_schedule_time')) ?? '09:00';
  await scheduleWeeklyTest(dow, time);
}

export const getEvolutionConnectionState = () =>
  fetch(`${process.env.EVOLUTION_URL}/instance/connectionState/${process.env.EVOLUTION_INSTANCE}`, {
    headers: { apikey: process.env.EVOLUTION_APIKEY! },
  })
    .then((r) => (r.ok ? r.json() : { state: 'error' }))
    .catch(() => ({ state: 'error' }));
