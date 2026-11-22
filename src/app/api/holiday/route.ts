import { airportInfo } from "@/lib/airports";
import { addDays } from "@/lib/dates";
import { holidayResponse, holidaySearch } from "@/lib/holiday";
import { newStats } from "@/lib/http";
import { travelpayoutsRoundTrips } from "@/lib/providers/travelpayouts";
import { streamSearch } from "@/lib/stream";
import type { DateWindow, HolidayRequest } from "@/lib/types";

const CODE = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Travelpayouts only has fares about a year ahead. */
const MAX_DAYS_AHEAD = 365;

function parse(body: unknown): HolidayRequest | string {
  if (!body || typeof body !== "object") return "Body must be JSON.";
  const b = body as Record<string, unknown>;
  const codes = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.map(String).map((s) => s.toUpperCase()))] : [];

  const origins = codes(b.origins);
  if (origins.length === 0 || origins.length > 8 || !origins.every((o) => CODE.test(o))) {
    return "Pick 1-8 home airports.";
  }
  const destinations = codes(b.destinations);
  if (destinations.length > 100 || !destinations.every((d) => CODE.test(d))) return "Invalid destinations.";

  const today = new Date().toISOString().slice(0, 10);
  const windows: DateWindow[] = [];
  for (const w of Array.isArray(b.windows) ? b.windows : []) {
    const from = String(w?.from ?? "");
    const to = String(w?.to ?? "");
    if (!DATE.test(from) || !DATE.test(to) || to < from) return "Each date range needs a start and an end after it.";
    if (to < today) continue; // already over
    windows.push({
      from: from < today ? today : from,
      to: to > addDays(today, MAX_DAYS_AHEAD) ? addDays(today, MAX_DAYS_AHEAD) : to,
      label: typeof w?.label === "string" ? w.label.slice(0, 40) : undefined,
    });
  }
  if (windows.length === 0) return "Add at least one date range or school holiday that hasn't already ended.";
  if (windows.length > 12) return "Too many date ranges (12 at most).";

  const minNights = Number(b.minNights);
  const maxNights = Number(b.maxNights);
  if (!Number.isInteger(minNights) || !Number.isInteger(maxNights) || minNights < 1 || maxNights > 60 || maxNights < minNights) {
    return "Nights must be whole numbers, 1-60, with the minimum no more than the maximum.";
  }
  const maxStops = Number(b.maxStops);
  if (![0, 1, 2].includes(maxStops)) return "Invalid stops.";
  const maxPrice = b.maxPrice === undefined || b.maxPrice === null || b.maxPrice === "" ? undefined : Number(b.maxPrice);
  if (maxPrice !== undefined && (!Number.isFinite(maxPrice) || maxPrice <= 0)) return "Invalid max price.";

  return { origins, destinations, windows, minNights, maxNights, maxStops, maxPrice };
}

export async function POST(request: Request) {
  const req = parse(await request.json().catch(() => null));
  if (typeof req === "string") return Response.json({ error: req }, { status: 400 });
  const token = process.env.TRAVELPAYOUTS_TOKEN?.trim();
  if (!token) {
    return Response.json(
      { error: "Further-away searches need a Travelpayouts token (TRAVELPAYOUTS_TOKEN). It isn't set up yet." },
      { status: 503 },
    );
  }

  const stats = newStats();
  const started = Date.now();
  const errors = new Set<string>();
  return streamSearch(stats, async (signal) => {
    const result = await holidaySearch(
      req,
      travelpayoutsRoundTrips(token, stats),
      airportInfo,
      (e) => {
        if (e instanceof Error && /token|Travelpayouts/.test(e.message)) errors.add(e.message);
      },
      signal,
    );
    return holidayResponse(result, errors, stats, started);
  });
}
