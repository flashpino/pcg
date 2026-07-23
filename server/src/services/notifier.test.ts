import { describe, expect, it } from 'vitest';
import { buildTestCron } from './notifier.js';

describe('buildTestCron', () => {
  it('segunda 09:00 -> "0 9 * * 1"', () => {
    expect(buildTestCron('1', '09:00')).toBe('0 9 * * 1');
  });

  it('domingo 18:30 -> "30 18 * * 0"', () => {
    expect(buildTestCron('0', '18:30')).toBe('30 18 * * 0');
  });

  it('remove zero à esquerda de hora/minuto', () => {
    expect(buildTestCron('5', '07:05')).toBe('5 7 * * 5');
  });
});
