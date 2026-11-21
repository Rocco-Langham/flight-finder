import { airportRef } from "@/lib/airports";
import { cachedJson, type FetchStats } from "@/lib/http";
import type { FareProvider, Leg, OneWayQuery, OneWayResult, TimeWindow } from "@/lib/types";
import { cheapestPerPair, googleFlightsUrl, inWindow } from "./common";

// Google Flights via SerpApi: live prices for every airline (easyJet, Jet2...).
// Needs SERPAPI_KEY. Each route + date is one paid search (250/month free), so
// it's only used in "Pick a destination" mode when the user asks, and each
// search is capped at MAX_CALLS_PER_SEARCH.

const URL_BASE = "https://serpapi.com/search.json";
export const MAX_CALLS_PER_SEARCH = 30;
// Our own cache: repeat searches within this window don't use any allowance.
const CACHE_MS = 3 * 60 * 60 * 1000;

interface SerpAirport {
  id?: string;
  name?: string;
  time?: string; // "YYYY-MM-DD HH:MM", local
}
interface SerpFlight {
  departure_airport?: SerpAirport;
  arrival_airport?: SerpAirport;
  airline?: string;
  flight_number?: string;
}
interface SerpOption {
  flights?: SerpFlight[];
  price?: number;
}
interface SerpResponse {
  best_flights?: SerpOption[];
  other_flights?: SerpOption[];
  error?: string;
}

export interface SerpApiBudget {
  stats: FetchStats;
  limitHit: boolean;
}

function naive(time: string): string {
  return `${time.replace(" ", "T")}:00`;
}

/**
 * Every direct one-way flight Google Flights lists between the airports on a
 * date (one SerpApi search, cached 3h), optionally only departing in `window`.
 */
export async function googleFlightsOneWay(
  apiKey: string,
  q: { from: string[]; to: string[]; date: string; window?: TimeWindow },
  stats?: FetchStats,
): Promise<Leg[]> {
  const p = new URLSearchParams({
    engine: "google_flights",
    departure_id: q.from.join(","),
    arrival_id: q.to.join(","),
    outbound_date: q.date,
    type: "2", // one way
    stops: "1", // nonstop only
    currency: "GBP",
    hl: "en",
    gl: "uk",
    sort_by: "2", // price
    api_key: apiKey,
  });
  if (q.window) {
    const fromHour = Number(q.window.from.slice(0, 2));
    const toHour = Number(q.window.to.slice(0, 2));
    if (fromHour > 0 || toHour < 23) p.set("outbound_times", `${fromHour},${toHour}`);
  }

  let res: SerpResponse;
  try {
    res = await cachedJson<SerpResponse>(`${URL_BASE}?${p}`, stats, CACHE_MS);
  } catch (e) {
    if (e instanceof Error && /Upstream 401|Upstream 403/.test(e.message)) {
      throw new Error("SerpApi rejected the key. Check SERPAPI_KEY.");
    }
    if (e instanceof Error && /Upstream 429/.test(e.message)) {
      throw new Error("SerpApi limit reached (monthly allowance or hourly rate).");
    }
    throw e;
  }
  if (res.error && !/no results|hasn't returned any results/i.test(res.error)) {
    throw new Error(`Google Flights: ${res.error}`);
  }

  const legs: Leg[] = [];
  for (const opt of [...(res.best_flights ?? []), ...(res.other_flights ?? [])]) {
    const f = opt.flights;
    if (!f || f.length !== 1 || !opt.price) continue;
    const { departure_airport: dep, arrival_airport: arr } = f[0];
    if (!dep?.id || !dep.time || !arr?.id || !arr.time) continue;
    const depart = naive(dep.time);
    if (depart.slice(0, 10) !== q.date || (q.window && !inWindow(depart, q.window))) continue;
    legs.push({
      provider: "serpapi",
      freshness: "live",
      airline: f[0].airline ?? "",
      flightNumber: (f[0].flight_number ?? "").replace(/\s+/g, ""),
      from: await airportRef(dep.id, { name: dep.name }),
      to: await airportRef(arr.id, { name: arr.name }),
      depart,
      arrive: naive(arr.time),
      price: opt.price,
      currency: "GBP",
      bookingUrl: googleFlightsUrl(dep.id, arr.id, q.date),
    });
  }
  return legs.sort((a, b) => a.price - b.price);
}

export function serpapi(apiKey: string, budget: SerpApiBudget): FareProvider {
  return {
    id: "serpapi",
    name: "Google Flights",
    async cheapestOneWay(q: OneWayQuery): Promise<OneWayResult> {
      // Google Flights needs both ends and a single date.
      if (!q.to?.length || q.dateFrom !== q.dateTo) return { legs: [], complete: false };
      if (budget.stats.upstreamCalls >= MAX_CALLS_PER_SEARCH) {
        budget.limitHit = true;
        return { legs: [], complete: false };
      }
      const legs = await googleFlightsOneWay(
        apiKey,
        { from: q.from, to: q.to, date: q.dateFrom, window: q.window },
        budget.stats,
      );
      return { legs: cheapestPerPair(legs), complete: true };
    },
  };
}

/** Searches left on the SerpApi account (the account endpoint is free), if it says. */
export async function serpapiSearchesLeft(apiKey: string): Promise<number | undefined> {
  try {
    const a = await cachedJson<{ total_searches_left?: number; plan_searches_left?: number }>(
      `https://serpapi.com/account.json?api_key=${encodeURIComponent(apiKey)}`,
      undefined,
      30_000,
    );
    return a.total_searches_left ?? a.plan_searches_left;
  } catch {
    return undefined;
  }
}
