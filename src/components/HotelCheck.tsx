"use client";

import { useContext, useState } from "react";
import { fmtPrice } from "@/lib/format";
import type { HotelRequest, HotelResponse, Trip } from "@/lib/types";
import { LiveCheckContext } from "./LiveCheck";

const stars = (n?: number) => (n ? "★".repeat(Math.round(n)) : "");

/**
 * "Find a hotel" for a trip with nights away: the cheapest decent (3★+, rated
 * 4.0+, not a hostel) hotel within easy reach of the city centre, priced for
 * the group (2 people per room). One SerpApi search, cached 6 hours.
 */
export function HotelCheck({ trip }: { trip: Trip }) {
  const ctx = useContext(LiveCheckContext);
  const people = ctx?.people ?? 1;
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "done"; data: HotelResponse; people: number }
  >({ kind: "idle" });

  if (trip.nights === 0) return null;
  const enabled = ctx?.enabled ?? false;

  async function find() {
    setState({ kind: "loading" });
    try {
      const body: HotelRequest = {
        airport: trip.destination.code,
        checkIn: trip.out.depart.slice(0, 10),
        checkOut: trip.back.depart.slice(0, 10),
        people,
      };
      const res = await fetch("/api/hotel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Hotel search failed.");
      setState({ kind: "done", data, people });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "Hotel search failed.",
      });
    }
  }

  // People changed since the search: offer to search again.
  const stale = state.kind === "done" && state.people !== people;

  if (state.kind === "idle" || state.kind === "loading" || stale) {
    return (
      <button
        type="button"
        onClick={find}
        disabled={!enabled || state.kind === "loading"}
        title={
          enabled
            ? `Cheapest 3★+ hotel rated 4.0+ near the centre of ${trip.destination.transfer?.city ?? trip.destination.city}, for ${people} ${people === 1 ? "person" : "people"}. Uses 1 SerpApi search; repeats within 6 hours are free.`
            : "Add SERPAPI_KEY to .env.local to find hotels."
        }
        className="text-sm font-medium text-sky-700 dark:text-sky-400 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 dark:disabled:text-slate-600 disabled:no-underline"
      >
        {state.kind === "loading"
          ? "Finding a hotel…"
          : stale
            ? "Find a hotel again (people changed)"
            : "Find a hotel"}
      </button>
    );
  }

  if (state.kind === "error") {
    return (
      <p className="basis-full text-xs text-red-700 dark:text-red-300">
        {state.message}{" "}
        <button type="button" onClick={find} className="underline">
          Try again
        </button>
      </p>
    );
  }

  const { data } = state;
  const flights = trip.total * people;
  const h = data.best;
  const roomsText = `${data.rooms} room${data.rooms === 1 ? "" : "s"}, ${data.nights} night${data.nights === 1 ? "" : "s"}`;

  return (
    <div className="mt-1 basis-full space-y-1.5 rounded-lg border border-violet-100 dark:border-violet-900 bg-violet-50 dark:bg-violet-950/40 px-3 py-2 text-xs text-slate-700 dark:text-slate-300">
      <p className="font-semibold text-slate-800 dark:text-slate-200">
        Hotel in {data.city}
      </p>
      {h ? (
        <>
          <p>
            {h.link ? (
              <a
                href={h.link}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:underline"
              >
                {h.name} ↗
              </a>
            ) : (
              <span className="font-medium">{h.name}</span>
            )}{" "}
            <span className="text-amber-600 dark:text-amber-400">
              {stars(h.stars)}
            </span>
            {h.rating !== undefined && (
              <span className="text-slate-500 dark:text-slate-400">
                {" "}
                · {h.rating.toFixed(1)}/5
                {h.reviews ? ` (${h.reviews.toLocaleString("en-GB")})` : ""}
              </span>
            )}
          </p>
          <p className="text-slate-500 dark:text-slate-400">
            {h.kmFromCentre !== undefined &&
              `${h.kmFromCentre} km from the centre`}
            {h.kmFromCentre !== undefined && h.nearby && " · "}
            {h.nearby}
          </p>
          <p>
            <span className="font-semibold">{fmtPrice(h.total)}</span> for{" "}
            {roomsText}
            {data.rooms > 1 && (
              <span className="text-slate-500 dark:text-slate-400">
                {" "}
                ({fmtPrice(h.pricePerRoom)} a room)
              </span>
            )}
          </p>
          <p className="rounded-md bg-white dark:bg-slate-900 px-2 py-1 text-sm">
            Flights + hotel:{" "}
            <span className="font-bold text-emerald-700 dark:text-emerald-400">
              {fmtPrice(flights + h.total)}
            </span>
            {people > 1 && (
              <span className="text-slate-500 dark:text-slate-400">
                {" "}
                · {fmtPrice((flights + h.total) / people)} each
              </span>
            )}
          </p>
          {data.alternatives.length > 0 && (
            <p className="text-slate-500 dark:text-slate-400">
              Also:{" "}
              {data.alternatives
                .map((a) => `${a.name} ${fmtPrice(a.total)}`)
                .join(" · ")}
            </p>
          )}
        </>
      ) : (
        <p className="text-slate-500 dark:text-slate-400">
          No 3★+ hotel rated 4.0+ near the centre found for these dates.
        </p>
      )}
      <a
        href={data.searchUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sky-700 dark:text-sky-400 hover:underline"
      >
        More hotels on Google ↗
      </a>
    </div>
  );
}
