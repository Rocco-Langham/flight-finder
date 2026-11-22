import { airportInfo, airportRef, toLocalNaive } from "@/lib/airports";
import { naiveMs } from "@/lib/dates";
import { cachedJson, type FetchStats } from "@/lib/http";
import type { CalendarResult, FareProvider, Leg, OneWayQuery, OneWayResult } from "@/lib/types";
import { airlineName, cheapestPerPair, googleFlightsUrl, inWindow, monthsBetween } from "./common";

// Travelpayouts (Aviasales) Data API: prices other travellers found in recent
// searches, covering easyJet, Jet2 and most other airlines. Free with a token
// (TRAVELPAYOUTS_TOKEN). Cached data: prices may be hours or days old and some
// dates/routes are missing, so these legs are marked "cached".

const URL_BASE = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates";
const LIMIT = 1000;
const MAX_PAGES = 3;
// Ryanair-group fares come live from the Ryanair provider instead.
const SKIP_AIRLINES = new Set(["FR", "RK", "AL"]);

interface Ticket {
  origin?: string;
  destination?: string;
  origin_airport?: string;
  destination_airport?: string;
  price?: number;
  airline?: string;
  flight_number?: string | number;
  departure_at?: string;
  transfers?: number;
  duration?: number;
  duration_to?: number;
}

interface Response {
  success?: boolean;
  data?: Ticket[];
  currency?: string;
  error?: string;
}

/** Instant of a departure_at string. With no offset it's treated as local time at the airport. */
export function departureInstant(departureAt: string, timeZone: string): Date {
  if (/(Z|[+-]\d\d:?\d\d)$/.test(departureAt)) return new Date(departureAt);
  const naive = departureAt.slice(0, 19);
  const guess = naiveMs(naive);
  const offset = naiveMs(toLocalNaive(new Date(guess), timeZone)) - guess;
  return new Date(guess - offset);
}

