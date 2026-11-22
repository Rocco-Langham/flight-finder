import { addDays } from "@/lib/dates";

// Times when flights usually cost more, and why: UK school holidays (when most
// of the app's users and everyone else travel), plus big holidays and high
// seasons at the destination. Used to explain pricier results.
//
// School holiday dates vary by council (and Scotland breaks up in late June),
// so the UK ones are typical England & Wales dates.

export interface Peak {
  id: string;
  label: string;
  why: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  /** Destination countries it applies to (ISO alpha-2); none = every trip from the UK. */
  countries?: string[];
  /** A whole season (months long): explains a search, too broad to flag single trips. */
  season?: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const dow = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Easter Sunday (Gregorian, "anonymous" algorithm). */
function easter(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}

/** The last given weekday (0 = Sunday) of a month. */
function lastWeekday(y: number, m: number, weekday: number): string {
  let d = addDays(ymd(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1), -1);
  while (dow(d) !== weekday) d = addDays(d, -1);
  return d;
}

/** The nth given weekday (0 = Sunday) of a month. */
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  let d = ymd(y, m, 1);
  while (dow(d) !== weekday) d = addDays(d, 1);
  return addDays(d, 7 * (n - 1));
}

/** A half-term week around a Monday: the Saturday before to the Sunday after. */
const halfTerm = (monday: string) => ({ from: addDays(monday, -2), to: addDays(monday, 6) });

// Holidays whose dates follow other calendars (looked up, not computed).
const LUNAR_NEW_YEAR: Record<number, string> = {
  2026: "2026-02-17",
  2027: "2027-02-06",
  2028: "2028-01-26",
  2029: "2029-02-13",
};
const DIWALI: Record<number, string> = {
  2026: "2026-11-08",
  2027: "2027-10-29",
  2028: "2028-10-17",
  2029: "2029-11-05",
};

const LUNAR_COUNTRIES = ["CN", "HK", "TW", "SG", "VN", "KR", "MY", "MO"];
const WINTER_SUN_COUNTRIES = [
  // Caribbean & Mexico
  "DO", "JM", "BB", "AG", "LC", "BS", "AW", "CU", "MX", "TC", "KY", "GD", "VC", "KN", "TT", "CW",
  // Indian Ocean & South-East Asia dry season
  "MV", "MU", "SC", "TH", "LK", "VN", "KH",
  // Gulf winter sun
  "AE", "OM", "QA",
  // Canaries, Egypt, Cape Verde
  "CV", "EG",
];

