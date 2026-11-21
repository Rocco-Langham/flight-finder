import {
  addDays,
  datesBetween,
  minutesToTime,
  msToNaive,
  naiveMs,
  timeToMinutes,
  weekday,
} from "@/lib/dates";
import type { FetchStats } from "@/lib/http";
import { MAX_OUTBOUND_DATES } from "@/lib/limits";
import type { ProviderSet } from "@/lib/providers";
import { MAX_CALLS_PER_SEARCH as MAX_SERPAPI_CALLS } from "@/lib/providers/serpapi";
import { inWindow, monthsBetween } from "@/lib/providers/common";
import type {
  CountryFilter,
  Leg,
  SearchRequest,
  SearchResponse,
  TimeWindow,
  Trip,
} from "@/lib/types";

// The search engine. Every trip is built from two one-way fares so that we can
// mix home airports and enforce time-on-the-ground exactly.
//
// Provider queries return the cheapest fare per (from, to) airport pair within
// a date range + departure-time window, merged across all fare sources.
//
/** Near misses: how far the time windows are widened, and how much ground time is relaxed. */
const NEAR_MISS_WIDEN_MIN = 3 * 60;
const NEAR_MISS_MIN_HOURS_FACTOR = 0.5;

/** The parts of a request that decide which trips are valid. */
interface Rules {
  outWindow: TimeWindow;
  returnWindow: TimeWindow;
  minHoursAtDestination: number;
}

