import { pool } from './index.js';

export interface User {
  id: number;
  email: string;
  password_hash: string;
}

export const getUserByEmail = (email: string) =>
  pool.query<User>('SELECT * FROM users WHERE email = $1', [email]).then((r) => r.rows[0]);

export const getUserById = (id: number) =>
  pool.query<User>('SELECT * FROM users WHERE id = $1', [id]).then((r) => r.rows[0]);

export interface AdminSummary {
  id: number;
  email: string;
  phone: string | null;
  telegram_chat_id: string | null;
}

const ADMIN_SUMMARY_COLS = 'id, email, phone, telegram_chat_id';

// Nunca seleciona password_hash de volta pro painel.
export const listUsers = () =>
  pool.query<AdminSummary>(`SELECT ${ADMIN_SUMMARY_COLS} FROM users ORDER BY email`).then((r) => r.rows);

// Só quem tem telefone cadastrado recebe alerta de hardware (sensor travado/sem leitura).
export const listAdminsWithPhone = () =>
  pool
    .query<AdminSummary>(`SELECT ${ADMIN_SUMMARY_COLS} FROM users WHERE phone IS NOT NULL AND phone <> ''`)
    .then((r) => r.rows);

// Somado ao WhatsApp (nunca substitui) — admin com Telegram vinculado recebe os avisos por lá também.
export const listAdminsWithTelegram = () =>
  pool.query<AdminSummary>(`SELECT ${ADMIN_SUMMARY_COLS} FROM users WHERE telegram_chat_id IS NOT NULL`).then((r) => r.rows);

export const countUsers = () => pool.query('SELECT COUNT(*) FROM users').then((r) => Number(r.rows[0].count));

export const createUserRecord = (email: string, passwordHash: string, phone: string | null = null) =>
  pool
    .query<AdminSummary>(
      `INSERT INTO users (email, password_hash, phone) VALUES ($1, $2, $3) RETURNING ${ADMIN_SUMMARY_COLS}`,
      [email, passwordHash, phone],
    )
    .then((r) => r.rows[0]);

export interface UserUpdate {
  email?: string;
  phone?: string | null;
  password_hash?: string;
  telegram_chat_id?: string | null;
}

export const updateUser = (id: number, patch: UserUpdate) => {
  const cols = Object.keys(patch);
  if (cols.length === 0) return listUsers().then((rows) => rows.find((u) => u.id === id));
  const set = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const values = cols.map((c) => patch[c as keyof UserUpdate]);
  return pool
    .query<AdminSummary>(`UPDATE users SET ${set} WHERE id = $1 RETURNING ${ADMIN_SUMMARY_COLS}`, [id, ...values])
    .then((r) => r.rows[0]);
};

export const deleteUser = (id: number) =>
  pool.query('DELETE FROM users WHERE id = $1', [id]).then((r) => r.rowCount! > 0);

// Token de uso único do link de convite do admin (POST /api/admins/:id/telegram-link) — mesmo
// mecanismo de contacts, tabela/coluna diferente.
export const setAdminTelegramLinkToken = (id: number, token: string) =>
  pool.query('UPDATE users SET telegram_link_token = $2 WHERE id = $1', [id, token]).then(() => undefined);

export const getAdminByTelegramToken = (token: string) =>
  pool.query<AdminSummary>(`SELECT ${ADMIN_SUMMARY_COLS} FROM users WHERE telegram_link_token = $1`, [token]).then((r) => r.rows[0]);

export const linkAdminTelegramChat = (id: number, chatId: string) =>
  pool
    .query<AdminSummary>(
      `UPDATE users SET telegram_chat_id = $2, telegram_link_token = NULL WHERE id = $1 RETURNING ${ADMIN_SUMMARY_COLS}`,
      [id, chatId],
    )
    .then((r) => r.rows[0]);

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

export interface Supervisor {
  id: number;
  name: string;
  email: string | null;
  created_at: string;
}

// Nunca inclui password_hash — mesmo motivo do CLIENT_COLS acima.
const SUPERVISOR_COLS = 'id, name, email, created_at';

export const listSupervisors = () =>
  pool.query<Supervisor>(`SELECT ${SUPERVISOR_COLS} FROM supervisors ORDER BY name`).then((r) => r.rows);

export const getSupervisor = (id: number) =>
  pool.query<Supervisor>(`SELECT ${SUPERVISOR_COLS} FROM supervisors WHERE id = $1`, [id]).then((r) => r.rows[0]);

export const createSupervisor = (name: string) =>
  pool
    .query<Supervisor>(`INSERT INTO supervisors (name) VALUES ($1) RETURNING ${SUPERVISOR_COLS}`, [name])
    .then((r) => r.rows[0]);

