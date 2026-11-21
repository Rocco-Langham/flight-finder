import { shortHaulCountries } from "@/lib/airports";

export async function GET() {
  try {
    return Response.json(await shortHaulCountries(), {
      headers: { "Cache-Control": "public, max-age=86400" },
    });
  } catch {
    return Response.json({ error: "Could not load countries." }, { status: 502 });
  }
}
