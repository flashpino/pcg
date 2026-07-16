import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { getClientByEmail, getSensor, listAlertsByClient, listSensors } from '../db/queries.js';
import { queryReadings } from '../services/influx.js';

// Todas as rotas aqui abaixo (exceto /login) só são alcançáveis com role: 'client' no JWT —
// ver checagem de role em index.ts. sub do token é sempre o client_id, nunca confiar num
// client_id vindo do body/querystring.
export async function clientPortalRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { email: string; password: string } }>('/api/client/login', async (req, reply) => {
    const { email, password } = req.body ?? {};
    const client = email && (await getClientByEmail(email));
    if (!client || !client.password_hash || !(await bcrypt.compare(password ?? '', client.password_hash))) {
      throw Object.assign(new Error('credenciais inválidas'), { statusCode: 401 });
    }
    const token = app.jwt.sign({ sub: client.id, role: 'client', name: client.name });
    reply.setCookie('token', token, { httpOnly: true, path: '/', sameSite: 'lax' });
    return { ok: true };
  });

  app.get('/api/client/me', async (req) => {
    const { name } = req.user as { name: string };
    return { name };
  });

  app.post('/api/client/logout', async (_req, reply) => {
    reply.clearCookie('token', { path: '/' });
    return { ok: true };
  });

  app.get('/api/client/sensors', async (req) => {
    const { sub } = req.user as { sub: number };
    return listSensors(sub);
  });

  app.get<{ Params: { id: string }; Querystring: { range?: string } }>(
    '/api/client/sensors/:id/readings',
    async (req) => {
      const { sub } = req.user as { sub: number };
      const sensor = await getSensor(Number(req.params.id));
      if (!sensor || sensor.client_id !== sub) throw Object.assign(new Error('sensor não encontrado'), { statusCode: 404 });
      return queryReadings(sensor.id, req.query.range ?? '24h');
    },
  );

  app.get('/api/client/alerts', async (req) => {
    const { sub } = req.user as { sub: number };
    return listAlertsByClient(sub);
  });
}