export const updateSupervisor = (id: number, name: string) =>
  pool
    .query<Supervisor>(`UPDATE supervisors SET name = $2 WHERE id = $1 RETURNING ${SUPERVISOR_COLS}`, [id, name])
    .then((r) => r.rows[0]);

export const deleteSupervisor = (id: number) =>
  pool.query('DELETE FROM supervisors WHERE id = $1', [id]).then((r) => r.rowCount! > 0);

// Uso exclusivo do login do portal (server-side) — só aqui o password_hash sai do banco.
export const getSupervisorByEmail = (email: string) =>
  pool
    .query<Supervisor & { password_hash: string | null }>('SELECT * FROM supervisors WHERE email = $1', [email])
    .then((r) => r.rows[0]);

export const setSupervisorCredentials = (id: number, email: string, passwordHash: string) =>
  pool
    .query<Supervisor>(`UPDATE supervisors SET email = $2, password_hash = $3 WHERE id = $1 RETURNING ${SUPERVISOR_COLS}`, [
      id,
      email,
      passwordHash,
    ])
    .then((r) => r.rows[0]);

export const getSupervisorSensorIds = (supervisorId: number) =>
  pool
    .query<{ sensor_id: number }>('SELECT sensor_id FROM supervisor_sensors WHERE supervisor_id = $1', [supervisorId])
    .then((r) => r.rows.map((row) => row.sensor_id));

