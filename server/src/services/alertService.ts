import {
  createAdminNotification,
  createAlert,
  createNotification,
  createResolvedAlert,
  getClient,
  getFiringAlert,
  getLastNotification,
  getMessageTemplate,
  listAdminsWithPhone,
  listContactAlertPrefsByClient,
  listContacts,
  listSensors,
  resolveAlert,
  type Alert,
  type Contact,
  type ContactAlertPref,
  type Sensor,
} from '../db/queries.js';
import { queryLatestReadings } from './influx.js';
import { renderTemplate } from './messageTemplates.js';
import { enqueueVoice, enqueueWhatsapp } from './notifier.js';
import { isWithinWindow } from './scheduleWindow.js';

const HYSTERESIS = 0.5;

export interface Bound {
  min: number | null;
  max: number | null;
}

export type Transition = 'fire' | 'resolve' | 'renotify' | 'none';
type AlertType = 'temperature' | 'humidity' | 'connectivity' | 'test';

export function isOutOfBounds(value: number, bound: Bound): boolean {
  if (bound.max !== null && value > bound.max) return true;
  if (bound.min !== null && value < bound.min) return true;
  return false;
}

// Histerese: só considera "voltou ao normal" 0.5 dentro do limite — evita flapping no limiar.
// Number(...) no min é defesa contra bound vir como string (NUMERIC do Postgres): "15" + 0.5
// concatena texto ("150.5") em vez de somar — já causou um alerta preso em "firing" pra sempre.
export function isBackInBounds(value: number, bound: Bound): boolean {
  if (bound.max !== null && value > bound.max - HYSTERESIS) return false;
  if (bound.min !== null && value < Number(bound.min) + HYSTERESIS) return false;
  return true;
}

// Qual limite (min ou max) foi de fato ultrapassado — pra mensagem poder mostrar "o limite"
// sem o admin precisar saber de antemão se o alerta veio de baixo ou de cima da faixa.
export function violatedBound(value: number, bound: Bound): number | string {
  if (bound.max !== null && value > bound.max) return bound.max;
  if (bound.min !== null && value < bound.min) return bound.min;
  return bound.max ?? bound.min ?? '-';
}

