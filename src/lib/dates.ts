// Date helpers working on plain "YYYY-MM-DD" / naive local datetime strings.
// Everything is computed in UTC so the server's own time zone never matters.

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Naive local datetime -> epoch ms, treating it as UTC. Only use for differences in the same zone. */
export function naiveMs(dt: string): number {
  return Date.parse(`${dt.length === 16 ? `${dt}:00` : dt}Z`);
}

export function msToNaive(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
