"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_OUTBOUND_DATES } from "@/lib/limits";
import {
  countOutboundDates,
  DAY_LABELS,
  DEFAULT_HOMES,
  defaultRange,
  PRESETS,
  UK_AIRPORTS,
  type TripPreset,
} from "@/lib/presets";
import type {
  CountryFilter as CountryFilterValue,
  SearchMode,
  SearchRequest,
  SearchResponse,
  SourceStatus,
  TimeWindow,
} from "@/lib/types";
import { addDays } from "@/lib/dates";
import {
  CountryFilter,
  passesCountryFilter,
  type Country,
} from "./CountryFilter";
import {
  DestinationPicker,
  type Destination,
  type PickerAirport,
} from "./DestinationPicker";
import { LiveCheckContext, type LiveRules } from "./LiveCheck";
import { HolidaySearch } from "./HolidaySearch";
import { SavedList, useSavedCount } from "./Saved";
import { Results } from "./Results";
import {
  Chip,
  Field,
  LoadingCard,
  readSearchStream,
  type SearchProgress,
} from "./ui";

interface FormState {
  mode: SearchMode | "holiday" | "saved";
  preset: TripPreset;
  origins: string[];
  destination: Destination | null;
  dateFrom: string;
  dateTo: string;
  outDays: number[];
  nights: number[];
  outWindow: TimeWindow;
  returnWindow: TimeWindow;
  minHoursAtDestination: number;
  maxPrice: string;
  mixAirports: boolean;
  people: number;
  countryFilter: CountryFilterValue;
  liveCheck: boolean;
}

interface Sources {
  sources: SourceStatus[];
  serpapiMaxCallsPerSearch: number;
}

const STORAGE_KEY = "flight-finder:form:v1";