// A renotificação fala do alerta que está em curso, não da leitura do momento: na zona morta da
// histerese o valor atual já voltou pra dentro do limite, e mandar "29.6°C / limite 30°C" contradiz
// o próprio alarme. Nesse caso usa o valor que disparou o alerta (alerts.value); se a leitura atual
// ainda viola o limite, ela é mais informativa (a temperatura pode ter piorado desde o disparo).
export function renotifyValue(current: number, bound: Bound, firedValue: number | null): number {
  if (isOutOfBounds(current, bound)) return current;
  return firedValue ?? current;
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

      // texts.voice garantido pelo guard de skipped_no_voice_text acima.
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
  const shown = transition === 'renotify' ? renotifyValue(value, bound, firing!.value) : value;
  const vars = {
    sensor: sensor.name,
    cliente,
    local: sensor.local ?? '',
    [valueVar]: shown,
    min: bound.min ?? '-',
    max: bound.max ?? '-',
    limite: violatedBound(shown, bound),
  };

  if (transition === 'fire') {
    const texts = await renderMessage(`${type}_fire`, vars);
    const alert = await createAlert(sensor.id, type, value, texts.whatsapp);
    // Ligação de voz é exclusiva de alerta de temperatura, e só no disparo inicial (nunca em
    // renotify/resolve) — garante "1 ligação por alerta". Template sem texto de voz e contato com
    // o canal desligado são decididos (e auditados) dentro de notifyContacts.
    const channels: Channel[] = type === 'temperature' ? ['whatsapp', 'voice'] : ['whatsapp'];
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

// Caminho único de saída dos avisos de admin (hardware/reboot/firmware). Sempre chamado DEPOIS
// do alerta já estar gravado: sem nenhum admin com telefone, o evento continua visível em
// Alertas — antes ele sumia sem rastro e não dava pra distinguir "não disparou" de "não enviou".
async function notifyAdmins(alert: Alert, whatsapp: string): Promise<void> {
  const admins = await listAdminsWithPhone();

  // Nenhum admin com telefone: o aviso não tem pra onde ir, mas o motivo precisa ficar gravado.
  // Antes o laço rodava vazio e o alerta ficava sem UMA linha de notification — no painel isso é
  // idêntico a "a fila do pg-boss travou" ou "o Evolution caiu", e o operador não tem como saber
  // que só falta preencher o telefone em Admins. Mesmo padrão de auditoria de skipped_pref/
  // skipped_window, com as duas FKs nulas (não há destinatário a apontar).
  if (admins.length === 0) {
    await createAdminNotification(alert.id, null, 'whatsapp', 'skipped_no_admin');
    return;
  }

  for (const admin of admins) {
    const notification = await createAdminNotification(alert.id, admin.id, 'whatsapp');
    await enqueueWhatsapp({ notificationId: notification.id, phone: admin.phone!, text: whatsapp });
  }
}

// Alerta de hardware pros admins (cadastro > telefone) — mesmo gatilho da conectividade (o
// firmware não manda nada quando o DHT22 trava, então "sem ingest há offline_after_seconds"
// já é o sinal disponível), só que só no fire/resolve (sem re-notificar, pra não spammar o
// time). Sem janela de horário/preferência — é alerta operacional, sempre entregue.
async function notifyAdminsHardware(alert: Alert, kind: 'fire' | 'resolve', vars: Record<string, string | number>): Promise<void> {
  const texts = await renderMessage(`hardware_${kind}`, vars);
  await notifyAdmins(alert, texts.whatsapp);
}

// Device vivo (heartbeat chegando) mas sem leitura válida — DHT travado/desconectado. É o caso
// que antes se disfarçava de 'connectivity': sem leitura o firmware não ingeria nada, last_seen_at
// congelava e o painel dizia "offline" um device com Wi-Fi perfeito, mandando a equipe caçar rede.
// Só fire/resolve, sem renotify: o heartbeat chega a cada 60s e repetir encheria o WhatsApp do time.
export async function evaluateHardware(sensor: Sensor, stale: boolean): Promise<void> {
  const firing = await getFiringAlert(sensor.id, 'hardware');

  if (stale) {
    healthyStreak.delete(sensor.id);
    if (firing) return;  // já firing: sem renotify (heartbeat é de 60s)
    const vars = await hardwareVars(sensor);
    const texts = await renderMessage('hardware_fire', vars);
    const alert = await createAlert(sensor.id, 'hardware', null, texts.whatsapp);
    if (alert) await notifyAdminsHardware(alert, 'fire', vars);
    return;
  }

  if (!firing) {
    healthyStreak.delete(sensor.id);
    return;
  }

  // Um DHT moribundo entrega uma leitura isolada de vez em quando; resolver na primeira delas
  // fazia o alerta alternar fire/resolve a cada ciclo, com WhatsApp nos dois sentidos. Só uma
  // sequência de ingests saudáveis conta como recuperação de verdade.
  const streak = (healthyStreak.get(sensor.id) ?? 0) + 1;
  if (streak < HEALTHY_STREAK_TO_RESOLVE) {
    healthyStreak.set(sensor.id, streak);
    return;
  }
  healthyStreak.delete(sensor.id);
  await resolveAlert(firing.id);
  await notifyAdminsHardware(firing, 'resolve', await hardwareVars(sensor));
}

const HEALTHY_STREAK_TO_RESOLVE = 3;

// ponytail: em memória — reinício do server zera a contagem, atrasando um resolve em até ~3 min
// (erra pro lado seguro, nunca resolve cedo demais). Só vira coluna no banco se o server passar a
// rodar em mais de uma instância, aí cada uma contaria o seu streak e nenhuma fecharia o alerta.
const healthyStreak = new Map<number, number>();

async function hardwareVars(sensor: Sensor): Promise<Record<string, string | number>> {
  return {
    sensor: sensor.name,
    cliente: await clientNameOf(sensor),
    local: sensor.local ?? '',
    segundos: sensor.offline_after_seconds,
  };
}

// Rótulos pt-BR de esp_reset_reason() (ver resetReasonStr() no firmware) — "poweron" nunca
// dispara aqui (é o boot normal); os demais indicam reinício fora do ciclo esperado.
const RESET_REASON_LABELS: Record<string, string> = {
  sw_restart: 'reinício por software (auto-recuperação)',
  panic: 'pânico/crash de firmware',
  watchdog_interrupt: 'watchdog (interrupção travada)',
  watchdog_task: 'watchdog (tarefa travada)',
  watchdog_other: 'watchdog',
  brownout: 'queda de tensão (brownout)',
  outro: 'motivo desconhecido',
};

// Evento pontual (não tem firing/resolved real) — reusa o truque do 'test'/welcome:
// createResolvedAlert só pra ter um alert_id pra pendurar a notification. Vai só pra admins
// com telefone, sem janela de horário/preferência (mesmo critério de notifyAdminsHardware).
export async function notifyAdminsReboot(sensor: Sensor, resetReason: string): Promise<void> {
  if (resetReason === 'poweron') return;

  const cliente = await clientNameOf(sensor);
  const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const vars = {
    sensor: sensor.name,
    cliente,
    local: sensor.local ?? '',
    motivo: RESET_REASON_LABELS[resetReason] ?? resetReason,
    quando,
  };
  const texts = await renderMessage('reboot_fire', vars);
  const alert = await createResolvedAlert(sensor.id, 'reboot', texts.whatsapp);
  await notifyAdmins(alert, texts.whatsapp);
}

// Dispara quando o `fw` reportado no ingest muda em relação ao last_firmware anterior — é o
// único sinal confiável de que o OTA de fato pegou no device (o server só sabe que despachou).
// ponytail: reflash da MESMA versão (force_ota) e OTA de um .bin sem FW_VERSION incrementado não
// notificam — a string não muda. Se precisar cobrir isso, guardar o OTA despachado no sensor e
// confirmar no ingest seguinte.
export async function notifyAdminsFirmwareUpdate(sensor: Sensor, from: string, to: string): Promise<void> {
  const cliente = await clientNameOf(sensor);
  const vars = { sensor: sensor.name, cliente, local: sensor.local ?? '', de: from, para: to };
  const texts = await renderMessage('firmware_update', vars);
  const alert = await createResolvedAlert(sensor.id, 'firmware', texts.whatsapp);
  await notifyAdmins(alert, texts.whatsapp);
}

// Vars comuns às 3 mensagens de conectividade — extraída à parte pra poder testar sem tocar
// Influx/Postgres. `temperatura` vem da última leitura conhecida (sensor.id), mesmo critério de
// sendTest: sem leitura recente ainda envia '--' (revela sensor mudo) em vez de quebrar a mensagem.
export function connectivityVars(
  sensor: Pick<Sensor, 'name' | 'local' | 'offline_after_seconds'>,
  cliente: string,
  temperatura: number | null,
): Record<string, string | number> {
  return {
    sensor: sensor.name,
    cliente,
    local: sensor.local ?? '',
    segundos: sensor.offline_after_seconds,
    temperatura: temperatura ?? '--',
  };
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
  const latest = (await queryLatestReadings([sensor.id])).get(sensor.id);
  const vars = connectivityVars(sensor, cliente, latest?.temperature ?? null);

  if (transition === 'fire') {
    const texts = await renderMessage('connectivity_fire', vars);
    const alert = await createAlert(sensor.id, 'connectivity', null, texts.whatsapp);
    // Sem ligação de voz aqui — voz é exclusiva de alerta de temperatura.
    if (alert) {
      await notifyContacts(alert, contacts, prefs, 'connectivity', ['whatsapp'], texts, 'fire');
      await notifyAdminsHardware(alert, 'fire', vars);
    }
    return;
  }

  if (transition === 'resolve') {
    await resolveAlert(firing!.id);
    // A comunicação voltou de fato (por isso o registro resolve), mas com o sensor quebrado não
    // houve retomada de monitoramento: anunciar "voltou a reportar" ao cliente é falsa
    // tranquilização. Quem precisa saber já recebeu o alerta de hardware.
    if (await getFiringAlert(sensor.id, 'hardware')) return;
    const texts = await renderMessage('connectivity_resolve', vars);
    await notifyContacts(firing!, contacts, prefs, 'connectivity', ['whatsapp'], texts, 'resolve');
    await notifyAdminsHardware(firing!, 'resolve', vars);
    return;
  }

  const texts = await renderMessage('connectivity_renotify', vars);
  await notifyContacts(firing!, contacts, prefs, 'connectivity', ['whatsapp'], texts, 'renotify');
}

// Avisa por WhatsApp, antes de qualquer teste, que a ligação que vem a seguir não é uma
// emergência real — mesma pref 'test' (enabled/janela/canal) do teste em si, então só chega a
// quem de fato vai receber o teste.
async function warnBeforeTest(alert: Alert, contacts: Contact[], prefs: ContactAlertPref[]): Promise<void> {
  const warningTexts = await renderMessage('test_warning', {});
  await notifyContacts(alert, contacts, prefs, 'test', ['whatsapp'], warningTexts, 'fire');
}

// Teste de dispositivo: mesma mensagem disparada pelo botão do painel, pelo device (ESP32) e
// pelo agendamento automático. Usa a pref dedicada 'test' de cada contato (liga/desliga, dias,
// janela) via notifyContacts — o texto vem do template 'test', não da chave do tipo. Inclui voz
// quando o template 'test' tem texto de voz configurado (mesmo critério de sendContactTest).
export async function sendTest(sensor: Sensor): Promise<void> {
  if (sensor.client_id === null) return; // sensor não reivindicado não tem contatos

  const latest = (await queryLatestReadings([sensor.id])).get(sensor.id);
  const cliente = await clientNameOf(sensor);
  // last_seen_at (Postgres, gravado em todo /api/ingest) em vez de latest.time (Influx) —
  // o pivot de queryLatestReadings junta temperature/humidity/rssi por sensor_id, não por
  // _time, então o _time devolvido é pouco confiável mesmo quando os valores dos campos batem.
  const quando = sensor.last_seen_at
    ? new Date(sensor.last_seen_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : '--:--';
  const vars = {
    sensor: sensor.name,
    cliente,
    local: sensor.local ?? '',
    temperatura: latest?.temperature ?? '--', // sem leitura recente ainda envia (revela sensor mudo)
    quando,
  };

  const texts = await renderMessage('test', vars);
  const alert = await createResolvedAlert(sensor.id, 'test', texts.whatsapp);
  const contacts = await listContacts(sensor.client_id);
  const prefs = await listContactAlertPrefsByClient(sensor.client_id);
  await warnBeforeTest(alert, contacts, prefs);
  await notifyContacts(alert, contacts, prefs, 'test', ['whatsapp', 'voice'], texts, 'fire');
}

// Teste avulso de um único contato (botão "Testar canal" no cadastro) — mesma pref dedicada
// 'test' usada por sendTest(sensor), mas restrita a esse contato. Antes esse botão ignorava
// active/enabled/janela por completo; agora passa pela mesma engrenagem que o alerta real.
export async function sendContactTest(contact: Contact): Promise<void> {
  const sensors = await listSensors(contact.client_id);
  const sensor = sensors[0];
  if (!sensor) throw Object.assign(new Error('cliente sem sensor cadastrado'), { statusCode: 400 });

  const cliente = await clientNameOf(sensor);
  const vars = { sensor: sensor.name, cliente, local: sensor.local ?? '', nome: contact.name };
  const texts = await renderMessage('test', vars);
  const alert = await createResolvedAlert(sensor.id, 'test', texts.whatsapp);
  const prefs = await listContactAlertPrefsByClient(contact.client_id);
  await warnBeforeTest(alert, [contact], prefs);
  await notifyContacts(alert, [contact], prefs, 'test', ['whatsapp', 'voice'], texts, 'fire');
}
