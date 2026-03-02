import { NextResponse } from "next/server";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import {
  appendComplianceAuditEvent,
  createDsarRequest,
  listDsarRequestsForActor,
  type DsarType,
} from "@/lib/server/compliance/store";

const VALID_TYPES = new Set<DsarType>([
  "access",
  "delete",
  "rectify",
  "restrict",
  "object",
  "portability",
]);

export async function GET() {
  const actorAddress = await getActorAddressFromLensCookie();
  if (!actorAddress || !isValidAddress(actorAddress)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const actor = normalizeAddress(actorAddress);
  const requests = await listDsarRequestsForActor(actor);
  return NextResponse.json({ actor, requests });
}

export async function POST(req: Request) {
  const actorAddress = await getActorAddressFromLensCookie();
  if (!actorAddress || !isValidAddress(actorAddress)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const type = typeof body?.type === "string" ? (body.type as DsarType) : null;
  if (!type || !VALID_TYPES.has(type)) {
    return NextResponse.json({ error: "Invalid DSAR type" }, { status: 400 });
  }

  const details = typeof body?.details === "string" ? body.details.trim().slice(0, 1000) : undefined;
  const actor = normalizeAddress(actorAddress);

  const requestItem = await createDsarRequest({ actor, type, details });
  await appendComplianceAuditEvent({
    type: "dsar.request.created",
    actor,
    metadata: { dsarId: requestItem.id, dsarType: requestItem.type },
  });

  return NextResponse.json({ success: true, request: requestItem }, { status: 201 });
}
