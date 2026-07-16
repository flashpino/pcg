import type { FastifyInstance } from 'fastify';
import {
  createContact,
  createNotification,
  createResolvedAlert,
  deleteContact,
  getContact,
  listContactAlertPrefs,
  listContacts,
  listSensors,
  updateContact,
  upsertContactAlertPref,
  type ContactAlertPref,
  type ContactInput,
} from '../db/queries.js';
import { enqueueVoice, enqueueWhatsapp } from '../services/notifier.js';

// Boas-vindas/teste não são alertas reais, mas notifications.alert_id é NOT NULL — pendura
// num alerta sintético já resolvido no primeiro sensor do cliente (Tasks 8/8b usam o mesmo padrão).
async function syntheticAlertFor(clientId: number, message: string) {
  const sensors = await listSensors(clientId);
  const sensor = sensors[0];
  if (!sensor) throw Object.assign(new Error('cliente sem sensor cadastrado'), { statusCode: 400 });
  return createResolvedAlert(sensor.id, 'test', message);
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

  // 3 prefs por contato (temperature/humidity/connectivity), semeadas por createContact.
  app.get<{ Params: { id: string } }>('/api/contacts/:id/alert-prefs', async (req) =>
    listContactAlertPrefs(Number(req.params.id)),
  );

  const ALERT_TYPES = ['temperature', 'humidity', 'connectivity'];
  app.put<{
    Params: { id: string; type: string };
    Body: Omit<ContactAlertPref, 'contact_id' | 'alert_type'>;
  }>('/api/contacts/:id/alert-prefs/:type', async (req) => {
    const { type } = req.params;
    if (!ALERT_TYPES.includes(type)) {
      throw Object.assign(new Error("type deve ser 'temperature', 'humidity' ou 'connectivity'"), { statusCode: 400 });
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

    const alert = await syntheticAlertFor(contact.client_id, `Boas-vindas para ${contact.name}`);
    // Placeholder %name% (não {{name}}) — {{...}} é sintaxe de template do EasyPanel e
    // quebra a expansão de env vars na UI dele antes mesmo do container subir.
    const template = process.env.WELCOME_TEMPLATE ?? 'Olá %name%! Você foi cadastrado no monitoramento PCG.';
    const text = template.replace('%name%', contact.name);
    const notification = await createNotification(alert.id, contact.id, 'whatsapp', 'queued', 'welcome');
    await enqueueWhatsapp({ notificationId: notification.id, phone: contact.phone, text });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/contacts/:id/test', async (req) => {
    const contact = await getContact(Number(req.params.id));
    if (!contact) throw Object.assign(new Error('contato não encontrado'), { statusCode: 404 });

    const alert = await syntheticAlertFor(contact.client_id, `Teste manual para ${contact.name}`);
    const text = `Teste PCG: canal de notificação de ${contact.name} funcionando.`;
    if (contact.channel_whatsapp) {
      const n = await createNotification(alert.id, contact.id, 'whatsapp', 'queued', 'test');
      await enqueueWhatsapp({ notificationId: n.id, phone: contact.phone, text });
    }
    if (contact.channel_voice) {
      const n = await createNotification(alert.id, contact.id, 'voice', 'queued', 'test');
      await enqueueVoice({ notificationId: n.id, phone: contact.phone, text });
    }
    return { ok: true };
  });
}
