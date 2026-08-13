import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { createSensor, getSensorByMac, updateSensor } from '../db/queries.js';

// TOFU: MAC desconhecido cria sensor não reivindicado (client_id NULL) com token novo.
// MAC já conhecido + client_id NULL -> re-provisiona com novo token (cobre delete + reset).
// MAC já conhecido + client_id preenchido -> 404, token não é reemitido (evita sequestro).
export async function provisionRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { mac: string } }>('/api/provision', async (req) => {
    const { mac } = req.body ?? {};
    if (!mac) throw Object.assign(new Error('mac obrigatório'), { statusCode: 400 });

    const existing = await getSensorByMac(mac);

    if (existing) {
      // Sensor atribuído a um cliente — não permite re-provisionar (proteção contra sequestro).
      if (existing.client_id != null) {
        throw Object.assign(new Error('mac já provisionado'), { statusCode: 404 });
      }

      // Sensor órfão (client_id NULL) — re-provisiona com token novo.
      const token = randomBytes(24).toString('hex');
      await updateSensor(existing.id, { device_token: token });
      return { token, sensorId: existing.id };
    }

    const token = randomBytes(24).toString('hex');
    const sensor = await createSensor(mac, `novo-${mac}`, token);
    return { token, sensorId: sensor.id };
  });
}
