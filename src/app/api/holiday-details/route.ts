import { googleRoundTripDetails, serpapiSearchesLeft } from "@/lib/providers/serpapi";
import type { HolidayDetailsRequest } from "@/lib/types";

// "Flight details" for a Further-away trip: every flight, stop and plane from
// Google Flights (2 SerpApi searches, cached 3h).

const CODE = /^[A-Z]{3}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as Partial<HolidayDetailsRequest> | null;
  if (
    !b ||
    !CODE.test(String(b.from)) ||
    !CODE.test(String(b.to)) ||
    !TIME.test(String(b.depart)) ||
    !TIME.test(String(b.returnDepart))
  ) {
    return Response.json({ error: "Invalid trip." }, { status: 400 });
  }
  const key = process.env.SERPAPI_KEY?.trim();
  if (!key) return Response.json({ error: "Flight details need a SerpApi key (SERPAPI_KEY)." }, { status: 503 });

  const q: HolidayDetailsRequest = {
    from: String(b.from),
    to: String(b.to),
    depart: String(b.depart),
    returnDepart: String(b.returnDepart),
    stopsOut: Number(b.stopsOut) || 0,
    stopsBack: Number(b.stopsBack) || 0,
  };
  try {
    const details = await googleRoundTripDetails(key, q);
    return Response.json({ ...details, searchesLeft: await serpapiSearchesLeft(key) });
  } catch (e) {
    const limit = e instanceof Error && e.message === "LIMIT";
    if (!limit) console.error("holiday-details:", e);
    return Response.json(
      {
        error: limit
          ? "The shared Google Flights allowance (SerpApi) is used up for this month, so full details aren't available until it resets. “See this fare” shows them on the booking site."
          : "Couldn't get the flight details from Google Flights. Try again in a minute.",
      },
      { status: limit ? 429 : 502 },
    );
  }
}
