import type { Contact } from '../db/queries.js';

type WindowContact = Pick<Contact, 'days_of_week' | 'window_start' | 'window_end' | 'timezone'>;

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localParts(timezone: string, now: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const byType: Record<string, string> = {};
  for (const p of parts) byType[p.type] = p.value;
  return { day: WEEKDAY_INDEX[byType.weekday], minutes: Number(byType.hour) * 60 + Number(byType.minute) };
}

// Aceita 'HH:MM' ou 'HH:MM:SS' (Postgres TIME volta com segundos).
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Pura, zero dependências: usa Intl.DateTimeFormat para converter `now` (sempre UTC/servidor)
// para o horário local do contato antes de comparar contra a janela.
export function isWithinWindow(contact: WindowContact, now: Date): boolean {
  const { day, minutes } = localParts(contact.timezone, now);
  if (!contact.days_of_week.includes(day)) return false;

  const start = toMinutes(contact.window_start);
  const end = toMinutes(contact.window_end);

  // Janela cruzando meia-noite (ex. 22:00–06:00): start > end inverte a comparação.
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
