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

const WEEKDAY_TO_DOW: Record<string, string> = { Sun: '0', Mon: '1', Tue: '2', Wed: '3', Thu: '4', Fri: '5', Sat: '6' };

// Dia da semana ('0'-'6') e hora ('HH:MM') atuais em America/Sao_Paulo — mesmo formato salvo
// pelo agendamento (global ou por sensor), pra comparar a cada tick do minuto.
export function spNow(date: Date): { dow: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  let hour = get('hour');
  if (hour === '24') hour = '00'; // Intl com hour12:false pode devolver "24" à meia-noite
  return { dow: WEEKDAY_TO_DOW[get('weekday')] ?? '1', time: `${hour}:${get('minute')}` };
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

const VOICE_NAME = process.env.TWILIO_VOICE_NAME || 'Google.pt-BR-Neural2-B';
// Ajuste fino da locução: no telefone a voz neural sai corrida e atropela nome de sensor e
// número. Um pouco mais devagar, com respiro entre as frases, é o que faz soar natural.
const SPEECH_RATE = '92%';
const SENTENCE_PAUSE = '500ms';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// O SSML é montado AQUI, nunca no template do admin: o texto dele continua escapado por inteiro.
// Se o template pudesse trazer tag, o campo de mensagem do painel viraria injeção de TwiML.
// Só as tags do subset da Twilio (break/prosody/say-as/emphasis/lang/p/s/phoneme/sub/w) valem —
// as extensões do Google (google:style, mark, audio) são rejeitadas.
export function voiceTwiml(text: string, voice = VOICE_NAME): string {
  // Chirp3-HD e Generative são as vozes mais naturais do catálogo, mas não entendem SSML — com
  // elas o ritmo tem que vir da pontuação do próprio texto, senão a locução sai adulterada.
  if (/Chirp3-HD|Generative/i.test(voice)) {
    return `<Response><Say voice="${voice}">${escapeXml(text)}</Say></Response>`;
  }
  // Quebra em frases pelo ponto final seguido de espaço — "1.5" e "Dr." colados não quebram.
  const body = text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim())
    .map(escapeXml)
    .join(`<break time="${SENTENCE_PAUSE}"/>`);
  return `<Response><Say voice="${voice}"><prosody rate="${SPEECH_RATE}">${body}</prosody></Say></Response>`;
}

async function sendVoice(job: NotifyJob): Promise<void> {
  await twilioClient.calls.create({
    to: job.phone,
    from: process.env.TWILIO_VOICE_FROM!,
    // Sem `voice=` a Twilio usa a voz básica (bem robótica). Neural2 soa bem mais natural e o
    // atributo já carrega o idioma. Trocável por env pra testar outras (Wavenet, Polly.Camila-Neural)
    // sem mexer em código — mas evite Chirp3-HD/Generative: elas ignoram o SSML de voiceTwiml.
    twiml: voiceTwiml(job.text),
    // Twilio bate aqui quando a ligação termina, com o resultado final (completou/não atendeu/
    // ocupado/falhou) — server/src/routes/twilio.ts grava isso em notifications.status.
    statusCallback: `${process.env.PUBLIC_URL}/api/twilio/voice-status/${job.notificationId}`,
    statusCallbackEvent: ['completed'],
    statusCallbackMethod: 'POST',
    // ponytail: sem AMD (machineDetection + asyncAmd, US$ 0,0075/chamada) não dá pra separar
    // "pessoa atendeu" de "caiu na caixa postal" — a Twilio reporta 'completed' nos dois casos.
    // Decisão consciente de custo; pra ter essa distinção, ligar o AMD e uma rota pro
    // asyncAmdStatusCallback gravar o AnsweredBy em notifications.detail.
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

// Roda a cada minuto (ver startNotifier); cada sensor tem seu próprio dow/time (ou herda o
// padrão global de app_settings quando NULL) — só dispara sendTest nos sensores cujo horário
// bate com o agora, em vez de um cron único disparando todos de uma vez.
async function runScheduledTests(): Promise<void> {
  const { dow, time } = spNow(new Date());
  const defaultDow = (await getSetting('test_schedule_dow')) ?? '1';
  const defaultTime = (await getSetting('test_schedule_time')) ?? '09:00';

  for (const client of await listClients()) {
    for (const sensor of await listSensors(client.id)) {
      const sensorDow = sensor.test_schedule_dow ?? defaultDow;
      const sensorTime = sensor.test_schedule_time ?? defaultTime;
      if (sensorDow === dow && sensorTime === time) await sendTest(sensor);
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
    await runScheduledTests();
  });

  // Roda todo minuto — cada sensor compara seu próprio agendamento (ou o padrão global) contra
  // o horário atual dentro de runScheduledTests. Idempotente: chamar em todo boot é o padrão
  // do pg-boss (upsert pelo nome da fila).
  await b.schedule(WEEKLY_TEST_QUEUE, '* * * * *', {}, { tz: 'America/Sao_Paulo' });
}

export const getEvolutionConnectionState = () =>
  fetch(`${process.env.EVOLUTION_URL}/instance/connectionState/${process.env.EVOLUTION_INSTANCE}`, {
    headers: { apikey: process.env.EVOLUTION_APIKEY! },
  })
    .then((r) => (r.ok ? r.json() : { state: 'error' }))
    .catch(() => ({ state: 'error' }));
