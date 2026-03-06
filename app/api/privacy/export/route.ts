import { NextResponse } from "next/server";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { exportUserOffchainData } from "@/lib/posts/store";
import { appendComplianceAuditEvent } from "@/lib/server/compliance/store";
import { exportMessages } from "@/lib/server/messages/store";
import { exportNotifications } from "@/lib/server/notifications/store";
import { exportProfiles } from "@/lib/profiles/store";

export async function GET() {
  const actorAddress = await getActorAddressFromLensCookie();
  if (!actorAddress || !isValidAddress(actorAddress)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const actor = normalizeAddress(actorAddress);
  const [postsData, profiles, notifications, directMessages] = await Promise.all([
    exportUserOffchainData(actor),
    exportProfiles([actor]),
    exportNotifications(actor),
    exportMessages(actor),
  ]);
  await appendComplianceAuditEvent({
    type: "privacy.export.executed",
    actor,
    metadata: {
      exportedPosts: postsData.posts.length,
      exportedReplies: postsData.replies.length,
      exportedNotifications: notifications.length,
      exportedMessages: directMessages.length,
    },
  });

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    actor,
    offchain: {
      ...postsData,
      profiles,
      notifications,
      directMessages,
    },
    note:
      "On-chain and decentralized records are not fully deletable by this endpoint. This export covers app-managed off-chain data.",
  });
}
