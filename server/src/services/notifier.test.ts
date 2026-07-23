import { describe, expect, it } from 'vitest';
import { spNow } from './notifier.js';

describe('spNow', () => {
  it('segunda 09:00 em São Paulo (UTC-3, sem horário de verão desde 2019)', () => {
    // 2026-01-05 12:00 UTC = 2026-01-05 09:00 -03:00 (segunda-feira)
    expect(spNow(new Date('2026-01-05T12:00:00Z'))).toEqual({ dow: '1', time: '09:00' });
  });

  it('vira o dia da semana ao cruzar meia-noite em São Paulo', () => {
    // 2026-01-05 02:30 UTC = 2026-01-04 23:30 -03:00 (domingo, dia anterior)
    expect(spNow(new Date('2026-01-05T02:30:00Z'))).toEqual({ dow: '0', time: '23:30' });
  });

  it('meia-noite exata em São Paulo', () => {
    // 2026-01-05 03:00 UTC = 2026-01-05 00:00 -03:00 (segunda-feira)
    expect(spNow(new Date('2026-01-05T03:00:00Z'))).toEqual({ dow: '1', time: '00:00' });
  });
});
