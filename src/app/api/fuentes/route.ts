import { NextResponse } from "next/server";
import { getAllExternalSources } from "@/lib/sources/multi-source";

export async function GET() {
  const data = await getAllExternalSources();
  return NextResponse.json(data);
}
