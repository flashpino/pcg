import type { FastifyInstance } from 'fastify';
import { getSensorByToken, updateSensor } from '../db/queries.js';
import { evaluate } from '../services/alertService.js';
import { flushInflux, writeReadings, type Reading } from '../services/influx.js';

interface IngestBody {
  readings: Array<{ temp: number; hum: number; rssi: number; ago_ms: number }>;
  fw: string;
  device_name?: string;
}

// Fronteira de confiança (device remoto) — validação de faixa não é opcional.
function isValidReading(r: Partial<Reading> | undefined): r is Reading {
  if (!r) return false;
  const { temp, hum, rssi, ago_ms } = r;
  return (
    typeof temp === 'number' && Number.isFinite(temp) && temp >= -60 && temp <= 100 &&
    typeof hum === 'number' && Number.isFinite(hum) && hum >= 0 && hum <= 100 &&
    typeof rssi === 'number' && Number.isFinite(rssi) &&
    typeof ago_ms === 'number' && Number.isFinite(ago_ms) && ago_ms >= 0
  );
}

export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: IngestBody }>('/api/ingest', async (req) => {
    const token = req.headers['x-device-token'];
    if (typeof token !== 'string' || !token) {
      throw Object.assign(new Error('token ausente'), { statusCode: 401 });
    }
    const sensor = await getSensorByToken(token);
    if (!sensor) throw Object.assign(new Error('token inválido'), { statusCode: 401 });

    const readings = req.body?.readings ?? [];
    if (readings.length === 0 || readings.length > 400 || !readings.every(isValidReading)) {
      throw Object.assign(new Error('readings inválidas'), { statusCode: 400 });
    }
    if (typeof req.body.fw !== 'string' || !req.body.fw) {
      throw Object.assign(new Error('fw obrigatório'), { statusCode: 400 });
    }

    writeReadings(sensor.client_id, sensor.id, readings);
    try {
      await flushInflux();
    } catch (err) {
      throw Object.assign(new Error('falha ao escrever no influx'), { statusCode: 500, cause: err });
    }

    await updateSensor(sensor.id, { last_seen_at: new Date().toISOString(), last_firmware: req.body.fw });

    // Reading mais recente = menor ago_ms (o device manda em ordem, mas não assumir sem checar).
    const latest = readings.reduce((a, b) => (a.ago_ms <= b.ago_ms ? a : b));
    await evaluate(sensor, { temp: latest.temp, hum: latest.hum });

    const ota = sensor.target_firmware && sensor.target_firmware !== req.body.fw
      ? { version: sensor.target_firmware, url: `/api/ota/firmware/${sensor.target_firmware}.bin` }
      : undefined;

    return { ok: true, ota };
  });
}
