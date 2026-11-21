import type { Trip } from "@/lib/types";

// Links that open a return journey (both flights, both dates) on the airline's
// own site where we can, otherwise on Google Flights.

const isRyanair = (airline: string) => /ryanair|malta air/i.test(airline);

export interface ReturnLink {
  url: string;
  label: string;
}

/**
 * A link to book the trip as a return, or null when it can't be one booking
 * (flying back to a different home airport). Prices on those pages are for
 * `people` adults.
 */
export function returnBookingLink(trip: Trip, people: number): ReturnLink | null {
  const from = trip.out.from.code;
  const to = trip.out.to.code;
  const dateOut = trip.out.depart.slice(0, 10);
  const dateIn = trip.back.depart.slice(0, 10);
  // A return needs the same two airports both ways.
  if (trip.back.from.code !== to || trip.back.to.code !== from) return null;

  if (isRyanair(trip.out.airline) && isRyanair(trip.back.airline)) {
    const adults = String(people);
    const p = new URLSearchParams({
      adults,
      teens: "0",
      children: "0",
      infants: "0",
      dateOut,
      dateIn,
      isConnectedFlight: "false",
      discount: "0",
      isReturn: "true",
      promoCode: "",
      originIata: from,
      destinationIata: to,
      tpAdults: adults,
      tpTeens: "0",
      tpChildren: "0",
      tpInfants: "0",
      tpStartDate: dateOut,
      tpEndDate: dateIn,
      tpDiscount: "0",
      tpPromoCode: "",
      tpOriginIata: from,
      tpDestinationIata: to,
    });
    return { url: `https://www.ryanair.com/gb/en/trip/flights/select?${p}`, label: "Book return on Ryanair" };
  }

  const airline = trip.out.airline === trip.back.airline ? trip.out.airline : "";
  const q = `Direct flights from ${from} to ${to} on ${dateOut} returning ${dateIn} for ${people} adult${people === 1 ? "" : "s"}${airline ? ` on ${airline}` : ""}`;
  return {
    url: `https://www.google.com/travel/flights?hl=en-GB&curr=GBP&q=${encodeURIComponent(q)}`,
    label: airline ? `Book return (${airline}, via Google Flights)` : "Book return via Google Flights",
  };
}
