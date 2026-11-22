import "server-only";
import type { FetchStats } from "@/lib/http";
import type { CalendarResult, FareProvider, Leg, OneWayQuery, OneWayResult, SourceStatus } from "@/lib/types";
import { cheapestPerPair } from "./common";
import { ryanair } from "./ryanair";
import { serpapi, type SerpApiBudget } from "./serpapi";
import { travelpayouts } from "./travelpayouts";

const TP_TOKEN = () => process.env.TRAVELPAYOUTS_TOKEN?.trim() || "";
const SERP_KEY = () => process.env.SERPAPI_KEY?.trim() || "";

export function sourceStatus(): SourceStatus[] {
  return [
    { id: "ryanair", name: "Ryanair", enabled: true, note: "Live prices" },
    {
      id: "travelpayouts",
      name: "easyJet, Jet2 & others",
      enabled: Boolean(TP_TOKEN()),
      note: TP_TOKEN() ? "Recent prices via Travelpayouts (may be out of date)" : "Add TRAVELPAYOUTS_TOKEN to turn on",
    },
    {
      id: "serpapi",
      name: "Google Flights live check",
      enabled: Boolean(SERP_KEY()),
      note: SERP_KEY() ? "Live prices for all airlines, uses your SerpApi allowance" : "Add SERPAPI_KEY to turn on",
    },
  ];
}

export interface ProviderSet {
  provider: FareProvider;
  /** Error messages per provider, for warnings. */
  errors: Map<string, string>;
  serpBudget: SerpApiBudget;
}

/**
 * All enabled providers behind one FareProvider. Queries run in parallel and the
 * cheapest leg per airport pair wins. A failing provider doesn't fail the
 * search, it is recorded in `errors` and its result counts as incomplete.
 */
export function providers(stats: FetchStats, opts: { liveCheck: boolean }): ProviderSet {
  const serpBudget: SerpApiBudget = { stats: { upstreamCalls: 0, cacheHits: 0, done: 0 }, limitHit: false };
  const list: FareProvider[] = [ryanair(stats)];
  if (TP_TOKEN()) list.push(travelpayouts(TP_TOKEN(), stats));
  if (opts.liveCheck && SERP_KEY()) list.push(serpapi(SERP_KEY(), serpBudget));

  const errors = new Map<string, string>();
  const combined: FareProvider = {
    id: "ryanair",
    name: list.map((p) => p.name).join(" + "),
    async cheapestOneWay(q: OneWayQuery): Promise<OneWayResult> {
      const settled = await Promise.allSettled(list.map((p) => p.cheapestOneWay(q)));
      const legs: Leg[] = [];
      let complete = true;
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") {
          legs.push(...r.value.legs);
          // Google Flights only runs in route mode, which doesn't use lower
          // bounds, and it refuses range queries by design: don't let that
          // count as incomplete.
          if (!r.value.complete && list[i].id !== "serpapi") complete = false;
        } else {
          complete = false;
          errors.set(list[i].name, r.reason instanceof Error ? r.reason.message : String(r.reason));
        }
      });
      if (settled.every((r) => r.status === "rejected")) {
        throw new Error([...errors.values()].join("; "));
      }
      return { legs: cheapestPerPair(legs), complete };
    },
    // A calendar is only a safe lower bound if every source in use can give one.
    async calendar(from: string, to: string, month: string): Promise<CalendarResult> {
      if (list.some((p) => !p.calendar)) return { legs: [], complete: false };
      const settled = await Promise.allSettled(list.map((p) => p.calendar!(from, to, month)));
      const byDay = new Map<string, Leg>();
      let complete = true;
      settled.forEach((r, i) => {
        if (r.status === "rejected") {
          complete = false;
          errors.set(list[i].name, r.reason instanceof Error ? r.reason.message : String(r.reason));
          return;
        }
        if (!r.value.complete) complete = false;
        for (const leg of r.value.legs) {
          const day = leg.depart.slice(0, 10);
          const cur = byDay.get(day);
          if (!cur || leg.price < cur.price) byDay.set(day, leg);
        }
      });
      if (settled.every((r) => r.status === "rejected")) {
        throw new Error([...errors.values()].join("; "));
      }
      return { legs: [...byDay.values()], complete };
    },
  };
  return { provider: combined, errors, serpBudget };
}
