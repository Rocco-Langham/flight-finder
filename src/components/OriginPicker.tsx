"use client";

import { useEffect, useRef, useState } from "react";
import { airportsNear, ukAirportName, UK_MAJOR_AIRPORTS } from "@/lib/ukAirports";

// Home airports for "Further away": search any major UK airport, or "Near me"
// (the browser's location picks the closest ones).

const normalise = (s: string) => s.toLowerCase().trim();

export function OriginPicker({
  origins = [],
  onChange,
}: {
  origins: string[];
  onChange: (codes: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const q = normalise(query);
  const matches = q
    ? UK_MAJOR_AIRPORTS.filter(
        (a) =>
          a.code.toLowerCase() === q ||
          normalise(a.name).includes(q) ||
          normalise(a.area).includes(q),
      ).slice(0, 8)
    : UK_MAJOR_AIRPORTS.filter((a) => !origins.includes(a.code)).slice(0, 8);

  const add = (codes: string[]) => onChange([...new Set([...origins, ...codes])]);
  const pick = (i: number) => {
    const a = matches[i];
    if (!a) return;
    add([a.code]);
    setQuery("");
    setActive(0);
    setOpen(false);
  };

  const nearMe = () => {
    if (!navigator.geolocation) {
      setNote("Your browser can't share its location. Search for your airport instead.");
      return;
    }
    setLocating(true);
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const near = airportsNear(pos.coords.latitude, pos.coords.longitude);
        if (near[0].km > 400) {
          setNote("You don't seem to be in the UK. Search for your airport instead.");
          return;
        }
        onChange(near.map((a) => a.code));
        setNote(`Closest to you: ${near.map((a) => `${a.name} (${a.km} km)`).join(", ")}.`);
      },
      () => {
        setLocating(false);
        setNote("Couldn't get your location (permission denied?). Search for your airport instead.");
      },
      { timeout: 10_000, maximumAge: 600_000 },
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {origins.map((code) => (
          <span
            key={code}
            className="inline-flex items-center gap-1 rounded-full bg-sky-600 py-1 pr-1.5 pl-3 text-sm text-white"
          >
            {ukAirportName(code)} <span className="opacity-70">{code}</span>
            <button
              type="button"
              onClick={() => onChange(origins.filter((c) => c !== code))}
              aria-label={`Remove ${ukAirportName(code)}`}
              className="rounded-full px-1 hover:bg-sky-700"
            >
              ✕
            </button>
          </span>
        ))}
        {origins.length === 0 && (
          <span className="text-sm text-slate-500 dark:text-slate-400">No airports picked yet.</span>
        )}
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <button
          type="button"
          onClick={nearMe}
          disabled={locating}
          className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-400 disabled:opacity-60"
        >
          📍 {locating ? "Finding you…" : "Near me"}
        </button>
        <div ref={box} className="relative min-w-56 flex-1">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, matches.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(active);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Add a UK airport, e.g. Heathrow or Glasgow"
            aria-label="Search UK airports"
            role="combobox"
            aria-expanded={open && matches.length > 0}
            aria-controls="origin-options"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
          {open && matches.length > 0 && (
            <ul
              id="origin-options"
              role="listbox"
              className="absolute z-[1000] mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1 text-sm shadow-lg"
            >
              {matches.map((a, i) => (
                <li
                  key={a.code}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(i);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-sky-50 dark:bg-sky-950/50" : ""}`}
                >
                  <span className="font-medium text-slate-800 dark:text-slate-200">{a.name}</span>
                  <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">
                    {a.code} · {a.area}
                  </span>
                  {origins.includes(a.code) && (
                    <span className="ml-1.5 text-xs text-sky-600">✓ added</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {note && <p className="text-xs text-slate-500 dark:text-slate-400">{note}</p>}
    </div>
  );
}
