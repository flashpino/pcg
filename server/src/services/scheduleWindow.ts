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

const FIM_DO_DIA = 24 * 60 - 1; // 23:59

// Mensagem diária: window_start é o HORÁRIO DO PRIMEIRO ENVIO, não o início de uma janela de
// permissão. Por isso horário vazio aqui significa "não envia", o oposto de isWithinWindow (onde
// vazio libera geral).
//
// renotify_minutes é o intervalo de repetição, no mesmo campo que os outros alertas usam pra
// re-alerta: 0 = uma vez por dia (no minuto exato); > 0 = repete de N em N minutos a partir do
// horário inicial, até window_end (vazio = até o fim do dia).
export function isDailySendTime(
  pref: { days_of_week: number[]; window_start: string | null; window_end?: string | null; renotify_minutes?: number },
  timezone: string,
  now: Date,
): boolean {
  if (pref.window_start === null) return false;
  const { day, minutes } = localParts(timezone, now);
  if (!pref.days_of_week.includes(day)) return false;

  const start = toMinutes(pref.window_start);
  const intervalo = pref.renotify_minutes ?? 0;
  if (intervalo <= 0) return minutes === start;

  // Janela que cruza a meia-noite (fim < início) não repete: a aritmética de repetição precisaria
  // atravessar o dia civil, e aí o dia da semana marcado deixaria de bater com o dia do envio.
  const end = pref.window_end == null ? FIM_DO_DIA : toMinutes(pref.window_end);
  if (end < start) return minutes === start;

  if (minutes < start || minutes > end) return false;
  return (minutes - start) % intervalo === 0;
}

// Cinto de segurança contra duplicata: isDailySendTime só olha o minuto exato, então um retry do
// pg-boss ou um segundo worker rodando o mesmo tick mandam a diária de novo dentro do mesmo
// minuto. Dedup por DIA CIVIL no fuso do contato (não por instante) — resiste a isso mesmo que o
// guard de minuto falhe.
function localDateKey(timezone: string, date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function alreadySentToday(lastSentAt: Date | null, timezone: string, now: Date): boolean {
  if (!lastSentAt) return false;
  return localDateKey(timezone, lastSentAt) === localDateKey(timezone, now);
}
