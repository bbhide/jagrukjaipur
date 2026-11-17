/** Date helpers. All calendar maths is done on IST calendar dates represented as "YYYY-MM-DD" strings. */
const IST = "Asia/Kolkata";

export function todayIST(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
const toUTC = (d: string) => new Date(`${d}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fmt(new Date(toUTC(d).getTime() + n * 86400000));
export const weekday = (d: string) => toUTC(d).getUTCDay(); // 0 = Sunday

/** Friday–Sunday window of the current/upcoming weekend. On Saturday or Sunday the window is the ongoing weekend. */
export function weekendRange(today: string): { friday: string; saturday: string; sunday: string } {
  const wd = weekday(today);
  const toSaturday = wd === 0 ? -1 : 6 - wd;
  const saturday = addDays(today, toSaturday);
  return { friday: addDays(saturday, -1), saturday, sunday: addDays(saturday, 1) };
}

export interface Recurrence {
  event_date: string;
  end_date: string | null;
  is_recurring: boolean;
  recurrence_type: "weekly" | "monthly" | null;
  recurrence_days: number[];
  recurrence_day_of_month: number | null;
}

/** Does the event take place on `day`? Multi-day events cover every day in their range; recurring ones only their pattern days. */
export function occursOn(e: Recurrence, day: string): boolean {
  const end = e.end_date ?? e.event_date;
  if (day < e.event_date || day > end) return false;
  if (!e.is_recurring) return true;
  if (e.recurrence_type === "weekly") return e.recurrence_days.length === 0 || e.recurrence_days.includes(weekday(day));
  if (e.recurrence_type === "monthly") return Number(day.slice(8)) === (e.recurrence_day_of_month ?? Number(e.event_date.slice(8)));
  return true;
}

/** The date shown on cards: the next occurrence for recurring events, otherwise the start date. */
export function displayDate(e: Recurrence, today: string): string {
  if (!e.is_recurring || today <= e.event_date) return e.event_date;
  const end = e.end_date ?? e.event_date;
  for (let d = today, i = 0; d <= end && i < 62; d = addDays(d, 1), i++) if (occursOn(e, d)) return d;
  return e.event_date;
}
