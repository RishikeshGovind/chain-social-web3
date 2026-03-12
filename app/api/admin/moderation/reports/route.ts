import { NextResponse } from "next/server";
import { isLegacyAdminTokenRequest } from "@/lib/server/compliance/admin";
import { getAdminOperator } from "@/lib/server/compliance/operator-auth";
import {
  applyModerationAction,
  listModerationState,
} from "@/lib/server/moderation/store";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

async function getAuthorizedOperator(headers: Headers) {
  const operator = await getAdminOperator();
  if (operator) return operator;
  if (isLegacyAdminTokenRequest(headers)) {
    return { address: "legacy-token", authMethod: "legacy-token" as const };
  }
  return null;
}

export async function GET(req: Request) {
  const operator = await getAuthorizedOperator(req.headers);
  if (!operator) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const state = await listModerationState();
  return NextResponse.json(
    {
      reports: state.reports,
      hiddenPostIds: state.hiddenPostIds,
      hiddenReplyIds: state.hiddenReplyIds,
      hiddenProfileAddresses: state.hiddenProfileAddresses,
      bannedAddresses: state.bannedAddresses,
      blockedMediaUrls: state.blockedMediaUrls,
      quarantinedMediaUrls: state.quarantinedMediaUrls,
      approvedRemoteMediaUrls: state.approvedRemoteMediaUrls,
      operator,
    },
    { headers: NO_STORE_HEADERS }
  );
}

export async function PATCH(req: Request) {
  const operator = await getAuthorizedOperator(req.headers);
  if (!operator) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const body = await req.json().catch(() => ({}));
  const result = await applyModerationAction({
    reportId: typeof body?.reportId === "string" ? body.reportId : undefined,
    action: typeof body?.action === "string" ? (body.action as never) : undefined,
    entityId: typeof body?.entityId === "string" ? body.entityId : undefined,
    address: typeof body?.address === "string" ? body.address : undefined,
    notes: typeof body?.notes === "string" ? body.notes : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400, headers: NO_STORE_HEADERS });
  }

  return NextResponse.json(
    {
      success: true,
      report: result.report,
      moderation: {
        hiddenPostIds: result.state.hiddenPostIds,
        hiddenReplyIds: result.state.hiddenReplyIds,
        hiddenProfileAddresses: result.state.hiddenProfileAddresses,
        bannedAddresses: result.state.bannedAddresses,
        blockedMediaUrls: result.state.blockedMediaUrls,
        quarantinedMediaUrls: result.state.quarantinedMediaUrls,
        approvedRemoteMediaUrls: result.state.approvedRemoteMediaUrls,
      },
      operator,
    },
    { headers: NO_STORE_HEADERS }
  );
}
