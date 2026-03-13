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
  const results = await Promise.allSettled([
    deleteUserOffchainData(actor),
    deleteProfiles([actor]),
    deleteNotifications(actor),
    deleteMessages(actor),
    deleteBookmarks(actor),
    deleteUserLists(actor),
    deleteUserSettings(actor),
  ]);

  const [
    postDeletionResult,
    profilesResult,
    notificationsResult,
    messagesResult,
    bookmarksResult,
    listsResult,
    settingsResult,
  ] = results;

  const failures = results
    .map((r, i) => (r.status === "rejected" ? i : null))
    .filter((i) => i !== null);

  const postDeletionSummary =
    postDeletionResult.status === "fulfilled" ? postDeletionResult.value : { deleted: 0 };
  const deletedProfiles =
    profilesResult.status === "fulfilled" ? profilesResult.value : { removed: 0 };
  const deletedNotifications =
    notificationsResult.status === "fulfilled" ? notificationsResult.value : { removed: 0 };
  const deletedMessages =
    messagesResult.status === "fulfilled" ? messagesResult.value : { removed: 0 };
  const deletedBookmarks =
    bookmarksResult.status === "fulfilled" ? bookmarksResult.value : { removed: 0 };
  const deletedLists =
    listsResult.status === "fulfilled" ? listsResult.value : { removed: 0 };
  const deletedSettings =
    settingsResult.status === "fulfilled" ? settingsResult.value : { removed: 0 };

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
    success: failures.length === 0,
    partialFailure: failures.length > 0,
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
