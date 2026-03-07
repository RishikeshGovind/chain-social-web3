import { NextResponse } from "next/server";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { deleteUserOffchainData } from "@/lib/posts/store";
import { deleteBookmarks } from "@/lib/server/bookmarks/store";
import { appendComplianceAuditEvent } from "@/lib/server/compliance/store";
import { deleteUserLists } from "@/lib/server/lists/store";
import { deleteMessages } from "@/lib/server/messages/store";
import { deleteNotifications } from "@/lib/server/notifications/store";
import { deleteUserSettings } from "@/lib/server/settings/store";
import { deleteProfiles } from "@/lib/profiles/store";

export async function DELETE() {
  const actorAddress = await getActorAddressFromLensCookie();
  if (!actorAddress || !isValidAddress(actorAddress)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const actor = normalizeAddress(actorAddress);
  const [
    postDeletionSummary,
    deletedProfiles,
    deletedNotifications,
    deletedMessages,
    deletedBookmarks,
    deletedLists,
    deletedSettings,
  ] = await Promise.all([
    deleteUserOffchainData(actor),
    deleteProfiles([actor]),
    deleteNotifications(actor),
    deleteMessages(actor),
    deleteBookmarks(actor),
    deleteUserLists(actor),
    deleteUserSettings(actor),
  ]);
  await appendComplianceAuditEvent({
    type: "privacy.delete.executed",
    actor,
    metadata: {
      ...postDeletionSummary,
      deletedProfiles,
      deletedNotifications: deletedNotifications.removed,
      deletedMessages: deletedMessages.removed,
      deletedBookmarks: deletedBookmarks.removed,
      deletedLists: deletedLists.removed,
      deletedSettings: deletedSettings.removed,
    },
  });

  return NextResponse.json({
    success: true,
    deletedAt: new Date().toISOString(),
    actor,
    offchainDeletionSummary: {
      ...postDeletionSummary,
      deletedProfiles,
      deletedNotifications: deletedNotifications.removed,
      deletedMessages: deletedMessages.removed,
      deletedBookmarks: deletedBookmarks.removed,
      deletedLists: deletedLists.removed,
      deletedSettings: deletedSettings.removed,
    },
    note:
      "On-chain and decentralized records may remain accessible due to network immutability; this request deletes app-managed off-chain data only.",
  });
}
