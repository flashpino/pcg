import { pool } from './index.js';

export interface User {
  id: number;
  email: string;
  password_hash: string;
}

export const getUserByEmail = (email: string) =>
  pool.query<User>('SELECT * FROM users WHERE email = $1', [email]).then((r) => r.rows[0]);

export interface AdminSummary {
  id: number;
  email: string;
}

// Nunca seleciona password_hash de volta pro painel.
export const listUsers = () =>
  pool.query<AdminSummary>('SELECT id, email FROM users ORDER BY email').then((r) => r.rows);

export const countUsers = () => pool.query('SELECT COUNT(*) FROM users').then((r) => Number(r.rows[0].count));

export const createUserRecord = (email: string, passwordHash: string) =>
  pool
    .query<AdminSummary>('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email', [
      email,
      passwordHash,
    ])
    .then((r) => r.rows[0]);

export const deleteUser = (id: number) =>
  pool.query('DELETE FROM users WHERE id = $1', [id]).then((r) => r.rowCount! > 0);

export interface Client {
  id: number;
  name: string;
  email: string | null;
  created_at: string;
}

// Nunca inclui password_hash — essas 4 são as que o painel admin usa pra listar/editar clientes.
const CLIENT_COLS = 'id, name, email, created_at';

export const listClients = () =>
  pool.query<Client>(`SELECT ${CLIENT_COLS} FROM clients ORDER BY name`).then((r) => r.rows);

export const getClient = (id: number) =>
  pool.query<Client>(`SELECT ${CLIENT_COLS} FROM clients WHERE id = $1`, [id]).then((r) => r.rows[0]);

export const createClient = (name: string) =>
  pool.query<Client>(`INSERT INTO clients (name) VALUES ($1) RETURNING ${CLIENT_COLS}`, [name]).then((r) => r.rows[0]);

export const updateClient = (id: number, name: string) =>
  pool
    .query<Client>(`UPDATE clients SET name = $2 WHERE id = $1 RETURNING ${CLIENT_COLS}`, [id, name])
    .then((r) => r.rows[0]);

export const deleteClient = (id: number) =>
  pool.query('DELETE FROM clients WHERE id = $1', [id]).then((r) => r.rowCount! > 0);

// Uso exclusivo do login do portal (server-side) — só aqui o password_hash sai do banco.
export const getClientByEmail = (email: string) =>
  pool
    .query<Client & { password_hash: string | null }>('SELECT * FROM clients WHERE email = $1', [email])
    .then((r) => r.rows[0]);

export const setClientCredentials = (id: number, email: string, passwordHash: string) =>
  pool
    .query<Client>(`UPDATE clients SET email = $2, password_hash = $3 WHERE id = $1 RETURNING ${CLIENT_COLS}`, [
      id,
      email,
      passwordHash,
    ])
    .then((r) => r.rows[0]);

export interface Sensor {
  id: number;
  client_id: number | null;
  name: string;
  mac: string;
  device_token: string;
  temp_min: number | null;
  temp_max: number | null;
  hum_min: number | null;
  hum_max: number | null;
  interval_seconds: number;
  offline_after_seconds: number;
  target_firmware: string | null;
  last_seen_at: string | null;
  last_firmware: string | null;
  created_at: string;
}

export const getSensorByMac = (mac: string) =>
  pool.query<Sensor>('SELECT * FROM sensors WHERE mac = $1', [mac]).then((r) => r.rows[0]);

export const getSensorByToken = (token: string) =>
  pool.query<Sensor>('SELECT * FROM sensors WHERE device_token = $1', [token]).then((r) => r.rows[0]);

export const createSensor = (mac: string, name: string, deviceToken: string) =>
  pool
    .query<Sensor>(
      'INSERT INTO sensors (mac, name, device_token) VALUES ($1, $2, $3) RETURNING *',
      [mac, name, deviceToken],
    )
    .then((r) => r.rows[0]);

export const listSensors = (clientId?: number) =>
  clientId === undefined
    ? pool.query<Sensor>('SELECT * FROM sensors ORDER BY name').then((r) => r.rows)
    : pool
        .query<Sensor>('SELECT * FROM sensors WHERE client_id = $1 ORDER BY name', [clientId])
        .then((r) => r.rows);

export const getSensor = (id: number) =>
  pool.query<Sensor>('SELECT * FROM sensors WHERE id = $1', [id]).then((r) => r.rows[0]);

export interface SensorUpdate {
  client_id?: number | null;
  name?: string;
  temp_min?: number | null;
  temp_max?: number | null;
  hum_min?: number | null;
  hum_max?: number | null;
  interval_seconds?: number;
  offline_after_seconds?: number;
  target_firmware?: string | null;
  last_seen_at?: string;
  last_firmware?: string;
}

