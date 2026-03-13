import { isValidAddress, normalizeAddress, sanitizePostContent } from "@/lib/posts/content";
import { mergeState, readState } from "@/lib/server/persistence";
import type { PersistedDirectMessageRecord } from "@/lib/server/persistence/types";

export type DirectMessageRecord = PersistedDirectMessageRecord;

export type ConversationSummary = {
  peerAddress: string;
  lastMessage: DirectMessageRecord;
  unreadCount: number;
};

const MAX_MESSAGE_LENGTH = 2000;

let cache: DirectMessageRecord[] | null = null;
let writeChain = Promise.resolve();

function sortMessages(items: DirectMessageRecord[]) {
  return [...items].sort((a, b) => {
    if (a.createdAt === b.createdAt) {
      return b.id.localeCompare(a.id);
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

function isMessageRecord(value: unknown): value is DirectMessageRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.senderAddress === "string" &&
    typeof record.recipientAddress === "string" &&
    typeof record.content === "string" &&
    typeof record.createdAt === "string"
  );
}

function validateMessageContent(raw: unknown) {
  if (typeof raw !== "string") {
    return { ok: false as const, error: "Message must be a string" };
  }

  const content = sanitizePostContent(raw);
  if (!content) {
    return { ok: false as const, error: "Message cannot be empty" };
  }

  if (content.length > MAX_MESSAGE_LENGTH) {
    return { ok: false as const, error: `Message exceeds ${MAX_MESSAGE_LENGTH} characters` };
  }

  return { ok: true as const, content };
}

async function loadStore(): Promise<DirectMessageRecord[]> {
  if (cache) return cache;
  const state = await readState();
  const messages = Array.isArray(state.directMessages)
    ? state.directMessages.filter(isMessageRecord)
    : [];
  cache = sortMessages(messages);
  return cache;
}

async function saveStore(store: DirectMessageRecord[]) {
  writeChain = writeChain.then(() =>
    mergeState({
      directMessages: sortMessages(store),
    })
  );
  await writeChain;
}

export async function sendDirectMessage(input: {
  senderAddress: string;
  recipientAddress: string;
  content: unknown;
}) {
  const senderAddress = normalizeAddress(input.senderAddress);
  const recipientAddress = normalizeAddress(input.recipientAddress);

  if (!isValidAddress(senderAddress) || !isValidAddress(recipientAddress)) {
    return { ok: false as const, error: "Invalid address" };
  }
  if (senderAddress === recipientAddress) {
    return { ok: false as const, error: "You cannot message yourself" };
  }

  const parsed = validateMessageContent(input.content);
  if (!parsed.ok) {
    return parsed;
  }

  const store = await loadStore();
  const message: DirectMessageRecord = {
    id: crypto.randomUUID(),
    senderAddress,
    recipientAddress,
    content: parsed.content,
    createdAt: new Date().toISOString(),
  };

  store.unshift(message);
  cache = sortMessages(store).slice(0, 5000);
  await saveStore(cache);
  return { ok: true as const, message };
}

export async function listConversation(actorAddress: string, peerAddress: string) {
  const actor = normalizeAddress(actorAddress);
  const peer = normalizeAddress(peerAddress);
  const store = await loadStore();
  return store
    .filter(
      (message) =>
        (message.senderAddress === actor && message.recipientAddress === peer) ||
        (message.senderAddress === peer && message.recipientAddress === actor)
    )
    .sort((a, b) => {
      if (a.createdAt === b.createdAt) {
        return a.id.localeCompare(b.id);
      }
      return a.createdAt.localeCompare(b.createdAt);
    });
}

export async function listConversations(actorAddress: string, options?: { limit?: number }) {
  const actor = normalizeAddress(actorAddress);
  const rawLimit = options?.limit ?? 100;
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.max(rawLimit, 1), 200) : 100;
  const store = await loadStore();
  const summaries = new Map<string, ConversationSummary>();

  for (const message of store) {
    if (message.senderAddress !== actor && message.recipientAddress !== actor) continue;
    const peerAddress =
      message.senderAddress === actor ? message.recipientAddress : message.senderAddress;
    const existing = summaries.get(peerAddress);
    const unreadIncrement =
      message.recipientAddress === actor && message.senderAddress === peerAddress && !message.readAt
        ? 1
        : 0;

    if (!existing) {
      summaries.set(peerAddress, {
        peerAddress,
        lastMessage: message,
        unreadCount: unreadIncrement,
      });
      continue;
    }

    if (
      message.createdAt > existing.lastMessage.createdAt ||
      (message.createdAt === existing.lastMessage.createdAt &&
        message.id > existing.lastMessage.id)
    ) {
      existing.lastMessage = message;
    }
    existing.unreadCount += unreadIncrement;
  }

  return [...summaries.values()]
    .sort((a, b) => {
      if (a.lastMessage.createdAt === b.lastMessage.createdAt) {
        return b.lastMessage.id.localeCompare(a.lastMessage.id);
      }
      return b.lastMessage.createdAt.localeCompare(a.lastMessage.createdAt);
    })
    .slice(0, limit);
}

export async function markConversationRead(actorAddress: string, peerAddress: string) {
  const actor = normalizeAddress(actorAddress);
  const peer = normalizeAddress(peerAddress);
  const store = await loadStore();
  let updated = 0;

  for (const message of store) {
    if (message.recipientAddress !== actor) continue;
    if (message.senderAddress !== peer) continue;
    if (message.readAt) continue;
    message.readAt = new Date().toISOString();
    updated += 1;
  }

  if (updated > 0) {
    cache = sortMessages(store);
    await saveStore(cache);
  }

  return { updated };
}

export async function exportMessages(actorAddress: string) {
  const actor = normalizeAddress(actorAddress);
  const store = await loadStore();
  return store.filter(
    (message) => message.senderAddress === actor || message.recipientAddress === actor
  );
}

export async function deleteMessages(actorAddress: string) {
  const actor = normalizeAddress(actorAddress);
  const store = await loadStore();
  const next = store.filter(
    (message) => message.senderAddress !== actor && message.recipientAddress !== actor
  );
  const removed = store.length - next.length;
  if (removed > 0) {
    cache = sortMessages(next);
    await saveStore(cache);
  }
  return { removed };
}

/** Redact a single message by ID (moderation action). Replaces content with a tombstone. */
export async function redactMessageById(messageId: string) {
  const store = await loadStore();
  const message = store.find((m) => m.id === messageId);
  if (!message) return { ok: false as const, error: "Message not found" };

  message.content = "[This message has been removed by moderation]";
  cache = sortMessages(store);
  await saveStore(cache);
  return { ok: true as const };
}
