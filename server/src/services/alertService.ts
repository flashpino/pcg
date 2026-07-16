import {
  createAlert,
  createNotification,
  getFiringAlert,
  getLastNotification,
  listContacts,
  resolveAlert,
  type Alert,
  type Contact,
  type Sensor,
} from '../db/queries.js';
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

// Schema só tem alert_temperature/alert_connectivity no contato — umidade é a mesma
// leitura do sensor de clima (DHT22), então herda a preferência "temperature".
function contactPrefOk(contact: Contact, type: AlertType): boolean {
  return type === 'temperature' || type === 'humidity' ? contact.alert_temperature : contact.alert_connectivity;
}

function buildMessage(sensor: Sensor, type: AlertType, value: number, bound: Bound): string {
  const unit = type === 'temperature' ? '°C' : '%';
  const label = type === 'temperature' ? 'Temperatura' : 'Umidade';
  return `${label} de ${sensor.name} fora do limite: ${value}${unit} (min ${bound.min ?? '-'} / max ${bound.max ?? '-'})`;
}

function buildResolveMessage(sensor: Sensor, type: AlertType): string {
  const label = type === 'temperature' ? 'Temperatura' : 'Umidade';
  return `${label} de ${sensor.name} voltou ao normal.`;
}

type Channel = 'whatsapp' | 'voice';
type Kind = 'fire' | 'resolve' | 'renotify';

// Ponto único de enfileiramento: aplica preferência de tipo + janela de horário (auditável via
// notifications.status skipped_pref/skipped_window), e para renotify o cooldown por contato.
async function notifyContacts(
  alert: Alert,
  contacts: Contact[],
  type: AlertType,
  channels: Channel[],
  text: string,
  kind: Kind,
): Promise<void> {
  const now = new Date();
  for (const contact of contacts) {
    const prefOk = contactPrefOk(contact, type);
    for (const channel of channels) {
      const channelEnabled = channel === 'whatsapp' ? contact.channel_whatsapp : contact.channel_voice;
      if (!channelEnabled) continue; // contato desligou o canal — nada a auditar

      if (!prefOk) {
        await createNotification(alert.id, contact.id, channel, 'skipped_pref');
        continue;
      }
      if (!isWithinWindow(contact, now)) {
        await createNotification(alert.id, contact.id, channel, 'skipped_window');
        continue;
      }
      if (kind === 'renotify') {
        const last = await getLastNotification(alert.id, contact.id, 'whatsapp');
        if (!shouldRenotify(last ? new Date(last.created_at) : null, contact.renotify_minutes, now)) continue;
      }

      const notification = await createNotification(alert.id, contact.id, channel, 'queued');
      const job = { notificationId: notification.id, phone: contact.phone, text };
      if (channel === 'whatsapp') await enqueueWhatsapp(job);
      else await enqueueVoice(job);
    }
  }
}

async function evaluateType(sensor: Sensor, contacts: Contact[], type: AlertType, value: number, bound: Bound): Promise<void> {
  const firing = await getFiringAlert(sensor.id, type);
  const transition = decideTransition(value, bound, Boolean(firing));
  if (transition === 'none') return;

  if (transition === 'fire') {
    const message = buildMessage(sensor, type, value, bound);
    const alert = await createAlert(sensor.id, type, value, message);
    // Voz só entra no disparo inicial — nunca em renotify/resolve — garante "1 ligação por alerta".
    if (alert) await notifyContacts(alert, contacts, type, ['whatsapp', 'voice'], message, 'fire');
    return;
  }

  // firing sempre existe aqui — decideTransition só devolve resolve/renotify quando firing é true.
  if (transition === 'resolve') {
    await resolveAlert(firing!.id);
    await notifyContacts(firing!, contacts, type, ['whatsapp'], buildResolveMessage(sensor, type), 'resolve');
    return;
  }

  await notifyContacts(firing!, contacts, type, ['whatsapp'], buildMessage(sensor, type, value, bound), 'renotify');
}

// Sensor não reivindicado (client_id null) não tem contatos — ingest chama isso incondicionalmente.
export async function evaluate(sensor: Sensor, reading: { temp: number; hum: number }): Promise<void> {
  if (sensor.client_id === null) return;
  const contacts = await listContacts(sensor.client_id);
  await evaluateType(sensor, contacts, 'temperature', reading.temp, { min: sensor.temp_min, max: sensor.temp_max });
  await evaluateType(sensor, contacts, 'humidity', reading.hum, { min: sensor.hum_min, max: sensor.hum_max });
}

// Chamado pelo connectivitySweep (Task 9) a cada varredura — `offline` já vem calculado a partir
// de last_seen_at/offline_after_seconds. Sensor não reivindicado nunca chega aqui (sweep filtra).
export async function evaluateConnectivity(sensor: Sensor, offline: boolean): Promise<void> {
  const firing = await getFiringAlert(sensor.id, 'connectivity');
  const transition = decideBinaryTransition(offline, Boolean(firing));
  if (transition === 'none') return;

  const contacts = await listContacts(sensor.client_id!);

  if (transition === 'fire') {
    const message = `Sensor ${sensor.name} sem comunicação há mais de ${sensor.offline_after_seconds}s.`;
    const alert = await createAlert(sensor.id, 'connectivity', null, message);
    if (alert) await notifyContacts(alert, contacts, 'connectivity', ['whatsapp', 'voice'], message, 'fire');
    return;
  }

  if (transition === 'resolve') {
    await resolveAlert(firing!.id);
    await notifyContacts(firing!, contacts, 'connectivity', ['whatsapp'], `Sensor ${sensor.name} voltou a reportar.`, 'resolve');
    return;
  }

  await notifyContacts(firing!, contacts, 'connectivity', ['whatsapp'], `Sensor ${sensor.name} continua sem comunicação.`, 'renotify');
}
