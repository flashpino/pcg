import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import {
  getLastConnectivityResolutions,
  getSensor,
  getSupervisorByEmail,
  getSupervisorSensorIds,
  listAlertsBySensorIds,
  listSensorIdsWithFiringAlert,
  listSensorsByIds,
} from '../db/queries.js';
import { buildDeviceView } from '../services/dashboardService.js';
import { queryLatestReadings, queryReadings } from '../services/influx.js';

// Igual a clientPortal.ts (mesma tela, só leitura), mas escopado por um conjunto arbitrário de
// sensor_id — definido pelo admin em /api/supervisors/:id/sensors — em vez de um único client_id.
// Rotas abaixo (exceto /login) só são alcançáveis com role: 'supervisor' no JWT — ver authz.ts.
export async function supervisorPortalRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { email: string; password: string } }>('/api/supervisor/login', async (req, reply) => {
    const { email, password } = req.body ?? {};
    const supervisor = email && (await getSupervisorByEmail(email.trim().toLowerCase()));
    if (!supervisor || !supervisor.password_hash || !(await bcrypt.compare(password ?? '', supervisor.password_hash))) {
      throw Object.assign(new Error('credenciais inválidas'), { statusCode: 401 });
    }
    const token = app.jwt.sign({ sub: supervisor.id, role: 'supervisor', name: supervisor.name });
    reply.setCookie('token', token, { httpOnly: true, path: '/', sameSite: 'lax' });
    return { ok: true };
  });

  app.get('/api/supervisor/me', async (req) => {
    const { name } = req.user as { name: string };
    return { name };
  });

  app.post('/api/supervisor/logout', async (_req, reply) => {
    reply.clearCookie('token', { path: '/' });
    return { ok: true };
  });

  app.get('/api/supervisor/sensors', async (req) => {
    const { sub } = req.user as { sub: number };
    const now = Date.now();
    const sensorIds = await getSupervisorSensorIds(sub);
    const sensors = await listSensorsByIds(sensorIds);
    const [latestReadings, onlineSince, hardwareFaults] = await Promise.all([
      queryLatestReadings(sensorIds),
      getLastConnectivityResolutions(sensorIds),
      listSensorIdsWithFiringAlert('hardware'),
    ]);
    return sensors.map((sensor) =>
      buildDeviceView(sensor, now, {
        reading: latestReadings.get(sensor.id),
        lastResolvedAt: onlineSince.get(sensor.id),
        hardwareFault: hardwareFaults.has(sensor.id),
      }),
    );
  });

  app.get<{ Params: { id: string }; Querystring: { range?: string } }>(
    '/api/supervisor/sensors/:id/readings',
    async (req) => {
      const { sub } = req.user as { sub: number };
      const sensorId = Number(req.params.id);
      const allowedIds = await getSupervisorSensorIds(sub);
      const sensor = allowedIds.includes(sensorId) && (await getSensor(sensorId));
      if (!sensor) throw Object.assign(new Error('sensor não encontrado'), { statusCode: 404 });
      return queryReadings(sensor.id, req.query.range ?? '24h');
    },
  );

  app.get('/api/supervisor/alerts', async (req) => {
    const { sub } = req.user as { sub: number };
    const sensorIds = await getSupervisorSensorIds(sub);
    return listAlertsBySensorIds(sensorIds);
  });
}
