import { NextResponse } from "next/server";

import { getPrismaClient } from "@/server/db/client";

export async function GET() {
  try {
    await getPrismaClient().$queryRaw`SELECT 1 AS ready`;
    return NextResponse.json({ status: "ready" });
  } catch {
    return NextResponse.json({ status: "not_ready" }, { status: 503 });
  }
}
