import type { FastifyInstance } from 'fastify';
import { getSensorByToken, updateSensor } from '../db/queries.js';
import { evaluate, notifyAdminsReboot, sendTest } from '../services/alertService.js';
import { flushInflux, writeReadings, type Reading } from '../services/influx.js';

interface IngestBody {
  readings: Array<{ temp: number; hum: number; rssi: number; ago_ms: number }>;
  fw: string;
  variant?: string;
  device_name?: string;
  reset_reason?: string;
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

    // reset_reason vem em todo ingest (constante durante o boot atual) — só notifica quando
    // muda em relação ao último já registrado, senão vira spam a cada ingest (ex. a cada 20s).
    // ponytail: dedupe por string igual; um 2º reboot com o MESMO motivo em sequência não
    // gera novo alerta — se isso importar, trocar por um contador/uptime do device.
    if (req.body.reset_reason && req.body.reset_reason !== sensor.last_reset_reason) {
      req.log.info({ sensor: sensor.name, reset_reason: req.body.reset_reason }, 'device reset reason');
      await notifyAdminsReboot(sensor, req.body.reset_reason);
      await updateSensor(sensor.id, { last_reset_reason: req.body.reset_reason });
    }

    const readings = req.body?.readings ?? [];
    if (readings.length === 0 || readings.length > 400 || !readings.every(isValidReading)) {
      throw Object.assign(new Error('readings inválidas'), { statusCode: 400 });
    }
    if (typeof req.body.fw !== 'string' || !req.body.fw) {
      throw Object.assign(new Error('fw obrigatório'), { statusCode: 400 });
    }

    const calibrated = readings.map((r) => ({ ...r, temp: r.temp + sensor.temp_offset }));

    writeReadings(sensor.client_id, sensor.id, calibrated);
    try {
      await flushInflux();
    } catch (err) {
      throw Object.assign(new Error('falha ao escrever no influx'), { statusCode: 500, cause: err });
    }

    await updateSensor(sensor.id, {
      last_seen_at: new Date().toISOString(),
      last_firmware: req.body.fw,
      ...(req.body.variant ? { last_variant: req.body.variant } : {}),
    });

    // Reading mais recente = menor ago_ms (o device manda em ordem, mas não assumir sem checar).
    const latest = calibrated.reduce((a, b) => (a.ago_ms <= b.ago_ms ? a : b));
    await evaluate(sensor, { temp: latest.temp, hum: latest.hum });

    const ota = sensor.target_firmware && sensor.target_firmware !== req.body.fw
      ? { version: sensor.target_firmware, url: `/api/ota/firmware/${sensor.target_firmware}.bin` }
      : undefined;

    return { ok: true, ota };
  });

  // Disparado pelo botão "Testar dispositivo" na tela do ESP32 — mesma ação do botão do painel.
  app.post('/api/device/test', async (req) => {
    const token = req.headers['x-device-token'];
    if (typeof token !== 'string' || !token) {
      throw Object.assign(new Error('token ausente'), { statusCode: 401 });
    }
    const sensor = await getSensorByToken(token);
    if (!sensor) throw Object.assign(new Error('token inválido'), { statusCode: 401 });
    await sendTest(sensor);
    return { ok: true };
  });
}
