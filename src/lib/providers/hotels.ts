import "server-only";
import { km } from "@/lib/airports";
import { cachedJson } from "@/lib/http";
import type { HotelOption } from "@/lib/types";

// Hotels via SerpApi's Google Hotels engine (same SERPAPI_KEY as Google
// Flights). One search per city + dates + guests, cached for 6 hours.

const CACHE_MS = 6 * 60 * 60 * 1000;

/** What counts as "decent and well located". */
export const HOTEL_RULES = {
  minStars: 3,
  /** Google rating filter: "8" = 4.0 and up. */
  minRatingParam: "8",
  maxKmFromCentre: 2.5,
  /** Used when a hotel's distance can't be worked out. */
  minLocationRating: 4.3,
  /** Names that are hostels even when listed with stars. */
  hostel: /hostel|\bclink\b|generator|backpack|\bdorm/i,
};

interface Property {
  name?: string;
  type?: string;
  link?: string;
  gps_coordinates?: { latitude?: number; longitude?: number };
  total_rate?: { extracted_lowest?: number };
  extracted_hotel_class?: number;
  overall_rating?: number;
  reviews?: number;
  location_rating?: number;
  nearby_places?: {
    name?: string;
    transportations?: { type?: string; duration?: string }[];
  }[];
}

/**
 * Hotels in a city centre for the stay, already filtered to decent, well-located
 * ones and sorted cheapest first. Prices are for the whole stay, one room.
 */
export async function cityCentreHotels(
  apiKey: string,
  q: {
    city: string;
    centre?: { lat: number; lon: number };
    checkIn: string;
    checkOut: string;
    adultsPerRoom: number;
  },
): Promise<HotelOption[]> {
  const p = new URLSearchParams({
    engine: "google_hotels",
    q: `hotels in ${q.city} city centre`,
    check_in_date: q.checkIn,
    check_out_date: q.checkOut,
    adults: String(q.adultsPerRoom),
    currency: "GBP",
    gl: "uk",
    hl: "en",
    sort_by: "3", // lowest price
    rating: HOTEL_RULES.minRatingParam,
    hotel_class: "3,4,5",
    api_key: apiKey,
  });
  let res: { properties?: Property[]; error?: string };
  try {
    res = await cachedJson(
      `https://serpapi.com/search.json?${p}`,
      undefined,
      CACHE_MS,
    );
  } catch (e) {
    if (e instanceof Error && /Upstream 401|Upstream 403/.test(e.message))
      throw new Error("SerpApi rejected the key. Check SERPAPI_KEY.");
    if (e instanceof Error && /Upstream 429/.test(e.message))
      throw new Error(
        "SerpApi limit reached (monthly allowance or hourly rate).",
      );
    throw e;
  }
  if (res.error && !/no results|hasn't returned any results/i.test(res.error))
    throw new Error(`Google Hotels: ${res.error}`);

  const out: HotelOption[] = [];
  for (const h of res.properties ?? []) {
    const price = h.total_rate?.extracted_lowest;
    if (!h.name || !price || HOTEL_RULES.hostel.test(h.name)) continue;
    if ((h.extracted_hotel_class ?? 0) < HOTEL_RULES.minStars) continue;
    const g = h.gps_coordinates;
    const distance =
      q.centre && g?.latitude !== undefined && g.longitude !== undefined
        ? km({ lat: g.latitude, lon: g.longitude }, q.centre)
        : undefined;
    const wellLocated =
      distance !== undefined
        ? distance <= HOTEL_RULES.maxKmFromCentre
        : (h.location_rating ?? 0) >= HOTEL_RULES.minLocationRating;
    if (!wellLocated) continue;

    // Closest nearby place reachable on foot, as a hint of what's around.
    const walk = (h.nearby_places ?? [])
      .flatMap((n) =>
        (n.transportations ?? [])
          .filter((t) => t.type === "Walking")
          .map((t) => ({ n, t })),
      )
      .sort(
        (a, b) =>
          parseInt(a.t.duration ?? "99") - parseInt(b.t.duration ?? "99"),
      )[0];

    out.push({
      name: h.name,
      stars: h.extracted_hotel_class,
      rating: h.overall_rating,
      reviews: h.reviews,
      locationRating: h.location_rating,
      kmFromCentre:
        distance !== undefined ? Math.round(distance * 10) / 10 : undefined,
      nearby: walk ? `${walk.n.name}, ${walk.t.duration} walk` : undefined,
      pricePerRoom: price,
      link: h.link,
    });
  }
  return out.sort((a, b) => a.pricePerRoom - b.pricePerRoom);
}
