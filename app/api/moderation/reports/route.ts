import { NextResponse } from "next/server";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import { createModerationReport } from "@/lib/server/moderation/store";
import { checkReportRateLimit } from "@/lib/server/rate-limit";
import { invalidateFeedCache } from "@/app/api/posts/route";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  // Prefer Lens session identity; fall back to the reporter address
  // supplied by the client (Privy-authenticated wallet). Reports are a
  // low-privilege operation — the address is only used for audit
  // attribution and rate-limiting, not for granting access.
  let actorAddress = await getActorAddressFromLensCookie();
  if (!actorAddress || !isValidAddress(actorAddress)) {
    const bodyAddress =
      typeof body?.reporterAddress === "string" ? body.reporterAddress.trim() : "";
    if (bodyAddress && isValidAddress(bodyAddress)) {
      actorAddress = normalizeAddress(bodyAddress);
    }
  }

  if (!actorAddress || !isValidAddress(actorAddress)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const reportRateLimit = await checkReportRateLimit(normalizeAddress(actorAddress));
  if (!reportRateLimit.ok) {
    return NextResponse.json(
      { error: reportRateLimit.error },
      { status: 429 }
    );
  }

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

  const entityId = typeof body?.entityId === "string" ? body.entityId.trim().slice(0, 256) : "";
  if (!entityId) {
    return NextResponse.json({ error: "Missing report target" }, { status: 400 });
  }
  const targetAddress =
    typeof body?.targetAddress === "string" && isValidAddress(body.targetAddress)
      ? normalizeAddress(body.targetAddress)
      : undefined;

  const result = await createModerationReport({
    reporterAddress: normalizeAddress(actorAddress),
    entityType,
    entityId,
    targetAddress,
    reason: body?.reason,
    details: typeof body?.details === "string" ? body.details.slice(0, 2000) : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  invalidateFeedCache();
  return NextResponse.json({ success: true, report: result.report }, { status: 201 });
}
