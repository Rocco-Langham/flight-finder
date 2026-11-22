"use client";

import { useEffect, useRef, useState } from "react";
import { addDays, todayISO } from "@/lib/dates";
import { fmtDate, fmtPrice, fmtTime } from "@/lib/format";
import { POPULAR_PLACES, type HolidayType, type LongHaulPlace } from "@/lib/longhaul";
import type {
  DateWindow,
  HolidayRequest,
  HolidayResponse,
  HolidayTrip,
  SourceStatus,
} from "@/lib/types";
import { DestinationChooser } from "./DestinationChooser";
import { OriginPicker } from "./OriginPicker";
import {
  Chip,
  Field,
  LoadingCard,
  readSearchStream,
  type SearchProgress,
} from "./ui";

// "Further away": long-haul holidays (a week or more, connections allowed),
// within a date range or around school holidays.

interface SchoolHoliday {
  id: string;
  label: string;
  from: string;
  to: string;
}

interface HolidayForm {
  /** Home airports (kept apart from the other tabs: any major UK airport). */
  origins: string[];
  /** Places picked (search or map). Empty = by holiday type, or anywhere far away. */
  chosen: LongHaulPlace[];
  /** Kinds of holiday wanted; used when no places are picked. */
  types: HolidayType[];
  minNights: number;
  maxNights: number;
  dateMode: "holidays" | "range";
  dateFrom: string;
  dateTo: string;
  holidays: SchoolHoliday[];
  /** Days added either side of each school holiday. */
  extendDays: number;
  maxStops: number;
  maxPrice: string;
  people: number;
}

const STORAGE_KEY = "flight-finder:holiday:v1";
/** Travelpayouts lookups run about 5 a second (see PACED_HOSTS in src/lib/http.ts). */
const LOOKUPS_PER_SECOND = 5;

const NIGHT_PRESETS: { label: string; min: number; max: number }[] = [
  { label: "1 week", min: 7, max: 7 },
  { label: "About 10 nights", min: 9, max: 11 },
  { label: "2 weeks", min: 14, max: 14 },
  { label: "1 to 2 weeks", min: 7, max: 14 },
];
const STOPS: { value: number; label: string }[] = [
  { value: 0, label: "Direct only" },
  { value: 1, label: "Up to 1 stop" },
  { value: 2, label: "Any" },
];
const EXTEND_OPTIONS = [0, 1, 2, 3, 4, 5, 7];

function initialForm(): HolidayForm {
  return {
    origins: [],
    chosen: [],
    types: [],
    minNights: 7,
    maxNights: 14,
    dateMode: "holidays",
    dateFrom: "",
    dateTo: "",
    holidays: [],
    extendDays: 2,
    maxStops: 1,
    maxPrice: "",
    people: 1,
  };
}

const newHoliday = (): SchoolHoliday => ({
  id: Math.random().toString(36).slice(2),
  label: "",
  from: "",
  to: "",
});

/** Places to search: those picked, else the popular ones of the chosen kinds, else anywhere ([]). */
function destinationsOf(f: HolidayForm): string[] {
  if (f.chosen.length > 0) return f.chosen.map((p) => p.code);
  if (f.types.length > 0)
    return POPULAR_PLACES.filter((p) => p.types.some((t) => f.types.includes(t))).map((p) => p.code);
  return [];
}

/** The date windows a trip must fit inside. */
function windowsOf(f: HolidayForm): DateWindow[] {
  if (f.dateMode === "range") return [{ from: f.dateFrom, to: f.dateTo }];
  return f.holidays
    .filter((h) => h.from && h.to)
    .map((h) => ({
      from: addDays(h.from, -f.extendDays),
      to: addDays(h.to, f.extendDays),
      label: h.label.trim() || undefined,
    }));
}

