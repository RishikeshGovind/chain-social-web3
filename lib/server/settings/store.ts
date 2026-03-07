import { normalizeAddress } from "@/lib/posts/content";
import { mergeState, readState } from "@/lib/server/persistence";
import type { PersistedUserSettingsRecord } from "@/lib/server/persistence/types";

export type UserSettingsRecord = PersistedUserSettingsRecord;

export type UserSettings = {
  compactFeed: boolean;
  autoplayVideos: boolean;
  hideMediaPreviews: boolean;
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  compactFeed: false,
  autoplayVideos: true,
  hideMediaPreviews: false,
};

let cache: UserSettingsRecord[] | null = null;
let writeChain = Promise.resolve();

function isUserSettingsRecord(value: unknown): value is UserSettingsRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.ownerAddress === "string" &&
    typeof record.updatedAt === "string" &&
    typeof record.compactFeed === "boolean" &&
    typeof record.autoplayVideos === "boolean" &&
    typeof record.hideMediaPreviews === "boolean"
  );
}

async function loadStore(): Promise<UserSettingsRecord[]> {
  if (cache) return cache;
  const state = await readState();
  cache = Array.isArray(state.userSettings)
    ? state.userSettings.filter(isUserSettingsRecord)
    : [];
  return cache;
}

async function saveStore(store: UserSettingsRecord[]) {
  writeChain = writeChain.then(() => mergeState({ userSettings: store }));
  await writeChain;
}

export async function getUserSettings(ownerAddress: string) {
  const owner = normalizeAddress(ownerAddress);
  const store = await loadStore();
  const record = store.find((item) => item.ownerAddress === owner);
  return {
    ...DEFAULT_USER_SETTINGS,
    ...(record ?? {}),
  };
}

export async function upsertUserSettings(
  ownerAddress: string,
  updates: Partial<UserSettings>
) {
  const owner = normalizeAddress(ownerAddress);
  const store = await loadStore();
  const now = new Date().toISOString();
  const existing = store.find((item) => item.ownerAddress === owner);

  if (existing) {
    existing.compactFeed =
      typeof updates.compactFeed === "boolean" ? updates.compactFeed : existing.compactFeed;
    existing.autoplayVideos =
      typeof updates.autoplayVideos === "boolean"
        ? updates.autoplayVideos
        : existing.autoplayVideos;
    existing.hideMediaPreviews =
      typeof updates.hideMediaPreviews === "boolean"
        ? updates.hideMediaPreviews
        : existing.hideMediaPreviews;
    existing.updatedAt = now;
    await saveStore(store);
    return existing;
  }

  const created: UserSettingsRecord = {
    ownerAddress: owner,
    compactFeed:
      typeof updates.compactFeed === "boolean"
        ? updates.compactFeed
        : DEFAULT_USER_SETTINGS.compactFeed,
    autoplayVideos:
      typeof updates.autoplayVideos === "boolean"
        ? updates.autoplayVideos
        : DEFAULT_USER_SETTINGS.autoplayVideos,
    hideMediaPreviews:
      typeof updates.hideMediaPreviews === "boolean"
        ? updates.hideMediaPreviews
        : DEFAULT_USER_SETTINGS.hideMediaPreviews,
    updatedAt: now,
  };
  store.push(created);
  cache = store;
  await saveStore(store);
  return created;
}

export async function exportUserSettings(ownerAddress: string) {
  return getUserSettings(ownerAddress);
}

export async function deleteUserSettings(ownerAddress: string) {
  const owner = normalizeAddress(ownerAddress);
  const store = await loadStore();
  const next = store.filter((item) => item.ownerAddress !== owner);
  const removed = store.length - next.length;
  if (removed > 0) {
    cache = next;
    await saveStore(next);
  }
  return { removed };
}
