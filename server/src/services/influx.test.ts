import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryLatestReadings } from './influx.js';

// O cliente real nasce no primeiro uso a partir do process.env (ver getApis). Mockando o pacote
// inteiro, o teste não depende de rede nem de INFLUX_URL configurada.
vi.mock('@influxdata/influxdb-client', () => ({
  InfluxDB: class {
    getWriteApi() {
      return { writePoint: vi.fn(), flush: vi.fn() };
    }
    getQueryApi() {
      return { collectRows: () => Promise.reject(new Error('getaddrinfo ENOTFOUND host.invalido')) };
    }
  },
  Point: class {},
}));

describe('queryLatestReadings', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // Regressão de campo (2026-09-11): o host do Influx parou de resolver e GET /api/dashboard
  // passou a responder 500 — o painel ficava em branco, mesmo com sensores, alertas e status de
  // conectividade disponíveis no Postgres o tempo todo. Ausência de leitura já é caso normal nos
  // 9 chamadores (sensor recém-provisionado cai no mesmo lugar), então indisponibilidade do
  // Influx tem que virar degradação, nunca erro de rota.
  it('Influx inacessível devolve mapa vazio em vez de estourar', async () => {
    await expect(queryLatestReadings([1, 2])).resolves.toEqual(new Map());
  });

  it('sem sensores nem chega a consultar', async () => {
    await expect(queryLatestReadings([])).resolves.toEqual(new Map());
  });
});
