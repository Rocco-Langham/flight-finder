const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-12-05T09:15:00" -> "Sat 5 Dec" */
export function fmtDate(dt: string): string {
  const d = new Date(`${dt.slice(0, 10)}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "2026-12-05T09:15:00" -> "09:15" */
export function fmtTime(dt: string): string {
  return dt.slice(11, 16);
}

export function fmtPrice(value: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

export function fmtHours(h: number): string {
  if (h < 24) return `${Math.floor(h)}h${h % 1 ? ` ${Math.round((h % 1) * 60)}m` : ""}`;
  const days = Math.floor(h / 24);
  const rest = Math.round(h - days * 24);
  return `${days}d ${rest}h`;
}
