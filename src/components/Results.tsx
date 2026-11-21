"use client";

import { useContext } from "react";
import { fmtDate, fmtHours, fmtPrice, fmtTime } from "@/lib/format";
import type { AirportRef, Leg, SearchResponse, Trip } from "@/lib/types";
import { returnBookingLink } from "@/lib/booking";
import { GetHome } from "./GetHome";
import { HotelCheck } from "./HotelCheck";
import { LiveCheck, LiveCheckContext } from "./LiveCheck";

/** Airports further than this from the city they serve get a warning. */
const FAR_TRANSFER_MIN = 30;

export function Results({
  result,
  routeLabel,
  onSeeAllDates,
}: {
  result: SearchResponse;
  /** Route mode: what was searched for, e.g. "Milan (all airports)". */
  routeLabel: string;
  onSeeAllDates: (destination: AirportRef) => void;
}) {
  const { trips, nearMisses, stats, warnings, mode } = result;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {trips.length === 0
            ? "No trips found"
            : mode === "explore"
              ? `${trips.length} destination${trips.length === 1 ? "" : "s"}, cheapest first`
              : `${trips.length} date${trips.length === 1 ? "" : "s"} to ${routeLabel || trips[0].destination.city}`}
        </h2>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {stats.upstreamCalls + stats.cacheHits} fare lookups ·{" "}
          {(stats.ms / 1000).toFixed(1)}s
        </p>
      </div>

      {warnings.map((w) => (
        <p
          key={w}
          className="rounded-lg bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
        >
          {w}
        </p>
      ))}

      {trips.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Nothing matched. Try widening the time windows, adding more dates or
          airports, or raising the price cap.
          {nearMisses.length > 0 && " Some near misses are below."}
        </p>
      )}

      {mode === "explore" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {trips.map((t) => (
            <TripCard
              key={t.destination.code}
              trip={t}
              onSeeAllDates={() => onSeeAllDates(t.destination)}
            />
          ))}
        </div>
      ) : (
        <DateList trips={trips} />
      )}

      {nearMisses.length > 0 && (
        <div className="space-y-3 pt-4">
          <div className="px-1">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {nearMisses.length} near miss{nearMisses.length === 1 ? "" : "es"}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Places you can reach on these dates, but the flight times
              don&apos;t quite fit what you asked for.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {nearMisses.map((t) => (
              <TripCard
                key={t.destination.code}
                trip={t}
                nearMiss
                onSeeAllDates={() => onSeeAllDates(t.destination)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function TransferWarning({ airport }: { airport: AirportRef }) {
  const t = airport.transfer;
  if (!t || t.minutes <= FAR_TRANSFER_MIN) return null;
  return (
    <p
      className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-yellow-100 dark:bg-yellow-900/40 px-2 py-0.5 text-xs font-medium text-yellow-900 dark:text-yellow-200"
      title={`${airport.name} is ${t.km} km from ${t.city}. Typical time by the usual fastest public transport (train, express bus or shuttle)${t.estimate ? ", estimated from distance" : ""}.`}
    >
      <span aria-hidden>⚠</span> {t.estimate ? "About " : "~"}
      {t.minutes} min from the airport to {t.city}
    </p>
  );
}

function TripCard({
  trip,
  onSeeAllDates,
  nearMiss,
}: {
  trip: Trip;
  onSeeAllDates: () => void;
  nearMiss?: boolean;
}) {
  const people = useContext(LiveCheckContext)?.people ?? 1;
  return (
    <article
      className={`flex flex-col rounded-2xl border bg-white dark:bg-slate-900 p-4 shadow-sm ${nearMiss ? "border-dashed border-slate-300 dark:border-slate-600" : "border-slate-200 dark:border-slate-700"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {trip.destination.city}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {trip.destination.name !== trip.destination.city &&
              `${trip.destination.name} · `}
            {trip.destination.country}
          </p>
          <TransferWarning airport={trip.destination} />
        </div>
        <div className="text-right">
          <div
            className={`text-2xl font-bold ${nearMiss ? "text-slate-600 dark:text-slate-400" : "text-emerald-600 dark:text-emerald-400"}`}
          >
            {fmtPrice(trip.total * people, trip.currency)}
          </div>
          <div className="text-xs text-slate-400 dark:text-slate-500">
            {people > 1
              ? `return for ${people} · ${fmtPrice(trip.total, trip.currency)} each`
              : "return"}
          </div>
        </div>
      </div>

      {trip.misses && trip.misses.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-slate-600 dark:text-slate-400">
          {trip.misses.map((m) => (
            <li key={m}>✕ {m}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
        {fmtDate(trip.out.depart)}
        {trip.nights > 0 && ` → ${fmtDate(trip.back.depart)}`}
        <span className="font-normal text-slate-500 dark:text-slate-400">
          {" "}
          · {fmtHours(trip.hoursAtDestination)} there
        </span>
      </div>

      <div className="mt-2 space-y-1.5">
        <LegRow leg={trip.out} />
        <LegRow leg={trip.back} />
        <ReturnLinkRow trip={trip} people={people} />
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={onSeeAllDates}
          className="text-sm font-medium text-sky-700 dark:text-sky-400 hover:underline"
        >
          See every date →
        </button>
        <LiveCheck trip={trip} />
        <HotelCheck trip={trip} />
        {trip.maybeCheaper && (
          <span
            className="text-xs text-slate-500 dark:text-slate-400"
            title="Not every date could be checked for this destination (a fare source couldn't give a full price calendar). See every date to check them all."
          >
            Might be cheaper on other dates
          </span>
        )}
      </div>
    </article>
  );
}

/** Link to book both flights as one return on the airline's site (or Google Flights). */
function ReturnLinkRow({ trip, people }: { trip: Trip; people: number }) {
  const link = returnBookingLink(trip, people);
  if (!link) {
    return <GetHome trip={trip} />;
  }
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
    >
      {link.label}
      {people > 1 && ` for ${people}`} ↗
    </a>
  );
}

function LegRow({ leg, showDate }: { leg: Leg; showDate?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-sm">
      <div className="min-w-0">
        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
          {fmtTime(leg.depart)}
        </span>{" "}
        <span className="text-slate-600 dark:text-slate-400">
          {leg.from.code}
        </span>
        <span className="mx-1.5 text-slate-300 dark:text-slate-600">→</span>
        <span className="font-mono text-slate-800 dark:text-slate-200">
          {fmtTime(leg.arrive)}
        </span>{" "}
        <span className="text-slate-600 dark:text-slate-400">
          {leg.to.code}
        </span>
        {leg.arrive.slice(0, 10) !== leg.depart.slice(0, 10) && (
          <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">
            +1
          </span>
        )}
        <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
          {showDate ? `${fmtDate(leg.depart)} · ` : ""}
          <span className="text-slate-500 dark:text-slate-400">
            {leg.airline}
          </span>{" "}
          {leg.flightNumber}
        </span>
        {leg.freshness === "cached" && (
          <span
            className="ml-1.5 rounded bg-amber-50 dark:bg-amber-950/40 px-1 py-px text-[10px] font-medium text-amber-700 dark:text-amber-400"
            title="Seen in a recent search, not checked live. The price may have changed."
          >
            recent price
          </span>
        )}
      </div>
      <a
        href={leg.bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-0.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-400"
      >
        {fmtPrice(leg.price, leg.currency)} ↗
      </a>
    </div>
  );
}

function DateList({ trips }: { trips: Trip[] }) {
  const people = useContext(LiveCheckContext)?.people ?? 1;
  if (trips.length === 0) return null;
  const prices = trips.map((t) => t.total);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const airports = [
    ...new Map(trips.map((t) => [t.destination.code, t.destination])).values(),
  ];
  const multi = airports.length > 1;

  return (
    <>
      {airports.some(
        (a) => a.transfer && a.transfer.minutes > FAR_TRANSFER_MIN,
      ) && (
        <div className="flex flex-wrap gap-2 px-1">
          {airports.map((a) => (
            <span
              key={a.code}
              className="text-xs text-slate-600 dark:text-slate-400"
            >
              <TransferWarning airport={a} />
              {a.transfer && a.transfer.minutes > FAR_TRANSFER_MIN && (
                <span className="ml-1">({a.name})</span>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
        {trips.map((t) => {
          const share = max === min ? 1 : (t.total - min) / (max - min);
          const cheapest = t.total === min;
          return (
            <details key={`${t.out.depart}-${t.back.depart}`} className="group">
              <summary className="flex cursor-pointer list-none items-center gap-4 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800">
                <div className="w-28 shrink-0 text-sm font-medium text-slate-800 dark:text-slate-200">
                  {fmtDate(t.out.depart)}
                  {t.nights > 0 && (
                    <div className="text-xs font-normal text-slate-500 dark:text-slate-400">
                      → {fmtDate(t.back.depart)}
                    </div>
                  )}
                </div>
                <div className="hidden flex-1 sm:block">
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-2 rounded-full ${cheapest ? "bg-emerald-500" : "bg-sky-400"}`}
                      style={{ width: `${12 + share * 88}%` }}
                    />
                  </div>
                </div>
                <div className="flex-1 text-xs text-slate-500 dark:text-slate-400 sm:w-44 sm:flex-none">
                  {t.out.from.code} {fmtTime(t.out.depart)}
                  {multi && <> → {t.destination.code}</>} · back{" "}
                  {fmtTime(t.back.depart)} → {t.back.to.code}
                </div>
                <div
                  className={`w-20 text-right text-lg font-bold ${cheapest ? "text-emerald-600 dark:text-emerald-400" : "text-slate-800 dark:text-slate-200"}`}
                >
                  {fmtPrice(t.total * people, t.currency)}
                </div>
              </summary>
              <div className="space-y-1.5 px-4 pb-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t.destination.name} · {fmtHours(t.hoursAtDestination)} at the
                  destination
                </p>
                <TransferWarning airport={t.destination} />
                <LegRow leg={t.out} showDate />
                <LegRow leg={t.back} showDate />
                <ReturnLinkRow trip={t} people={people} />
                <div className="flex flex-wrap pt-1">
                  <LiveCheck trip={t} />
                  <HotelCheck trip={t} />
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}
