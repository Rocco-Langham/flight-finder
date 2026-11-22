"use client";

import { fmtPrice } from "@/lib/format";
import { peaksFor, peakSummary } from "@/lib/peaks";

// "Why is this expensive?" for trips in peak times (school holidays, big
// holidays at the destination, high season).

/**
 * A badge naming the peak a trip falls in, with the reason. Only for trips that
 * cost more than other dates to the same place (when there are any to compare),
 * and not for months-long seasons (the note above the results covers those).
 */
export function PeakBadge({
  out,
  back,
  countryCode,
  price,
  compare,
  compact,
}: {
  out: string;
  back: string;
  countryCode: string;
  /** This trip's price (as shown), for comparing. */
  price?: number;
  /** Cheapest price (as shown) to the same place among other dates, if there are any. */
  compare?: number;
  /** Just the badge (reason in the tooltip), for tight rows. */
  compact?: boolean;
}) {
  const peaks = peaksFor(out, back, countryCode).filter((p) => !p.season);
  if (peaks.length === 0) return null;
  const extra = price !== undefined && compare !== undefined ? price - compare : undefined;
  // Other dates to compare with, and this one isn't noticeably dearer: no badge.
  if (extra !== undefined && (extra < 5 || extra < price! * 0.08)) return null;
  const label = peaks.map((p) => p.label).join(" · ");
  const why = peaks.map((p) => p.why).join(" ");
  const more = extra !== undefined ? `About ${fmtPrice(Math.round(extra))} more than the cheapest other dates found.` : "";
  return (
    <div className={compact ? "inline" : "mt-1.5"}>
      <span
        title={`${why} ${more}`.trim()}
        className="inline-flex items-center gap-1 rounded-md bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-200"
      >
        <span aria-hidden>💸</span> Peak time: {label}
      </span>
      {!compact && (
        <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/80">
          {why} {more}
        </p>
      )}
    </div>
  );
}

/** A note above the results when most of them fall in peak times. */
export function PeakNote({
  trips,
  tip,
}: {
  trips: { out: string; back: string; countryCode: string }[];
  /** What to try instead, for this kind of search. */
  tip: string;
}) {
  const s = peakSummary(trips);
  if (!s) return null;
  const labels =
    s.labels.length === 1 ? s.labels[0] : `${s.labels.slice(0, -1).join(", ")} and ${s.labels.at(-1)}`;
  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
      <p className="font-medium">
        <span aria-hidden>💸 </span>Expensive time to travel: most of these trips fall in {labels}.
      </p>
      <p className="mt-0.5 text-amber-800 dark:text-amber-200/80">
        {s.why} {tip}
      </p>
    </div>
  );
}

/**
 * For each trip, the cheapest price to the same place on other dates in these
 * results (none if it's the only one), to say how much more a peak date costs.
 */
export function cheapestOtherDate<T>(trips: T[], get: (t: T) => { place: string; price: number }): Map<T, number> {
  const byPlace = new Map<string, T[]>();
  for (const t of trips) {
    const k = get(t).place;
    byPlace.set(k, [...(byPlace.get(k) ?? []), t]);
  }
  const out = new Map<T, number>();
  for (const group of byPlace.values()) {
    if (group.length < 2) continue;
    for (const t of group) {
      const others = group.filter((o) => o !== t).map((o) => get(o).price);
      out.set(t, Math.min(...others));
    }
  }
  return out;
}
