"use client";

import type { CountryFilter as Filter } from "@/lib/types";

export interface Country {
  code: string;
  name: string;
}

/** Hide-these / only-these country picker. */
export function CountryFilter({
  value,
  onChange,
  countries,
  inResults,
}: {
  value: Filter;
  onChange: (v: Filter) => void;
  countries: Country[];
  /** Countries in the latest results, with how many destinations each. */
  inResults: { code: string; name: string; count: number }[];
}) {
  const names = new Map(countries.map((c) => [c.code, c.name]));
  for (const c of inResults) names.set(c.code, c.name);
  const selected = new Set(value.codes);
  const hide = value.mode === "exclude";

  const add = (code: string) =>
    !selected.has(code) &&
    onChange({ ...value, codes: [...value.codes, code] });
  const remove = (code: string) =>
    onChange({ ...value, codes: value.codes.filter((c) => c !== code) });
  const suggestions = inResults.filter((c) => !selected.has(c.code));

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-xs font-medium">
          {(
            [
              ["exclude", "Hide these"],
              ["include", "Only these"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange({ ...value, mode })}
              aria-pressed={value.mode === mode}
              className={`rounded-md px-2.5 py-1 transition ${
                value.mode === mode
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value=""
          onChange={(e) => e.target.value && add(e.target.value)}
          className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-700 dark:text-slate-300"
          aria-label="Add a country"
        >
          <option value="">Add a country…</option>
          {countries
            .filter((c) => !selected.has(c.code))
            .map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
        </select>

        {value.codes.length > 0 && (
          <button
            type="button"
            onClick={() => onChange({ ...value, codes: [] })}
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      {value.codes.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.codes.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => remove(code)}
              title="Remove"
              className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${
                hide
                  ? "border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 line-through decoration-rose-300 dark:decoration-rose-700"
                  : "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300"
              }`}
            >
              {names.get(code) ?? code}
              <span aria-hidden className="no-underline">
                ×
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {hide
            ? "No countries hidden."
            : "Pick the countries you want. Until you do, every country is shown."}
        </p>
      )}

      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {hide ? "Hide from results:" : "Add from results:"}
          </span>
          {suggestions.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => add(c.code)}
              className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-0.5 text-xs text-slate-600 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500"
            >
              {c.name}{" "}
              <span className="text-slate-400 dark:text-slate-500">
                {c.count}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Same rule the server applies, for instant feedback on results already shown. */
export function passesCountryFilter(f: Filter, countryCode: string): boolean {
  if (f.codes.length === 0) return true;
  return f.mode === "exclude"
    ? !f.codes.includes(countryCode)
    : f.codes.includes(countryCode);
}
