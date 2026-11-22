"use client";

import { useCallback, useSyncExternalStore } from "react";
import { returnBookingLink } from "@/lib/booking";
import { fmtDate, fmtPrice, fmtTime } from "@/lib/format";
import type { HolidayTrip, Trip } from "@/lib/types";

// Saved flights: a star on any result keeps it in this browser (no accounts
// yet), listed in the "Saved" tab. Prices are as they were when saved.

const KEY = "flight-finder:saved:v1";
const EVENT = "flight-finder:saved-changed";

export type SavedFlight =
  | { id: string; kind: "short"; savedAt: string; people: number; trip: Trip }
  | { id: string; kind: "holiday"; savedAt: string; people: number; trip: HolidayTrip };

export const shortId = (t: Trip) =>
  `short:${t.out.from.code}-${t.destination.code}-${t.back.to.code}:${t.out.depart}:${t.back.depart}`;
export const holidayId = (t: HolidayTrip) =>
  `holiday:${t.from.code}-${t.destination.code}:${t.depart}:${t.returnDepart}`;

// A small store over localStorage, shared by every card and tab (and other tabs
// of the browser), read with useSyncExternalStore.
let cache: SavedFlight[] | null = null;
let cacheRaw: string | null = null;
const EMPTY: SavedFlight[] = [];

