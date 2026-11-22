"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { addDays, todayISO } from "@/lib/dates";
import { fmtDate, fmtPrice } from "@/lib/format";
import { HOLIDAY_TYPES } from "@/lib/longhaul";
import { PRESETS } from "@/lib/presets";
import type { HolidayResponse, SearchResponse } from "@/lib/types";
import type { FormState } from "./FlightSearch";
import type { HolidayForm, Searched } from "./HolidaySearch";
import type { LiveRules } from "./LiveCheck";

// Saved searches: every setting of a search, kept in this browser, to run
// again later from the Saved tab.

const KEY = "flight-finder:saved-searches:v1";
const EVENT = "flight-finder:saved-searches-changed";

/** Results kept with a search, to look at again without searching. */
export interface ShortSnapshot {
  result: SearchResponse;
  label: string;
  rules: LiveRules | null;
  people: number;
}
export interface HolidaySnapshot {
  result: HolidayResponse;
  people: number;
  searched: Searched | null;
}

export type SavedSearch = {
  id: string;
  name: string;
  savedAt: string;
  /** Cheapest result (per person) when saved, if there were results. */
  cheapest?: number;
  /** The last "Run again". */
  lastRun?: { at: string; cheapest?: number };
} & (
  | { kind: "short"; form: FormState; results?: { at: string; snapshot: ShortSnapshot } }
  | { kind: "holiday"; form: HolidayForm; results?: { at: string; snapshot: HolidaySnapshot } }
);

let cache: SavedSearch[] | null = null;
let cacheRaw: string | null = null;
const EMPTY: SavedSearch[] = [];

