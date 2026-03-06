import { NextResponse } from "next/server";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import {
  listConversation,
  listConversations,
  markConversationRead,
  sendDirectMessage,
} from "@/lib/server/messages/store";
import { createNotification } from "@/lib/server/notifications/store";

async function getActor() {
  const actorAddress = await getActorAddressFromLensCookie();
  if (!actorAddress || !isValidAddress(actorAddress)) return null;
  return normalizeAddress(actorAddress);
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const peer = searchParams.get("peer")?.trim();
  const limit = Number.parseInt(searchParams.get("limit") ?? "100", 10);

  const conversations = await listConversations(actor, { limit });
  if (!peer) {
    return NextResponse.json({ actor, conversations, messages: [] });
  }

  if (!isValidAddress(peer)) {
    return NextResponse.json({ error: "Invalid peer address" }, { status: 400 });
  }

  const normalizedPeer = normalizeAddress(peer);
  await markConversationRead(actor, normalizedPeer);
  const [messages, refreshedConversations] = await Promise.all([
    listConversation(actor, normalizedPeer),
    listConversations(actor, { limit }),
  ]);

  return NextResponse.json({
    actor,
    peerAddress: normalizedPeer,
    conversations: refreshedConversations,
    messages,
  });
}

export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const recipientAddress =
    typeof body?.recipientAddress === "string" ? normalizeAddress(body.recipientAddress) : "";

  const result = await sendDirectMessage({
    senderAddress: actor,
    recipientAddress,
    content: body?.content,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await createNotification({
    type: "message",
    recipientAddress,
    actorAddress: actor,
    message: `${shortenAddress(actor)} sent you a message.`,
    entityId: result.message.id,
    entityHref: `/messages?peer=${actor}`,
    metadata: { messageId: result.message.id },
  });

  const [messages, conversations] = await Promise.all([
    listConversation(actor, recipientAddress),
    listConversations(actor),
  ]);

  return NextResponse.json({
    success: true,
    actor,
    peerAddress: recipientAddress,
    message: result.message,
    messages,
    conversations,
  });
}

export async function PATCH(req: Request) {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const peer =
    typeof body?.peerAddress === "string" ? normalizeAddress(body.peerAddress) : "";
  if (!isValidAddress(peer)) {
    return NextResponse.json({ error: "Invalid peer address" }, { status: 400 });
  }

  const [result, messages, conversations] = await Promise.all([
    markConversationRead(actor, peer),
    listConversation(actor, peer),
    listConversations(actor),
  ]);

  return NextResponse.json({
    actor,
    peerAddress: peer,
    ...result,
    messages,
    conversations,
  });
}
