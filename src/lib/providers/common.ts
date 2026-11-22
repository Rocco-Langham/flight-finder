import type { Leg, TimeWindow } from "@/lib/types";

/** Is a naive local "YYYY-MM-DDTHH:MM:SS" departure inside an HH:MM window (inclusive)? */
export function inWindow(depart: string, w: TimeWindow): boolean {
  const t = depart.slice(11, 16);
  return t >= w.from && t <= w.to;
}

/** Keep the cheapest leg per (from, to) airport pair. */
export function cheapestPerPair(legs: Leg[]): Leg[] {
  const best = new Map<string, Leg>();
  for (const l of legs) {
    const key = `${l.from.code}-${l.to.code}`;
    const cur = best.get(key);
    if (!cur || l.price < cur.price || (l.price === cur.price && l.freshness === "live")) {
      best.set(key, l);
    }
  }
  return [...best.values()];
}

/** Google Flights one-way search link: neutral place to book any airline. */
export function googleFlightsUrl(from: string, to: string, date: string): string {
  const q = `One way direct flights from ${from} to ${to} on ${date}`;
  return `https://www.google.com/travel/flights?hl=en-GB&curr=GBP&q=${encodeURIComponent(q)}`;
}

/** Months ("YYYY-MM") touched by an inclusive date range. */
export function monthsBetween(dateFrom: string, dateTo: string): string[] {
  const out: string[] = [];
  let [y, m] = dateFrom.slice(0, 7).split("-").map(Number);
  const end = dateTo.slice(0, 7);
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    out.push(ym);
    if (ym >= end) return out;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
}

const AIRLINES: Record<string, string> = {
  FR: "Ryanair",
  RK: "Ryanair UK",
  U2: "easyJet",
  EC: "easyJet Europe",
  DS: "easyJet Switzerland",
  LS: "Jet2",
  W6: "Wizz Air",
  W9: "Wizz Air UK",
  W4: "Wizz Air",
  VF: "AJet",
  PC: "Pegasus",
  XQ: "SunExpress",
  EI: "Aer Lingus",
  EZY: "easyJet",
  BY: "TUI",
  TOM: "TUI",
  LM: "Loganair",
  BA: "British Airways",
  KL: "KLM",
  VY: "Vueling",
  "4U": "Eurowings",
  EW: "Eurowings",
  DY: "Norwegian",
  D8: "Norwegian",
  BE: "Flybe",
  "5O": "ASL Airlines",
  T3: "Eastern Airways",
  // Long-haul and connecting carriers ("Further away")
  VS: "Virgin Atlantic",
  Z0: "Norse Atlantic UK",
  N0: "Norse Atlantic",
  EK: "Emirates",
  QR: "Qatar Airways",
  EY: "Etihad",
  TK: "Turkish Airlines",
  GF: "Gulf Air",
  WY: "Oman Air",
  SV: "Saudia",
  FZ: "flydubai",
  MS: "EgyptAir",
  AF: "Air France",
  LH: "Lufthansa",
  LX: "Swiss",
  OS: "Austrian",
  IB: "Iberia",
  TP: "TAP Air Portugal",
  AZ: "ITA Airways",
  AY: "Finnair",
  SK: "SAS",
  LO: "LOT",
  DE: "Condor",
  AA: "American Airlines",
  UA: "United",
  DL: "Delta",
  B6: "JetBlue",
  AC: "Air Canada",
  WS: "WestJet",
  TS: "Air Transat",
  AM: "Aeroméxico",
  CM: "Copa Airlines",
  LA: "LATAM",
  AV: "Avianca",
  SQ: "Singapore Airlines",
  TR: "Scoot",
  CX: "Cathay Pacific",
  TG: "Thai Airways",
  MH: "Malaysia Airlines",
  GA: "Garuda Indonesia",
  VN: "Vietnam Airlines",
  PR: "Philippine Airlines",
  JL: "Japan Airlines",
  NH: "ANA",
  KE: "Korean Air",
  OZ: "Asiana",
  BR: "EVA Air",
  CI: "China Airlines",
  CA: "Air China",
  MU: "China Eastern",
  CZ: "China Southern",
  HU: "Hainan Airlines",
  ZH: "Shenzhen Airlines",
  HO: "Juneyao Air",
  "3U": "Sichuan Airlines",
  AI: "Air India",
  "6E": "IndiGo",
  UL: "SriLankan Airlines",
  KC: "Air Astana",
  J2: "Azerbaijan Airlines",
  ET: "Ethiopian Airlines",
  KQ: "Kenya Airways",
  SA: "South African Airways",
  QF: "Qantas",
  NZ: "Air New Zealand",
};

export function airlineName(code: string): string {
  return AIRLINES[code] ?? code;
}
