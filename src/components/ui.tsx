"use client";

import { useState } from "react";

// Form pieces and the search progress card, shared by both search forms.

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
        {label}
      </div>
      {children}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
  small,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  small?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border transition ${small ? "px-3 py-1 text-xs" : "px-3.5 py-1.5 text-sm"} ${
        active
          ? "border-sky-600 bg-sky-600 text-white"
          : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500"
      }`}
    >
      {children}
    </button>
  );
}

export interface SearchProgress {
  /** Fare lookups finished so far. */
  done: number;
  /** Fare lookups the search has asked for so far (grows as it goes). */
  total: number;
}

/** Ryanair lookups run about 8 a second (see PACED_HOSTS in src/lib/http.ts). */
const LOOKUPS_PER_SECOND = 8;

/** Reads a search API's progress stream (/api/search, /api/holiday) and returns the final result. */
export async function readSearchStream<T>(
  res: Response,
  onProgress: (p: SearchProgress) => void,
): Promise<T> {
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Search failed.");
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.progress) onProgress(msg.progress);
      if (msg.error) throw new Error(msg.error);
      if (msg.result) return msg.result;
    }
  }
  throw new Error("Search stopped before it finished. Try again.");
}

export function LoadingCard({
  progress,
  perSecond = LOOKUPS_PER_SECOND,
}: {
  progress: SearchProgress | null;
  /** How fast lookups run, for the time-left estimate. */
  perSecond?: number;
}) {
  // The total grows as the search finds more to check, so never let the bar go backwards.
  const [shown, setShown] = useState(0);
  const ratio = progress && progress.total > 0 ? progress.done / progress.total : 0;
  if (ratio > shown) setShown(ratio);
  const left = progress ? progress.total - progress.done : 0;
  // When the search asks for fares a few at a time, the total is only just
  // ahead of the count, so a bar would sit near full: show a count instead.
  const known = !!progress && left > perSecond * 2;
  const seconds = Math.ceil(left / perSecond);
  const timeLeft =
    seconds >= 90
      ? `about ${Math.round(seconds / 60)} min left`
      : seconds > 10
        ? "less than a minute left"
        : "almost done";

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
      <div className="mb-2 font-medium text-slate-700 dark:text-slate-300">
        Checking every fare…
      </div>
      <div
        role="progressbar"
        aria-label="Search progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? Math.round(shown * 100) : undefined}
        className="mx-auto h-2 max-w-md overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
      >
        {known ? (
          <div
            className="h-2 rounded-full bg-sky-600 transition-[width] duration-500"
            style={{ width: `${Math.max(3, shown * 100)}%` }}
          />
        ) : (
          <div className="h-2 w-full animate-pulse rounded-full bg-sky-600/60" />
        )}
      </div>
      <div className="mt-2 text-xs">
        {!progress || progress.total === 0
          ? "Starting…"
          : known
            ? `${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} fares checked · ${timeLeft}`
            : `${progress.done.toLocaleString()} fares checked so far`}
      </div>
      <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">
        Repeat searches are much quicker.
      </div>
    </div>
  );
}
