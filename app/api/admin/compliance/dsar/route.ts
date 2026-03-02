import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/server/compliance/admin";
import {
  appendComplianceAuditEvent,
  listAllDsarRequests,
  updateDsarStatus,
  type DsarStatus,
} from "@/lib/server/compliance/store";

const VALID_STATUS = new Set<DsarStatus>(["open", "in_review", "completed", "rejected"]);

export async function GET(req: Request) {
  if (!isAdminRequest(req.headers)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requests = await listAllDsarRequests();
  return NextResponse.json({ requests });
}

export async function PATCH(req: Request) {
  if (!isAdminRequest(req.headers)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  const status = typeof body?.status === "string" ? (body.status as DsarStatus) : null;

  if (!id || !status || !VALID_STATUS.has(status)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const updated = await updateDsarStatus({ id, status });
  if (!updated) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  await appendComplianceAuditEvent({
    type: "dsar.request.updated",
    actor: "admin",
    metadata: { dsarId: id, status },
  });

  return NextResponse.json({ success: true, request: updated });
}
