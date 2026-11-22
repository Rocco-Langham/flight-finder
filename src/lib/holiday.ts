import { addDays, datesBetween, naiveMs } from "@/lib/dates";
import { km, toLocalNaive, type AirportInfo } from "@/lib/airports";
import { CORE_PLACE_CODES, MIN_LONG_HAUL_KM, POPULAR_PLACES } from "@/lib/longhaul";
import { airlineName } from "@/lib/providers/common";
import {
  departureInstant,
  type RoundTripQuery,
  type RoundTripSource,
  type RoundTripTicket,
} from "@/lib/providers/travelpayouts";
import type { AirportRef, DateWindow, HolidayRequest, HolidayResponse, HolidayTrip } from "@/lib/types";

// "Further away": the cheapest return trips for long holidays, connections
// allowed. Fares are Travelpayouts' recently-seen round-trip prices, asked for
// by departure month, then filtered to trips that fit inside one of the date
// windows (e.g. school holidays plus a few days).

/** Most results shown when searching specific places (cheapest per place and date). */
const MAX_DATED_RESULTS = 60;
/** Lookups in flight at once (the host's pacing sets the real rate). */
const WORKERS = 6;
const LONG_HAUL_CODES = new Set(POPULAR_PLACES.map((p) => p.code));

export type AirportLookup = (code: string) => Promise<AirportInfo | undefined>;

/** Months ("YYYY-MM") a trip fitting the window could leave in. */
export function departMonths(w: DateWindow, minNights: number): string[] {
  const months = new Set<string>();
  for (const d of datesBetween(w.from, w.to)) {
    if (addDays(d, minNights) > w.to) break;
    months.add(d.slice(0, 7));
  }
  return [...months];
}

const nightsBetween = (from: string, to: string) =>
  Math.round((naiveMs(`${to}T00:00:00`) - naiveMs(`${from}T00:00:00`)) / 86_400_000);

function ref(a: AirportInfo): AirportRef {
  const r: AirportRef = { code: a.code, name: a.name, city: a.city, country: a.country, countryCode: a.countryCode };
  if (a.transfer) r.transfer = a.transfer;
  return r;
}

function googleRoundTripUrl(from: string, to: string, out: string, back: string): string {
  const q = `Flights from ${from} to ${to} on ${out} returning ${back}`;
  return `https://www.google.com/travel/flights?hl=en-GB&curr=GBP&q=${encodeURIComponent(q)}`;
}

export async function holidaySearch(
  req: HolidayRequest,
  source: RoundTripSource,
  airport: AirportLookup,
  onFailure: (e: unknown) => void = () => {},
  signal?: AbortSignal,
): Promise<{ trips: HolidayTrip[]; incomplete: boolean; failures: number }> {
  const anywhere = req.destinations.length === 0;
  // Anywhere: one open query per origin (whatever's cheapest), plus each popular
  // long-haul place, which the open query's cheapest-first pages may not reach.
  const dests: (string | undefined)[] = anywhere
    ? [undefined, ...CORE_PLACE_CODES]
    : req.destinations;

  // Ask by city: one "London" lookup covers Stansted, Luton, Gatwick... (only
  // the chosen airports are kept below).
  const askFrom = [
    ...new Set(
      await Promise.all(req.origins.map(async (o) => (await airport(o))?.cityCode ?? o)),
    ),
  ];
  const queries = new Map<string, RoundTripQuery>();
  for (const w of req.windows) {
    for (const departMonth of departMonths(w, req.minNights)) {
      for (const origin of askFrom) {
        for (const destination of dests) {
          const q = { origin, destination, departMonth, direct: req.maxStops === 0 };
          queries.set(JSON.stringify(q), q);
        }
      }
    }
  }

  let incomplete = false;
  let failures = 0;
  const tickets: RoundTripTicket[] = [];
  // A few at a time, so a search that's been abandoned stops queueing lookups.
  const queue = [...queries.values()];
  const worker = async () => {
    for (let q = queue.shift(); q && !signal?.aborted; q = queue.shift()) {
      try {
        const r = await source(q);
        tickets.push(...r.tickets);
        // A cut-off open "anywhere" query is fine (the popular places are asked
        // about one by one too); a cut-off single route may hide cheaper fares.
        if (!r.complete && q.destination) incomplete = true;
      } catch (e) {
        failures++;
        onFailure(e);
      }
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));

  const best = new Map<string, HolidayTrip>();
  for (const t of tickets) {
    const trip = await toTrip(t, req, airport, anywhere);
    if (!trip) continue;
    // Anywhere: cheapest per city. Specific places: cheapest per city and date.
    const city = (await airport(trip.destination.code))?.cityCode ?? trip.destination.code;
    const key = anywhere ? city : `${city}|${trip.depart.slice(0, 10)}|${trip.returnDepart.slice(0, 10)}`;
    const cur = best.get(key);
    if (!cur || trip.price < cur.price) best.set(key, trip);
  }
  const trips = [...best.values()].sort((a, b) => a.price - b.price);
  return { trips: anywhere ? trips : trips.slice(0, MAX_DATED_RESULTS), incomplete, failures };
}

