import { NextRequest, NextResponse } from "next/server";
import { getBoeOpportunities } from "@/lib/boe";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const refresh = searchParams.get("refresh") === "1";

  const data = await getBoeOpportunities({ refresh });
  return NextResponse.json(data);
}
