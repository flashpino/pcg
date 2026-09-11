import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import {
  createSupervisor,
  deleteSupervisor,
  getSupervisor,
  getSupervisorSensorIds,
  listSupervisors,
  setSupervisorCredentials,
  setSupervisorSensors,
  updateSupervisor,
} from '../db/queries.js';

// CRUD de admin pro acesso de supervisor: mesmo formato de clients.ts (nome + credenciais do
// portal), mais a atribuição de quais sensores esse supervisor enxerga (routes/supervisorPortal.ts
// é quem aplica essa restrição na leitura).
export async function supervisorsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/supervisors', async () => listSupervisors());

  app.get<{ Params: { id: string } }>('/api/supervisors/:id', async (req) => {
    const supervisor = await getSupervisor(Number(req.params.id));
    if (!supervisor) throw Object.assign(new Error('supervisor não encontrado'), { statusCode: 404 });
    return supervisor;
  });

  app.post<{ Body: { name: string } }>('/api/supervisors', async (req, reply) => {
    const { name } = req.body ?? {};
    if (!name) throw Object.assign(new Error('name obrigatório'), { statusCode: 400 });
    reply.status(201);
    return createSupervisor(name);
  });

  app.put<{ Params: { id: string }; Body: { name: string } }>('/api/supervisors/:id', async (req) => {
    const { name } = req.body ?? {};
    if (!name) throw Object.assign(new Error('name obrigatório'), { statusCode: 400 });
    const supervisor = await updateSupervisor(Number(req.params.id), name);
    if (!supervisor) throw Object.assign(new Error('supervisor não encontrado'), { statusCode: 404 });
    return supervisor;
  });

  app.delete<{ Params: { id: string } }>('/api/supervisors/:id', async (req, reply) => {
    const ok = await deleteSupervisor(Number(req.params.id));
    if (!ok) throw Object.assign(new Error('supervisor não encontrado'), { statusCode: 404 });
    reply.status(204);
  });

  app.put<{ Params: { id: string }; Body: { email: string; password: string } }>(
    '/api/supervisors/:id/credentials',
    async (req) => {
      const { email, password } = req.body ?? {};
      if (!email || !password || password.length < 8) {
        throw Object.assign(new Error('email e senha (mín. 8 caracteres) obrigatórios'), { statusCode: 400 });
      }
      const hash = await bcrypt.hash(password, 10);
      const supervisor = await setSupervisorCredentials(Number(req.params.id), email.trim().toLowerCase(), hash);
      if (!supervisor) throw Object.assign(new Error('supervisor não encontrado'), { statusCode: 404 });
      return supervisor;
    },
  );

  app.get<{ Params: { id: string } }>('/api/supervisors/:id/sensors', async (req) =>
    getSupervisorSensorIds(Number(req.params.id)),
  );

  app.put<{ Params: { id: string }; Body: { sensorIds: number[] } }>(
    '/api/supervisors/:id/sensors',
    async (req) => {
      const { sensorIds } = req.body ?? {};
      if (!Array.isArray(sensorIds)) throw Object.assign(new Error('sensorIds obrigatório'), { statusCode: 400 });
      await setSupervisorSensors(Number(req.params.id), sensorIds);
      return { ok: true };
    },
  );
}
