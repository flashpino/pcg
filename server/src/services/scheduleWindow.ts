interface WindowLike {
  days_of_week: number[];
  window_start: string | null;
  window_end: string | null;
  timezone: string;
}

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
export function isWithinWindow(pref: WindowLike, now: Date): boolean {
  const { day, minutes } = localParts(pref.timezone, now);
  if (!pref.days_of_week.includes(day)) return false;

  // Sem horário configurado = sem restrição (notifica a qualquer hora do dia).
  if (pref.window_start === null || pref.window_end === null) return true;

  const start = toMinutes(pref.window_start);
  const end = toMinutes(pref.window_end);

  // Janela cruzando meia-noite (ex. 22:00–06:00): start > end inverte a comparação.
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

// Mensagem diária: window_start é reusado como HORÁRIO DO ENVIO, não como início de janela — o
// tick roda a cada minuto e só o minuto exato dispara (um envio por dia, sem repetir). Por isso
// horário vazio aqui significa "não envia", o oposto de isWithinWindow (onde vazio libera geral).
export function isDailySendTime(
  pref: { days_of_week: number[]; window_start: string | null },
  timezone: string,
  now: Date,
): boolean {
  if (pref.window_start === null) return false;
  const { day, minutes } = localParts(timezone, now);
  return pref.days_of_week.includes(day) && minutes === toMinutes(pref.window_start);
}
