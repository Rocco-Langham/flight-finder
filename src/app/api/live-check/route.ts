import { naiveMs } from "@/lib/dates";
import { inWindow } from "@/lib/providers/common";
import {
  googleFlightsOneWay,
  serpapiSearchesLeft,
} from "@/lib/providers/serpapi";
import type {
  Leg,
  LiveCheckRequest,
  LiveCheckResponse,
  TimeWindow,
} from "@/lib/types";

// "Check live price" on one trip: two Google Flights searches (out and back),
// cached for 3 hours. Reports the same flights' live prices and the cheapest
// direct trip Google has on those dates that still fits the search's rules.

const IATA = /^[A-Z]{3}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function parse(b: unknown): LiveCheckRequest | string {
  const r = b as Partial<LiveCheckRequest> | null;
  const legOk = (l: unknown) => {
    const x = l as LiveCheckRequest["out"] | undefined;
    return x && IATA.test(x.from) && IATA.test(x.to) && DATETIME.test(x.depart);
  };
  const winOk = (w: TimeWindow | undefined) =>
    w && TIME.test(w.from) && TIME.test(w.to);
  if (!r || !legOk(r.out) || !legOk(r.back)) return "Invalid trip.";
  if (
    !Array.isArray(r.origins) ||
    r.origins.length === 0 ||
    !r.origins.every((o) => IATA.test(o))
  )
    return "Invalid home airports.";
  if (!winOk(r.outWindow) || !winOk(r.returnWindow))
    return "Invalid time windows.";
  if (
    typeof r.minHoursAtDestination !== "number" ||
    r.minHoursAtDestination < 0
  )
    return "Invalid minimum time.";
  return { ...r, mixAirports: r.mixAirports !== false } as LiveCheckRequest;
}

const hhmm = (dt: string) => dt.slice(11, 16);
const sameFlight = (leg: Leg, want: LiveCheckRequest["out"]) =>
  leg.from.code === want.from &&
  leg.to.code === want.to &&
  (hhmm(leg.depart) === hhmm(want.depart) ||
    (want.flightNumber !== "" &&
      leg.flightNumber.toUpperCase() === want.flightNumber.toUpperCase()));

export async function POST(request: Request) {
  const key = process.env.SERPAPI_KEY?.trim();
  if (!key)
    return Response.json(
      { error: "Add SERPAPI_KEY to .env.local to check live prices." },
      { status: 400 },
    );
  const req = parse(await request.json().catch(() => null));
  if (typeof req === "string")
    return Response.json({ error: req }, { status: 400 });

  const dest = req.out.to;
  const outHomes = req.mixAirports ? req.origins : [req.out.from];
  const backHomes = req.mixAirports ? req.origins : [req.out.from];
  try {
    const [outs, backs] = await Promise.all([
      googleFlightsOneWay(key, {
        from: [...new Set([...outHomes, req.out.from])],
        to: [dest],
        date: req.out.depart.slice(0, 10),
      }),
      googleFlightsOneWay(key, {
        from: [dest],
        to: [...new Set([...backHomes, req.back.to])],
        date: req.back.depart.slice(0, 10),
      }),
    ]);

    const sameOut = outs.find((l) => sameFlight(l, req.out));
    const sameBack = backs.find((l) => sameFlight(l, req.back));

    // Cheapest pairing that fits the search's windows and time at the destination.
    let best: LiveCheckResponse["best"];
    for (const o of outs) {
      if (!outHomes.includes(o.from.code) || !inWindow(o.depart, req.outWindow))
        continue;
      for (const b of backs) {
        if (!inWindow(b.depart, req.returnWindow)) continue;
        if (
          req.mixAirports
            ? !req.origins.includes(b.to.code)
            : b.to.code !== o.from.code
        )
          continue;
        const hours = (naiveMs(b.depart) - naiveMs(o.arrive)) / 3_600_000;
        if (hours < req.minHoursAtDestination) continue;
        const total = Math.round((o.price + b.price) * 100) / 100;
        if (!best || total < best.total)
          best = {
            out: o,
            back: b,
            total,
            hoursAtDestination: Math.round(hours * 10) / 10,
          };
      }
    }

    const body: LiveCheckResponse = {
      sameOut,
      sameBack,
      sameTotal:
        sameOut && sameBack
          ? Math.round((sameOut.price + sameBack.price) * 100) / 100
          : undefined,
      best,
      searchesLeft: await serpapiSearchesLeft(key),
      checkedAt: new Date().toISOString(),
    };
    return Response.json(body);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Live check failed." },
      { status: 502 },
    );
  }
}