export function travelpayouts(token: string, stats?: FetchStats): FareProvider {
  async function fetchAll(params: URLSearchParams): Promise<{ tickets: Ticket[]; complete: boolean }> {
    const tickets: Ticket[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      params.set("page", String(page));
      let res: Response;
      try {
        res = await cachedJson<Response>(`${URL_BASE}?${params}`, stats);
      } catch (e) {
        if (e instanceof Error && /Upstream 401|Upstream 403/.test(e.message)) {
          throw new Error("Travelpayouts rejected the token. Check TRAVELPAYOUTS_TOKEN.");
        }
        throw e;
      }
      if (res.success === false) throw new Error(`Travelpayouts: ${res.error ?? "request failed"}`);
      const data = res.data ?? [];
      tickets.push(...data);
      if (data.length < LIMIT) return { tickets, complete: true };
    }
    return { tickets, complete: false };
  }

  async function toLeg(t: Ticket): Promise<Leg | null> {
    const fromCode = t.origin_airport ?? t.origin;
    const toCode = t.destination_airport ?? t.destination;
    const minutes = t.duration_to ?? t.duration;
    if (!fromCode || !toCode || !t.departure_at || !t.price || !minutes) return null;
    if (t.transfers !== undefined && t.transfers !== 0) return null;
    const airline = t.airline ?? "";
    if (SKIP_AIRLINES.has(airline)) return null;

    const [fromInfo, toInfo] = await Promise.all([airportInfo(fromCode), airportInfo(toCode)]);
    if (!fromInfo || !toInfo) return null;
    const departAt = departureInstant(t.departure_at, fromInfo.timeZone);
    if (Number.isNaN(departAt.getTime())) return null;
    const depart = toLocalNaive(departAt, fromInfo.timeZone);
    const arrive = toLocalNaive(new Date(departAt.getTime() + minutes * 60_000), toInfo.timeZone);

    return {
      provider: "travelpayouts",
      freshness: "cached",
      airline: airlineName(airline),
      flightNumber: `${airline}${t.flight_number ?? ""}`,
      from: await airportRef(fromCode),
      to: await airportRef(toCode),
      depart,
      arrive,
      price: t.price,
      currency: "GBP",
      bookingUrl: googleFlightsUrl(fromCode, toCode, depart.slice(0, 10)),
    };
  }

  async function fromOne(from: string, q: OneWayQuery): Promise<OneWayResult> {
    // Always ask by whole month, then filter. One cached response serves every
    // day of the month, and a day's answer is always a subset of the range's
    // answer, which keeps the explore-mode lower bound valid.
    const periods = monthsBetween(q.dateFrom, q.dateTo);
    const destination = q.to?.length === 1 ? q.to[0] : undefined;
    const results = await Promise.all(
      periods.map((period) => {
        const p = new URLSearchParams({
          origin: from,
          departure_at: period,
          one_way: "true",
          direct: "true",
          unique: "false",
          sorting: "price",
          currency: "gbp",
          market: "uk",
          limit: String(LIMIT),
          token,
        });
        if (destination) p.set("destination", destination);
        return fetchAll(p);
      }),
    );
    const wanted = q.to ? new Set(q.to) : null;
    const legs: Leg[] = [];
    for (const t of results.flatMap((r) => r.tickets)) {
      const leg = await toLeg(t);
      if (!leg) continue;
      if (wanted && !wanted.has(leg.to.code)) continue;
      const day = leg.depart.slice(0, 10);
      if (day < q.dateFrom || day > q.dateTo || !inWindow(leg.depart, q.window)) continue;
      legs.push(leg);
    }
    return { legs, complete: results.every((r) => r.complete) };
  }

  /** Cheapest cached fare per day of a month on one route (from the same monthly data). */
  async function calendar(from: string, to: string, month: string): Promise<CalendarResult> {
    const r = await fromOne(from, {
      from: [from],
      to: [to],
      dateFrom: `${month}-01`,
      dateTo: `${month}-31`,
      window: { from: "00:00", to: "23:59" },
    });
    const byDay = new Map<string, Leg>();
    for (const leg of r.legs) {
      const day = leg.depart.slice(0, 10);
      const cur = byDay.get(day);
      if (!cur || leg.price < cur.price) byDay.set(day, leg);
    }
    return { legs: [...byDay.values()], complete: r.complete };
  }

  return {
    id: "travelpayouts",
    name: "Travelpayouts",
    calendar,
    async cheapestOneWay(q: OneWayQuery): Promise<OneWayResult> {
      const parts = await Promise.all(q.from.map((f) => fromOne(f, q)));
      return {
        legs: cheapestPerPair(parts.flatMap((p) => p.legs)),
        complete: parts.every((p) => p.complete),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Round trips with connections, for "Further away" (long-haul holidays).

export interface RoundTripTicket {
  origin?: string;
  destination?: string;
  origin_airport?: string;
  destination_airport?: string;
  price?: number;
  airline?: string;
  flight_number?: string | number;
  /** e.g. "2027-07-25T10:15:00+01:00": local time at the airport, with its offset. */
  departure_at?: string;
  return_at?: string;
  transfers?: number;
  return_transfers?: number;
  duration_to?: number;
  duration_back?: number;
  /** Path on aviasales.com for this exact fare. */
  link?: string;
  /** Who sells the fare, e.g. "Kiwi.com". */
  gate?: string;
}

export interface RoundTripQuery {
  origin: string;
  /** City or airport code; omit for anywhere. */
  destination?: string;
  departMonth: string; // YYYY-MM
  direct: boolean;
}

export type RoundTripSource = (q: RoundTripQuery) => Promise<{ tickets: RoundTripTicket[]; complete: boolean }>;

/**
 * Cheapest recently-seen return fares for one origin departing in a month, any
 * return date (asking without return_at gives every return month at once).
 */
export function travelpayoutsRoundTrips(token: string, stats?: FetchStats): RoundTripSource {
  return async (q) => {
    const tickets: RoundTripTicket[] = [];
    // One route rarely has more than a page; "anywhere" can, so it gets a few.
    const pages = q.destination ? 1 : MAX_PAGES;
    for (let page = 1; page <= pages; page++) {
      const p = new URLSearchParams({
        origin: q.origin,
        departure_at: q.departMonth,
        one_way: "false",
        direct: String(q.direct),
        unique: "false",
        sorting: "price",
        currency: "gbp",
        market: "uk",
        limit: String(LIMIT),
        page: String(page),
        token,
      });
      if (q.destination) p.set("destination", q.destination);
      let res: { success?: boolean; data?: RoundTripTicket[]; error?: string };
      try {
        res = await cachedJson(`${URL_BASE}?${p}`, stats);
      } catch (e) {
        if (e instanceof Error && /Upstream 401|Upstream 403/.test(e.message)) {
          throw new Error("Travelpayouts rejected the token. Check TRAVELPAYOUTS_TOKEN.");
        }
        throw e;
      }
      if (res.success === false) throw new Error(`Travelpayouts: ${res.error ?? "request failed"}`);
      const data = res.data ?? [];
      tickets.push(...data);
      if (data.length < LIMIT) return { tickets, complete: true };
    }
    return { tickets, complete: false };
  };
}
