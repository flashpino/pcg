import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideReboot, ingestRoutes, isValidIngestReadings } from './ingest.js';

const mocks = vi.hoisted(() => ({
  flushInflux: vi.fn(async () => {}),
  writeReadings: vi.fn(),
  getSensorByToken: vi.fn(),
  // Parâmetros declarados de propósito: sem eles mock.calls vira tupla vazia e o tsc recusa
  // qualquer leitura de argumento (o teste de presença abaixo precisa inspecionar o patch).
  updateSensor: vi.fn(async (_id: number, _patch: Record<string, unknown>) => {}),
}));

// influx.js instancia o cliente no load do módulo e explode sem INFLUX_URL — mockado só pra
// conseguir importar a rota (mesmo motivo do mock em alertService.test.ts). Nada de rede é
// exercitado: flushInflux é o ponto que o teste de presença precisa fazer falhar de propósito.
vi.mock('../services/influx.js', () => ({
  flushInflux: mocks.flushInflux,
  writeReadings: mocks.writeReadings,
  queryLatestReadings: vi.fn(async () => new Map()),
}));

vi.mock('../db/queries.js', () => ({
  getSensorByToken: mocks.getSensorByToken,
  updateSensor: mocks.updateSensor,
}));

vi.mock('../services/alertService.js', () => ({
  evaluate: vi.fn(async () => {}),
  evaluateHardware: vi.fn(async () => {}),
  notifyAdminsFirmwareUpdate: vi.fn(async () => {}),
  notifyAdminsReboot: vi.fn(async () => {}),
  sendTest: vi.fn(async () => {}),
}));

const boa = { temp: 23.4, hum: 55, rssi: -28, ago_ms: 0 };

const sensorFake = {
  id: 1, client_id: 2, name: 'proatus_TESTE', mac: 'AA:BB', device_token: 'tok',
  temp_min: null, temp_max: null, hum_min: null, hum_max: null,
  interval_seconds: 60, offline_after_seconds: 900, target_firmware: null,
  last_seen_at: null, last_firmware: '1.1.41', local: null, temp_offset: 0,
  last_reset_reason: null, last_variant: null, test_schedule_dow: null,
  test_schedule_time: null, force_ota: false,
};

describe('decideReboot', () => {
  // Regressão de campo (2026-08-26, proatus_F794): 40 "reboots" em 7 dias no painel eram só as
  // trocas de motivo — o device reiniciava muito mais, e cada sequência de watchdogs iguais
  // colapsava num registro só. Sem contar reboot direito não dá pra saber se um fix de firmware
  // melhorou alguma coisa.
  it('mesmo motivo em boot novo conta como reboot novo', () => {
    expect(decideReboot('watchdog_task', 8, 'watchdog_task#7')).toEqual({ key: 'watchdog_task#8', quiet: true });
  });

  it('ingest repetido do mesmo boot não registra nada', () => {
    expect(decideReboot('watchdog_task', 8, 'watchdog_task#8')).toBeNull();
  });

  // Registrar todo reboot não pode virar uma mensagem por reboot: só a mudança de motivo avisa.
  it('motivo diferente sai do modo silencioso', () => {
    expect(decideReboot('brownout', 9, 'watchdog_task#8')).toEqual({ key: 'brownout#9', quiet: false });
  });

  // Firmware < 1.1.39 não manda boot_id — dedupe continua sendo só o motivo, como era antes.
  it('sem boot_id mantém o comportamento antigo', () => {
    expect(decideReboot('panic', undefined, 'panic')).toBeNull();
    expect(decideReboot('panic', undefined, 'brownout')).toEqual({ key: 'panic', quiet: false });
  });
});

// Regressão de campo (2026-09-10): o last_seen_at era gravado DEPOIS do flushInflux(), então uma
// falha do Influx abortava a requisição antes dele. Os devices chegavam e eram atendidos, mas não
// ficava registro — o sweep deu os 3 sensores (em 2 sites diferentes) como offline ao mesmo tempo,
// disparou alerta falso de queda pros clientes, e cada device, vendo o 5xx, reiniciou em lockstep
// de 10 em 10 min. Isso aqui é um teste de ORDEM: se alguém mover a gravação de presença pra
// depois do Influx de novo, este teste quebra.
describe('POST /api/ingest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSensorByToken.mockResolvedValue(sensorFake);
    mocks.updateSensor.mockResolvedValue(undefined);
  });

  it('registra presença mesmo com o Influx fora', async () => {
    mocks.flushInflux.mockRejectedValue(new Error('influx fora do ar'));

    const app = Fastify();
    await app.register(ingestRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      headers: { 'x-device-token': 'tok' },
      payload: { readings: [boa], fw: '1.1.41' },
    });
    await app.close();

    // O 500 continua sendo a resposta certa: é ele que faz o device guardar o lote e reenviar,
    // em vez de dar as leituras por entregues e descartá-las.
    expect(res.statusCode).toBe(500);
    const gravouPresenca = mocks.updateSensor.mock.calls.some(([, patch]) => patch?.last_seen_at);
    expect(gravouPresenca).toBe(true);
  });
});

describe('isValidIngestReadings', () => {
  // Regressão de campo (2026-07-28): com o DHT22 morto o firmware não enfileirava nenhuma leitura,
  // então nunca chamava /api/ingest — last_seen_at congelava e o painel rotulava "offline" um
  // device que estava online com sinal excelente. O heartbeat precisa ser aceito sem leituras.
  it('heartbeat sem leituras é aceito quando o device declara sensor travado', () => {
    expect(isValidIngestReadings([], true)).toBe(true);
  });

  it('lote vazio sem declaração de sensor travado continua rejeitado', () => {
    expect(isValidIngestReadings([], false)).toBe(false);
  });

  it('leituras válidas passam normalmente', () => {
    expect(isValidIngestReadings([boa], false)).toBe(true);
  });

  it('leitura fora de faixa é rejeitada', () => {
    expect(isValidIngestReadings([{ ...boa, temp: 999 }], false)).toBe(false);
  });

  // O teto de 400 é defesa de fronteira (device remoto) — sensor travado não é passe livre.
  it('lote acima de 400 é rejeitado mesmo com sensor travado', () => {
    expect(isValidIngestReadings(new Array(401).fill(boa), true)).toBe(false);
  });

  // Um device que se diz travado mas manda leitura junto: a leitura vale, e ainda tem que ser boa.
  it('sensor travado com leitura inválida junto é rejeitado', () => {
    expect(isValidIngestReadings([{ ...boa, hum: 300 }], true)).toBe(false);
  });
});
