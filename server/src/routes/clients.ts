import type { FastifyInstance } from 'fastify';
import { createClient, deleteClient, getClient, listClients, updateClient } from '../db/queries.js';

export async function clientsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/clients', async () => listClients());

  app.get<{ Params: { id: string } }>('/api/clients/:id', async (req) => {
    const client = await getClient(Number(req.params.id));
    if (!client) throw Object.assign(new Error('cliente não encontrado'), { statusCode: 404 });
    return client;
  });

  app.post<{ Body: { name: string } }>('/api/clients', async (req, reply) => {
    const { name } = req.body ?? {};
    if (!name) throw Object.assign(new Error('name obrigatório'), { statusCode: 400 });
    reply.status(201);
    return createClient(name);
  });

  app.put<{ Params: { id: string }; Body: { name: string } }>('/api/clients/:id', async (req) => {
    const { name } = req.body ?? {};
    if (!name) throw Object.assign(new Error('name obrigatório'), { statusCode: 400 });
    const client = await updateClient(Number(req.params.id), name);
    if (!client) throw Object.assign(new Error('cliente não encontrado'), { statusCode: 404 });
    return client;
  });

  app.delete<{ Params: { id: string } }>('/api/clients/:id', async (req, reply) => {
    const ok = await deleteClient(Number(req.params.id));
    if (!ok) throw Object.assign(new Error('cliente não encontrado'), { statusCode: 404 });
    reply.status(204);
  });
}