export const updateSensor = (id: number, patch: SensorUpdate) => {
  const cols = Object.keys(patch);
  if (cols.length === 0) return getSensor(id);
  const set = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const values = cols.map((c) => patch[c as keyof SensorUpdate]);
  return pool
    .query<Sensor>(`UPDATE sensors SET ${set} WHERE id = $1 RETURNING *`, [id, ...values])
    .then((r) => r.rows[0]);
};

export const deleteSensor = (id: number) =>
  pool.query('DELETE FROM sensors WHERE id = $1', [id]).then((r) => r.rowCount! > 0);

export interface Contact {
  id: number;
  client_id: number;
  name: string;
  phone: string;
  alert_temperature: boolean;
  alert_connectivity: boolean;
  channel_voice: boolean;
  channel_whatsapp: boolean;
  renotify_minutes: number;
  days_of_week: number[];
  window_start: string;
  window_end: string;
  timezone: string;
  created_at: string;
}

export interface ContactInput {
  client_id: number;
  name: string;
  phone: string;
  alert_temperature?: boolean;
  alert_connectivity?: boolean;
  channel_voice?: boolean;
  channel_whatsapp?: boolean;
  renotify_minutes?: number;
  days_of_week?: number[];
  window_start?: string;
  window_end?: string;
  timezone?: string;
}

export const listContacts = (clientId?: number) =>
  clientId === undefined
    ? pool.query<Contact>('SELECT * FROM contacts ORDER BY name').then((r) => r.rows)
    : pool
        .query<Contact>('SELECT * FROM contacts WHERE client_id = $1 ORDER BY name', [clientId])
        .then((r) => r.rows);

export const getContact = (id: number) =>
  pool.query<Contact>('SELECT * FROM contacts WHERE id = $1', [id]).then((r) => r.rows[0]);

export const createContact = (input: ContactInput) =>
  pool
    .query<Contact>(
      `INSERT INTO contacts
        (client_id, name, phone, alert_temperature, alert_connectivity, channel_voice, channel_whatsapp,
         renotify_minutes, days_of_week, window_start, window_end, timezone)
       VALUES ($1, $2, $3, COALESCE($4, true), COALESCE($5, true), COALESCE($6, true), COALESCE($7, true),
               COALESCE($8, 60), COALESCE($9, '{1,2,3,4,5}'::integer[]), COALESCE($10, '07:00'), COALESCE($11, '18:00'),
               COALESCE($12, 'America/Sao_Paulo'))
       RETURNING *`,
      [
        input.client_id,
        input.name,
        input.phone,
        input.alert_temperature,
        input.alert_connectivity,
        input.channel_voice,
        input.channel_whatsapp,
        input.renotify_minutes,
        input.days_of_week,
        input.window_start,
        input.window_end,
        input.timezone,
      ],
    )
    .then((r) => r.rows[0]);

export const updateContact = (id: number, patch: Partial<ContactInput>) => {
  const cols = Object.keys(patch);
  if (cols.length === 0) return getContact(id);
  const set = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const values = cols.map((c) => patch[c as keyof ContactInput]);
  return pool
    .query<Contact>(`UPDATE contacts SET ${set} WHERE id = $1 RETURNING *`, [id, ...values])
    .then((r) => r.rows[0]);
};

export const deleteContact = (id: number) =>
  pool.query('DELETE FROM contacts WHERE id = $1', [id]).then((r) => r.rowCount! > 0);

export interface Alert {
  id: number;
  sensor_id: number;
  type: 'temperature' | 'humidity' | 'connectivity' | 'test';
  state: 'firing' | 'resolved';
  value: number | null;
  message: string;
  fired_at: string;
  resolved_at: string | null;
}

export const getFiringAlert = (sensorId: number, type: Alert['type']) =>
  pool
    .query<Alert>("SELECT * FROM alerts WHERE sensor_id = $1 AND type = $2 AND state = 'firing'", [sensorId, type])
    .then((r) => r.rows[0]);

// ON CONFLICT casa com o índice parcial alerts_one_firing — dedup contra corrida concorrente.
// undefined de volta = outra escrita já criou o alerta firing antes desta.
export const createAlert = (sensorId: number, type: Alert['type'], value: number | null, message: string) =>
  pool
    .query<Alert>(
      `INSERT INTO alerts (sensor_id, type, state, value, message)
       VALUES ($1, $2, 'firing', $3, $4)
       ON CONFLICT (sensor_id, type) WHERE state = 'firing' DO NOTHING
       RETURNING *`,
      [sensorId, type, value, message],
    )
    .then((r) => r.rows[0]);

// Alerta sintético já resolvido — usado por welcome/test/teste-semanal (Tasks 8/8b), que
// precisam de um alert_id para pendurar a notification mas não representam um firing real.
export const createResolvedAlert = (sensorId: number, type: Alert['type'], message: string) =>
  pool
    .query<Alert>(
      "INSERT INTO alerts (sensor_id, type, state, message, resolved_at) VALUES ($1, $2, 'resolved', $3, now()) RETURNING *",
      [sensorId, type, message],
    )
    .then((r) => r.rows[0]);

