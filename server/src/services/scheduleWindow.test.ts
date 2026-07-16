import { describe, expect, it } from 'vitest';
import { isWithinWindow } from './scheduleWindow.js';

const base = {
  days_of_week: [1, 2, 3, 4, 5], // seg-sex
  window_start: '07:00',
  window_end: '18:00',
  timezone: 'America/Sao_Paulo',
};

describe('isWithinWindow', () => {
  it('dentro: seg 10:00 (America/Sao_Paulo), janela seg-sex 07-18', () => {
    // 2026-01-05 é segunda-feira; 10:00 em SP (UTC-3) = 13:00 UTC
    expect(isWithinWindow(base, new Date('2026-01-05T13:00:00Z'))).toBe(true);
  });

  it('fora: sáb 10:00, mesma janela', () => {
    // 2026-01-10 é sábado; 10:00 SP = 13:00 UTC
    expect(isWithinWindow(base, new Date('2026-01-10T13:00:00Z'))).toBe(false);
  });

  it('janela cruzando meia-noite: 23:00 dentro de 22:00-06:00', () => {
    const contact = { ...base, window_start: '22:00', window_end: '06:00' };
    // 2026-01-05 (seg) 23:00 SP = 2026-01-06 02:00 UTC
    expect(isWithinWindow(contact, new Date('2026-01-06T02:00:00Z'))).toBe(true);
  });

  it('janela cruzando meia-noite: 12:00 fora de 22:00-06:00', () => {
    const contact = { ...base, window_start: '22:00', window_end: '06:00' };
    expect(isWithinWindow(contact, new Date('2026-01-05T15:00:00Z'))).toBe(false);
  });

  it('timezone diferente do servidor: 10:00 UTC = 07:00 em SP, dentro da janela', () => {
    expect(isWithinWindow(base, new Date('2026-01-05T10:00:00Z'))).toBe(true);
  });

  it('dia não incluído em days_of_week', () => {
    const contact = { ...base, days_of_week: [1, 2, 3, 4] }; // sem sexta
    // 2026-01-09 é sexta-feira, 10:00 SP = 13:00 UTC
    expect(isWithinWindow(contact, new Date('2026-01-09T13:00:00Z'))).toBe(false);
  });

  it('window_start/end null = sem restrição de horário (notifica a qualquer hora)', () => {
    const pref = { ...base, window_start: null, window_end: null };
    expect(isWithinWindow(pref, new Date('2026-01-05T03:00:00Z'))).toBe(true); // madrugada
  });

  it('window nula ainda respeita days_of_week', () => {
    const pref = { ...base, window_start: null, window_end: null, days_of_week: [1, 2, 3, 4] };
    expect(isWithinWindow(pref, new Date('2026-01-09T13:00:00Z'))).toBe(false); // sexta, sem sexta na lista
  });
});
