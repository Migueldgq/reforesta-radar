import { NextRequest, NextResponse } from "next/server";
import { getAllExternalSources } from "@/lib/sources/multi-source";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const refresh = searchParams.get("refresh") === "1";
  const data = await getAllExternalSources(refresh);
  return NextResponse.json(data);
}
