import { longHaulPlaces, searchLongHaulPlaces } from "@/lib/airports";

// Far-away destinations for "Further away": the popular ones (for the map), or
// a search across every far-away city with an airport (?q=).
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q");
  try {
    const places = q
      ? await searchLongHaulPlaces(q.slice(0, 60))
      : (await longHaulPlaces()).filter((p) => p.popular);
    return Response.json(places, { headers: { "Cache-Control": "public, max-age=86400" } });
  } catch {
    return Response.json({ error: "Could not load places." }, { status: 502 });
  }
}
