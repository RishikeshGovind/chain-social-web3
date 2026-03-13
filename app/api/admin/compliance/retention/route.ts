import { NextResponse } from "next/server";
import { isLegacyAdminTokenRequest } from "@/lib/server/compliance/admin";
import { getAdminOperator } from "@/lib/server/compliance/operator-auth";
import { appendComplianceAuditEvent, runComplianceRetention } from "@/lib/server/compliance/store";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const operator = await getAdminOperator(req.headers);
  if (!operator && !isLegacyAdminTokenRequest(req.headers)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const body = await req.json().catch(() => ({}));
  const auditDays =
    typeof body?.auditDays === "number" && Number.isFinite(body.auditDays)
      ? Math.max(1, Math.floor(body.auditDays))
      : undefined;
  const completedDsarDays =
    typeof body?.completedDsarDays === "number" && Number.isFinite(body.completedDsarDays)
      ? Math.max(1, Math.floor(body.completedDsarDays))
      : undefined;

  const result = await runComplianceRetention({ auditDays, completedDsarDays });
  await appendComplianceAuditEvent({
    type: "compliance.retention.executed",
    actor: operator?.address ?? "legacy-token",
    metadata: {
      ...result,
      authMethod: operator?.authMethod ?? "legacy-token",
    },
  });

  return NextResponse.json({ success: true, result }, { headers: NO_STORE_HEADERS });
}
