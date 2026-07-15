import type { FastifyInstance } from 'fastify';
import {
  createContact,
  deleteContact,
  getContact,
  listContacts,
  updateContact,
  type ContactInput,
} from '../db/queries.js';

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
}
