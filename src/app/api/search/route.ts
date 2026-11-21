import { newStats } from "@/lib/http";
import { providers } from "@/lib/providers";
import { search } from "@/lib/search";
import type { SearchRequest } from "@/lib/types";

const IATA = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function parse(body: unknown): SearchRequest | string {
  if (!body || typeof body !== "object") return "Body must be JSON.";
  const b = body as Record<string, unknown>;
  const mode = b.mode === "route" ? "route" : b.mode === "explore" ? "explore" : null;
  if (!mode) return "mode must be 'explore' or 'route'.";

  const origins = Array.isArray(b.origins) ? b.origins.map(String).map((s) => s.toUpperCase()) : [];
  if (origins.length === 0 || origins.length > 8 || !origins.every((o) => IATA.test(o))) {
    return "origins must be 1-8 airport codes.";
  }
  const rawDest = Array.isArray(b.destinations) ? b.destinations : typeof b.destination === "string" ? [b.destination] : [];
  const destinations = [...new Set(rawDest.map(String).map((s) => s.toUpperCase()))];
  if (mode === "route" && (destinations.length === 0 || destinations.length > 10 || !destinations.every((d) => IATA.test(d)))) {
    return "Route search needs 1-10 destination airports.";
  }

  const dateFrom = String(b.dateFrom ?? "");
  const dateTo = String(b.dateTo ?? "");
  if (!DATE.test(dateFrom) || !DATE.test(dateTo) || dateTo < dateFrom) return "Invalid date range.";

  const ints = (v: unknown, min: number, max: number) =>
    Array.isArray(v) ? [...new Set(v.map(Number))].filter((n) => Number.isInteger(n) && n >= min && n <= max) : [];
  const outDays = ints(b.outDays, 0, 6);
  const nights = ints(b.nights, 0, 14);
  if (outDays.length === 0) return "Pick at least one day to fly out.";
  if (nights.length === 0) return "Pick at least one trip length.";

  const window = (v: unknown) => {
    const w = v as { from?: unknown; to?: unknown } | undefined;
    const from = String(w?.from ?? "");
    const to = String(w?.to ?? "");
    return TIME.test(from) && TIME.test(to) && from <= to ? { from, to } : null;
  };
  const outWindow = window(b.outWindow);
  const returnWindow = window(b.returnWindow);
  if (!outWindow || !returnWindow) return "Time windows must be HH:MM with start before end.";

  const minHours = Number(b.minHoursAtDestination ?? 0);
  const maxPrice = b.maxPrice === undefined || b.maxPrice === null || b.maxPrice === "" ? undefined : Number(b.maxPrice);
  if (!Number.isFinite(minHours) || minHours < 0 || minHours > 48) return "Invalid minimum time at destination.";
  if (maxPrice !== undefined && (!Number.isFinite(maxPrice) || maxPrice <= 0)) return "Invalid max price.";

  const cf = b.countryFilter as { mode?: unknown; codes?: unknown } | undefined;
  const countryCodes = Array.isArray(cf?.codes)
    ? [...new Set(cf.codes.map(String).map((c) => c.toUpperCase()))].filter((c) => /^[A-Z]{2}$/.test(c))
    : [];
  if (countryCodes.length > 300) return "Too many countries.";
  const countryFilter =
    countryCodes.length > 0
      ? { mode: cf?.mode === "include" ? ("include" as const) : ("exclude" as const), codes: countryCodes }
      : undefined;

  return {
    mode,
    origins: [...new Set(origins)],
    destinations: mode === "route" ? destinations : undefined,
    dateFrom,
    dateTo,
    outDays,
    nights,
    outWindow,
    returnWindow,
    minHoursAtDestination: minHours,
    maxPrice,
    mixAirports: b.mixAirports !== false,
    countryFilter,
    liveCheck: mode === "route" && b.liveCheck === true,
  };
}

export async function POST(request: Request) {
  const req = parse(await request.json().catch(() => null));
  if (typeof req === "string") return Response.json({ error: req }, { status: 400 });

  const stats = newStats();
  try {
    const set = providers(stats, { liveCheck: req.liveCheck === true });
    return Response.json(await search(req, set, stats));
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Search failed. The fare source may be busy, so try again shortly." }, { status: 502 });
  }
}
