import { describe, expect, it } from 'vitest';
import { isDailySendTime, isWithinWindow } from './scheduleWindow.js';

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

// A mensagem diária não é uma janela e sim um instante: o tick roda a cada minuto e só o minuto
// exato do horário configurado dispara — window_start é reusado como "horário do envio".
describe('isDailySendTime', () => {
  const diaria = { days_of_week: [1, 2, 3, 4, 5], window_start: '08:00' };

  it('dispara no minuto exato do horário configurado', () => {
    // 2026-01-05 (seg) 08:00 em SP (UTC-3) = 11:00 UTC
    expect(isDailySendTime(diaria, 'America/Sao_Paulo', new Date('2026-01-05T11:00:00Z'))).toBe(true);
  });

  it('não dispara um minuto antes nem um minuto depois (senão manda 2x no mesmo dia)', () => {
    expect(isDailySendTime(diaria, 'America/Sao_Paulo', new Date('2026-01-05T10:59:00Z'))).toBe(false);
    expect(isDailySendTime(diaria, 'America/Sao_Paulo', new Date('2026-01-05T11:01:00Z'))).toBe(false);
  });

  it('segundos dentro do minuto ainda contam como o minuto do envio', () => {
    expect(isDailySendTime(diaria, 'America/Sao_Paulo', new Date('2026-01-05T11:00:59Z'))).toBe(true);
  });

  it('dia fora de days_of_week não dispara mesmo no horário certo', () => {
    // 2026-01-10 é sábado, 08:00 SP = 11:00 UTC
    expect(isDailySendTime(diaria, 'America/Sao_Paulo', new Date('2026-01-10T11:00:00Z'))).toBe(false);
  });

  it('usa o fuso do contato, não o do servidor', () => {
    // 11:00 UTC = 12:00 em Lisboa (inverno) — fora do horário; = 08:00 em SP — dentro.
    expect(isDailySendTime(diaria, 'Europe/Lisbon', new Date('2026-01-05T11:00:00Z'))).toBe(false);
    expect(isDailySendTime(diaria, 'Europe/Lisbon', new Date('2026-01-05T08:00:00Z'))).toBe(true);
  });

  it('aceita HH:MM:SS (Postgres TIME volta com segundos)', () => {
    expect(isDailySendTime({ ...diaria, window_start: '08:00:00' }, 'America/Sao_Paulo', new Date('2026-01-05T11:00:00Z'))).toBe(true);
  });

  it('sem horário configurado nunca dispara (diferente de janela nula, que libera geral)', () => {
    expect(isDailySendTime({ ...diaria, window_start: null }, 'America/Sao_Paulo', new Date('2026-01-05T11:00:00Z'))).toBe(false);
  });
});
