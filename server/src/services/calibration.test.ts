import { describe, expect, it } from 'vitest';
import { calcOffset } from './calibration.js';

describe('calcOffset', () => {
  it('calibração inicial (offset atual 0)', () => {
    expect(calcOffset(0, 5, 4.2)).toBeCloseTo(0.8);
  });

  it('recalibração em cima de offset já existente', () => {
    expect(calcOffset(0.8, 5, 5.3)).toBeCloseTo(0.5);
  });

  it('leitura já bate com a referência: offset não muda', () => {
    expect(calcOffset(1.2, 10, 10)).toBeCloseTo(1.2);
  });
});