async function toTrip(
  t: RoundTripTicket,
  req: HolidayRequest,
  airport: AirportLookup,
  anywhere: boolean,
): Promise<HolidayTrip | null> {
  const fromCode = t.origin_airport ?? t.origin;
  const toCode = t.destination_airport ?? t.destination;
  if (!fromCode || !toCode || !t.price || !t.departure_at || !t.return_at) return null;
  if (req.maxPrice !== undefined && t.price > req.maxPrice) return null;
  const stopsOut = t.transfers ?? 0;
  const stopsBack = t.return_transfers ?? t.transfers ?? 0;
  if (stopsOut > req.maxStops || stopsBack > req.maxStops) return null;

  const [from, to] = await Promise.all([airport(fromCode), airport(toCode)]);
  if (!from || !to) return null;

  // Times come with an offset, sometimes UTC ("Z"): show them in local time at
  // the airport the flight leaves from.
  const local = (at: string, timeZone: string) => {
    const instant = departureInstant(at, timeZone);
    return Number.isNaN(instant.getTime()) ? null : toLocalNaive(instant, timeZone).slice(0, 16);
  };
  const depart = local(t.departure_at, from.timeZone);
  const returnDepart = local(t.return_at, to.timeZone);
  if (!depart || !returnDepart) return null;
  // Landing times: leaving time plus journey time, in local time where it lands.
  const landing = (at: string, leaveZone: string, minutes: number | undefined, landZone: string) => {
    if (!minutes) return undefined;
    const leave = departureInstant(at, leaveZone);
    return toLocalNaive(new Date(leave.getTime() + minutes * 60_000), landZone).slice(0, 16);
  };
  const arrive = landing(t.departure_at, from.timeZone, t.duration_to, to.timeZone);
  const returnArrive = landing(t.return_at, to.timeZone, t.duration_back, from.timeZone);
  const outDate = depart.slice(0, 10);
  const backDate = returnDepart.slice(0, 10);
  const nights = nightsBetween(outDate, backDate);
  if (nights < req.minNights || nights > req.maxNights) return null;
  const window = req.windows.find((w) => outDate >= w.from && backDate <= w.to);
  if (!window) return null;
  if (!req.origins.includes(from.code) && !req.origins.includes(from.cityCode)) return null;
  if (anywhere) {
    const far =
      from.coords && to.coords
        ? km(from.coords, to.coords) >= MIN_LONG_HAUL_KM
        : LONG_HAUL_CODES.has(to.cityCode); // distance unknown: trust the list
    if (!far) return null;
  }

  return {
    destination: ref(to),
    from: ref(from),
    depart,
    returnDepart,
    arrive,
    returnArrive,
    nights,
    price: t.price,
    currency: "GBP",
    stopsOut,
    stopsBack,
    minutesOut: t.duration_to,
    minutesBack: t.duration_back,
    airline: airlineName(t.airline ?? ""),
    flightNumber: t.airline && t.flight_number ? `${t.airline}${t.flight_number}` : undefined,
    soldBy: t.gate || undefined,
    window: window.label,
    fareUrl: t.link ? `https://www.aviasales.com${t.link}` : undefined,
    googleUrl: googleRoundTripUrl(from.code, to.code, outDate, backDate),
  };
}

export function holidayResponse(
  result: Awaited<ReturnType<typeof holidaySearch>>,
  errors: Set<string>,
  stats: { upstreamCalls: number; cacheHits: number },
  started: number,
): HolidayResponse {
  const warnings: string[] = [...errors];
  if (result.failures > 0 && errors.size === 0) {
    warnings.push(`${result.failures} fare lookup${result.failures === 1 ? "" : "s"} failed, so some results may be missing.`);
  }
  if (result.incomplete) warnings.push("Some places had more fares than could be checked, so a cheaper one may exist.");
  return {
    trips: result.trips,
    warnings,
    stats: { upstreamCalls: stats.upstreamCalls, cacheHits: stats.cacheHits, ms: Date.now() - started },
  };
}
