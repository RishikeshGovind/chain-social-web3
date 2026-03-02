import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/server/compliance/admin";
import { appendComplianceAuditEvent, runComplianceRetention } from "@/lib/server/compliance/store";

export async function POST(req: Request) {
  if (!isAdminRequest(req.headers)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    actor: "admin",
    metadata: result,
  });

  return NextResponse.json({ success: true, result });
}
