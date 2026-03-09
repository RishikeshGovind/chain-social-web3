import { normalizeAddress } from "@/lib/posts/content";
import { mergeState, readState } from "@/lib/server/persistence";
import type { PersistedNotificationRecord } from "@/lib/server/persistence/types";

export type NotificationType = "like" | "reply" | "follow" | "repost" | "message";

export type NotificationRecord = PersistedNotificationRecord & {
  type: NotificationType;
};

let cache: NotificationRecord[] | null = null;
let writeChain = Promise.resolve();

function sortNotifications(items: NotificationRecord[]) {
  return [...items].sort((a, b) => {
    if (a.createdAt === b.createdAt) {
      return b.id.localeCompare(a.id);
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

async function loadStore(): Promise<NotificationRecord[]> {
  if (cache) return cache;
  const state = await readState();
  const notifications = Array.isArray(state.notifications)
    ? state.notifications.filter(
        (item): item is NotificationRecord =>
          !!item &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          typeof item.type === "string" &&
          typeof item.recipientAddress === "string" &&
          typeof item.actorAddress === "string" &&
          typeof item.message === "string" &&
          typeof item.createdAt === "string"
      )
    : [];
  cache = sortNotifications(notifications);
  return cache;
}

async function saveStore(store: NotificationRecord[]) {
  writeChain = writeChain.then(() =>
    mergeState({
      notifications: sortNotifications(store),
    })
  );
  await writeChain;
}

export async function createNotification(input: {
  type: NotificationType;
  recipientAddress: string;
  actorAddress: string;
  message: string;
  entityId?: string;
  entityHref?: string;
  metadata?: Record<string, unknown>;
}) {
  const recipientAddress = normalizeAddress(input.recipientAddress);
  const actorAddress = normalizeAddress(input.actorAddress);
  if (recipientAddress === actorAddress) return null;

  const store = await loadStore();
  const notification: NotificationRecord = {
    id: crypto.randomUUID(),
    type: input.type,
    recipientAddress,
    actorAddress,
    message: input.message.trim().slice(0, 280),
    createdAt: new Date().toISOString(),
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.entityHref ? { entityHref: input.entityHref } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };

  store.unshift(notification);
  cache = sortNotifications(store).slice(0, 500);
  await saveStore(cache);
  return notification;
}

export async function listNotificationsForRecipient(
  recipientAddress: string,
  options?: { limit?: number }
) {
  const store = await loadStore();
  const recipient = normalizeAddress(recipientAddress);
  const rawLimit = options?.limit ?? 100;
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.max(rawLimit, 1), 200)
      : 100;
  const items = store.filter((item) => item.recipientAddress === recipient).slice(0, limit);
  const unreadCount = store.filter((item) => item.recipientAddress === recipient && !item.readAt).length;
  return { items, unreadCount };
}

export async function markNotificationsRead(recipientAddress: string, ids?: string[]) {
  const store = await loadStore();
  const recipient = normalizeAddress(recipientAddress);
  const idSet = ids?.length ? new Set(ids) : null;
  let updated = 0;

  for (const item of store) {
    if (item.recipientAddress !== recipient) continue;
    if (idSet && !idSet.has(item.id)) continue;
    if (item.readAt) continue;
    item.readAt = new Date().toISOString();
    updated += 1;
  }

  if (updated > 0) {
    cache = sortNotifications(store);
    await saveStore(cache);
  }

  return { updated };
}

export async function clearNotifications(recipientAddress: string) {
  const store = await loadStore();
  const recipient = normalizeAddress(recipientAddress);
  const next = store.filter((item) => item.recipientAddress !== recipient);
  const removed = store.length - next.length;
  if (removed > 0) {
    cache = sortNotifications(next);
    await saveStore(cache);
  }
  return { removed };
}

export async function exportNotifications(recipientAddress: string) {
  const store = await loadStore();
  const recipient = normalizeAddress(recipientAddress);
  return store.filter((item) => item.recipientAddress === recipient);
}

export async function deleteNotifications(recipientAddress: string) {
  return clearNotifications(recipientAddress);
}
