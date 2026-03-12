import { NextResponse } from "next/server";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import { checkMessageRateLimit } from "@/lib/server/rate-limit";
import {
  listConversation,
  listConversations,
  markConversationRead,
  sendDirectMessage,
} from "@/lib/server/messages/store";
import { createNotification } from "@/lib/server/notifications/store";
import { logger } from "@/lib/server/logger";
import { evaluateTextSafety, isAddressBanned } from "@/lib/server/moderation/store";

async function parseJsonBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  try {
    const body = await req.json();
    return { ok: true, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    logger.warn("messages.json_parse_failed", { error: message });
    return { ok: false, error: "Invalid JSON body" };
  }
}

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

  if (await isAddressBanned(actor)) {
    return NextResponse.json({ error: "Your account is restricted from messaging." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const peer = searchParams.get("peer")?.trim();
  const limit = Number.parseInt(searchParams.get("limit") ?? "100", 10);

  const rawConversations = await listConversations(actor, { limit });
  const conversations = (
    await Promise.all(
      rawConversations.map(async (conversation) => ({
        conversation,
        banned: await isAddressBanned(conversation.peerAddress),
      }))
    )
  )
    .filter((item) => !item.banned)
    .map((item) => item.conversation);
  if (!peer) {
    return NextResponse.json({ actor, conversations, messages: [] });
  }

  if (!isValidAddress(peer)) {
    return NextResponse.json({ error: "Invalid peer address" }, { status: 400 });
  }

  const normalizedPeer = normalizeAddress(peer);
  if (await isAddressBanned(normalizedPeer)) {
    return NextResponse.json({ error: "Conversation unavailable" }, { status: 404 });
  }
  await markConversationRead(actor, normalizedPeer);
  const [messages, refreshedConversations] = await Promise.all([
    listConversation(actor, normalizedPeer),
    listConversations(actor, { limit }),
  ]);
  const visibleConversations = (
    await Promise.all(
      refreshedConversations.map(async (conversation) => ({
        conversation,
        banned: await isAddressBanned(conversation.peerAddress),
      }))
    )
  )
    .filter((item) => !item.banned)
    .map((item) => item.conversation);

  return NextResponse.json({
    actor,
    peerAddress: normalizedPeer,
    conversations: visibleConversations,
    messages,
  });
}

export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkMessageRateLimit(actor);
  if (!rateLimit.ok) {
    const retryAfterSeconds = Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000));
    return NextResponse.json(
      { error: rateLimit.error },
      { status: 429, headers: { "Retry-After": `${retryAfterSeconds}` } }
    );
  }

  const parsed = await parseJsonBody(req);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed.body as Record<string, unknown>;
  const recipientAddress =
    typeof body?.recipientAddress === "string" ? normalizeAddress(body.recipientAddress) : "";
  if (await isAddressBanned(recipientAddress)) {
    return NextResponse.json({ error: "Recipient is unavailable." }, { status: 403 });
  }
  const safety = await evaluateTextSafety({
    address: actor,
    text: typeof body?.content === "string" ? body.content : "",
    type: "message",
  });
  if (safety.thresholdTriggered) {
    return NextResponse.json(
      { error: "Messaging restricted due to unusual activity. Try again later." },
      { status: 429 }
    );
  }
  if (safety.decision === "block") {
    return NextResponse.json(
      { error: safety.reasons[0] ?? "Message blocked by safety system." },
      { status: 400 }
    );
  }
  if (safety.decision === "review") {
    return NextResponse.json(
      { error: "Message held by automated safety checks. Please revise it and try again." },
      { status: 400 }
    );
  }

  const result = await sendDirectMessage({
    senderAddress: actor,
    recipientAddress,
    content: body?.content,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  logger.info("messages.sent", { actor, recipientAddress });

  await createNotification({
    type: "message",
    recipientAddress,
    actorAddress: actor,
    message: `${shortenAddress(actor)} sent you a message.`,
    entityId: result.message.id,
    entityHref: `/messages?peer=${actor}`,
    metadata: { messageId: result.message.id },
  });

  const [messages, rawConversations] = await Promise.all([
    listConversation(actor, recipientAddress),
    listConversations(actor),
  ]);
  const conversations = (
    await Promise.all(
      rawConversations.map(async (conversation) => ({
        conversation,
        banned: await isAddressBanned(conversation.peerAddress),
      }))
    )
  )
    .filter((item) => !item.banned)
    .map((item) => item.conversation);

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
