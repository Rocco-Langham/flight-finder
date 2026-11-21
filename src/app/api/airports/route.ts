import { shortHaulAirports } from "@/lib/airports";

/** Airports in Europe and nearby, for the destination picker. */
export async function GET() {
  try {
    const airports = await shortHaulAirports();
    return Response.json(
      airports.map(({ code, name, city, country, countryCode, cityCode, metroCity, transfer }) => ({
        code,
        name,
        city,
        country,
        countryCode,
        cityCode,
        metroCity,
        transfer,
      })),
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  } catch {
    return Response.json({ error: "Could not load airports." }, { status: 502 });
  }
}
