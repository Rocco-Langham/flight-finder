import { connection } from "next/server";
import { sourceStatus } from "@/lib/providers";
import { MAX_CALLS_PER_SEARCH } from "@/lib/providers/serpapi";

export async function GET() {
  // Read keys at request time, not build time, so adding a key just needs a restart.
  await connection();
  return Response.json({ sources: sourceStatus(), serpapiMaxCallsPerSearch: MAX_CALLS_PER_SEARCH });
}
