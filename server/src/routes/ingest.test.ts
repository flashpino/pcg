import { describe, expect, it, vi } from 'vitest';
import { isValidIngestReadings } from './ingest.js';

// influx.js instancia o cliente no load do módulo e explode sem INFLUX_URL — mockado só pra
// conseguir importar a rota (mesmo motivo do mock em alertService.test.ts). Aqui só se testa
// função pura de validação; nada de rede é exercitado.
vi.mock('../services/influx.js', () => ({
  flushInflux: vi.fn(),
  writeReadings: vi.fn(),
  queryLatestReadings: vi.fn(async () => new Map()),
}));

const boa = { temp: 23.4, hum: 55, rssi: -28, ago_ms: 0 };

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
