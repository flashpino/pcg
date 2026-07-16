import {
  createAlert,
  createNotification,
  getClient,
  getFiringAlert,
  getLastNotification,
  getMessageTemplate,
  listContactAlertPrefsByClient,
  listContacts,
  resolveAlert,
  type Alert,
  type Contact,
  type ContactAlertPref,
  type Sensor,
} from '../db/queries.js';
import { renderTemplate } from './messageTemplates.js';
import { enqueueVoice, enqueueWhatsapp } from './notifier.js';
import { isWithinWindow } from './scheduleWindow.js';

const HYSTERESIS = 0.5;

export interface Bound {
  min: number | null;
  max: number | null;
}

export type Transition = 'fire' | 'resolve' | 'renotify' | 'none';
type AlertType = 'temperature' | 'humidity' | 'connectivity';

export function isOutOfBounds(value: number, bound: Bound): boolean {
  if (bound.max !== null && value > bound.max) return true;
  if (bound.min !== null && value < bound.min) return true;
  return false;
}

// Histerese: só considera "voltou ao normal" 0.5 dentro do limite — evita flapping no limiar.
export function isBackInBounds(value: number, bound: Bound): boolean {
  if (bound.max !== null && value > bound.max - HYSTERESIS) return false;
  if (bound.min !== null && value < bound.min + HYSTERESIS) return false;
  return true;
}

export function decideTransition(value: number, bound: Bound, firing: boolean): Transition {
  if (firing) {
    // Enquanto não voltar 0.5 para dentro do limite (zona morta da histerese), continua firing.
    return isBackInBounds(value, bound) ? 'resolve' : 'renotify';
  }
  return isOutOfBounds(value, bound) ? 'fire' : 'none';
}

// Conectividade não tem valor/limite — condição já vem como booleano (offline ou não), sem
// zona morta de histerese: ou o sensor voltou a reportar, ou não.
export function decideBinaryTransition(bad: boolean, firing: boolean): Transition {
  if (firing) return bad ? 'renotify' : 'resolve';
  return bad ? 'fire' : 'none';
}

export function shouldRenotify(lastSentAt: Date | null, renotifyMinutes: number, now: Date): boolean {
  if (renotifyMinutes <= 0) return false;
  if (!lastSentAt) return true;
  return now.getTime() - lastSentAt.getTime() >= renotifyMinutes * 60_000;
}

async function clientNameOf(sensor: Pick<Sensor, 'client_id'>): Promise<string> {
  if (sensor.client_id === null) return '';
  const client = await getClient(sensor.client_id);
  return client?.name ?? '';
}

interface RenderedTexts {
  whatsapp: string;
  voice?: string;
}

// Textos vêm de message_templates (painel > Mensagens), não mais hardcoded — {{$var}} são as
// variáveis documentadas na legenda da UI. `voice` só existe de fato no template temperature_fire.
async function renderMessage(key: string, vars: Record<string, string | number | undefined>): Promise<RenderedTexts> {
  const tpl = await getMessageTemplate(key);
  return {
    whatsapp: renderTemplate(tpl.whatsapp, vars),
    voice: tpl.voice ? renderTemplate(tpl.voice, vars) : undefined,
  };
}

type Channel = 'whatsapp' | 'voice';
type Kind = 'fire' | 'resolve' | 'renotify';

// Ponto único de enfileiramento: aplica preferência do tipo + janela de horário (auditável via
// notifications.status skipped_pref/skipped_window), cada uma vinda da pref específica do
// (contato, tipo) — não mais de um campo único compartilhado entre os 3 tipos de alerta.
async function notifyContacts(
  alert: Alert,
  contacts: Contact[],
  prefs: ContactAlertPref[],
  type: AlertType,
  channels: Channel[],
  texts: RenderedTexts,
  kind: Kind,
): Promise<void> {
  const now = new Date();
  for (const contact of contacts) {
    if (!contact.active) continue; // contato desligado por completo — nem entra na auditoria

    const pref = prefs.find((p) => p.contact_id === contact.id && p.alert_type === type);
    for (const channel of channels) {
      const channelEnabled = channel === 'whatsapp' ? contact.channel_whatsapp : contact.channel_voice;
      if (!channelEnabled) continue; // contato desligou o canal — nada a auditar

      if (!pref?.enabled) {
        await createNotification(alert.id, contact.id, channel, 'skipped_pref');
        continue;
      }
      const windowLike = { days_of_week: pref.days_of_week, window_start: pref.window_start, window_end: pref.window_end, timezone: contact.timezone };
      if (!isWithinWindow(windowLike, now)) {
        await createNotification(alert.id, contact.id, channel, 'skipped_window');
        continue;
      }
      if (kind === 'renotify') {
        const last = await getLastNotification(alert.id, contact.id, 'whatsapp');
        if (!shouldRenotify(last ? new Date(last.created_at) : null, pref.renotify_minutes, now)) continue;
      }

      // channels só inclui 'voice' quando texts.voice existe (ver chamadas em evaluateType).
      const text = channel === 'voice' ? texts.voice! : texts.whatsapp;
      const notification = await createNotification(alert.id, contact.id, channel, 'queued');
      const job = { notificationId: notification.id, phone: contact.phone, text };
      if (channel === 'whatsapp') await enqueueWhatsapp(job);
      else await enqueueVoice(job);
    }
  }
}

