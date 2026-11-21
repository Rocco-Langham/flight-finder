"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Transfer } from "@/lib/types";
import type { Country } from "./CountryFilter";

export interface PickerAirport {
  code: string;
  name: string;
  city: string;
  country: string;
  countryCode: string;
  cityCode: string;
  metroCity: string;
  transfer?: Transfer;
}

export interface Destination {
  label: string;
  codes: string[];
}

type Option =
  | { kind: "country"; code: string; name: string; airports: number }
  | { kind: "city"; name: string; country: string; codes: string[] }
  | { kind: "airport"; airport: PickerAirport };

const norm = (s: string | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const MAX_OPTIONS = 12;

/**
 * Search box for "Pick a destination": type an airport code, airport, city or
 * country. Cities with several airports can be picked as one destination;
 * picking a country hands over to an "anywhere in <country>" search.
 */
export function DestinationPicker({
  airports,
  countries,
  value,
  onPick,
  onPickCountry,
}: {
  airports: PickerAirport[];
  countries: Country[];
  value: Destination | null;
  onPick: (d: Destination) => void;
  onPickCountry: (countryCode: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const options = useMemo<Option[]>(() => {
    const q = norm(query.trim());
    if (q.length < 2) return [];
    const out: Option[] = [];

    const byCode =
      q.length === 3
        ? airports.find((a) => a.code.toLowerCase() === q)
        : undefined;
    if (byCode) out.push({ kind: "airport", airport: byCode });

    const airportCount = new Map<string, number>();
    for (const a of airports)
      airportCount.set(
        a.countryCode,
        (airportCount.get(a.countryCode) ?? 0) + 1,
      );
    for (const c of countries) {
      if (norm(c.name).startsWith(q)) {
        out.push({
          kind: "country",
          code: c.code,
          name: c.name,
          airports: airportCount.get(c.code) ?? 0,
        });
      }
    }

    const groups = new Map<string, PickerAirport[]>();
    for (const a of airports) {
      const key = a.cityCode || a.code;
      const list = groups.get(key) ?? [];
      list.push(a);
      groups.set(key, list);
    }
    for (const list of groups.values()) {
      const metro = list[0].metroCity || list[0].city;
      if (list.length < 2 || !norm(metro).startsWith(q)) continue;
      out.push({
        kind: "city",
        name: metro,
        country: list[0].country,
        codes: list.map((a) => a.code).sort(),
      });
    }

    const matches = airports
      .filter((a) => a !== byCode)
      .map((a) => {
        const fields = [a.city, a.name, a.metroCity].map(norm);
        const rank = fields.some((f) => f.startsWith(q))
          ? 0
          : fields.some((f) => f.includes(` ${q}`))
            ? 1
            : norm(a.country).startsWith(q)
              ? 2
              : 3;
        return { a, rank };
      })
      .filter((m) => m.rank < 3)
      .sort((x, y) => x.rank - y.rank || x.a.city.localeCompare(y.a.city));
    for (const { a } of matches) out.push({ kind: "airport", airport: a });

    return out.slice(0, MAX_OPTIONS);
  }, [query, airports, countries]);

  const choose = (o: Option) => {
    if (o.kind === "country") onPickCountry(o.code);
    else if (o.kind === "city")
      onPick({ label: `${o.name} (all airports)`, codes: o.codes });
    else
      onPick({
        label: `${o.airport.name} (${o.airport.code})`,
        codes: [o.airport.code],
      });
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative max-w-md">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || options.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(options.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={
          value
            ? "Change destination…"
            : "City, airport, code or country (e.g. Milan, BVA, Spain)"
        }
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls="ff-destination-options"
        aria-label="Destination"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      {value && (
        <p className="mt-1.5 text-sm text-slate-700">
          <span className="font-medium">{value.label}</span>
          {value.codes.length > 1 && (
            <span className="text-slate-500"> · {value.codes.join(", ")}</span>
          )}
        </p>
      )}

      {open && options.length > 0 && (
        <ul
          id="ff-destination-options"
          role="listbox"
          className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {options.map((o, i) => (
            <li
              key={
                o.kind === "airport"
                  ? o.airport.code
                  : o.kind === "city"
                    ? `city-${o.codes.join()}`
                    : `cc-${o.code}`
              }
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-sky-50" : ""}`}
            >
              {o.kind === "country" && (
                <>
                  <span className="font-medium text-slate-900">
                    Anywhere in {o.name}
                  </span>
                  <span className="block text-xs text-slate-500">
                    Cheapest trip to each of its {o.airports} airports
                  </span>
                </>
              )}
              {o.kind === "city" && (
                <>
                  <span className="font-medium text-slate-900">
                    {o.name}: all airports
                  </span>
                  <span className="block text-xs text-slate-500">
                    {o.codes.join(", ")} · {o.country}
                  </span>
                </>
              )}
              {o.kind === "airport" && (
                <>
                  <span className="text-slate-900">
                    {o.airport.name}{" "}
                    <span className="font-mono text-xs text-slate-500">
                      {o.airport.code}
                    </span>
                  </span>
                  <span className="block text-xs text-slate-500">
                    {o.airport.city !== o.airport.name &&
                      `${o.airport.city} · `}
                    {o.airport.country}
                    {o.airport.transfer && o.airport.transfer.minutes > 30 && (
                      <span className="text-amber-700">
                        {" "}
                        · ~{o.airport.transfer.minutes} min to{" "}
                        {o.airport.transfer.city}
                      </span>
                    )}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