function fmtMinutes(min?: number): string | null {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${m ? ` ${m}m` : ""}`;
}

const stopsText = (n: number) =>
  n === 0 ? "direct" : `${n} stop${n === 1 ? "" : "s"}`;

export function HolidaySearch({
  tabs,
  defaultOrigins,
}: {
  /** The mode switcher, shown at the top of the form. */
  tabs: React.ReactNode;
  /** Home airports to start with (from the other tabs), until changed here. */
  defaultOrigins: string[];
}) {
  const [form, setForm] = useState<HolidayForm>(initialForm);
  const origins = form.origins;
  const [hydrated, setHydrated] = useState(false);
  const [source, setSource] = useState<SourceStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HolidayResponse | null>(null);
  const [resultPeople, setResultPeople] = useState(1);
  const [searched, setSearched] = useState<Searched | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Restore saved choices (school holidays included), with fresh default dates.
  useEffect(() => {
    let saved: Partial<HolidayForm> | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    } catch {
      /* ignore corrupt storage */
    }
    const from = addDays(todayISO(), 14);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client init from localStorage + today's date
    setForm((f) => ({
      ...f,
      ...saved,
      holidays: Array.isArray(saved?.holidays) ? saved.holidays : [],
      chosen: Array.isArray(saved?.chosen) ? saved.chosen : [],
      origins: Array.isArray(saved?.origins) ? saved.origins : defaultOrigins,
      types: Array.isArray(saved?.types) ? saved.types : [],
      dateMode:
        saved?.dateMode ?? (saved?.holidays?.length ? "holidays" : "range"),
      dateFrom: from,
      dateTo: addDays(from, 182),
    }));
    setHydrated(true);
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d: { sources: SourceStatus[] }) =>
        setSource(d.sources.find((s) => s.id === "travelpayouts") ?? null),
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once; defaultOrigins only seeds the first visit
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const saved: Partial<HolidayForm> = { ...form };
    delete saved.dateFrom;
    delete saved.dateTo;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }, [form, hydrated]);

  const set = <K extends keyof HolidayForm>(key: K, value: HolidayForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setHoliday = (id: string, patch: Partial<SchoolHoliday>) =>
    set(
      "holidays",
      form.holidays.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    );
  const disabled = source !== null && !source.enabled;

  async function runSearch() {
    setError(null);
    if (origins.length === 0) return setError("Pick at least one home airport.");
    const windows = windowsOf(form);
    if (form.dateMode === "holidays") {
      if (form.holidays.some((h) => (h.from && !h.to) || (!h.from && h.to)))
        return setError("Each school holiday needs a start and an end date.");
      if (windows.length === 0)
        return setError("Add at least one school holiday (start and end dates).");
    }
    if (windows.some((w) => !w.from || !w.to || w.to < w.from))
      return setError("Each date range needs an end after its start.");
    if (form.minNights > form.maxNights)
      return setError("The fewest nights can't be more than the most.");
    const longest = Math.max(
      ...windows.map(
        (w) => (Date.parse(w.to) - Date.parse(w.from)) / 86_400_000,
      ),
    );
    if (longest < form.minNights)
      return setError(
        `None of the dates are long enough for ${form.minNights} nights. Shorten the trip or extend the dates.`,
      );

    const body: HolidayRequest = {
      origins,
      destinations: destinationsOf(form),
      windows,
      minNights: form.minNights,
      maxNights: form.maxNights,
      maxStops: form.maxStops,
      maxPrice: form.maxPrice ? Number(form.maxPrice) : undefined,
    };
    setLoading(true);
    setProgress(null);
    try {
      const res = await fetch("/api/holiday", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setResult(await readSearchStream<HolidayResponse>(res, setProgress));
      setResultPeople(form.people);
      setSearched({ origin: origins[0], places: form.chosen, from: windows[0].from });
      requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <form
        className="space-y-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-sm sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
      >
        {tabs}

        {disabled && (
          <p className="rounded-lg bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            Further-away searches need a free Travelpayouts token, which
            isn&apos;t set up yet. Add <code>TRAVELPAYOUTS_TOKEN</code> to{" "}
            <code>.env</code> and restart the app.
          </p>
        )}

        <Field label="Fly from">
          <OriginPicker origins={origins} onChange={(v) => set("origins", v)} />
        </Field>

        {/* Where */}
        <Field label="Where to">
          <DestinationChooser
            chosen={form.chosen}
            types={form.types}
            onChosen={(v) => set("chosen", v)}
            onTypes={(v) => set("types", v)}
          />
        </Field>

        {/* How long */}
        <Field label="How long">
          <div className="flex flex-wrap items-center gap-2">
            {NIGHT_PRESETS.map((p) => (
              <Chip
                key={p.label}
                small
                active={form.minNights === p.min && form.maxNights === p.max}
                onClick={() =>
                  setForm((f) => ({ ...f, minNights: p.min, maxNights: p.max }))
                }
              >
                {p.label}
              </Chip>
            ))}
            <span className="ml-1 flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
              <input
                type="number"
                min={1}
                max={60}
                value={form.minNights}
                onChange={(e) => set("minNights", Number(e.target.value))}
                aria-label="Fewest nights"
                className="w-16 rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm"
              />
              to
              <input
                type="number"
                min={1}
                max={60}
                value={form.maxNights}
                onChange={(e) => set("maxNights", Number(e.target.value))}
                aria-label="Most nights"
                className="w-16 rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm"
              />
              nights
            </span>
          </div>
        </Field>

        {/* When */}
        <Field label="When">
          <div className="mb-3 flex flex-wrap gap-2">
            <Chip
              small
              active={form.dateMode === "holidays"}
              onClick={() => set("dateMode", "holidays")}
            >
              School holidays
            </Chip>
            <Chip
              small
              active={form.dateMode === "range"}
              onClick={() => set("dateMode", "range")}
            >
              Any dates
            </Chip>
          </div>

          {form.dateMode === "range" ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-500 dark:text-slate-400">
                Leave and come back between
              </span>
              <input
                type="date"
                value={form.dateFrom}
                onChange={(e) => set("dateFrom", e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm"
              />
              <span className="text-slate-400 dark:text-slate-500">and</span>
              <input
                type="date"
                value={form.dateTo}
                min={form.dateFrom}
                onChange={(e) => set("dateTo", e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm"
              />
            </div>
          ) : (
            <div className="space-y-2">
              {form.holidays.map((h) => (
                <div key={h.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <input
                    value={h.label}
                    onChange={(e) => setHoliday(h.id, { label: e.target.value })}
                    placeholder="Name, e.g. Summer"
                    aria-label="Holiday name"
                    className="w-40 rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm"
                  />
                  <input
                    type="date"
                    value={h.from}
                    onChange={(e) => setHoliday(h.id, { from: e.target.value })}
                    aria-label="First day of the holiday"
                    className="rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm"
                  />
                  <span className="text-slate-400 dark:text-slate-500">to</span>
                  <input
                    type="date"
                    value={h.to}
                    min={h.from}
                    onChange={(e) => setHoliday(h.id, { to: e.target.value })}
                    aria-label="Last day of the holiday"
                    className="rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      set(
                        "holidays",
                        form.holidays.filter((x) => x.id !== h.id),
                      )
                    }
                    aria-label="Remove this holiday"
                    className="px-1.5 text-slate-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  onClick={() => set("holidays", [...form.holidays, newHoliday()])}
                  className="text-sm font-medium text-sky-700 dark:text-sky-400 hover:underline"
                >
                  + Add a school holiday
                </button>
                <a
                  href="https://www.gov.uk/school-term-holiday-dates"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-slate-500 dark:text-slate-400 hover:underline"
                >
                  Find your council&apos;s dates ↗
                </a>
              </div>
              <label className="flex flex-wrap items-center gap-2 pt-1 text-sm text-slate-700 dark:text-slate-300">
                Extend the search by
                <select
                  value={form.extendDays}
                  onChange={(e) => set("extendDays", Number(e.target.value))}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-sm"
                >
                  {EXTEND_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n === 0
                        ? "nothing (exact dates)"
                        : `${n} day${n === 1 ? "" : "s"} either side`}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                The whole trip fits inside the holiday
                {form.extendDays > 0 &&
                  `: you can leave up to ${form.extendDays} day${form.extendDays === 1 ? "" : "s"} before it starts and get back up to ${form.extendDays} after it ends`}
                . Saved in this browser for next time.
              </p>
            </div>
          )}
        </Field>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <Field label="Stops">
            <div className="flex flex-wrap gap-1.5">
              {STOPS.map((s) => (
                <Chip
                  key={s.value}
                  small
                  active={form.maxStops === s.value}
                  onClick={() => set("maxStops", s.value)}
                >
                  {s.label}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="People">
            <select
              value={form.people}
              onChange={(e) => set("people", Number(e.target.value))}
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "person" : "people"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Max return fare per person">
            <div className="flex items-center gap-1">
              <span className="text-slate-500 dark:text-slate-400">£</span>
              <input
                type="number"
                min={1}
                value={form.maxPrice}
                onChange={(e) => set("maxPrice", e.target.value)}
                placeholder="No limit"
                className="w-28 rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm"
              />
            </div>
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
          <button
            type="submit"
            disabled={loading || !hydrated || disabled}
            className="rounded-xl bg-sky-600 px-6 py-2.5 font-semibold text-white shadow-sm transition hover:bg-sky-700 disabled:opacity-60"
          >
            {loading ? "Searching…" : "Find cheapest"}
          </button>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Return fares per person, connections allowed · prices from other
            travellers&apos; recent searches (Travelpayouts), so check before
            booking
          </p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </form>

      <div ref={resultsRef} className="scroll-mt-4" />
      {loading && <LoadingCard progress={progress} perSecond={LOOKUPS_PER_SECOND} />}
      {result && (
        <div className={loading ? "pointer-events-none opacity-50 transition" : "transition"}>
          <HolidayResults result={result} people={resultPeople} searched={searched} />
        </div>
      )}
    </div>
  );
}

/** What a search was for, to offer live searches when there are no saved prices. */
interface Searched {
  origin: string;
  places: LongHaulPlace[];
  from: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function googleFlightsSearch(origin: string, place: string, from: string): string {
  const month = `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
  const q = `Flights from ${origin} to ${place} in ${month}`;
  return `https://www.google.com/travel/flights?hl=en-GB&curr=GBP&q=${encodeURIComponent(q)}`;
}

