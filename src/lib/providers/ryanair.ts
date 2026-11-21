import { airportRef } from "@/lib/airports";
import { cachedJson, type FetchStats } from "@/lib/http";
import type { CalendarResult, FareProvider, Leg, OneWayQuery, OneWayResult } from "@/lib/types";
import { cheapestPerPair } from "./common";

// Ryanair's public fare-finder API (the one behind ryanair.com's "fare finder").
// Unofficial: no key needed, but it can change without notice. Fares are the
// cheapest base fare (small under-seat bag only), always direct flights, live.

const BASE = "https://services-api.ryanair.com/farfnd/v4";
export const CURRENCY = "GBP";

interface RyanairAirport {
  iataCode: string;
  name: string;
  countryName: string;
  city: { name: string; countryCode?: string };
}

interface CalendarDay {
  day: string;
  departureDate: string | null;
  arrivalDate: string | null;
  price: { value: number; currencyCode?: string } | null;
  soldOut?: boolean;
  unavailable?: boolean;
}

interface RyanairFare {
  outbound: {
    departureAirport: RyanairAirport;
    arrivalAirport: RyanairAirport;
    departureDate: string;
    arrivalDate: string;
    price: { value: number; currencyCode: string };
    flightNumber: string;
  };
}

function hint(a: RyanairAirport) {
  return {
    name: a.name,
    city: a.city?.name ?? a.name,
    country: a.countryName,
    countryCode: a.city?.countryCode?.toUpperCase(),
  };
}

export function ryanairBookingUrl(from: string, to: string, date: string): string {
  const p = new URLSearchParams({
    adults: "1",
    teens: "0",
    children: "0",
    infants: "0",
    dateOut: date,
    dateIn: "",
    isConnectedFlight: "false",
    isReturn: "false",
    discount: "0",
    originIata: from,
    destinationIata: to,
  });
  return `https://www.ryanair.com/gb/en/trip/flights/select?${p}`;
}

export function ryanair(stats?: FetchStats): FareProvider {
  async function fromOne(from: string, q: OneWayQuery): Promise<Leg[]> {
    const p = new URLSearchParams({
      departureAirportIataCode: from,
      outboundDepartureDateFrom: q.dateFrom,
      outboundDepartureDateTo: q.dateTo,
      outboundDepartureTimeFrom: q.window.from,
      outboundDepartureTimeTo: q.window.to,
      currency: CURRENCY,
      market: "en-gb",
    });
    // One destination: ask about that route only. Several: ask "anywhere" once
    // and filter, which is one request instead of one per destination.
    if (q.to?.length === 1) p.set("arrivalAirportIataCode", q.to[0]);
    const data = await cachedJson<{ fares?: RyanairFare[] }>(`${BASE}/oneWayFares?${p}`, stats);
    const wanted = q.to ? new Set(q.to) : null;
    const fares = (data.fares ?? []).filter((f) => !wanted || wanted.has(f.outbound.arrivalAirport.iataCode));
    return Promise.all(
      fares.map(async ({ outbound: o }): Promise<Leg> => {
        const prefix = o.flightNumber.slice(0, 2);
        return {
          provider: "ryanair",
          freshness: "live",
          airline: prefix === "RK" ? "Ryanair UK" : prefix === "AL" ? "Malta Air" : "Ryanair",
          flightNumber: o.flightNumber,
          from: await airportRef(o.departureAirport.iataCode, hint(o.departureAirport)),
          to: await airportRef(o.arrivalAirport.iataCode, hint(o.arrivalAirport)),
          depart: o.departureDate,
          arrive: o.arrivalDate,
          price: o.price.value,
          currency: o.price.currencyCode,
          bookingUrl: ryanairBookingUrl(
            o.departureAirport.iataCode,
            o.arrivalAirport.iataCode,
            o.departureDate.slice(0, 10),
          ),
        };
      }),
    );
  }

  async function calendar(from: string, to: string, month: string): Promise<CalendarResult> {
    const p = new URLSearchParams({ outboundMonthOfDate: `${month}-01`, currency: CURRENCY, market: "en-gb" });
    const data = await cachedJson<{ outbound?: { fares?: CalendarDay[] } }>(
      `${BASE}/oneWayFares/${from}/${to}/cheapestPerDay?${p}`,
      stats,
    );
    const [fromRef, toRef] = await Promise.all([airportRef(from), airportRef(to)]);
    const legs: Leg[] = [];
    for (const d of data.outbound?.fares ?? []) {
      if (d.unavailable || d.soldOut || !d.price || !d.departureDate || !d.arrivalDate) continue;
      legs.push({
        provider: "ryanair",
        freshness: "live",
        airline: "Ryanair",
        flightNumber: "",
        from: fromRef,
        to: toRef,
        depart: d.departureDate,
        arrive: d.arrivalDate,
        price: d.price.value,
        currency: d.price.currencyCode ?? CURRENCY,
        bookingUrl: ryanairBookingUrl(from, to, d.departureDate.slice(0, 10)),
      });
    }
    return { legs, complete: true };
  }

  return {
    id: "ryanair",
    name: "Ryanair",
    calendar,
    async cheapestOneWay(q: OneWayQuery): Promise<OneWayResult> {
      const legs = (await Promise.all(q.from.map((f) => fromOne(f, q)))).flat();
      return { legs: cheapestPerPair(legs), complete: true };
    },
  };
}
