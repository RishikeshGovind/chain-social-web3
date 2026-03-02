import { NextResponse } from "next/server";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { deleteUserOffchainData } from "@/lib/posts/store";
import { appendComplianceAuditEvent } from "@/lib/server/compliance/store";
import { deleteProfiles } from "@/lib/profiles/store";

export async function DELETE() {
  const actorAddress = await getActorAddressFromLensCookie();
  if (!actorAddress || !isValidAddress(actorAddress)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const actor = normalizeAddress(actorAddress);
  const [postDeletionSummary, deletedProfiles] = await Promise.all([
    deleteUserOffchainData(actor),
    deleteProfiles([actor]),
  ]);
  await appendComplianceAuditEvent({
    type: "privacy.delete.executed",
    actor,
    metadata: {
      ...postDeletionSummary,
      deletedProfiles,
    },
  });

  return NextResponse.json({
    success: true,
    deletedAt: new Date().toISOString(),
    actor,
    offchainDeletionSummary: {
      ...postDeletionSummary,
      deletedProfiles,
    },
    note:
      "On-chain and decentralized records may remain accessible due to network immutability; this request deletes app-managed off-chain data only.",
  });
}
