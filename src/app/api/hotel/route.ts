import { airportInfo } from "@/lib/airports";
import { datesBetween } from "@/lib/dates";
import { cityCentreHotels } from "@/lib/providers/hotels";
import type { HotelRequest, HotelResponse } from "@/lib/types";

const IATA = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "Find a hotel": cheapest decent, central hotel for a trip (1 SerpApi search, cached 6h). */
export async function POST(request: Request) {
  const key = process.env.SERPAPI_KEY?.trim();
  if (!key)
    return Response.json(
      { error: "Add SERPAPI_KEY to .env.local to find hotels." },
      { status: 400 },
    );
  const r = (await request
    .json()
    .catch(() => null)) as Partial<HotelRequest> | null;
  const people = Number(r?.people);
  if (
    !r ||
    !IATA.test(r.airport ?? "") ||
    !DATE.test(r.checkIn ?? "") ||
    !DATE.test(r.checkOut ?? "") ||
    r.checkOut! <= r.checkIn!
  ) {
    return Response.json({ error: "Invalid hotel request." }, { status: 400 });
  }
  if (!Number.isInteger(people) || people < 1 || people > 9)
    return Response.json({ error: "People must be 1-9." }, { status: 400 });

  const airport = await airportInfo(r.airport!);
  const city = airport?.centre?.city ?? airport?.city ?? r.airport!;
  // Two people per room; one person gets a room to themselves.
  const rooms = Math.ceil(people / 2);
  const adultsPerRoom = people === 1 ? 1 : 2;
  const nights = datesBetween(r.checkIn!, r.checkOut!).length - 1;

  try {
    const hotels = await cityCentreHotels(key, {
      city,
      centre: airport?.centre,
      checkIn: r.checkIn!,
      checkOut: r.checkOut!,
      adultsPerRoom,
    });
    const priced = hotels.map((h) => ({
      ...h,
      total: Math.round(h.pricePerRoom * rooms * 100) / 100,
    }));
    const body: HotelResponse = {
      city,
      nights,
      rooms,
      people,
      best: priced[0],
      alternatives: priced.slice(1, 3),
      searchUrl: `https://www.google.com/travel/hotels/${encodeURIComponent(city)}?hl=en-GB&curr=GBP&q=${encodeURIComponent(`hotels in ${city} city centre ${r.checkIn} to ${r.checkOut}`)}`,
    };
    return Response.json(body);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Hotel search failed." },
      { status: 502 },
    );
  }
}
