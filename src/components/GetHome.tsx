"use client";

import { useEffect, useState } from "react";
import { fmtTime } from "@/lib/format";
import type { AirportRef, Trip } from "@/lib/types";

// When a trip flies back to a different home airport than it left from: a red
// warning, plus public-transport directions (Google Maps) from the traveller's
// address to the departure airport, and from the arrival airport back home.
// The address is kept in this browser only and sent to Google Maps on click.

const ADDRESS_KEY = "flight-finder:home-address";
const ADDRESS_EVENT = "flight-finder:address-changed";
const LATE_ARRIVAL = "22:30";

const airportPlace = (a: AirportRef) =>
  `${a.name} Airport (${a.code}), ${a.country}`;

function transitUrl(origin: string, destination: string): string {
  const p = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "transit",
  });
  return `https://www.google.com/maps/dir/?${p}`;
}

export function GetHome({ trip }: { trip: Trip }) {
  const leftFrom = trip.out.from;
  const landsAt = trip.back.to;
  const [address, setAddress] = useState("");

  useEffect(() => {
    // Read from this browser's storage, and follow changes made on other cards or tabs.
    const read = () => setAddress(localStorage.getItem(ADDRESS_KEY) ?? "");
    read();
    window.addEventListener(ADDRESS_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(ADDRESS_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  if (landsAt.code === leftFrom.code) return null;

  // Remembered as you type, and shared with every other card.
  const change = (value: string) => {
    setAddress(value);
    localStorage.setItem(ADDRESS_KEY, value);
    window.dispatchEvent(new Event(ADDRESS_EVENT));
  };
  const home = address.trim();
  const arrives = fmtTime(trip.back.arrive);
  const late =
    arrives >= LATE_ARRIVAL ||
    trip.back.arrive.slice(0, 10) !== trip.back.depart.slice(0, 10);

  const buttons: { label: string; url: string }[] = [
    {
      label: `Directions to ${leftFrom.name} Airport`,
      url: transitUrl(home, airportPlace(leftFrom)),
    },
    {
      label: `Directions home from ${landsAt.name} Airport`,
      url: transitUrl(airportPlace(landsAt), home),
    },
  ];

  return (
    <div className="space-y-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-200">
      <p className="font-semibold">
        ⚠ You fly out from {leftFrom.name} ({leftFrom.code}) but back to{" "}
        {landsAt.name} ({landsAt.code}).
      </p>
      <p className="text-red-700 dark:text-red-300">
        Book each flight separately (links above). Landing at {arrives}
        {late && ", so check the last trains and buses"}.
      </p>
      <input
        value={address}
        onChange={(e) => change(e.target.value)}
        placeholder="Your address or postcode"
        aria-label="Your address or postcode"
        autoComplete="street-address"
        className="w-full rounded-md border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-800 dark:text-slate-200"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        {buttons.map((b) =>
          home ? (
            <a
              key={b.label}
              href={b.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-red-700 px-2.5 py-1.5 text-center text-sm font-medium text-white hover:bg-red-800"
            >
              {b.label} ↗
            </a>
          ) : (
            <span
              key={b.label}
              title="Enter your address first"
              className="cursor-not-allowed rounded-md bg-red-200 dark:bg-red-900/40 px-2.5 py-1.5 text-center text-sm font-medium text-red-50 dark:text-red-300/60"
            >
              {b.label}
            </span>
          ),
        )}
      </div>
      <p className="text-[11px] text-red-600 dark:text-red-400">
        Opens Google Maps with train, bus and tram routes. Your address stays in
        this browser and only goes to Google Maps when you open directions.
      </p>
    </div>
  );
}
