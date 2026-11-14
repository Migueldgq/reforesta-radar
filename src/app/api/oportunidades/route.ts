import { NextRequest, NextResponse } from "next/server";
import { getOpportunities } from "@/lib/aggregate";
import { cacheStats } from "@/lib/cache";

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  // Reading req.nextUrl keeps this handler dynamic (never prerendered); caching is done in lib/cache.ts.
  const data = await getOpportunities(refresh);
  return NextResponse.json(data, {
    // Short browser reuse only; a forced refresh must never be stored by a browser or CDN.
    headers: {
      "Cache-Control": refresh ? "no-store" : "private, max-age=30, stale-while-revalidate=300",
      "X-Radar-Cache": JSON.stringify(cacheStats()), // ops/debug: build + per-source fetch counters
    },
  });
}
