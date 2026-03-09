import { NextResponse } from "next/server";
import { runHealthChecks } from "@/lib/server/health";
import { logger } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await runHealthChecks();
  if (result.status === "fail") {
    logger.warn("health.check.failed", { services: result.services });
  }
  return NextResponse.json(result, {
    status: result.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