function read(): SavedFlight[] {
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

function write(list: SavedFlight[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useSaved() {
  const saved = useSyncExternalStore(subscribe, read, () => EMPTY);
  const isSaved = useCallback((id: string) => saved.some((s) => s.id === id), [saved]);
  const toggle = useCallback((item: SavedFlight) => {
    const list = read();
    write(list.some((s) => s.id === item.id) ? list.filter((s) => s.id !== item.id) : [item, ...list]);
  }, []);
  const remove = useCallback((id: string) => write(read().filter((s) => s.id !== id)), []);
  const clear = useCallback((ids: string[]) => write(read().filter((s) => !ids.includes(s.id))), []);
  return { saved, isSaved, toggle, remove, clear };
}

/** ☆ Save / ★ Saved toggle for a result. */
export function SaveButton({ item }: { item: Omit<SavedFlight, "savedAt"> }) {
  const { isSaved, toggle } = useSaved();
  const on = isSaved(item.id);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => toggle({ ...item, savedAt: new Date().toISOString() } as SavedFlight)}
      title={on ? "Remove from your saved flights" : "Save to find it later (in the Saved tab)"}
      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-sm font-medium transition ${
        on
          ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
          : "border-slate-300 text-slate-600 hover:border-amber-400 hover:text-amber-700 dark:border-slate-600 dark:text-slate-400 dark:hover:text-amber-300"
      }`}
    >
      <span aria-hidden>{on ? "★" : "☆"}</span> {on ? "Saved" : "Save"}
    </button>
  );
}

/** Count for the tab label. */
export function useSavedCount(): number {
  return useSaved().saved.length;
}

const departOf = (s: SavedFlight) => (s.kind === "short" ? s.trip.out.depart : s.trip.depart);
const backOf = (s: SavedFlight) => (s.kind === "short" ? s.trip.back.depart : s.trip.returnDepart);

/** The "Saved" tab: upcoming trips soonest first, then ones that have gone. */
export function SavedList({ tabs }: { tabs: React.ReactNode }) {
  const { saved, remove, clear } = useSaved();
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...saved].sort((a, b) => departOf(a).localeCompare(departOf(b)));
  const upcoming = sorted.filter((s) => departOf(s).slice(0, 10) >= today);
  const gone = sorted.filter((s) => departOf(s).slice(0, 10) < today);

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-sm sm:p-6">
        {tabs}
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {saved.length === 0
              ? "No saved flights yet"
              : `${upcoming.length} saved trip${upcoming.length === 1 ? "" : "s"}`}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {saved.length === 0
              ? "Tap ☆ Save on any result to keep it here."
              : "Prices are what they were when you saved them, so check the live price before booking."}{" "}
            Saved in this browser only.
          </p>
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {upcoming.map((s) => (
            <SavedCard key={s.id} item={s} onRemove={() => remove(s.id)} />
          ))}
        </div>
      )}

      {gone.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between px-1">
            <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              Already departed ({gone.length})
            </h3>
            <button
              type="button"
              onClick={() => clear(gone.map((s) => s.id))}
              className="text-xs text-slate-500 dark:text-slate-400 hover:underline"
            >
              Clear these
            </button>
          </div>
          <div className="grid gap-3 opacity-60 sm:grid-cols-2">
            {gone.map((s) => (
              <SavedCard key={s.id} item={s} onRemove={() => remove(s.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SavedCard({ item, onRemove }: { item: SavedFlight; onRemove: () => void }) {
  const people = item.people;
  const savedOn = fmtDate(item.savedAt.slice(0, 10));
  let place: string, country: string, route: string, price: number, currency: string;
  let lines: string[];
  let links: { label: string; url: string; primary?: boolean }[];

  if (item.kind === "short") {
    const t = item.trip;
    place = t.destination.city;
    country = t.destination.country;
    route = `${t.out.from.code} → ${t.destination.code}${t.back.to.code !== t.out.from.code ? ` → ${t.back.to.code}` : ""}`;
    price = t.total;
    currency = t.currency;
    lines = [
      `Out ${fmtTime(t.out.depart)} ${t.out.from.code}→${t.out.to.code} · ${t.out.airline} ${t.out.flightNumber}`,
      `Back ${fmtTime(t.back.depart)} ${t.back.from.code}→${t.back.to.code} · ${t.back.airline} ${t.back.flightNumber}`,
    ];
    const ret = returnBookingLink(t, people);
    links = ret
      ? [{ label: ret.label, url: ret.url, primary: true }]
      : [
          { label: `Book outbound (${t.out.airline})`, url: t.out.bookingUrl, primary: true },
          { label: `Book return (${t.back.airline})`, url: t.back.bookingUrl },
        ];
  } else {
    const t = item.trip;
    place = t.destination.city;
    country = t.destination.country;
    route = `${t.from.code} → ${t.destination.code}`;
    price = t.price;
    currency = t.currency;
    const stops = (n: number) => (n === 0 ? "direct" : `${n} stop${n === 1 ? "" : "s"}`);
    lines = [
      `Out ${fmtTime(t.depart)}: ${stops(t.stopsOut)} · Back ${fmtTime(t.returnDepart)}: ${stops(t.stopsBack)}`,
      [t.airline && `First flight: ${t.airline}`, t.soldBy && `fare from ${t.soldBy}`].filter(Boolean).join(" · "),
    ].filter(Boolean);
    links = [
      ...(t.fareUrl ? [{ label: "See this fare", url: t.fareUrl, primary: true }] : []),
      { label: "Google Flights", url: t.googleUrl, primary: !t.fareUrl },
    ];
  }
  const out = departOf(item);
  const back = backOf(item);
  const nights = item.kind === "short" ? item.trip.nights : item.trip.nights;

  return (
    <article className="flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {place}
            <span className="font-normal text-slate-500 dark:text-slate-400">, {country}</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {route} · {item.kind === "holiday" ? "Further away" : nights === 0 ? "Day trip" : "Short break"}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {fmtPrice(price * people, currency)}
          </div>
          <div className="text-xs text-slate-400 dark:text-slate-500">
            {people > 1 ? `for ${people} · ${fmtPrice(price, currency)} each` : "return"} · when saved
          </div>
        </div>
      </div>
      <div className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
        {fmtDate(out)}
        {nights > 0 && ` → ${fmtDate(back)}`}
        <span className="font-normal text-slate-500 dark:text-slate-400">
          {" "}
          · {nights === 0 ? "same day" : `${nights} night${nights === 1 ? "" : "s"}`}
        </span>
      </div>
      <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600 dark:text-slate-400">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        {links.map((l) => (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className={
              l.primary
                ? "rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
                : "rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-400"
            }
          >
            {l.label} ↗
          </a>
        ))}
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto text-xs text-slate-500 dark:text-slate-400 hover:text-red-600"
        >
          Remove
        </button>
      </div>
      <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">Saved {savedOn}</p>
    </article>
  );
}
