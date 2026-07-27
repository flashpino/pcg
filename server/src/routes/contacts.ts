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

// Boas-vindas/teste não são alertas reais, mas notifications.alert_id é NOT NULL — pendura
// num alerta sintético já resolvido no primeiro sensor do cliente (Tasks 8/8b usam o mesmo padrão).
async function syntheticAlertFor(clientId: number, message: string) {
  const sensors = await listSensors(clientId);
  const sensor = sensors[0];
  if (!sensor) throw Object.assign(new Error('cliente sem sensor cadastrado'), { statusCode: 400 });
  const alert = await createResolvedAlert(sensor.id, 'test', message);
  return { alert, sensor };
}

export async function contactsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { clientId?: string } }>('/api/contacts', async (req) => {
    const clientId = req.query.clientId ? Number(req.query.clientId) : undefined;
    return listContacts(clientId);
  });

  app.get<{ Params: { id: string } }>('/api/contacts/:id', async (req) => {
    const contact = await getContact(Number(req.params.id));
    if (!contact) throw Object.assign(new Error('contato não encontrado'), { statusCode: 404 });
    return contact;
  });

  app.post<{ Body: ContactInput }>('/api/contacts', async (req, reply) => {
    const { client_id, name, phone } = req.body ?? ({} as ContactInput);
    if (!client_id || !name || !phone) {
      throw Object.assign(new Error('client_id, name e phone obrigatórios'), { statusCode: 400 });
    }
    reply.status(201);
    return createContact(req.body);
  });

  app.patch<{ Params: { id: string }; Body: Partial<ContactInput> }>('/api/contacts/:id', async (req) => {
    const contact = await updateContact(Number(req.params.id), req.body ?? {});
    if (!contact) throw Object.assign(new Error('contato não encontrado'), { statusCode: 404 });
    return contact;
  });

  app.delete<{ Params: { id: string } }>('/api/contacts/:id', async (req, reply) => {
    const ok = await deleteContact(Number(req.params.id));
    if (!ok) throw Object.assign(new Error('contato não encontrado'), { statusCode: 404 });
    reply.status(204);
  });

  // 4 prefs por contato (temperature/humidity/connectivity/test), semeadas por createContact.
  app.get<{ Params: { id: string } }>('/api/contacts/:id/alert-prefs', async (req) =>
    listContactAlertPrefs(Number(req.params.id)),
  );

  const ALERT_TYPES = ['temperature', 'humidity', 'connectivity', 'test'];
  app.put<{
    Params: { id: string; type: string };
    Body: Omit<ContactAlertPref, 'contact_id' | 'alert_type'>;
  }>('/api/contacts/:id/alert-prefs/:type', async (req) => {
    const { type } = req.params;
    if (!ALERT_TYPES.includes(type)) {
      throw Object.assign(new Error("type deve ser 'temperature', 'humidity', 'connectivity' ou 'test'"), { statusCode: 400 });
    }
    const { enabled, days_of_week, window_start, window_end, renotify_minutes } = req.body ?? {};
    return upsertContactAlertPref(Number(req.params.id), type as ContactAlertPref['alert_type'], {
      enabled: enabled ?? true,
      days_of_week: days_of_week ?? [0, 1, 2, 3, 4, 5, 6],
      window_start: window_start ?? null,
      window_end: window_end ?? null,
      renotify_minutes: renotify_minutes ?? 60,
    });
  });

  app.post<{ Params: { id: string } }>('/api/contacts/:id/welcome', async (req) => {
    const contact = await getContact(Number(req.params.id));
    if (!contact) throw Object.assign(new Error('contato não encontrado'), { statusCode: 404 });

    const { alert, sensor } = await syntheticAlertFor(contact.client_id, `Boas-vindas para ${contact.name}`);
    // Texto vem de message_templates (painel > Mensagens); env WELCOME_TEMPLATE segue como
    // fallback pra instalações antigas cujo banco ainda não tem a chave 'welcome'.
    // Placeholder %name% (não {{name}}) no env — {{...}} é sintaxe de template do EasyPanel e
    // quebra a expansão de env vars na UI dele antes mesmo do container subir.
    const tpl = await getMessageTemplate('welcome');
    const client = await getClient(contact.client_id);
    const latest = (await queryLatestReadings([sensor.id])).get(sensor.id);
    const text = tpl
      ? renderTemplate(tpl.whatsapp, {
          nome: contact.name,
          telefone: contact.phone,
          cliente: client?.name ?? '',
          sensor: sensor.name,
          local: sensor.local ?? '',
          temperatura: latest?.temperature ?? '',
        })
      : (process.env.WELCOME_TEMPLATE ?? 'Olá %name%! Você foi cadastrado no monitoramento PCG.').replace('%name%', contact.name);
    const notification = await createNotification(alert.id, contact.id, 'whatsapp', 'queued', 'welcome');
    await enqueueWhatsapp({ notificationId: notification.id, phone: contact.phone, text });
    return { ok: true };
  });

  // Respeita a pref dedicada 'test' do contato (liga/desliga, dias, janela de horário) — mesma
  // engrenagem do alerta real (notifyContacts em alertService.ts), não mais um envio incondicional.
  app.post<{ Params: { id: string } }>('/api/contacts/:id/test', async (req) => {
    const contact = await getContact(Number(req.params.id));
    if (!contact) throw Object.assign(new Error('contato não encontrado'), { statusCode: 404 });

    await sendContactTest(contact);
    return { ok: true };
  });
}
