"use client";

import { useState } from "react";
import { fmtDate, fmtPrice, fmtTime } from "@/lib/format";
import type { HolidayDetailsResponse, HolidayTrip, Journey } from "@/lib/types";

// The "Flight details" drop-down on a Further-away result: what the fare data
// says straight away, and on request every flight, stop and plane from Google
// Flights.

function fmtMinutes(min?: number): string {
  if (!min) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${m ? ` ${m}m` : ""}`;
}

const stopsText = (n: number) => (n === 0 ? "Direct" : `${n} stop${n === 1 ? "" : "s"}`);

/** "Sat 25 Jul 10:15", with "+1" style day marks handled by showing the date. */
const when = (dt?: string) => (dt ? `${fmtDate(dt)} ${fmtTime(dt)}` : "");

function Summary({
  title,
  from,
  to,
  depart,
  arrive,
  stops,
  minutes,
}: {
  title: string;
  from: string;
  to: string;
  depart: string;
  arrive?: string;
  stops: number;
  minutes?: number;
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">{title}</div>
      <div className="text-xs text-slate-600 dark:text-slate-400">
        {from} {when(depart)} → {to} {arrive ? when(arrive) : ""}
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400">
        {[stopsText(stops), minutes ? `${fmtMinutes(minutes)} in total` : ""].filter(Boolean).join(" · ")}
      </div>
    </div>
  );
}

function JourneyView({ title, journey }: { title: string; journey: Journey }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
        {title}
        {journey.totalMinutes ? (
          <span className="font-normal text-slate-500 dark:text-slate-400"> · {fmtMinutes(journey.totalMinutes)} in total</span>
        ) : null}
      </div>
      {!journey.exact && (
        <p className="mb-1 text-[11px] text-amber-700 dark:text-amber-400">
          Google Flights doesn&apos;t list this exact combination, so this is its closest match.
        </p>
      )}
      <ol className="space-y-1.5">
        {journey.segments.map((s, i) => (
          <li key={`${s.flightNumber}-${s.depart}`}>
            <div className="rounded-md bg-slate-50 dark:bg-slate-800/60 px-2 py-1.5 text-xs">
              <div className="font-medium text-slate-800 dark:text-slate-200">
                {fmtTime(s.depart)} {s.from.code} → {fmtTime(s.arrive)} {s.to.code}
                {s.arrive.slice(0, 10) !== s.depart.slice(0, 10) && (
                  <span className="ml-1 text-amber-600 dark:text-amber-400">(lands {fmtDate(s.arrive)})</span>
                )}
              </div>
              <div className="text-slate-600 dark:text-slate-400">
                {[s.airline, s.flightNumber, s.plane, fmtMinutes(s.minutes)].filter(Boolean).join(" · ")}
                {s.overnight && " · overnight"}
              </div>
              <div className="text-slate-500 dark:text-slate-500">
                {s.from.name} → {s.to.name}
              </div>
            </div>
            {journey.layovers[i] && (
              <div className="py-1 pl-2 text-[11px] text-slate-500 dark:text-slate-400">
                ⏱ {fmtMinutes(journey.layovers[i].minutes)} connection in {journey.layovers[i].name || journey.layovers[i].code}
                {journey.layovers[i].overnight && " (overnight)"}
                {journey.layovers[i].minutes < 75 && (
                  <span className="ml-1 text-amber-600 dark:text-amber-400">· tight</span>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HolidayDetails({ trip: t }: { trip: HolidayTrip }) {
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "done"; data: HolidayDetailsResponse } | { kind: "error"; message: string }
  >({ kind: "idle" });

  const load = async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/holiday-details", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: t.from.code,
          to: t.destination.code,
          depart: t.depart,
          returnDepart: t.returnDepart,
          stopsOut: t.stopsOut,
          stopsBack: t.stopsBack,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load the details.");
      if (!data.out) throw new Error("Google Flights has no flights for these dates on this route.");
      setState({ kind: "done", data });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Couldn't load the details." });
    }
  };

  return (
    <details className="group/details mt-2 rounded-lg border border-slate-200 dark:border-slate-700">
      <summary className="flex cursor-pointer list-none items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-sky-700 dark:hover:text-sky-400 [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open/details:rotate-90">▸</span>
        Flight details
      </summary>
      <div className="space-y-3 border-t border-slate-200 dark:border-slate-700 px-3 py-2.5">
        {state.kind !== "done" && (
          <>
            <Summary
              title="Outbound"
              from={t.from.code}
              to={t.destination.code}
              depart={t.depart}
              arrive={t.arrive}
              stops={t.stopsOut}
              minutes={t.minutesOut}
            />
            <Summary
              title="Return"
              from={t.destination.code}
              to={t.from.code}
              depart={t.returnDepart}
              arrive={t.returnArrive}
              stops={t.stopsBack}
              minutes={t.minutesBack}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {[
                t.airline && (t.stopsOut + t.stopsBack ? `First flight: ${t.airline}` : t.airline),
                t.flightNumber,
                t.soldBy && `Fare from ${t.soldBy}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </>
        )}

        {state.kind === "idle" && (
          <div>
            <button
              type="button"
              onClick={load}
              className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-400"
            >
              Show every flight, connection & plane
            </button>
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
              From Google Flights: uses 2 of the shared monthly SerpApi searches (repeats within 3 hours are free).
            </p>
          </div>
        )}
        {state.kind === "loading" && (
          <p className="text-sm text-slate-500 dark:text-slate-400">Asking Google Flights…</p>
        )}
        {state.kind === "error" && (
          <p className="rounded-md bg-amber-50 dark:bg-amber-950/40 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200">
            {state.message}
          </p>
        )}
        {state.kind === "done" && (
          <>
            {state.data.out && <JourneyView title={`Outbound · ${fmtDate(t.depart)}`} journey={state.data.out} />}
            {state.data.back && <JourneyView title={`Return · ${fmtDate(t.returnDepart)}`} journey={state.data.back} />}
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              From Google Flights
              {state.data.price ? `, where this trip is ${fmtPrice(state.data.price)} return per person` : ""}.
              {state.data.searchesLeft !== undefined && ` ${state.data.searchesLeft} shared searches left this month.`}
            </p>
          </>
        )}
      </div>
    </details>
  );
}