function read(): SavedSearch[] {
  const raw = localStorage.getItem(KEY);
  if (raw === cacheRaw && cache) return cache;
  cacheRaw = raw;
  try {
    const list = JSON.parse(raw ?? "[]");
    cache = Array.isArray(list) ? list : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** False if the browser's storage is full (saved results can be large). */
function write(list: SavedSearch[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(EVENT));
  return true;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useSavedSearches() {
  const searches = useSyncExternalStore(subscribe, read, () => EMPTY);
  const add = useCallback((s: SavedSearch) => write([s, ...read()]), []);
  const update = useCallback(
    (id: string, patch: Partial<Pick<SavedSearch, "name" | "lastRun" | "cheapest">> & { results?: SavedSearch["results"] }) =>
      write(read().map((s) => (s.id === id ? ({ ...s, ...patch } as SavedSearch) : s))),
    [],
  );
  const remove = useCallback((id: string) => write(read().filter((s) => s.id !== id)), []);
  return { searches, add, update, remove };
}

const range = (from: string, to: string) =>
  from && to ? `${fmtDate(from)} – ${fmtDate(to)}` : "";

/** A readable name for a search, e.g. "Day trip · anywhere · from MAN, LPL · 23 Nov – 20 Dec". */
export function describeShort(f: FormState): string {
  const what = f.mode === "route" ? (f.destination?.label ?? "a destination") : "anywhere";
  return [PRESETS[f.preset]?.label ?? "Trip", what, `from ${f.origins.join(", ")}`, range(f.dateFrom, f.dateTo)]
    .filter(Boolean)
    .join(" · ");
}

export function describeHoliday(f: HolidayForm): string {
  const where =
    f.chosen.length > 0
      ? f.chosen.length > 3
        ? `${f.chosen
            .slice(0, 3)
            .map((p) => p.name)
            .join(", ")} +${f.chosen.length - 3}`
        : f.chosen.map((p) => p.name).join(", ")
      : f.types.length > 0
        ? f.types.map((t) => HOLIDAY_TYPES.find((x) => x.id === t)?.label ?? t).join(", ")
        : "Anywhere far away";
  const nights = f.minNights === f.maxNights ? `${f.minNights} nights` : `${f.minNights}–${f.maxNights} nights`;
  const when =
    f.dateMode === "holidays"
      ? f.holidays.map((h) => h.label || range(h.from, h.to)).filter(Boolean).join(", ") || "school holidays"
      : range(f.dateFrom, f.dateTo);
  return [where, `from ${f.origins.join(", ")}`, nights, when].filter(Boolean).join(" · ");
}

/** Dates that have passed move to start tomorrow, keeping the same length. */
export function freshDates(from: string, to: string): { dateFrom: string; dateTo: string } {
  const tomorrow = addDays(todayISO(), 1);
  if (!from || from >= tomorrow) return { dateFrom: from, dateTo: to };
  const days = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));
  return { dateFrom: tomorrow, dateTo: addDays(tomorrow, days) };
}

/**
 * "☆ Save this search" next to Find cheapest. With results on screen it offers
 * to keep them too.
 */
export function SaveSearchButton({
  make,
  snapshot,
}: {
  make: () => Omit<SavedSearch, "id" | "savedAt" | "results">;
  /** The results on screen, if any, to keep with the search. */
  snapshot: () => { count: number; data: ShortSnapshot | HolidaySnapshot } | null;
}) {
  const { add } = useSavedSearches();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const snap = open ? snapshot() : null;

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const save = (withResults: boolean) => {
    const now = new Date().toISOString();
    const base = { ...make(), id: Math.random().toString(36).slice(2), savedAt: now };
    const s = snapshot();
    const item = (withResults && s ? { ...base, results: { at: now, snapshot: s.data } } : base) as SavedSearch;
    let ok = add(item);
    if (!ok && withResults) ok = add(base as SavedSearch); // too big to keep the results
    setOpen(false);
    setMessage(
      !ok
        ? "Couldn't save: this browser's storage is full"
        : withResults && !item.results
          ? "★ Saved"
          : withResults
            ? "★ Saved with results"
            : "★ Saved to the Saved tab",
    );
    setTimeout(() => setMessage(null), 2500);
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => (snapshot() ? setOpen((o) => !o) : save(false))}
        aria-expanded={open}
        title="Keep this search (and its results, if you like) in the Saved tab"
        className="rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:border-amber-400 hover:text-amber-700 dark:hover:text-amber-300"
      >
        {message ?? "☆ Save this search"}
        {!message && snapshot() && <span className="ml-1 text-xs">▾</span>}
      </button>
      {open && snap && (
        <div className="absolute left-0 z-[1000] mt-1 w-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1 text-sm shadow-lg">
          <button
            type="button"
            onClick={() => save(true)}
            className="block w-full px-3 py-2 text-left hover:bg-sky-50 dark:hover:bg-sky-950/50"
          >
            <span className="font-medium text-slate-800 dark:text-slate-200">Search + these results</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              Keep the {snap.count} result{snap.count === 1 ? "" : "s"} to look at later, and run it again any time
            </span>
          </button>
          <button
            type="button"
            onClick={() => save(false)}
            className="block w-full px-3 py-2 text-left hover:bg-sky-50 dark:hover:bg-sky-950/50"
          >
            <span className="font-medium text-slate-800 dark:text-slate-200">Search only</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              Keep the settings, to run it again for fresh prices
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Saved searches, at the top of the Saved tab. */
export function SavedSearchList({
  onRun,
  onView,
}: {
  onRun: (s: SavedSearch) => void;
  /** Show a search's saved results. */
  onView: (s: SavedSearch) => void;
}) {
  const { searches, update, remove } = useSavedSearches();
  const [editing, setEditing] = useState<string | null>(null);
  if (searches.length === 0) return null;
  return (
    <section className="space-y-3">
      <h3 className="px-1 text-sm font-semibold text-slate-700 dark:text-slate-300">
        Saved searches ({searches.length})
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {searches.map((s) => {
          const outOfDate =
            s.kind === "short"
              ? s.form.dateTo && s.form.dateTo < todayISO()
              : s.form.dateMode === "range"
                ? s.form.dateTo && s.form.dateTo < todayISO()
                : s.form.holidays.length > 0 && s.form.holidays.every((h) => h.to && h.to < todayISO());
          return (
            <article
              key={s.id}
              className="flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-sm"
            >
              {editing === s.id ? (
                <input
                  autoFocus
                  defaultValue={s.name}
                  aria-label="Search name"
                  onBlur={(e) => {
                    update(s.id, { name: e.target.value.trim() || s.name });
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm"
                />
              ) : (
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {s.name}{" "}
                  <button
                    type="button"
                    onClick={() => setEditing(s.id)}
                    className="ml-1 text-xs font-normal text-slate-400 hover:text-sky-700 dark:hover:text-sky-400"
                    aria-label="Rename"
                  >
                    ✎ Rename
                  </button>
                </h4>
              )}
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {s.kind === "holiday" ? "Further away" : s.form.mode === "route" ? "Pick a destination" : "Anywhere cheap"}
                {" · saved "}
                {fmtDate(s.savedAt.slice(0, 10))}
                {s.cheapest !== undefined && ` · cheapest then ${fmtPrice(s.cheapest)}`}
                {s.lastRun?.cheapest !== undefined &&
                  ` · ${fmtPrice(s.lastRun.cheapest)} on ${fmtDate(s.lastRun.at.slice(0, 10))}`}
              </p>
              {outOfDate && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  {s.kind === "holiday" && s.form.dateMode === "holidays"
                    ? "These school holidays have passed: run it, then add new dates."
                    : "These dates have passed, so it will search the same length of time from tomorrow."}
                </p>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => onRun(s)}
                  className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
                >
                  ↻ Run again
                </button>
                {s.results && (
                  <button
                    type="button"
                    onClick={() => onView(s)}
                    className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-400"
                  >
                    📄 View saved results ({fmtDate(s.results.at.slice(0, 10))})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  className="ml-auto text-xs text-slate-500 dark:text-slate-400 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** Shown above the results of a re-run saved search: how the price has moved. */
export function RerunNote({
  search,
  cheapestNow,
  onSaveResults,
}: {
  search: SavedSearch;
  cheapestNow?: number;
  /** Keep these fresh results with the saved search. */
  onSaveResults?: () => boolean;
}) {
  const [saved, setSaved] = useState<"yes" | "full" | null>(null);
  const was = search.cheapest;
  let change = "";
  if (was !== undefined && cheapestNow !== undefined) {
    const diff = Math.round(cheapestNow - was);
    change =
      diff === 0
        ? " The cheapest price is the same as when you saved it."
        : diff < 0
          ? ` The cheapest is ${fmtPrice(-diff)} less than when you saved it (${fmtPrice(was)}).`
          : ` The cheapest is ${fmtPrice(diff)} more than when you saved it (${fmtPrice(was)}).`;
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sky-50 dark:bg-sky-950/40 px-3 py-2 text-sm text-sky-900 dark:text-sky-200">
      <p>
        ↻ Saved search: <span className="font-medium">{search.name}</span>.{change}
      </p>
      {onSaveResults && (
        <button
          type="button"
          disabled={saved === "yes"}
          onClick={() => setSaved(onSaveResults() ? "yes" : "full")}
          className="rounded-lg border border-sky-300 dark:border-sky-800 px-2.5 py-1 text-xs font-medium hover:bg-sky-100 dark:hover:bg-sky-900/50 disabled:opacity-70"
        >
          {saved === "yes"
            ? "★ Results saved"
            : saved === "full"
              ? "Browser storage full"
              : search.results
                ? "Replace saved results with these"
                : "Save these results"}
        </button>
      )}
    </div>
  );
}

/** Shown above saved results being looked at: when they're from, and how to refresh. */
export function SavedResultsNote({ search, onRun }: { search: SavedSearch; onRun: () => void }) {
  const at = search.results?.at ?? search.savedAt;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
      <p>
        📄 Saved results for <span className="font-medium">{search.name}</span>, from {fmtDate(at.slice(0, 10))} at{" "}
        {new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Prices may have changed
        since.
      </p>
      <button
        type="button"
        onClick={onRun}
        className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
      >
        ↻ Run again for fresh prices
      </button>
    </div>
  );
}