export async function search(
  req: SearchRequest,
  { provider, errors, serpBudget }: ProviderSet,
  stats: FetchStats,
): Promise<SearchResponse> {
  const started = Date.now();
  const warnings: string[] = [];
  const home = new Set(req.origins);
  const countryOk =
    req.mode === "explore" ? countryFilter(req.countryFilter) : () => true;
  let failures = 0;
  const failureMessages = new Set<string>();
  const noteFailure = (e: unknown) => {
    failures++;
    if (e instanceof Error) failureMessages.add(e.message);
  };

  let outDates = datesBetween(req.dateFrom, req.dateTo).filter((d) =>
    req.outDays.includes(weekday(d)),
  );
  if (outDates.length > MAX_OUTBOUND_DATES) {
    outDates = outDates.slice(0, MAX_OUTBOUND_DATES);
    warnings.push(
      `Only the first ${MAX_OUTBOUND_DATES} matching dates were searched.`,
    );
  }
  const n = outDates.length;
  const dateIndex = new Map(outDates.map((d, i) => [d, i]));
  const minNights = Math.min(...req.nights);
  const maxNights = Math.max(...req.nights);

  const legOk = (leg: Leg) =>
    !home.has(leg.to.code) &&
    countryOk(leg.to.countryCode) &&
    (req.maxPrice === undefined || leg.price <= req.maxPrice);

  /** Cheapest valid trip for one destination leaving on one date, using the given outbound legs. */
  async function evaluate(
    rules: Rules,
    dest: string,
    outDate: string,
    outs: Leg[],
  ): Promise<Trip | null> {
    const candidates = await Promise.all(
      req.nights.flatMap((nights) => {
        const retDate = addDays(outDate, nights);
        return outs.map(async (out): Promise<Trip | null> => {
          const earliest = msToNaive(
            naiveMs(out.arrive) + rules.minHoursAtDestination * 3_600_000,
          );
          const earliestDate = earliest.slice(0, 10);
          if (earliestDate > retDate) return null;
          let fromTime = rules.returnWindow.from;
          if (earliestDate === retDate && earliest.slice(11, 16) > fromTime)
            fromTime = earliest.slice(11, 16);
          if (fromTime > rules.returnWindow.to) return null;

          const { legs } = await provider.cheapestOneWay({
            from: [dest],
            to: req.mixAirports ? req.origins : [out.from.code],
            dateFrom: retDate,
            dateTo: retDate,
            window: { from: fromTime, to: rules.returnWindow.to },
          });
          let best: Trip | null = null;
          for (const back of legs) {
            if (!home.has(back.to.code)) continue;
            if (!req.mixAirports && back.to.code !== out.from.code) continue;
            const hours =
              (naiveMs(back.depart) - naiveMs(out.arrive)) / 3_600_000;
            if (hours < rules.minHoursAtDestination) continue;
            const total = Math.round((out.price + back.price) * 100) / 100;
            if (!best || total < best.total) {
              best = {
                destination: out.to,
                out,
                back,
                total,
                currency: out.currency,
                nights,
                hoursAtDestination: Math.round(hours * 10) / 10,
              };
            }
          }
          return best;
        });
      }),
    );
    return cheapest(candidates);
  }

  /** Outbound legs to `dest` on one date, departing in the window, from the given home airports. */
  async function outsOn(
    rules: Rules,
    dest: string,
    homes: string[],
    date: string,
  ): Promise<Leg[]> {
    const { legs } = await provider.cheapestOneWay({
      from: homes,
      to: [dest],
      dateFrom: date,
      dateTo: date,
      window: rules.outWindow,
    });
    return legs.filter((l) => l.to.code === dest && legOk(l));
  }

  /**
   * Price calendars for one destination: the cheapest fare on each day, out from
   * each home airport and back to each. Null if any source can't give a
   * complete calendar (then they're not a safe lower bound).
   */
  async function calendars(
    dest: string,
    outHomes: string[],
    backHomes: string[],
  ) {
    const outMonths = monthsBetween(outDates[0], outDates[n - 1]);
    const backMonths = monthsBetween(
      addDays(outDates[0], minNights),
      addDays(outDates[n - 1], maxNights),
    );
    if (!provider.calendar) return null;
    const get = async (from: string, to: string, months: string[]) => {
      const parts = await Promise.all(
        months.map((m) => provider.calendar!(from, to, m)),
      );
      if (parts.some((p) => !p.complete)) return null;
      return new Map(
        parts.flatMap((p) => p.legs).map((l) => [l.depart.slice(0, 10), l]),
      );
    };
    const [outs, backs] = await Promise.all([
      Promise.all(outHomes.map((h) => get(h, dest, outMonths))),
      Promise.all(backHomes.map((h) => get(dest, h, backMonths))),
    ]);
    if (outs.some((c) => !c) || backs.some((c) => !c)) return null;
    return {
      out: new Map(outHomes.map((h, i) => [h, outs[i]!])),
      back: new Map(backHomes.map((h, i) => [h, backs[i]!])),
    };
  }

  /** A pairing of the day's cheapest flights each way: a lower bound for that date's trips. */
  interface Pairing {
    k: number;
    bound: number;
    /** The pairing itself fits the rules, so it is that date's cheapest trip. */
    trip: Trip | null;
  }

  function pairings(
    rules: Rules,
    cal: NonNullable<Awaited<ReturnType<typeof calendars>>>,
    dates: number[],
  ): Pairing[] {
    const out: Pairing[] = [];
    for (const k of dates) {
      const date = outDates[k];
      for (const [h, outCal] of cal.out) {
        const o = outCal.get(date);
        if (!o || !legOk(o)) continue;
        for (const nights of req.nights) {
          const retDate = addDays(date, nights);
          for (const [h2, backCal] of cal.back) {
            if (!req.mixAirports && h2 !== h) continue;
            const b = backCal.get(retDate);
            if (!b) continue;
            const bound = Math.round((o.price + b.price) * 100) / 100;
            const hours = (naiveMs(b.depart) - naiveMs(o.arrive)) / 3_600_000;
            const fits =
              inWindow(o.depart, rules.outWindow) &&
              inWindow(b.depart, rules.returnWindow) &&
              hours >= rules.minHoursAtDestination;
            out.push({
              k,
              bound,
              trip: fits
                ? {
                    destination: o.to,
                    out: o,
                    back: b,
                    total: bound,
                    currency: o.currency,
                    nights,
                    hoursAtDestination: Math.round(hours * 10) / 10,
                  }
                : null,
            });
          }
        }
      }
    }
    return out.sort(
      (a, b) => a.bound - b.bound || (a.trip ? 0 : 1) - (b.trip ? 0 : 1),
    );
  }

  /**
   * Explore: the cheapest trip per destination, in two phases.
   *
   *   Phase 1 (every destination, ~2 calls each): one shared query gives the
   *     cheapest outbound to every destination across the whole period; then per
   *     destination, the cheapest return across the period (so a lower bound) and
   *     the trip leaving on the cheapest outbound date. Ryanair's lowest fares
   *     repeat a lot, so this often meets the bound and is proven cheapest.
   *   Phase 2 (destinations not yet proven, in parallel): price calendars
   *     for each route. Pairing each day's cheapest flights gives a lower bound
   *     per date; dates are checked from the lowest bound up, using the pairing
   *     directly when it fits the requested times and an exact lookup when not,
   *     until no date can beat the best trip.
   * Destinations that couldn't be proven cheapest (no complete price calendar
   * from every source in use) are flagged `maybeCheaper`.
   */
  async function explore(
    rules: Rules,
    skip: Set<string>,
  ): Promise<{ trips: Trip[]; unresolved: string[] }> {
    if (n === 0) return { trips: [], unresolved: [] };
    const root = await provider
      .cheapestOneWay({
        from: req.origins,
        dateFrom: outDates[0],
        dateTo: outDates[n - 1],
        window: rules.outWindow,
      })
      .catch((e) => {
        noteFailure(e);
        return { legs: [] as Leg[], complete: false };
      });
    const rootByDest = new Map<string, Leg[]>();
    for (const leg of root.legs) {
      if (!legOk(leg) || skip.has(leg.to.code)) continue;
      rootByDest.set(leg.to.code, [
        ...(rootByDest.get(leg.to.code) ?? []),
        leg,
      ]);
    }

    interface DestState {
      dest: string;
      homes: string[];
      /** Home airports with a flight back in the return window (from Phase 1). */
      backHomes: string[];
      best: Trip | null;
      bound: number;
      proven: boolean;
    }
    const consider = (s: DestState, trip: Trip | null) => {
      if (trip && (!s.best || trip.total < s.best.total)) s.best = trip;
      if (s.best && s.best.total <= s.bound) s.proven = true;
    };

    const states: DestState[] = [...rootByDest].map(([dest, legs]) => ({
      dest,
      homes: [...new Set(legs.map((l) => l.from.code))],
      backHomes: [],
      best: null,
      bound: 0,
      proven: false,
    }));

    // Phase 1.
    await Promise.all(
      states.map(async (s) => {
        try {
          const outMin = Math.min(
            ...rootByDest.get(s.dest)!.map((l) => l.price),
          );
          const ret = await provider.cheapestOneWay({
            from: [s.dest],
            to: req.mixAirports ? req.origins : s.homes,
            dateFrom: addDays(outDates[0], minNights),
            dateTo: addDays(outDates[n - 1], maxNights),
            window: rules.returnWindow,
          });
          const backs = ret.legs.filter((l) => home.has(l.to.code));
          s.backHomes = ret.complete
            ? [...new Set(backs.map((l) => l.to.code))]
            : req.mixAirports
              ? req.origins
              : s.homes;
          if (backs.length === 0 && ret.complete && root.complete) {
            s.proven = true; // no way back in the return window: no trip
            return;
          }
          s.bound =
            ret.complete && root.complete && backs.length
              ? outMin + Math.min(...backs.map((l) => l.price))
              : 0;
          // The root legs are already the cheapest outbound from each home on their
          // date, so pricing that date needs only the return lookup.
          const seed = [...rootByDest.get(s.dest)!].sort(
            (a, b) => a.price - b.price,
          )[0];
          const k = dateIndex.get(seed.depart.slice(0, 10));
          if (k !== undefined)
            consider(s, await evaluate(rules, s.dest, outDates[k], [seed]));
          // Nothing yet: try the dates that pair with the cheapest flight back.
          const back = [...backs].sort((a, b) => a.price - b.price)[0];
          for (const nights of !s.best && back ? req.nights : []) {
            const kb = dateIndex.get(
              addDays(back.depart.slice(0, 10), -nights),
            );
            if (kb === undefined || kb === k) continue;
            const outs = await outsOn(rules, s.dest, s.homes, outDates[kb]);
            if (outs.length)
              consider(s, await evaluate(rules, s.dest, outDates[kb], outs));
          }
        } catch (e) {
          noteFailure(e);
        }
      }),
    );

    // Phase 2: every destination not yet proven, in parallel.
    await Promise.all(
      states
        .filter((s) => !s.proven)
        .map(async (s) => {
          try {
            const cal = await calendars(s.dest, s.homes, s.backHomes);
            if (!cal) return;
            const checked = new Set<number>();
            for (const p of pairings(
              rules,
              cal,
              outDates.map((_, k) => k),
            )) {
              if (s.best && p.bound >= s.best.total) break;
              if (req.maxPrice !== undefined && p.bound > req.maxPrice) break;
              if (p.trip) {
                consider(s, p.trip);
                continue;
              }
              if (checked.has(p.k)) continue;
              checked.add(p.k);
              const outs = await outsOn(rules, s.dest, s.homes, outDates[p.k]);
              if (outs.length)
                consider(s, await evaluate(rules, s.dest, outDates[p.k], outs));
            }
            s.proven = true;
          } catch (e) {
            noteFailure(e);
          }
        }),
    );

    return {
      trips: states
        .filter(
          (s) =>
            s.best &&
            (req.maxPrice === undefined || s.best.total <= req.maxPrice),
        )
        .map((s) => (s.proven ? s.best! : { ...s.best!, maybeCheaper: true }))
        .sort((a, b) => a.total - b.total),
      unresolved: states.filter((s) => !s.best && !s.proven).map((s) => s.dest),
    };
  }

  /**
   * Route: the cheapest trip on every date, across the chosen destination
   * airports. Uses price calendars (a few calls per month) and only looks a date
   * up directly when the day's cheapest flights don't fit the requested times.
   */
  async function route(rules: Rules): Promise<Trip[]> {
    const dests = req.destinations ?? [];
    // Which home airports fly to each destination at all in this period.
    const reach = await provider
      .cheapestOneWay({
        from: req.origins,
        to: dests,
        dateFrom: outDates[0],
        dateTo: outDates[n - 1],
        window: rules.outWindow,
      })
      .catch((e) => {
        noteFailure(e);
        return { legs: [] as Leg[], complete: false };
      });
    const homesFor = (dest: string) =>
      reach.complete
        ? [
            ...new Set(
              reach.legs
                .filter((l) => l.to.code === dest)
                .map((l) => l.from.code),
            ),
          ]
        : req.origins;

    const best = new Map<number, Trip>();
    const consider = (k: number, t: Trip | null) => {
      if (t && (!best.has(k) || t.total < best.get(k)!.total)) best.set(k, t);
    };
    for (const dest of dests) {
      const homes = homesFor(dest);
      if (homes.length === 0) continue;
      // And which home airports have flights back from it in the return window.
      const back = await provider
        .cheapestOneWay({
          from: [dest],
          to: req.mixAirports ? req.origins : homes,
          dateFrom: addDays(outDates[0], minNights),
          dateTo: addDays(outDates[n - 1], maxNights),
          window: rules.returnWindow,
        })
        .catch((e) => {
          noteFailure(e);
          return { legs: [] as Leg[], complete: false };
        });
      const backHomes = back.complete
        ? [
            ...new Set(
              back.legs
                .filter((l) => home.has(l.to.code))
                .map((l) => l.to.code),
            ),
          ]
        : req.mixAirports
          ? req.origins
          : homes;
      if (back.complete && backHomes.length === 0) continue;
      const cal = await calendars(dest, homes, backHomes).catch((e) => {
        noteFailure(e);
        return null;
      });
      // Pairings per date, cheapest first; a date is settled by its first fitting
      // pairing or one exact lookup.
      const byDate = new Map<number, Pairing[]>();
      if (cal)
        for (const p of pairings(
          rules,
          cal,
          outDates.map((_, k) => k),
        ))
          byDate.set(p.k, [...(byDate.get(p.k) ?? []), p]);
      const toLookUp: number[] = [];
      for (let k = 0; k < n; k++) {
        const ps = byDate.get(k);
        if (cal && !ps) continue; // no flights that day
        const first = ps?.[0];
        if (first?.trip) consider(k, first.trip);
        else toLookUp.push(k);
      }
      for (const k of toLookUp) {
        try {
          const outs = await outsOn(rules, dest, homes, outDates[k]);
          if (outs.length)
            consider(k, await evaluate(rules, dest, outDates[k], outs));
        } catch (e) {
          noteFailure(e);
        }
      }
    }
    return [...best.values()]
      .filter((t) => req.maxPrice === undefined || t.total <= req.maxPrice)
      .sort((a, b) => a.out.depart.localeCompare(b.out.depart));
  }

  const strict: Rules = {
    outWindow: req.outWindow,
    returnWindow: req.returnWindow,
    minHoursAtDestination: req.minHoursAtDestination,
  };
  let trips: Trip[] = [];
  let nearMisses: Trip[] = [];

  if (req.mode === "route") {
    trips = await route(strict);
  } else {
    const main = await explore(strict, new Set());
    trips = main.trips;
    if (main.unresolved.length > 0) {
      warnings.push(
        `${main.unresolved.length} more destination${main.unresolved.length === 1 ? " wasn't" : "s weren't"} fully checked (a fare source couldn't give a complete price calendar, or a lookup failed). Try again in a minute to see more.`,
      );
    }
    // Near misses: destinations with no trip that fits, searched again with
    // wider times, labelled with how they miss.
    const relaxed: Rules = {
      outWindow: widen(req.outWindow, NEAR_MISS_WIDEN_MIN),
      returnWindow: widen(req.returnWindow, NEAR_MISS_WIDEN_MIN),
      minHoursAtDestination: Math.max(
        1,
        Math.round(req.minHoursAtDestination * NEAR_MISS_MIN_HOURS_FACTOR * 2) /
          2,
      ),
    };
    // Only destinations proven to have no fitting trip can be near misses.
    const skip = new Set([
      ...trips.map((t) => t.destination.code),
      ...main.unresolved,
    ]);
    nearMisses = (await explore(relaxed, skip)).trips
      .map((t) => ({ ...t, misses: missesOf(t, req) }))
      .filter((t) => t.misses.length > 0);
  }

  for (const [name, message] of errors) {
    if (!failureMessages.has(message)) warnings.push(`${name}: ${message}`);
  }
  if (serpBudget.limitHit) {
    warnings.push(
      `The Google Flights live check stopped after ${MAX_SERPAPI_CALLS} searches to protect your SerpApi allowance. Later dates show Ryanair and cached prices only. Narrow the dates to check them all.`,
    );
  }
  const rateLimited = [...failureMessages].filter((m) =>
    /refusing requests/.test(m),
  );
  for (const m of rateLimited) warnings.push(m);
  if (failures > 0 && rateLimited.length === 0) {
    warnings.push(
      `${failures} fare lookup${failures === 1 ? "" : "s"} failed, so some results may be missing. Try again in a minute.`,
    );
  }

  return {
    mode: req.mode,
    currency: trips[0]?.currency ?? "GBP",
    trips,
    nearMisses,
    stats: {
      upstreamCalls: stats.upstreamCalls,
      cacheHits: stats.cacheHits,
      ms: Date.now() - started,
      outboundDates: n,
      truncated: trips.some((t) => t.maybeCheaper),
      serpapiCalls: serpBudget.stats.upstreamCalls,
    },
    warnings,
  };
}

