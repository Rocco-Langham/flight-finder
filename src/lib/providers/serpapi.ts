import { airportRef } from "@/lib/airports";
import { cachedJson, type FetchStats } from "@/lib/http";
import type {
  FareProvider,
  HolidayDetailsRequest,
  HolidayDetailsResponse,
  Journey,
  Leg,
  OneWayQuery,
  OneWayResult,
  TimeWindow,
} from "@/lib/types";
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

// ---------------------------------------------------------------------------
// Full itineraries for "Further away" flight details: every flight, stop and
// plane. Two searches (outbound, then the return for the chosen outbound),
// each cached 3h.

interface SerpSegment extends SerpFlight {
  duration?: number;
  airplane?: string;
  overnight?: boolean;
}
interface SerpLayover {
  duration?: number;
  name?: string;
  id?: string;
  overnight?: boolean;
}
interface SerpItinerary {
  flights?: SerpSegment[];
  layovers?: SerpLayover[];
  total_duration?: number;
  price?: number;
  departure_token?: string;
}
interface SerpItineraryResponse {
  best_flights?: SerpItinerary[];
  other_flights?: SerpItinerary[];
  error?: string;
}

const hhmm = (naiveTime: string) => naiveTime.slice(11, 16);

function toJourney(it: SerpItinerary, exact: boolean): Journey {
  return {
    segments: (it.flights ?? []).map((f) => ({
      from: { code: f.departure_airport?.id ?? "", name: f.departure_airport?.name ?? "" },
      to: { code: f.arrival_airport?.id ?? "", name: f.arrival_airport?.name ?? "" },
      depart: naive(f.departure_airport?.time ?? "").slice(0, 16),
      arrive: naive(f.arrival_airport?.time ?? "").slice(0, 16),
      minutes: f.duration,
      airline: f.airline ?? "",
      flightNumber: (f.flight_number ?? "").replace(/\s+/g, ""),
      plane: f.airplane,
      overnight: f.overnight,
    })),
    layovers: (it.layovers ?? []).map((l) => ({
      code: l.id ?? "",
      name: l.name ?? "",
      minutes: l.duration ?? 0,
      overnight: l.overnight,
    })),
    totalMinutes: it.total_duration,
    exact,
  };
}

/**
 * The itinerary that best matches a trip: same departure time (and stops) if
 * Google lists it, else the one leaving closest to that time.
 */
function bestMatch(options: SerpItinerary[], departTime: string, stops: number): { it: SerpItinerary; exact: boolean } | null {
  const usable = options.filter((o) => o.flights?.length);
  if (usable.length === 0) return null;
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const leaves = (o: SerpItinerary) => hhmm(naive(o.flights![0].departure_airport?.time ?? ""));
  const exact = usable.find((o) => leaves(o) === departTime && o.flights!.length - 1 === stops);
  if (exact) return { it: exact, exact: true };
  const closest = [...usable].sort(
    (a, b) =>
      Math.abs(minutes(leaves(a)) - minutes(departTime)) - Math.abs(minutes(leaves(b)) - minutes(departTime)) ||
      Math.abs(a.flights!.length - 1 - stops) - Math.abs(b.flights!.length - 1 - stops),
  )[0];
  return { it: closest, exact: leaves(closest) === departTime };
}

async function serpItineraries(apiKey: string, params: Record<string, string>): Promise<SerpItinerary[]> {
  const p = new URLSearchParams({
    engine: "google_flights",
    currency: "GBP",
    hl: "en",
    gl: "uk",
    api_key: apiKey,
    ...params,
  });
  let res: SerpItineraryResponse;
  try {
    res = await cachedJson<SerpItineraryResponse>(`${URL_BASE}?${p}`, undefined, CACHE_MS);
  } catch (e) {
    if (e instanceof Error && /Upstream 401|Upstream 403/.test(e.message)) {
      throw new Error("SerpApi rejected the key. Check SERPAPI_KEY.");
    }
    if (e instanceof Error && /Upstream 429/.test(e.message)) {
      throw new Error("LIMIT");
    }
    throw e;
  }
  if (res.error) {
    if (/run out of searches|limit/i.test(res.error)) throw new Error("LIMIT");
    if (/no results|hasn't returned any results/i.test(res.error)) return [];
    throw new Error(`Google Flights: ${res.error}`);
  }
  return [...(res.best_flights ?? []), ...(res.other_flights ?? [])];
}

/** Every flight, stop and plane for a round trip, matched to the trip found. */
export async function googleRoundTripDetails(
  apiKey: string,
  q: HolidayDetailsRequest,
): Promise<Omit<HolidayDetailsResponse, "searchesLeft">> {
  const base = {
    type: "1",
    departure_id: q.from,
    arrival_id: q.to,
    outbound_date: q.depart.slice(0, 10),
    return_date: q.returnDepart.slice(0, 10),
  };
  const outs = await serpItineraries(apiKey, base);
  const out = bestMatch(outs, hhmm(q.depart), q.stopsOut);
  if (!out) return {};
  const result: Omit<HolidayDetailsResponse, "searchesLeft"> = {
    out: toJourney(out.it, out.exact),
    price: out.it.price,
  };
  if (out.it.departure_token) {
    const backs = await serpItineraries(apiKey, { ...base, departure_token: out.it.departure_token });
    const back = bestMatch(backs, hhmm(q.returnDepart), q.stopsBack);
    if (back) {
      result.back = toJourney(back.it, back.exact);
      if (back.it.price) result.price = back.it.price;
    }
  }
  return result;
}