function initialForm(): FormState {
  const p = PRESETS.day;
  return {
    mode: "explore",
    preset: "day",
    origins: DEFAULT_HOMES,
    destination: null,
    // Filled in on the client (dates depend on "today", so they can't be prerendered).
    dateFrom: "",
    dateTo: "",
    outDays: p.outDays,
    nights: p.nights,
    outWindow: p.outWindow,
    returnWindow: p.returnWindow,
    minHoursAtDestination: p.minHoursAtDestination,
    maxPrice: "",
    mixAirports: true,
    people: 1,
    countryFilter: { mode: "exclude", codes: [] },
    liveCheck: false,
  };
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function FlightSearch() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [showAllAirports, setShowAllAirports] = useState(false);
  const [airports, setAirports] = useState<PickerAirport[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [sources, setSources] = useState<Sources | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [resultLabel, setResultLabel] = useState("");
  const [resultRules, setResultRules] = useState<LiveRules | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Restore saved preferences (home airports, preset, times), but always use fresh dates.
  useEffect(() => {
    let saved: Partial<FormState> | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    } catch {
      /* ignore corrupt storage */
    }
    const preset =
      saved?.preset && saved.preset in PRESETS ? saved.preset : "day";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client init from localStorage + today's date
    setForm((f) => ({
      ...f,
      ...saved,
      preset,
      countryFilter: saved?.countryFilter?.codes
        ? saved.countryFilter
        : f.countryFilter,
      destination: Array.isArray(saved?.destination?.codes)
        ? saved.destination
        : null,
      ...defaultRange(PRESETS[preset].rangeDays),
    }));
    if (saved?.origins?.some((o) => !DEFAULT_HOMES.includes(o)))
      setShowAllAirports(true);
    setHydrated(true);
    const load = <T,>(url: string, then: (v: T) => void) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then(then)
        .catch(() => {});
    // Versioned so browsers drop old cached copies when the shape changes.
    load("/api/airports?v=2", setAirports);
    load("/api/countries", setCountries);
    load("/api/sources", setSources);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    // Dates go stale, so they're not saved.
    const saved: Partial<FormState> = { ...form };
    delete saved.dateFrom;
    delete saved.dateTo;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }, [form, hydrated]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const choosePreset = (preset: TripPreset) => {
    const p = PRESETS[preset];
    setForm((f) => ({
      ...f,
      preset,
      outDays: p.outDays,
      nights: p.nights,
      outWindow: p.outWindow,
      returnWindow: p.returnWindow,
      minHoursAtDestination: p.minHoursAtDestination,
      ...defaultRange(p.rangeDays),
    }));
  };

  const dateCount = useMemo(
    () => countOutboundDates(form.dateFrom, form.dateTo, form.outDays),
    [form.dateFrom, form.dateTo, form.outDays],
  );

  const visibleAirports = showAllAirports
    ? UK_AIRPORTS
    : UK_AIRPORTS.filter(
        (a) => DEFAULT_HOMES.includes(a.code) || form.origins.includes(a.code),
      );

  const source = (id: SourceStatus["id"]) =>
    sources?.sources.find((s) => s.id === id);
  const serpEnabled = source("serpapi")?.enabled ?? false;
  const liveCheckCalls = Math.min(
    sources?.serpapiMaxCallsPerSearch ?? 30,
    Math.min(dateCount, MAX_OUTBOUND_DATES) * (1 + form.nights.length),
  );

  // Countries in the latest results (before the client-side filter), for quick picks.
  const resultCountries = useMemo(() => {
    const counts = new Map<
      string,
      { code: string; name: string; count: number }
    >();
    if (result?.mode !== "explore") return [];
    for (const t of [...result.trips, ...result.nearMisses]) {
      const { countryCode: code, country: name } = t.destination;
      if (!code) continue;
      const c = counts.get(code) ?? { code, name, count: 0 };
      c.count++;
      counts.set(code, c);
    }
    return [...counts.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    );
  }, [result]);

  // Apply the country filter to results already on screen, so changes show instantly.
  const shownResult = useMemo(() => {
    if (!result || result.mode !== "explore") return result;
    const keep = (t: SearchResponse["trips"][number]) =>
      passesCountryFilter(form.countryFilter, t.destination.countryCode);
    return {
      ...result,
      trips: result.trips.filter(keep),
      nearMisses: result.nearMisses.filter(keep),
    };
  }, [result, form.countryFilter]);

  async function runSearch(override?: Partial<FormState>) {
    const f = { ...form, ...override };
    if (override) setForm(f);
    setError(null);
    if (f.origins.length === 0)
      return setError("Pick at least one home airport.");
    if (f.mode === "route" && !f.destination?.codes.length) {
      return setError("Pick a destination.");
    }
    setLoading(true);
    setProgress(null);
    const body: SearchRequest = {
      mode: f.mode === "route" ? "route" : "explore",
      origins: f.origins,
      destinations: f.mode === "route" ? f.destination?.codes : undefined,
      dateFrom: f.dateFrom,
      dateTo: f.dateTo,
      outDays: f.outDays,
      nights: f.nights,
      outWindow: f.outWindow,
      returnWindow: f.returnWindow,
      minHoursAtDestination: f.minHoursAtDestination,
      maxPrice: f.maxPrice ? Number(f.maxPrice) : undefined,
      mixAirports: f.mixAirports,
      countryFilter:
        f.countryFilter.codes.length > 0 ? f.countryFilter : undefined,
      liveCheck: f.mode === "route" && f.liveCheck && serpEnabled,
    };
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readSearchStream<SearchResponse>(res, setProgress);
      setResult(data);
      setResultLabel(f.mode === "route" ? (f.destination?.label ?? "") : "");
      setResultRules({
        origins: body.origins,
        outWindow: body.outWindow,
        returnWindow: body.returnWindow,
        minHoursAtDestination: body.minHoursAtDestination,
        mixAirports: body.mixAirports,
      });
      requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  const isDayTrip = form.nights.length === 1 && form.nights[0] === 0;

  const savedCount = useSavedCount();
  const modeTabs = (
    <div className="flex gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
      {(
        [
          ["explore", "Anywhere cheap"],
          ["route", "Pick a destination"],
          ["holiday", "Further away"],
          ["saved", savedCount ? `★ Saved (${savedCount})` : "★ Saved"],
        ] as const
      ).map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          onClick={() => set("mode", mode)}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
            form.mode === mode
              ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
  const homeAirports = (
    <div className="flex flex-wrap gap-2">
      {visibleAirports.map((a) => (
        <Chip
          key={a.code}
          active={form.origins.includes(a.code)}
          onClick={() => set("origins", toggle(form.origins, a.code))}
        >
          {a.name} <span className="opacity-60">{a.code}</span>
        </Chip>
      ))}
      <button
        type="button"
        onClick={() => setShowAllAirports((s) => !s)}
        className="px-2 text-sm text-sky-700 dark:text-sky-400 hover:underline"
      >
        {showAllAirports ? "Fewer airports" : "More airports…"}
      </button>
    </div>
  );

  if (form.mode === "saved") return <SavedList tabs={modeTabs} />;

  if (form.mode === "holiday") {
    return (
      <HolidaySearch
        tabs={modeTabs}
        defaultOrigins={form.origins}
      />
    );
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
        {/* Mode */}
        {modeTabs}

        {/* Trip type */}
        <Field label="Trip">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(PRESETS) as TripPreset[]).map((key) => (
              <Chip
                key={key}
                active={form.preset === key}
                onClick={() => choosePreset(key)}
                title={PRESETS[key].hint}
              >
                {PRESETS[key].label}
              </Chip>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {PRESETS[form.preset].hint}
          </p>
        </Field>

        {/* Home airports */}
        <Field label="Fly from">
          {homeAirports}
        </Field>

        {/* Destination */}
        {form.mode === "route" && (
          <Field label="Destination">
            <DestinationPicker
              airports={airports}
              countries={countries}
              value={form.destination}
              onPick={(d) => set("destination", d)}
              onPickCountry={(code) =>
                setForm((f) => ({
                  ...f,
                  mode: "explore",
                  countryFilter: { mode: "include", codes: [code] },
                }))
              }
            />
          </Field>
        )}

        {/* Countries (explore only) */}
        {form.mode === "explore" && (
          <Field label="Countries">
            <CountryFilter
              value={form.countryFilter}
              onChange={(v) => set("countryFilter", v)}
              countries={countries}
              inResults={resultCountries}
            />
          </Field>
        )}

        {/* Dates */}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Outbound between">
            <div className="flex items-center gap-2">
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
            <p
              className={`mt-1.5 text-xs ${dateCount > MAX_OUTBOUND_DATES ? "text-amber-700 dark:text-amber-400" : "text-slate-500 dark:text-slate-400"}`}
            >
              {dateCount} outbound date{dateCount === 1 ? "" : "s"}
              {dateCount > MAX_OUTBOUND_DATES &&
                `: only the first ${MAX_OUTBOUND_DATES} will be searched`}
              {form.dateFrom && (
                <span className="ml-2">
                  {(
                    [
                      [1, "1 month"],
                      [3, "3 months"],
                      [6, "6 months"],
                    ] as const
                  ).map(([months, label]) => (
                    <button
                      key={months}
                      type="button"
                      onClick={() =>
                        set("dateTo", addMonths(form.dateFrom, months))
                      }
                      className="ml-1.5 text-sky-700 dark:text-sky-400 hover:underline"
                    >
                      {label}
                    </button>
                  ))}
                </span>
              )}
            </p>
          </Field>

          {(form.preset === "custom" || form.preset === "day") && (
            <Field label="Fly out on">
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <Chip
                    key={d}
                    small
                    active={form.outDays.includes(d)}
                    onClick={() => set("outDays", toggle(form.outDays, d))}
                  >
                    {DAY_LABELS[d]}
                  </Chip>
                ))}
              </div>
            </Field>
          )}
        </div>

        {form.preset === "custom" && (
          <Field label="Nights away">
            <div className="flex flex-wrap gap-1.5">
              {[0, 1, 2, 3, 4].map((n) => (
                <Chip
                  key={n}
                  small
                  active={form.nights.includes(n)}
                  onClick={() => set("nights", toggle(form.nights, n).sort())}
                >
                  {n === 0 ? "Same day" : `${n} night${n > 1 ? "s" : ""}`}
                </Chip>
              ))}
            </div>
          </Field>
        )}

        {/* Times */}
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Outbound departs">
            <TimeRange
              value={form.outWindow}
              onChange={(v) => set("outWindow", v)}
            />
          </Field>
          <Field label="Return departs">
            <TimeRange
              value={form.returnWindow}
              onChange={(v) => set("returnWindow", v)}
            />
          </Field>
          <Field
            label={
              isDayTrip ? "At least this long there" : "Min. time after landing"
            }
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={24}
                step={0.5}
                value={form.minHoursAtDestination}
                onChange={(e) =>
                  set("minHoursAtDestination", Number(e.target.value))
                }
                className="w-20 rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm"
              />
              <span className="text-sm text-slate-500 dark:text-slate-400">
                hours
              </span>
            </div>
          </Field>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
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
          <Field label="Max price per person">
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
          <label className="flex cursor-pointer items-center gap-2 pb-1.5 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.mixAirports}
              onChange={(e) => set("mixAirports", e.target.checked)}
              className="size-4 accent-sky-600"
            />
            Can return to a different home airport
          </label>
          {form.mode === "route" && (
            <label
              className={`flex items-start gap-2 pb-1.5 text-sm ${serpEnabled ? "cursor-pointer text-slate-700 dark:text-slate-300" : "text-slate-400 dark:text-slate-500"}`}
              title={serpEnabled ? undefined : source("serpapi")?.note}
            >
              <input
                type="checkbox"
                disabled={!serpEnabled}
                checked={form.liveCheck && serpEnabled}
                onChange={(e) => set("liveCheck", e.target.checked)}
                className="mt-0.5 size-4 accent-sky-600"
              />
              <span>
                Live Google Flights check (easyJet, Jet2 &amp; more)
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {serpEnabled
                    ? `Uses up to ${liveCheckCalls} of your SerpApi searches (repeats within 3h are free)`
                    : "Add SERPAPI_KEY to .env.local to turn on"}
                </span>
              </span>
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
          <button
            type="submit"
            disabled={loading || !hydrated}
            className="rounded-xl bg-sky-600 px-6 py-2.5 font-semibold text-white shadow-sm transition hover:bg-sky-700 disabled:opacity-60"
          >
            {loading ? "Searching…" : "Find cheapest"}
          </button>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            <p>
              Direct flights · price per person · cheapest fare (small
              under-seat bag only)
            </p>
            {sources && (
              <p className="mt-0.5">
                Prices from:{" "}
                {sources.sources
                  .filter((s) => s.id !== "serpapi")
                  .map((s) => (
                    <span
                      key={s.id}
                      className={
                        s.enabled
                          ? "text-slate-600 dark:text-slate-400"
                          : "text-slate-400 dark:text-slate-500"
                      }
                      title={s.note}
                    >
                      {s.enabled ? "✓" : "✗"} {s.name}
                      {s.id === "travelpayouts" &&
                        s.enabled &&
                        " (recent prices)"}
                      {s.id === "travelpayouts" &&
                        !s.enabled &&
                        " (not set up)"}
                    </span>
                  ))
                  .reduce<React.ReactNode[]>(
                    (acc, el, i) => (i ? [...acc, " · ", el] : [el]),
                    [],
                  )}
              </p>
            )}
          </div>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </form>

      <div ref={resultsRef} className="scroll-mt-4" />
      {loading && <LoadingCard progress={progress} />}
      {shownResult && (
        <div
          className={
            loading ? "pointer-events-none opacity-50 transition" : "transition"
          }
        >
          <LiveCheckContext.Provider
            value={
              resultRules && {
                rules: resultRules,
                enabled: serpEnabled,
                people: form.people,
              }
            }
          >
            <Results
              result={shownResult}
              routeLabel={resultLabel}
              onSeeAllDates={(a) =>
                runSearch({
                  mode: "route",
                  destination: {
                    label: `${a.name} (${a.code})`,
                    codes: [a.code],
                  },
                })
              }
            />
          </LiveCheckContext.Provider>
        </div>
      )}
    </div>
  );
}

/** Same day N months later, minus one day (so "1 month" from 5 Jan ends 4 Feb). */
function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return addDays(d.toISOString().slice(0, 10), -1);
}



function TimeRange({
  value,
  onChange,
}: {
  value: TimeWindow;
  onChange: (v: TimeWindow) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="time"
        value={value.from}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
        className="rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm"
      />
      <span className="text-slate-400 dark:text-slate-500">–</span>
      <input
        type="time"
        value={value.to}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
        className="rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm"
      />
    </div>
  );
}




