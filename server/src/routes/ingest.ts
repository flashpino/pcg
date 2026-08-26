import type { FastifyInstance } from 'fastify';
import { getSensorByToken, updateSensor } from '../db/queries.js';
import {
  evaluate,
  evaluateHardware,
  notifyAdminsFirmwareUpdate,
  notifyAdminsReboot,
  sendTest,
} from '../services/alertService.js';
import { flushInflux, writeReadings, type Reading } from '../services/influx.js';

interface IngestBody {
  readings: Array<{ temp: number; hum: number; rssi: number; ago_ms: number }>;
  fw: string;
  variant?: string;
  device_name?: string;
  reset_reason?: string;
  sensor_stale?: boolean;
  boot_id?: number;   // contador de boots do device (RTC RAM); só o firmware >= 1.1.39 manda
  diag?: string;      // breadcrumb do crash anterior + heap/stack — ver net.h do firmware
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

// Lote vazio só é aceito como heartbeat de sensor travado (o device declara sensor_stale). Sem
// essa exceção o device com DHT morto não tinha o que enviar, não chamava /api/ingest, e o painel
// o rotulava "offline" — indistinguível de queda de rede. O teto de 400 vale nos dois casos.
// reset_reason é constante durante o boot atual, então a chave de dedupe define o que conta como
// "um reboot novo". Só o motivo não bastava: um device travando de hora em hora sempre pelo mesmo
// watchdog aparecia como UM evento e o painel subcontava os reboots feio (o caso do proatus_F794).
// Com boot_id (contador em RTC RAM), cada reinício vira um registro — mas notificar continua preso
// à mudança de motivo, senão registrar todo reboot viraria um WhatsApp por reboot pro admin.
export function decideReboot(
  resetReason: string,
  bootId: number | undefined,
  previous: string | null,
): { key: string; quiet: boolean } | null {
  const key = bootId != null ? `${resetReason}#${bootId}` : resetReason;
  const prev = previous ?? '';
  if (key === prev) return null;
  return { key, quiet: prev.split('#')[0] === resetReason };
}

export function isValidIngestReadings(readings: unknown[], sensorStale: boolean): boolean {
  if (readings.length > 400) return false;
  if (readings.length === 0) return sensorStale;
  return readings.every((r) => isValidReading(r as Partial<Reading>));
}

export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: IngestBody }>('/api/ingest', async (req) => {
    const token = req.headers['x-device-token'];
    if (typeof token !== 'string' || !token) {
      throw Object.assign(new Error('token ausente'), { statusCode: 401 });
    }
    const sensor = await getSensorByToken(token);
    if (!sensor) throw Object.assign(new Error('token inválido'), { statusCode: 401 });

    const reboot = req.body.reset_reason
      ? decideReboot(req.body.reset_reason, req.body.boot_id, sensor.last_reset_reason)
      : null;
    if (reboot) {
      req.log.info(
        { sensor: sensor.name, reset_reason: req.body.reset_reason, diag: req.body.diag },
        'device reset reason',
      );
      await notifyAdminsReboot(sensor, req.body.reset_reason!, req.body.diag, reboot.quiet);
      await updateSensor(sensor.id, { last_reset_reason: reboot.key });
    }

    const readings = req.body?.readings ?? [];
    const sensorStale = req.body?.sensor_stale === true;
    if (!isValidIngestReadings(readings, sensorStale)) {
      throw Object.assign(new Error('readings inválidas'), { statusCode: 400 });
    }
    if (typeof req.body.fw !== 'string' || !req.body.fw) {
      throw Object.assign(new Error('fw obrigatório'), { statusCode: 400 });
    }

    const calibrated = readings.map((r) => ({ ...r, temp: r.temp + sensor.temp_offset }));

    // Heartbeat de sensor travado não tem ponto pra gravar — pular o Influx aqui é o que permite
    // o device seguir marcando presença (last_seen_at) mesmo sem nenhuma leitura.
    if (calibrated.length > 0) {
      writeReadings(sensor.client_id, sensor.id, calibrated);
      try {
        await flushInflux();
      } catch (err) {
        throw Object.assign(new Error('falha ao escrever no influx'), { statusCode: 500, cause: err });
      }
    }

    // Só notifica se já havia uma versão anterior registrada — sem isso o 1º ingest de todo
    // sensor recém-provisionado (last_firmware ainda NULL) dispararia um "atualizou" falso.
    if (sensor.last_firmware !== req.body.fw) {
      req.log.info({ sensor: sensor.name, de: sensor.last_firmware, para: req.body.fw }, 'firmware reportado mudou');
      if (sensor.last_firmware) await notifyAdminsFirmwareUpdate(sensor, sensor.last_firmware, req.body.fw);
    }

    await updateSensor(sensor.id, {
      last_seen_at: new Date().toISOString(),
      last_firmware: req.body.fw,
      ...(req.body.variant ? { last_variant: req.body.variant } : {}),
      // Sincroniza com o nome configurado no menu do device — sem isso ficava preso no
      // "novo-<mac>" do provisionamento pra sempre (device_name chegava mas nunca era lido).
      ...(req.body.device_name && req.body.device_name !== sensor.name ? { name: req.body.device_name } : {}),
    });

    // Alerta de hardware é decidido pelo que o device declara, não por ausência de ingest —
    // resolve sozinho no primeiro lote com leitura de verdade.
    await evaluateHardware(sensor, sensorStale && calibrated.length === 0);

    // Reading mais recente = menor ago_ms (o device manda em ordem, mas não assumir sem checar).
    // Sem leitura (heartbeat) não há limite de temp/umidade a avaliar.
    if (calibrated.length > 0) {
      const latest = calibrated.reduce((a, b) => (a.ago_ms <= b.ago_ms ? a : b));
      await evaluate(sensor, { temp: latest.temp, hum: latest.hum });
    }

    // target_firmware NULL = "não atualizar" (ver schema.sql) — sensor fica parado na
    // versão atual até o admin escolher uma versão explícita no painel.
    if (sensor.force_ota) await updateSensor(sensor.id, { force_ota: false });

    const ota = sensor.target_firmware != null && (sensor.force_ota || sensor.target_firmware !== req.body.fw)
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