export const resolveAlert = (id: number) =>
  pool
    .query<Alert>("UPDATE alerts SET state = 'resolved', resolved_at = now() WHERE id = $1 RETURNING *", [id])
    .then((r) => r.rows[0]);

export interface Notification {
  id: number;
  alert_id: number;
  contact_id: number;
  channel: 'voice' | 'whatsapp';
  status: string;
  detail: string | null;
  created_at: string;
}

export const createNotification = (
  alertId: number,
  contactId: number,
  channel: Notification['channel'],
  status = 'queued',
  detail: string | null = null,
) =>
  pool
    .query<Notification>(
      'INSERT INTO notifications (alert_id, contact_id, channel, status, detail) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [alertId, contactId, channel, status, detail],
    )
    .then((r) => r.rows[0]);

export const getLastNotification = (alertId: number, contactId: number, channel: Notification['channel']) =>
  pool
    .query<Notification>(
      'SELECT * FROM notifications WHERE alert_id = $1 AND contact_id = $2 AND channel = $3 ORDER BY created_at DESC LIMIT 1',
      [alertId, contactId, channel],
    )
    .then((r) => r.rows[0]);

export interface AlertWithNotifications extends Alert {
  notifications: Notification[];
}

// Alertas de todos os sensores de um cliente — usado pelo portal do cliente final, escopado
// por client_id via join (nunca aceita um sensor_id direto de fora).
export const listAlertsByClient = (clientId: number, limit = 50) =>
  pool
    .query<Alert>(
      `SELECT a.* FROM alerts a JOIN sensors s ON s.id = a.sensor_id
       WHERE s.client_id = $1 ORDER BY a.fired_at DESC LIMIT $2`,
      [clientId, limit],
    )
    .then((r) => r.rows);

export const countAlertsSince = (hours: number) =>
  pool
    .query<{ count: string }>("SELECT COUNT(*) FROM alerts WHERE fired_at >= now() - ($1 || ' hours')::interval", [
      hours,
    ])
    .then((r) => Number(r.rows[0].count));

// Último alerta de conectividade resolvido por sensor — base pra aproximar "online desde" no dashboard.
export const getLastConnectivityResolutions = (sensorIds: number[]) =>
  pool
    .query<{ sensor_id: number; resolved_at: string }>(
      `SELECT DISTINCT ON (sensor_id) sensor_id, resolved_at FROM alerts
       WHERE type = 'connectivity' AND state = 'resolved' AND sensor_id = ANY($1)
       ORDER BY sensor_id, resolved_at DESC`,
      [sensorIds],
    )
    .then((r) => new Map(r.rows.map((row) => [row.sensor_id, row.resolved_at])));

// 2 queries (sem N+1): busca os alertas, depois todas as notifications deles de uma vez.
export const listAlerts = async (state?: Alert['state'], limit?: number): Promise<AlertWithNotifications[]> => {
  const limitClause = limit ? ` LIMIT ${Number(limit)}` : '';
  const alerts = await (
    state
      ? pool.query<Alert>(`SELECT * FROM alerts WHERE state = $1 ORDER BY fired_at DESC${limitClause}`, [state])
      : pool.query<Alert>(`SELECT * FROM alerts ORDER BY fired_at DESC${limitClause}`)
  ).then((r) => r.rows);
  if (alerts.length === 0) return [];

  const notifications = await pool
    .query<Notification>('SELECT * FROM notifications WHERE alert_id = ANY($1) ORDER BY created_at', [
      alerts.map((a) => a.id),
    ])
    .then((r) => r.rows);

  const byAlert = new Map<number, Notification[]>();
  for (const n of notifications) byAlert.set(n.alert_id, [...(byAlert.get(n.alert_id) ?? []), n]);
  return alerts.map((a) => ({ ...a, notifications: byAlert.get(a.id) ?? [] }));
};

export const updateNotificationStatus = (id: number, status: string, detail: string | null = null) =>
  pool
    .query<Notification>('UPDATE notifications SET status = $2, detail = $3 WHERE id = $1 RETURNING *', [
      id,
      status,
      detail,
    ])
    .then((r) => r.rows[0]);

export interface Firmware {
  id: number;
  version: string;
  filename: string;
  sha256: string;
  created_at: string;
}

export const listFirmwares = () =>
  pool.query<Firmware>('SELECT * FROM firmware ORDER BY created_at DESC').then((r) => r.rows);

export const getFirmwareByVersion = (version: string) =>
  pool.query<Firmware>('SELECT * FROM firmware WHERE version = $1', [version]).then((r) => r.rows[0]);

export const createFirmware = (version: string, filename: string, sha256: string) =>
  pool
    .query<Firmware>(
      'INSERT INTO firmware (version, filename, sha256) VALUES ($1, $2, $3) RETURNING *',
      [version, filename, sha256],
    )
    .then((r) => r.rows[0]);