function peaksForYear(y: number): Peak[] {
  const e = easter(y);
  const list: Peak[] = [
    {
      id: `xmas-${y}`,
      label: "Christmas & New Year",
      why: "UK school holidays and the busiest weeks of the year for flights, so fares are at their highest.",
      from: ymd(y, 12, 19),
      to: ymd(y + 1, 1, 4),
    },
    {
      id: `feb-${y}`,
      label: "February half-term",
      why: "Families travel in half-term week, so airlines put prices up.",
      ...halfTerm(nthWeekday(y, 2, 1, 3)),
    },
    {
      id: `easter-${y}`,
      label: "Easter holidays",
      why: "UK school holidays plus the Easter bank holidays: one of the busiest times to fly.",
      from: addDays(e, -9),
      to: addDays(e, 8),
    },
    {
      id: `may-${y}`,
      label: "May half-term",
      why: "Half-term week and the spring bank holiday, when lots of families go away.",
      ...halfTerm(lastWeekday(y, 5, 1)),
    },
    {
      id: `summer-${y}`,
      label: "Summer holidays",
      why: "UK school summer holidays: peak season, with the highest demand of the year.",
      from: ymd(y, 7, 18),
      to: ymd(y, 9, 3),
    },
    {
      id: `oct-${y}`,
      label: "October half-term",
      why: "Half-term week, when families head off for autumn sun.",
      ...halfTerm(lastWeekday(y, 10, 1)),
    },
    // Destination peaks
    {
      id: `sakura-${y}`,
      label: "Cherry blossom season",
      why: "Japan's most popular weeks for visitors, so flights and hotels fill up.",
      from: ymd(y, 3, 24),
      to: ymd(y, 4, 10),
      countries: ["JP"],
    },
    {
      id: `golden-${y}`,
      label: "Golden Week",
      why: "A run of Japanese public holidays when much of Japan travels.",
      from: ymd(y, 4, 29),
      to: ymd(y, 5, 6),
      countries: ["JP"],
    },
    {
      id: `obon-${y}`,
      label: "Obon",
      why: "A Japanese holiday week when people travel home to their families.",
      from: ymd(y, 8, 10),
      to: ymd(y, 8, 18),
      countries: ["JP"],
    },
    {
      id: `thanksgiving-${y}`,
      label: "Thanksgiving",
      why: "The busiest travel week of the year in the USA.",
      from: addDays(nthWeekday(y, 11, 4, 4), -3),
      to: addDays(nthWeekday(y, 11, 4, 4), 4),
      countries: ["US"],
    },
    {
      id: `southern-summer-${y}`,
      label: "Australian & NZ summer holidays",
      why: "School summer holidays down under, the peak season for flights there.",
      from: ymd(y, 12, 15),
      to: ymd(y + 1, 1, 31),
      countries: ["AU", "NZ"],
      season: true,
    },
    {
      id: `winter-sun-${y}`,
      label: "Winter-sun high season",
      why: "Dry, sunny season there while it's winter here, so it's their busiest and priciest time.",
      from: ymd(y, 12, 15),
      to: ymd(y + 1, 3, 15),
      countries: WINTER_SUN_COUNTRIES,
      season: true,
    },
  ];
  if (LUNAR_NEW_YEAR[y]) {
    list.push({
      id: `lunar-${y}`,
      label: "Lunar New Year",
      why: "The biggest holiday in East Asia, when millions travel home.",
      from: addDays(LUNAR_NEW_YEAR[y], -5),
      to: addDays(LUNAR_NEW_YEAR[y], 7),
      countries: LUNAR_COUNTRIES,
    });
  }
  if (DIWALI[y]) {
    list.push({
      id: `diwali-${y}`,
      label: "Diwali",
      why: "India's biggest festival, when flights there are in high demand.",
      from: addDays(DIWALI[y], -5),
      to: addDays(DIWALI[y], 5),
      countries: ["IN"],
    });
  }
  return list;
}

const cache = new Map<number, Peak[]>();
function peaksIn(year: number): Peak[] {
  if (!cache.has(year)) cache.set(year, peaksForYear(year));
  return cache.get(year)!;
}

/** Peak times a trip touches (leaving `out`, back `back`, YYYY-MM-DD...), for its destination. */
export function peaksFor(out: string, back: string, countryCode: string): Peak[] {
  const from = out.slice(0, 10);
  const to = back.slice(0, 10);
  const years = new Set([Number(from.slice(0, 4)) - 1, Number(from.slice(0, 4)), Number(to.slice(0, 4))]);
  const found = new Map<string, Peak>();
  for (const y of years) {
    for (const p of peaksIn(y)) {
      if (p.countries && !p.countries.includes(countryCode)) continue;
      if (from <= p.to && to >= p.from) found.set(p.label, p);
    }
  }
  return [...found.values()];
}

/**
 * A short note when most results fall in peak times, saying which and why;
 * null otherwise.
 */
export function peakSummary(
  trips: { out: string; back: string; countryCode: string }[],
): { labels: string[]; why: string; schoolHolidays: boolean } | null {
  if (trips.length === 0) return null;
  const counts = new Map<string, { peak: Peak; n: number }>();
  let inPeak = 0;
  for (const t of trips) {
    const ps = peaksFor(t.out, t.back, t.countryCode);
    if (ps.length) inPeak++;
    for (const p of ps) {
      const c = counts.get(p.label) ?? { peak: p, n: 0 };
      c.n++;
      counts.set(p.label, c);
    }
  }
  if (inPeak / trips.length < 0.6) return null;
  const top = [...counts.values()].sort((a, b) => b.n - a.n);
  return {
    labels: top.slice(0, 3).map((c) => c.peak.label),
    why: top[0].peak.why,
    schoolHolidays: top.some((c) => !c.peak.countries),
  };
}
