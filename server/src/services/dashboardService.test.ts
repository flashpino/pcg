import { describe, expect, it } from 'vitest';
import type { Sensor } from '../db/queries.js';
import { countSensorStatus, isSensorOnline, readingForDisplay, resolveOnlineSince } from './dashboardService.js';

function sensor(overrides: Partial<Sensor>): Sensor {
  return {
    id: 1,
    client_id: 1,
    name: 's',
    mac: 'aa:bb',
    device_token: 't',
    temp_min: null,
    temp_max: null,
    temp_offset: 0,
    hum_min: null,
    hum_max: null,
    interval_seconds: 60,
    offline_after_seconds: 300,
    target_firmware: null,
    force_ota: false,
    last_seen_at: null,
    last_firmware: null,
    last_variant: null,
    local: null,
    last_reset_reason: null,
    test_schedule_dow: null,
    test_schedule_time: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('isSensorOnline', () => {
  it('nunca reportou = offline', () => {
    expect(isSensorOnline(sensor({ last_seen_at: null }), Date.now())).toBe(false);
  });

  it('reportou dentro da janela = online', () => {
    const now = Date.parse('2026-01-01T00:05:00.000Z');
    const lastSeen = '2026-01-01T00:04:00.000Z'; // 60s atrás, janela de 300s
    expect(isSensorOnline(sensor({ last_seen_at: lastSeen, offline_after_seconds: 300 }), now)).toBe(true);
  });

  it('exatamente no limiar (<=) ainda conta como online — mesma condição do connectivitySweep', () => {
    const now = Date.parse('2026-01-01T00:05:00.000Z');
    const lastSeen = '2026-01-01T00:00:00.000Z'; // exatos 300s atrás
    expect(isSensorOnline(sensor({ last_seen_at: lastSeen, offline_after_seconds: 300 }), now)).toBe(true);
  });

  it('passou o limiar = offline', () => {
    const now = Date.parse('2026-01-01T00:05:00.001Z');
    const lastSeen = '2026-01-01T00:00:00.000Z'; // 300001ms atrás
    expect(isSensorOnline(sensor({ last_seen_at: lastSeen, offline_after_seconds: 300 }), now)).toBe(false);
  });
});

describe('countSensorStatus', () => {
  // Espera lista já filtrada (só client_id não nulo) — quem filtra é o chamador (routes/dashboard.ts).
  it('conta online/offline e agrega clientes ativos + status por sensor', () => {
    const now = Date.now();
    const sensors = [
      sensor({ id: 1, client_id: 5, last_seen_at: new Date(now).toISOString() }),
      sensor({ id: 2, client_id: 7, last_seen_at: null }),
    ];
    const result = countSensorStatus(sensors, now);
    expect(result.online).toBe(1);
    expect(result.offline).toBe(1);
    expect(result.activeClientIds).toEqual(new Set([5]));
    expect(result.onlineById).toEqual(new Map([[1, true], [2, false]]));
  });

  it('conta offline quando last_seen_at é null ou expirado', () => {
    const now = Date.now();
    const sensors = [
      sensor({ id: 1, client_id: 2, last_seen_at: null }),
      sensor({ id: 2, client_id: 3, last_seen_at: new Date(now - 10 * 60_000).toISOString(), offline_after_seconds: 60 }),
    ];
    const result = countSensorStatus(sensors, now);
    expect(result.online).toBe(0);
    expect(result.offline).toBe(2);
    expect(result.activeClientIds.size).toBe(0);
  });
});

describe('resolveOnlineSince', () => {
  it('usa o resolved_at do último alerta de conectividade quando existe', () => {
    const s = sensor({ created_at: '2026-01-01T00:00:00.000Z' });
    expect(resolveOnlineSince(s, '2026-02-01T00:00:00.000Z')).toBe('2026-02-01T00:00:00.000Z');
  });

  it('cai pra created_at quando nunca houve alerta de conectividade resolvido', () => {
    const s = sensor({ created_at: '2026-01-01T00:00:00.000Z' });
    expect(resolveOnlineSince(s, undefined)).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('readingForDisplay', () => {
  const leitura = { temperature: 23.4, humidity: 55, rssi: -28, time: '2026-01-01T12:00:00.000Z' };

  it('online entrega a leitura completa', () => {
    expect(readingForDisplay(leitura, true)).toEqual({
      temperature: 23.4,
      humidity: 55,
      rssi: -28,
      reading_time: '2026-01-01T12:00:00.000Z',
    });
  });

  // Sensor mudo tem sim leitura no Influx — a última antes de calar. Exibi-la faz um dado velho
  // passar por atual: o painel mostraria 23.4°C de horas atrás como se fosse a temperatura de agora.
  it('offline não entrega temperatura, umidade, sinal nem horário — mesmo havendo leitura', () => {
    expect(readingForDisplay(leitura, false)).toEqual({
      temperature: null,
      humidity: null,
      rssi: null,
      reading_time: null,
    });
  });

  it('online sem nenhuma leitura no Influx devolve tudo nulo, sem quebrar', () => {
    expect(readingForDisplay(undefined, true)).toEqual({
      temperature: null,
      humidity: null,
      rssi: null,
      reading_time: null,
    });
  });
});
