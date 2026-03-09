import { NextResponse } from "next/server";
import { isLegacyAdminTokenRequest } from "@/lib/server/compliance/admin";
import { getAdminOperator } from "@/lib/server/compliance/operator-auth";
import {
  appendComplianceAuditEvent,
  listAllDsarRequests,
  updateDsarStatus,
  type DsarStatus,
} from "@/lib/server/compliance/store";

const VALID_STATUS = new Set<DsarStatus>(["open", "in_review", "completed", "rejected"]);
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const operator = await getAdminOperator();
  if (!operator && !isLegacyAdminTokenRequest(req.headers)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const requests = await listAllDsarRequests();
  return NextResponse.json(
    {
      requests,
      operator: operator
        ? { address: operator.address, authMethod: operator.authMethod }
        : { address: "legacy-token", authMethod: "legacy-token" },
    },
    { headers: NO_STORE_HEADERS }
  );
}

export async function PATCH(req: Request) {
  const operator = await getAdminOperator();
  if (!operator && !isLegacyAdminTokenRequest(req.headers)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  const status = typeof body?.status === "string" ? (body.status as DsarStatus) : null;

  if (!id || !status || !VALID_STATUS.has(status)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const updated = await updateDsarStatus({ id, status });
  if (!updated) {
    return NextResponse.json({ error: "Request not found" }, { status: 404, headers: NO_STORE_HEADERS });
  }

  await appendComplianceAuditEvent({
    type: "dsar.request.updated",
    actor: operator?.address ?? "legacy-token",
    metadata: { dsarId: id, status, authMethod: operator?.authMethod ?? "legacy-token" },
  });

  return NextResponse.json({ success: true, request: updated }, { headers: NO_STORE_HEADERS });
}
