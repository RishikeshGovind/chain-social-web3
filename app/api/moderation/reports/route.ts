import { NextResponse } from "next/server";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import { createModerationReport } from "@/lib/server/moderation/store";

export async function POST(req: Request) {
  const actorAddress = await getActorAddressFromLensCookie();
  if (!actorAddress || !isValidAddress(actorAddress)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const entityType =
    body?.entityType === "post" ||
    body?.entityType === "reply" ||
    body?.entityType === "profile" ||
    body?.entityType === "message" ||
    body?.entityType === "media"
      ? body.entityType
      : null;

  if (!entityType) {
    return NextResponse.json({ error: "Invalid report target type" }, { status: 400 });
  }

  const result = await createModerationReport({
    reporterAddress: normalizeAddress(actorAddress),
    entityType,
    entityId: body?.entityId,
    targetAddress: typeof body?.targetAddress === "string" ? body.targetAddress : undefined,
    reason: body?.reason,
    details: body?.details,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, report: result.report }, { status: 201 });
}
