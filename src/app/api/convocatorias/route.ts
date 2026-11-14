import { NextRequest, NextResponse } from "next/server";
import { getRadarConvocatorias } from "@/lib/bdns";
import type { WorkLine } from "@/lib/types";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") || "";
  const refresh = searchParams.get("refresh") === "1";
  const outsideOnly = searchParams.get("outside") === "1";
  const competitiveOnly = searchParams.get("competitive") === "1";
  const workLine = (searchParams.get("line") || "") as WorkLine | "";

  const { items, cached, fetchedAt } = await getRadarConvocatorias({
    query,
    refresh,
  });

  const filtered = items.filter((item) => {
    if (outsideOnly && !item.fit.outsideManualSources) return false;
    if (competitiveOnly && !item.fit.isCompetitive) return false;
    if (workLine && !item.fit.workLines.includes(workLine)) return false;
    return true;
  });

  const stats = {
    total: items.length,
    highFit: items.filter((i) => i.fit.tier === "alto").length,
    outsideManual: items.filter((i) => i.fit.outsideManualSources).length,
    openOrUpcoming: items.filter(
      (i) => i.fit.deadlineState === "abierta" || i.fit.deadlineState === "proxima"
    ).length,
  };

  return NextResponse.json({
    items: filtered,
    stats,
    cached,
    fetchedAt,
  });
}
