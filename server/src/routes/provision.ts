import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { createSensor, getSensorByMac } from '../db/queries.js';

// TOFU: MAC desconhecido cria sensor não reivindicado (client_id NULL) com token novo.
// MAC já conhecido -> 404, token não é reemitido (evita sequestro por MAC conhecido).
export async function provisionRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { mac: string } }>('/api/provision', async (req) => {
    const { mac } = req.body ?? {};
    if (!mac) throw Object.assign(new Error('mac obrigatório'), { statusCode: 400 });

    const existing = await getSensorByMac(mac);
    if (existing) throw Object.assign(new Error('mac já provisionado'), { statusCode: 404 });

    const token = randomBytes(24).toString('hex');
    const sensor = await createSensor(mac, `novo-${mac}`, token);
    return { token, sensorId: sensor.id };
  });
}