function widen(w: TimeWindow, minutes: number): TimeWindow {
  return {
    from: minutesToTime(Math.max(0, timeToMinutes(w.from) - minutes)),
    to: minutesToTime(Math.min(23 * 60 + 59, timeToMinutes(w.to) + minutes)),
  };
}

/** Human-readable reasons a trip breaks the requested times. */
function missesOf(t: Trip, req: SearchRequest): string[] {
  const out: string[] = [];
  const outTime = t.out.depart.slice(11, 16);
  const backTime = t.back.depart.slice(11, 16);
  if (outTime < req.outWindow.from)
    out.push(`Leaves ${outTime}, before ${req.outWindow.from}`);
  if (outTime > req.outWindow.to)
    out.push(`Leaves ${outTime}, after ${req.outWindow.to}`);
  if (backTime < req.returnWindow.from)
    out.push(`Flight home ${backTime}, before ${req.returnWindow.from}`);
  if (backTime > req.returnWindow.to)
    out.push(`Flight home ${backTime}, after ${req.returnWindow.to}`);
  if (t.hoursAtDestination < req.minHoursAtDestination) {
    const h = Math.floor(t.hoursAtDestination);
    const m = Math.round((t.hoursAtDestination - h) * 60);
    out.push(
      `Only ${h}h${m ? ` ${m}m` : ""} there (wanted ${req.minHoursAtDestination}h)`,
    );
  }
  return out;
}

function countryFilter(f?: CountryFilter): (countryCode: string) => boolean {
  if (!f || f.codes.length === 0) return () => true;
  const codes = new Set(f.codes);
  return f.mode === "exclude" ? (c) => !codes.has(c) : (c) => codes.has(c);
}

function cheapest(trips: (Trip | null)[]): Trip | null {
  let best: Trip | null = null;
  for (const t of trips) if (t && (!best || t.total < best.total)) best = t;
  return best;
}