// Substitui o conjunto inteiro de sensores atribuídos numa transação — mais simples que diff
// de add/remove, e a UI (checkboxes) sempre manda a lista completa de qualquer forma.
export const setSupervisorSensors = async (supervisorId: number, sensorIds: number[]) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM supervisor_sensors WHERE supervisor_id = $1', [supervisorId]);
    for (const sensorId of sensorIds) {
      await client.query('INSERT INTO supervisor_sensors (supervisor_id, sensor_id) VALUES ($1, $2)', [
        supervisorId,
        sensorId,
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export interface Sensor {
  id: number;
  client_id: number | null;
  name: string;
  mac: string;
  device_token: string;
  temp_min: number | null;
  temp_max: number | null;
  temp_offset: number;
  hum_min: number | null;
  hum_max: number | null;
  interval_seconds: number;
  offline_after_seconds: number;
  target_firmware: string | null;
  force_ota: boolean;
  last_seen_at: string | null;
  last_firmware: string | null;
  last_variant: string | null;
  local: string | null;
  last_reset_reason: string | null;
  test_schedule_dow: string | null;
  test_schedule_time: string | null;
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

// Usado pelo portal do supervisor — conjunto arbitrário de sensores (não um único client_id).
export const listSensorsByIds = (ids: number[]) =>
  pool.query<Sensor>('SELECT * FROM sensors WHERE id = ANY($1) ORDER BY name', [ids]).then((r) => r.rows);

export interface SensorUpdate {
  client_id?: number | null;
  name?: string;
  device_token?: string;
  temp_min?: number | null;
  temp_max?: number | null;
  temp_offset?: number;
  hum_min?: number | null;
  hum_max?: number | null;
  interval_seconds?: number;
  offline_after_seconds?: number;
  target_firmware?: string | null;
  force_ota?: boolean;
  last_seen_at?: string;
  last_firmware?: string;
  last_variant?: string;
  local?: string | null;
  last_reset_reason?: string | null;
  test_schedule_dow?: string | null;
  test_schedule_time?: string | null;
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

// Apaga em cascata os filhos (notifications -> alerts) antes do sensor, numa transação —
// as FKs alerts.sensor_id / notifications.alert_id não têm ON DELETE CASCADE, então sem isso
// o DELETE do sensor viola a constraint. Tudo ou nada: se algo falhar, rollback.
export const deleteSensor = async (id: number): Promise<boolean> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM notifications WHERE alert_id IN (SELECT id FROM alerts WHERE sensor_id = $1)',
      [id],
    );
    await client.query('DELETE FROM alerts WHERE sensor_id = $1', [id]);
    const r = await client.query('DELETE FROM sensors WHERE id = $1', [id]);
    await client.query('COMMIT');
    return r.rowCount! > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

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

const ALERT_TYPES = ['temperature', 'humidity', 'connectivity', 'test', 'daily'] as const;

export const listContacts = (clientId?: number) =>
  clientId === undefined
    ? pool.query<Contact>('SELECT * FROM contacts ORDER BY name').then((r) => r.rows)
    : pool
        .query<Contact>('SELECT * FROM contacts WHERE client_id = $1 ORDER BY name', [clientId])
        .then((r) => r.rows);

export const getContact = (id: number) =>
  pool.query<Contact>('SELECT * FROM contacts WHERE id = $1', [id]).then((r) => r.rows[0]);

// Depois de criar o contato, semeia as 3 prefs (temperature/humidity/connectivity) com os
// defaults da tabela — sem isso o contato não recebe nada até o admin configurar cada tipo.
export const createContact = async (input: ContactInput): Promise<Contact> => {
  const contact = await pool
    .query<Contact>(
      `INSERT INTO contacts (client_id, name, phone, channel_voice, channel_whatsapp, channel_telegram, telegram_chat_id, timezone, active)
       VALUES ($1, $2, $3, COALESCE($4, true), COALESCE($5, true), COALESCE($6, false), $7, COALESCE($8, 'America/Sao_Paulo'), COALESCE($9, true))
       RETURNING *`,
      [
        input.client_id,
        input.name,
        input.phone,
        input.channel_voice,
        input.channel_whatsapp,
        input.channel_telegram,
        input.telegram_chat_id,
        input.timezone,
        input.active,
      ],
    )
    .then((r) => r.rows[0]);

  for (const type of ALERT_TYPES) {
    await pool.query('INSERT INTO contact_alert_prefs (contact_id, alert_type) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      contact.id,
      type,
    ]);
  }
  return contact;
};

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
  contact_id: number;
  alert_type: 'temperature' | 'humidity' | 'connectivity' | 'test' | 'daily';
  enabled: boolean;
  days_of_week: number[];
  window_start: string | null;
  window_end: string | null;
  renotify_minutes: number;
}

export const listContactAlertPrefs = (contactId: number) =>
  pool
    .query<ContactAlertPref>('SELECT * FROM contact_alert_prefs WHERE contact_id = $1 ORDER BY alert_type', [contactId])
    .then((r) => r.rows);

// Todas as prefs de todos os contatos de um cliente numa query só (sem N+1 no alertService).
export const listContactAlertPrefsByClient = (clientId: number) =>
  pool
    .query<ContactAlertPref>(
      `SELECT p.* FROM contact_alert_prefs p JOIN contacts c ON c.id = p.contact_id WHERE c.client_id = $1`,
      [clientId],
    )
    .then((r) => r.rows);

// Replace completo (não patch parcial) — o form sempre manda os 5 campos de uma vez pro tipo.
export const upsertContactAlertPref = (
  contactId: number,
  alertType: ContactAlertPref['alert_type'],
  pref: Pick<ContactAlertPref, 'enabled' | 'days_of_week' | 'window_start' | 'window_end' | 'renotify_minutes'>,
) =>
  pool
    .query<ContactAlertPref>(
      `INSERT INTO contact_alert_prefs (contact_id, alert_type, enabled, days_of_week, window_start, window_end, renotify_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (contact_id, alert_type) DO UPDATE SET
         enabled = $3, days_of_week = $4, window_start = $5, window_end = $6, renotify_minutes = $7
       RETURNING *`,
      [contactId, alertType, pref.enabled, pref.days_of_week, pref.window_start, pref.window_end, pref.renotify_minutes],
    )
    .then((r) => r.rows[0]);

export interface Alert {
  id: number;
  sensor_id: number;
  type: 'temperature' | 'humidity' | 'connectivity' | 'test' | 'reboot' | 'firmware' | 'hardware' | 'daily';
  state: 'firing' | 'resolved';
  value: number | null;
  message: string;
  fired_at: string;
  resolved_at: string | null;
  sensor_name?: string;
}

export const getFiringAlert = (sensorId: number, type: Alert['type']) =>
  pool
    .query<Alert>("SELECT * FROM alerts WHERE sensor_id = $1 AND type = $2 AND state = 'firing'", [sensorId, type])
    .then((r) => r.rows[0]);

// Em lote, pro dashboard: um getFiringAlert por sensor seria N+1 com 50 sensores na tela.
export const listSensorIdsWithFiringAlert = (type: Alert['type']) =>
  pool
    .query<{ sensor_id: number }>("SELECT sensor_id FROM alerts WHERE type = $1 AND state = 'firing'", [type])
    .then((r) => new Set(r.rows.map((row) => row.sensor_id)));

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
  contact_id: number | null;
  admin_id: number | null;
  channel: 'voice' | 'whatsapp' | 'telegram';
  status: string;
  detail: string | null;
  created_at: string;
  contact_name?: string | null;
  admin_email?: string | null;
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

// Alerta de hardware vai pra um admin (users), não pra um contato de cliente — mesma tabela
// notifications, só troca qual FK é preenchida. adminId null = ninguém pra notificar (status
// skipped_no_admin): a linha existe só pra registrar por que nada saiu.
export const createAdminNotification = (
  alertId: number,
  adminId: number | null,
  channel: Notification['channel'],
  status = 'queued',
  detail: string | null = null,
) =>
  pool
    .query<Notification>(
      'INSERT INTO notifications (alert_id, admin_id, channel, status, detail) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [alertId, adminId, channel, status, detail],
    )
    .then((r) => r.rows[0]);

export const getLastNotification = (alertId: number, contactId: number, channel: Notification['channel']) =>
  pool
    .query<Notification>(
      'SELECT * FROM notifications WHERE alert_id = $1 AND contact_id = $2 AND channel = $3 ORDER BY created_at DESC LIMIT 1',
      [alertId, contactId, channel],
    )
    .then((r) => r.rows[0]);

// Última diária efetivamente tentada (não skipped_*) pra este contato+sensor — cada chamada de
// sendDailyReport cria um alerta 'daily' novo, então getLastNotification (por alert_id) não serve
// aqui; o histórico precisa atravessar todos os alertas 'daily' do sensor via join.
export const getLastDailyNotification = (contactId: number, sensorId: number) =>
  pool
    .query<Notification>(
      `SELECT n.* FROM notifications n JOIN alerts a ON a.id = n.alert_id
       WHERE a.type = 'daily' AND a.sensor_id = $1 AND n.contact_id = $2
         AND n.status NOT LIKE 'skipped_%'
       ORDER BY n.created_at DESC LIMIT 1`,
      [sensorId, contactId],
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

// Alertas dos sensores atribuídos a um supervisor — mesmo formato de listAlertsByClient, mas
// escopado por um conjunto arbitrário de sensor_id em vez de client_id.
export const listAlertsBySensorIds = (sensorIds: number[], limit = 50) =>
  pool
    .query<Alert>('SELECT * FROM alerts WHERE sensor_id = ANY($1) ORDER BY fired_at DESC LIMIT $2', [
      sensorIds,
      limit,
    ])
    .then((r) => r.rows);

// Qualquer alerta em curso nos sensores do cliente — a mensagem diária de "está tudo bem" não
// pode sair por cima de um alarme aberto (ver sendDailyReport).
export const listFiringAlertsByClient = (clientId: number) =>
  pool
    .query<Alert>(
      `SELECT a.* FROM alerts a JOIN sensors s ON s.id = a.sensor_id
       WHERE s.client_id = $1 AND a.state = 'firing'`,
      [clientId],
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
export const countAlerts = (state?: Alert['state']): Promise<number> =>
  (
    state
      ? pool.query<{ count: string }>('SELECT COUNT(*) FROM alerts WHERE state = $1', [state])
      : pool.query<{ count: string }>('SELECT COUNT(*) FROM alerts')
  ).then((r) => Number(r.rows[0].count));

export const listAlerts = async (
  state?: Alert['state'],
  limit?: number,
  offset?: number,
): Promise<AlertWithNotifications[]> => {
  const limitClause = limit ? ` LIMIT ${Number(limit)} OFFSET ${Number(offset ?? 0)}` : '';
  const alerts = await (
    state
      ? pool.query<Alert>(
          `SELECT a.*, s.name AS sensor_name FROM alerts a JOIN sensors s ON s.id = a.sensor_id
           WHERE a.state = $1 ORDER BY a.fired_at DESC${limitClause}`,
          [state],
        )
      : pool.query<Alert>(
          `SELECT a.*, s.name AS sensor_name FROM alerts a JOIN sensors s ON s.id = a.sensor_id
           ORDER BY a.fired_at DESC${limitClause}`,
        )
  ).then((r) => r.rows);
  if (alerts.length === 0) return [];

  const notifications = await pool
    .query<Notification>(
      `SELECT n.*, c.name AS contact_name, u.email AS admin_email FROM notifications n
       LEFT JOIN contacts c ON c.id = n.contact_id
       LEFT JOIN users u ON u.id = n.admin_id
       WHERE n.alert_id = ANY($1) ORDER BY n.created_at`,
      [alerts.map((a) => a.id)],
    )
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

export const deleteFirmware = (version: string) =>
  pool.query<Firmware>('DELETE FROM firmware WHERE version = $1 RETURNING *', [version]).then((r) => r.rows[0]);

export interface MessageTemplate {
  key: string;
  whatsapp: string;
  voice: string | null;
}

export const listMessageTemplates = () =>
  pool.query<MessageTemplate>('SELECT * FROM message_templates ORDER BY key').then((r) => r.rows);

export const getMessageTemplate = (key: string) =>
  pool.query<MessageTemplate>('SELECT * FROM message_templates WHERE key = $1', [key]).then((r) => r.rows[0]);

export const updateMessageTemplate = (key: string, whatsapp: string, voice: string | null) =>
  pool
    .query<MessageTemplate>('UPDATE message_templates SET whatsapp = $2, voice = $3 WHERE key = $1 RETURNING *', [
      key,
      whatsapp,
      voice,
    ])
    .then((r) => r.rows[0]);

export const getSetting = (key: string) =>
  pool
    .query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [key])
    .then((r) => r.rows[0]?.value ?? null);

export const setSetting = (key: string, value: string) =>
  pool
    .query('INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, value])
    .then(() => undefined);