async function evaluateType(
  sensor: Sensor,
  contacts: Contact[],
  prefs: ContactAlertPref[],
  type: AlertType,
  value: number,
  bound: Bound,
): Promise<void> {
  const firing = await getFiringAlert(sensor.id, type);
  const transition = decideTransition(value, bound, Boolean(firing));
  if (transition === 'none') return;

  const cliente = await clientNameOf(sensor);
  const valueVar = type === 'temperature' ? 'temperatura' : 'umidade';
  const vars = {
    sensor: sensor.name,
    cliente,
    local: sensor.local ?? '',
    [valueVar]: value,
    min: bound.min ?? '-',
    max: bound.max ?? '-',
  };

  if (transition === 'fire') {
    const texts = await renderMessage(`${type}_fire`, vars);
    const alert = await createAlert(sensor.id, type, value, texts.whatsapp);
    // Ligação de voz é exclusiva de alerta de temperatura, e só no disparo inicial (nunca em
    // renotify/resolve) — garante "1 ligação por alerta". Sem texto de voz configurado = sem ligação.
    const channels: Channel[] = type === 'temperature' && texts.voice ? ['whatsapp', 'voice'] : ['whatsapp'];
    if (alert) await notifyContacts(alert, contacts, prefs, type, channels, texts, 'fire');
    return;
  }

  // firing sempre existe aqui — decideTransition só devolve resolve/renotify quando firing é true.
  if (transition === 'resolve') {
    await resolveAlert(firing!.id);
    const texts = await renderMessage(`${type}_resolve`, vars);
    await notifyContacts(firing!, contacts, prefs, type, ['whatsapp'], texts, 'resolve');
    return;
  }

  const texts = await renderMessage(`${type}_fire`, vars);
  await notifyContacts(firing!, contacts, prefs, type, ['whatsapp'], texts, 'renotify');
}

// Sensor não reivindicado (client_id null) não tem contatos — ingest chama isso incondicionalmente.
export async function evaluate(sensor: Sensor, reading: { temp: number; hum: number }): Promise<void> {
  if (sensor.client_id === null) return;
  const contacts = await listContacts(sensor.client_id);
  const prefs = await listContactAlertPrefsByClient(sensor.client_id);
  await evaluateType(sensor, contacts, prefs, 'temperature', reading.temp, { min: sensor.temp_min, max: sensor.temp_max });
  await evaluateType(sensor, contacts, prefs, 'humidity', reading.hum, { min: sensor.hum_min, max: sensor.hum_max });
}

// Chamado pelo connectivitySweep (Task 9) a cada varredura — `offline` já vem calculado a partir
// de last_seen_at/offline_after_seconds. Sensor não reivindicado nunca chega aqui (sweep filtra).
export async function evaluateConnectivity(sensor: Sensor, offline: boolean): Promise<void> {
  const firing = await getFiringAlert(sensor.id, 'connectivity');
  const transition = decideBinaryTransition(offline, Boolean(firing));
  if (transition === 'none') return;

  const contacts = await listContacts(sensor.client_id!);
  const prefs = await listContactAlertPrefsByClient(sensor.client_id!);
  const cliente = await clientNameOf(sensor);
  const vars = { sensor: sensor.name, cliente, local: sensor.local ?? '', segundos: sensor.offline_after_seconds };

  if (transition === 'fire') {
    const texts = await renderMessage('connectivity_fire', vars);
    const alert = await createAlert(sensor.id, 'connectivity', null, texts.whatsapp);
    // Sem ligação de voz aqui — voz é exclusiva de alerta de temperatura.
    if (alert) await notifyContacts(alert, contacts, prefs, 'connectivity', ['whatsapp'], texts, 'fire');
    return;
  }

  if (transition === 'resolve') {
    await resolveAlert(firing!.id);
    const texts = await renderMessage('connectivity_resolve', vars);
    await notifyContacts(firing!, contacts, prefs, 'connectivity', ['whatsapp'], texts, 'resolve');
    return;
  }

  const texts = await renderMessage('connectivity_renotify', vars);
  await notifyContacts(firing!, contacts, prefs, 'connectivity', ['whatsapp'], texts, 'renotify');
}
