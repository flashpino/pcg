import type { FastifyInstance } from 'fastify';
import { deleteSensor, getSensor, listSensors, updateSensor, type SensorUpdate } from '../db/queries.js';
import { queryLatestReadings, queryReadings } from '../services/influx.js';

export async function sensorsRoutes(app: FastifyInstance): Promise<void> {
  // Sensores nascem via /api/provision. CRUD aqui só lista, atribui cliente/nome/limites e remove.
  app.get<{ Querystring: { clientId?: string } }>('/api/sensors', async (req) => {
    const clientId = req.query.clientId ? Number(req.query.clientId) : undefined;
    return listSensors(clientId);
  });

  app.get<{ Params: { id: string } }>('/api/sensors/:id', async (req) => {
    const sensor = await getSensor(Number(req.params.id));
    if (!sensor) throw Object.assign(new Error('sensor não encontrado'), { statusCode: 404 });
    return sensor;
  });

  app.patch<{ Params: { id: string }; Body: SensorUpdate }>('/api/sensors/:id', async (req) => {
    const sensor = await updateSensor(Number(req.params.id), req.body ?? {});
    if (!sensor) throw Object.assign(new Error('sensor não encontrado'), { statusCode: 404 });
    return sensor;
  });

  app.delete<{ Params: { id: string } }>('/api/sensors/:id', async (req, reply) => {
    const ok = await deleteSensor(Number(req.params.id));
    if (!ok) throw Object.assign(new Error('sensor não encontrado'), { statusCode: 404 });
    reply.status(204);
  });

  app.get<{ Params: { id: string }; Querystring: { range?: string } }>('/api/sensors/:id/readings', async (req) => {
    const sensor = await getSensor(Number(req.params.id));
    if (!sensor) throw Object.assign(new Error('sensor não encontrado'), { statusCode: 404 });
    return queryReadings(sensor.id, req.query.range ?? '24h');
  });

  app.get<{ Params: { id: string } }>('/api/sensors/:id/latest', async (req) => {
    const sensor = await getSensor(Number(req.params.id));
    if (!sensor) throw Object.assign(new Error('sensor não encontrado'), { statusCode: 404 });
    const latest = (await queryLatestReadings([sensor.id])).get(sensor.id);
    return {
      temperature: latest?.temperature ?? null,
      humidity: latest?.humidity ?? null,
      time: latest?.time ?? null,
    };
  });
}
