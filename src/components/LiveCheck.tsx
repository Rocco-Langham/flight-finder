"use client";

import { createContext, useContext, useState } from "react";
import { fmtDate, fmtHours, fmtPrice, fmtTime } from "@/lib/format";
import type {
  Leg,
  LiveCheckRequest,
  LiveCheckResponse,
  Trip,
} from "@/lib/types";

/** The search rules a trip was found under, needed to look for cheaper live options. */
export type LiveRules = Omit<LiveCheckRequest, "out" | "back">;

const legRef = (l: Leg) => ({
  from: l.from.code,
  to: l.to.code,
  depart: l.depart,
  flightNumber: l.flightNumber,
});

/** The rules of the search on screen, and whether a SerpApi key is set up. */
export const LiveCheckContext = createContext<{
  rules: LiveRules;
  enabled: boolean;
  /** How many people are travelling (prices on screen are per person × this). */
  people: number;
} | null>(null);

/** "Check live price" for one trip, via Google Flights (2 SerpApi searches, cached 3h). */
export function LiveCheck({ trip }: { trip: Trip }) {
  const ctx = useContext(LiveCheckContext);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "done"; data: LiveCheckResponse }
  >({ kind: "idle" });

  async function check() {
    setState({ kind: "loading" });
    try {
      if (!ctx) return;
      const body: LiveCheckRequest = {
        ...ctx.rules,
        out: legRef(trip.out),
        back: legRef(trip.back),
      };
      const res = await fetch("/api/live-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Live check failed.");
      setState({ kind: "done", data });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "Live check failed.",
      });
    }
  }

  const enabled = ctx?.enabled ?? false;
  if (state.kind === "idle" || state.kind === "loading") {
    return (
      <button
        type="button"
        onClick={check}
        disabled={!enabled || state.kind === "loading"}
        title={
          enabled
            ? "Checks these dates on Google Flights (all airlines). Uses 2 of your SerpApi searches; repeat checks within 3 hours are free."
            : "Add SERPAPI_KEY to .env.local to check live prices on Google Flights."
        }
        className="text-sm font-medium text-sky-700 dark:text-sky-400 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 dark:disabled:text-slate-600 disabled:no-underline"
      >
        {state.kind === "loading"
          ? "Checking Google Flights…"
          : "Check live price"}
      </button>
    );
  }

  if (state.kind === "error") {
    return (
      <p className="basis-full text-xs text-red-700 dark:text-red-300">
        {state.message}{" "}
        <button type="button" onClick={check} className="underline">
          Try again
        </button>
      </p>
    );
  }

  const { sameTotal, sameOut, sameBack, best, searchesLeft } = state.data;
  // Google shows whole pounds (£15 for £14.99), so under £1 a flight is rounding, not a change.
  const ROUNDING = 2;
  const cheaper = best && best.total <= (sameTotal ?? trip.total) - ROUNDING;
  const diff =
    sameTotal !== undefined
      ? Math.round((sameTotal - trip.total) * 100) / 100
      : undefined;

  return (
    <div className="mt-1 basis-full space-y-1.5 rounded-lg border border-sky-100 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 px-3 py-2 text-xs text-slate-700 dark:text-slate-300">
      <p className="font-semibold text-slate-800 dark:text-slate-200">
        Live on Google Flights
      </p>
      {sameTotal !== undefined ? (
        <p>
          Same flights now{" "}
          <span className="font-semibold">
            {fmtPrice(sameTotal, trip.currency)}
          </span>{" "}
          {Math.abs(diff!) < ROUNDING ? (
            <span
              className="text-slate-500 dark:text-slate-400"
              title="Google Flights rounds to whole pounds"
            >
              (about the same)
            </span>
          ) : (
            <span
              className={
                diff! > 0
                  ? "text-rose-700 dark:text-rose-300"
                  : "text-emerald-700 dark:text-emerald-400"
              }
            >
              ({diff! > 0 ? "+" : "−"}
              {fmtPrice(Math.abs(diff!), trip.currency)})
            </span>
          )}
        </p>
      ) : (
        <p className="text-slate-500 dark:text-slate-400">
          {!sameOut && !sameBack
            ? "Google Flights doesn't list these flights."
            : `Google Flights doesn't list the ${!sameOut ? "outbound" : "return"} flight.`}
        </p>
      )}
      {cheaper && best && (
        <div className="rounded-md bg-white dark:bg-slate-900 px-2 py-1.5">
          <p className="text-emerald-700 dark:text-emerald-400">
            Cheaper on these dates:{" "}
            <span className="font-semibold">
              {fmtPrice(best.total, trip.currency)}
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {" "}
              · {fmtHours(best.hoursAtDestination)} there
            </span>
          </p>
          {[best.out, best.back].map((l) => (
            <p key={l.depart + l.from.code}>
              <a
                href={l.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {fmtDate(l.depart)} {fmtTime(l.depart)} {l.from.code} →{" "}
                {l.to.code} · {l.airline} {l.flightNumber} ·{" "}
                {fmtPrice(l.price, l.currency)} ↗
              </a>
            </p>
          ))}
        </div>
      )}
      {!cheaper && best && (
        <p className="text-slate-500 dark:text-slate-400">
          Nothing cheaper on Google Flights for these dates.
        </p>
      )}
      {searchesLeft !== undefined && (
        <p className="text-slate-400 dark:text-slate-500">
          {searchesLeft} SerpApi searches left
        </p>
      )}
    </div>
  );
}
