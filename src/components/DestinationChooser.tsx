"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { HOLIDAY_TYPES, type HolidayType, type LongHaulPlace } from "@/lib/longhaul";
import { Chip } from "./ui";

// "Where to" for Further away: search for places, filter by the kind of
// holiday, or click dots on the map. Nothing picked = anywhere far away.

const PlacesMap = dynamic(() => import("./PlacesMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-72 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-sm text-slate-500 sm:h-80 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
      Loading map…
    </div>
  ),
});

const normalise = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Popular places that suit any of the holiday types. */
export function placesForTypes(popular: LongHaulPlace[], types: HolidayType[]): LongHaulPlace[] {
  return popular.filter((p) => p.types?.some((t) => types.includes(t)));
}

export function DestinationChooser({
  chosen,
  types,
  onChosen,
  onTypes,
}: {
  chosen: LongHaulPlace[];
  types: HolidayType[];
  onChosen: (places: LongHaulPlace[]) => void;
  onTypes: (types: HolidayType[]) => void;
}) {
  const [popular, setPopular] = useState<LongHaulPlace[]>([]);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<LongHaulPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/places")
      .then((r) => (r.ok ? r.json() : []))
      .then(setPopular)
      .catch(() => {});
  }, []);

  // Search every far-away city with an airport (server side), as you type.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/places?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((list: LongHaulPlace[]) => {
          setMatches(list);
          setActive(0);
        })
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query]);

  // Close the suggestions when clicking elsewhere.
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const chosenCodes = useMemo(() => chosen.map((p) => p.code), [chosen]);
  const isChosen = (code: string) => chosenCodes.includes(code);
  const add = (places: LongHaulPlace[]) =>
    onChosen([...chosen, ...places.filter((p) => !isChosen(p.code))]);
  const remove = (code: string) => onChosen(chosen.filter((p) => p.code !== code));
  const toggle = (p: LongHaulPlace) => (isChosen(p.code) ? remove(p.code) : add([p]));

  // A country search ("Japan") also offers all of its popular places at once.
  const q = normalise(query.trim());
  const countryPick = useMemo(() => {
    if (q.length < 2) return null;
    const byCountry = popular.filter((p) => normalise(p.country).startsWith(q));
    const countries = new Set(byCountry.map((p) => p.country));
    return countries.size === 1 && byCountry.length >= 2
      ? { country: [...countries][0], places: byCountry }
      : null;
  }, [popular, q]);
  const options: { label: string; hint: string; places: LongHaulPlace[] }[] = [
    ...(countryPick
      ? [
          {
            label: `All popular places in ${countryPick.country}`,
            hint: countryPick.places.map((p) => p.name).join(", "),
            places: countryPick.places,
          },
        ]
      : []),
    ...(q.length >= 2 ? matches : []).map((p) => ({
      label: p.name,
      hint: p.country,
      places: [p],
    })),
  ];
  const pick = (i: number) => {
    const o = options[i];
    if (!o) return;
    add(o.places);
    setQuery("");
    setMatches([]);
    setOpen(false);
  };

  const typed = placesForTypes(popular, types);
  const dimmed = useMemo(() => {
    if (types.length === 0) return new Set<string>();
    const fits = new Set(placesForTypes(popular, types).map((p) => p.code));
    return new Set(popular.filter((p) => !fits.has(p.code)).map((p) => p.code));
  }, [popular, types]);
  // The map shows the popular places plus anything picked from the search.
  const mapPlaces = useMemo(
    () => [...popular, ...chosen.filter((c) => !popular.some((p) => p.code === c.code))],
    [popular, chosen],
  );

  const anywhere = chosen.length === 0 && types.length === 0;

  return (
    <div className="space-y-3">
      {/* Search */}
      <div ref={box} className="relative">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault(); // don't submit the search form
              pick(active);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Search a city or country, e.g. Tokyo or Japan"
          aria-label="Search destinations"
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls="destination-options"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
        />
        {open && options.length > 0 && (
          <ul
            id="destination-options"
            role="listbox"
            className="absolute z-[1000] mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1 text-sm shadow-lg"
          >
            {options.map((o, i) => (
              <li
                key={`${o.label}-${o.hint}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-sky-50 dark:bg-sky-950/50" : ""}`}
              >
                <span className="font-medium text-slate-800 dark:text-slate-200">{o.label}</span>
                <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">{o.hint}</span>
                {o.places.length === 1 && isChosen(o.places[0].code) && (
                  <span className="ml-1.5 text-xs text-sky-600">✓ added</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Holiday type */}
      <div>
        <div className="mb-1.5 text-xs text-slate-500 dark:text-slate-400">
          What kind of holiday?
        </div>
        <div className="flex flex-wrap gap-1.5">
          {HOLIDAY_TYPES.map((t) => (
            <Chip
              key={t.id}
              small
              active={types.includes(t.id)}
              onClick={() =>
                onTypes(types.includes(t.id) ? types.filter((x) => x !== t.id) : [...types, t.id])
              }
            >
              <span aria-hidden>{t.icon}</span> {t.label}
            </Chip>
          ))}
        </div>
      </div>

      {/* Chosen places */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip
          small
          active={anywhere}
          onClick={() => {
            onChosen([]);
            onTypes([]);
          }}
        >
          Anywhere far away
        </Chip>
        {chosen.map((p) => (
          <span
            key={p.code}
            className="inline-flex items-center gap-1 rounded-full bg-sky-600 py-1 pr-1.5 pl-3 text-xs text-white"
          >
            {p.name}
            <button
              type="button"
              onClick={() => remove(p.code)}
              aria-label={`Remove ${p.name}`}
              className="rounded-full px-1 hover:bg-sky-700"
            >
              ✕
            </button>
          </span>
        ))}
        {chosen.length > 1 && (
          <button
            type="button"
            onClick={() => onChosen([])}
            className="px-1 text-xs text-slate-500 dark:text-slate-400 hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      <PlacesMap places={mapPlaces} selected={chosenCodes} dimmed={dimmed} onToggle={toggle} />

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {chosen.length > 0
          ? `Searching ${chosen.length} place${chosen.length === 1 ? "" : "s"}. Click dots on the map or search to add more.`
          : types.length > 0
            ? `Searching the ${typed.length} popular place${typed.length === 1 ? "" : "s"} that suit ${types.length === 1 ? "this kind" : "these kinds"} of holiday (highlighted on the map).`
            : "Searching popular long-haul places, plus anywhere else at least 2,000 km away (Greece, the Canaries, Turkey and further) with a cheap fare. Click dots on the map or search to pick places."}
      </p>
    </div>
  );
}