function HolidayResults({
  result,
  people,
  searched,
}: {
  result: HolidayResponse;
  people: number;
  searched: Searched | null;
}) {
  const { trips, warnings, stats } = result;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {trips.length === 0
            ? "No trips found"
            : `${trips.length} option${trips.length === 1 ? "" : "s"}, cheapest first`}
        </h2>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {stats.upstreamCalls + stats.cacheHits} fare lookups ·{" "}
          {(stats.ms / 1000).toFixed(1)}s
        </p>
      </div>
      {warnings.map((w) => (
        <p
          key={w}
          className="rounded-lg bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
        >
          {w}
        </p>
      ))}
      {trips.length === 0 && (
        <div className="space-y-3 rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          <p>
            Nothing matched. Prices here come from other travellers&apos; recent
            searches, so rarely searched routes (and dates many months ahead)
            often have none saved yet. Try more stops, a wider range of nights,
            other dates, or more home airports.
          </p>
          {searched && searched.places.length > 0 && (
            <div>
              <p className="mb-2">Or check live prices on Google Flights:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {searched.places.slice(0, 8).map((p) => (
                  <a
                    key={p.code}
                    href={googleFlightsSearch(searched.origin, p.name, searched.from)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 font-medium text-slate-700 dark:text-slate-300 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-400"
                  >
                    {p.name} ↗
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {trips.map((t) => (
          <HolidayCard
            key={`${t.destination.code}-${t.depart}-${t.returnDepart}`}
            trip={t}
            people={people}
          />
        ))}
      </div>
    </section>
  );
}

function HolidayCard({ trip: t, people }: { trip: HolidayTrip; people: number }) {
  const journey = (stops: number, minutes?: number) =>
    [stopsText(stops), fmtMinutes(minutes)].filter(Boolean).join(", ");
  return (
    <article className="flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {t.destination.city}
            <span className="font-normal text-slate-500 dark:text-slate-400">
              , {t.destination.country}
            </span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t.from.name} ({t.from.code}) → {t.destination.name} (
            {t.destination.code})
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {fmtPrice(t.price, t.currency)}
          </div>
          <div className="text-xs text-slate-400 dark:text-slate-500">
            {people > 1
              ? `each · ${fmtPrice(t.price * people, t.currency)} for ${people}`
              : "return, per person"}
          </div>
        </div>
      </div>

      <div className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
        {fmtDate(t.depart)} → {fmtDate(t.returnDepart)}
        <span className="font-normal text-slate-500 dark:text-slate-400">
          {" "}
          · {t.nights} nights
        </span>
        {t.window && (
          <span className="ml-2 rounded bg-sky-50 dark:bg-sky-950/40 px-1.5 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">
            {t.window}
          </span>
        )}
      </div>
      <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600 dark:text-slate-400">
        <li>
          Out {fmtTime(t.depart)}: {journey(t.stopsOut, t.minutesOut)}
        </li>
        <li>
          Back {fmtTime(t.returnDepart)}: {journey(t.stopsBack, t.minutesBack)}
        </li>
        {(t.airline || t.soldBy) && (
          <li>
            {t.airline &&
              (t.stopsOut + t.stopsBack === 0 ? t.airline : `First flight: ${t.airline}`)}
            {t.airline && t.soldBy && " · "}
            {t.soldBy && `Fare from ${t.soldBy}`}
          </li>
        )}
      </ul>

      <div className="mt-auto flex flex-wrap gap-2 pt-3">
        {t.fareUrl && (
          <a
            href={t.fareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
          >
            See this fare ↗
          </a>
        )}
        <a
          href={t.googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-400"
        >
          Compare on Google Flights ↗
        </a>
      </div>
      {t.stopsOut + t.stopsBack > 0 && (
        <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
          Connecting fares can mix airlines or be separate tickets. Google
          Flights may show a different airline or price.
        </p>
      )}
    </article>
  );
}
