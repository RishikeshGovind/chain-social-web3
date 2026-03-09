import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { mergeState, readState } from "@/lib/server/persistence";
import type { PersistedUserListRecord } from "@/lib/server/persistence/types";

export type UserListRecord = PersistedUserListRecord;

let cache: UserListRecord[] | null = null;
let writeChain = Promise.resolve();

function sortLists(items: UserListRecord[]) {
  return [...items].sort((a, b) => {
    if (a.updatedAt === b.updatedAt) {
      return b.id.localeCompare(a.id);
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

function isUserListRecord(value: unknown): value is UserListRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.ownerAddress === "string" &&
    typeof record.name === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    Array.isArray(record.members)
  );
}

async function loadStore(): Promise<UserListRecord[]> {
  if (cache) return cache;
  const state = await readState();
  cache = sortLists(Array.isArray(state.userLists) ? state.userLists.filter(isUserListRecord) : []);
  return cache;
}

async function saveStore(store: UserListRecord[]) {
  writeChain = writeChain.then(() => mergeState({ userLists: sortLists(store) }));
  await writeChain;
}

export async function listUserLists(ownerAddress: string) {
  const owner = normalizeAddress(ownerAddress);
  const store = await loadStore();
  return sortLists(store.filter((list) => list.ownerAddress === owner));
}

export async function createUserList(ownerAddress: string, name: string) {
  const owner = normalizeAddress(ownerAddress);
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return { ok: false as const, error: "List name cannot be empty" };
  if (trimmed.length > 80) return { ok: false as const, error: "List name is too long" };

  const store = await loadStore();
  const exists = store.some(
    (list) => list.ownerAddress === owner && list.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (exists) return { ok: false as const, error: "You already have a list with that name" };

  const now = new Date().toISOString();
  const list: UserListRecord = {
    id: crypto.randomUUID(),
    ownerAddress: owner,
    name: trimmed,
    members: [],
    createdAt: now,
    updatedAt: now,
  };
  store.unshift(list);
  cache = sortLists(store);
  await saveStore(cache);
  return { ok: true as const, list };
}

export async function deleteUserList(ownerAddress: string, listId: string) {
  const owner = normalizeAddress(ownerAddress);
  const store = await loadStore();
  const next = store.filter((list) => !(list.ownerAddress === owner && list.id === listId));
  const removed = store.length - next.length;
  if (removed > 0) {
    cache = sortLists(next);
    await saveStore(cache);
  }
  return { removed };
}

export async function renameUserList(ownerAddress: string, listId: string, name: string) {
  const owner = normalizeAddress(ownerAddress);
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return { ok: false as const, error: "List name cannot be empty" };
  if (trimmed.length > 80) return { ok: false as const, error: "List name is too long" };

  const store = await loadStore();
  const list = store.find((item) => item.ownerAddress === owner && item.id === listId);
  if (!list) return { ok: false as const, error: "List not found" };

  list.name = trimmed;
  list.updatedAt = new Date().toISOString();
  cache = sortLists(store);
  await saveStore(cache);
  return { ok: true as const, list };
}

export async function addListMember(ownerAddress: string, listId: string, memberAddress: string) {
  const owner = normalizeAddress(ownerAddress);
  const member = normalizeAddress(memberAddress);
  if (!isValidAddress(member)) return { ok: false as const, error: "Invalid wallet address" };
  if (owner === member) return { ok: false as const, error: "You cannot add yourself to a list" };

  const store = await loadStore();
  const list = store.find((item) => item.ownerAddress === owner && item.id === listId);
  if (!list) return { ok: false as const, error: "List not found" };
  if (list.members.includes(member)) return { ok: false as const, error: "Address already in list" };

  list.members.unshift(member);
  list.updatedAt = new Date().toISOString();
  cache = sortLists(store);
  await saveStore(cache);
  return { ok: true as const, list };
}

export async function removeListMember(ownerAddress: string, listId: string, memberAddress: string) {
  const owner = normalizeAddress(ownerAddress);
  const member = normalizeAddress(memberAddress);
  const store = await loadStore();
  const list = store.find((item) => item.ownerAddress === owner && item.id === listId);
  if (!list) return { ok: false as const, error: "List not found" };

  list.members = list.members.filter((item) => item !== member);
  list.updatedAt = new Date().toISOString();
  cache = sortLists(store);
  await saveStore(cache);
  return { ok: true as const, list };
}

export async function exportUserLists(ownerAddress: string) {
  return listUserLists(ownerAddress);
}

export async function deleteUserLists(ownerAddress: string) {
  const owner = normalizeAddress(ownerAddress);
  const store = await loadStore();
  const next = store.filter((list) => list.ownerAddress !== owner);
  const removed = store.length - next.length;
  if (removed > 0) {
    cache = sortLists(next);
    await saveStore(cache);
  }
  return { removed };
}
