import { normalizeAddress } from "@/lib/posts/content";
import { fetchLensPostById } from "@/lib/lens/feed";
import { getPostById } from "@/lib/posts/store";
import { mergeState, readState } from "@/lib/server/persistence";
import type { PersistedBookmarkRecord } from "@/lib/server/persistence/types";

export type BookmarkRecord = PersistedBookmarkRecord;

let cache: BookmarkRecord[] | null = null;
let writeChain = Promise.resolve();

function sortBookmarks(items: BookmarkRecord[]) {
  return [...items].sort((a, b) => {
    if (a.createdAt === b.createdAt) {
      return b.id.localeCompare(a.id);
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

function isBookmarkRecord(value: unknown): value is BookmarkRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.ownerAddress === "string" &&
    typeof record.postId === "string" &&
    typeof record.createdAt === "string"
  );
}

async function loadStore(): Promise<BookmarkRecord[]> {
  if (cache) return cache;
  const state = await readState();
  cache = sortBookmarks(Array.isArray(state.bookmarks) ? state.bookmarks.filter(isBookmarkRecord) : []);
  return cache;
}

async function saveStore(store: BookmarkRecord[]) {
  writeChain = writeChain.then(() => mergeState({ bookmarks: sortBookmarks(store) }));
  await writeChain;
}

export async function listBookmarks(ownerAddress: string) {
  const owner = normalizeAddress(ownerAddress);
  const store = await loadStore();
  return store.filter((bookmark) => bookmark.ownerAddress === owner);
}

export async function listBookmarkIds(ownerAddress: string) {
  const items = await listBookmarks(ownerAddress);
  return items.map((bookmark) => bookmark.postId);
}

export async function toggleBookmark(ownerAddress: string, postId: string) {
  const owner = normalizeAddress(ownerAddress);
  const store = await loadStore();
  const existingIndex = store.findIndex(
    (bookmark) => bookmark.ownerAddress === owner && bookmark.postId === postId
  );

  let bookmarked = false;
  if (existingIndex >= 0) {
    store.splice(existingIndex, 1);
  } else {
    store.unshift({
      id: crypto.randomUUID(),
      ownerAddress: owner,
      postId,
      createdAt: new Date().toISOString(),
    });
    bookmarked = true;
  }

  cache = sortBookmarks(store);
  await saveStore(cache);
  return {
    bookmarked,
    items: cache.filter((bookmark) => bookmark.ownerAddress === owner),
    ids: cache.filter((bookmark) => bookmark.ownerAddress === owner).map((bookmark) => bookmark.postId),
  };
}

export async function resolveBookmarkedPosts(ownerAddress: string, accessToken?: string) {
  const items = await listBookmarks(ownerAddress);
  const posts = await Promise.all(
    items.map(async (bookmark) => {
      const local = await getPostById(bookmark.postId);
      if (local) return { bookmark, post: local };
      const lens = await fetchLensPostById({ postId: bookmark.postId, accessToken });
      if (!lens) return null;
      return { bookmark, post: lens };
    })
  );

  return posts
    .filter((item): item is { bookmark: BookmarkRecord; post: NonNullable<Awaited<ReturnType<typeof getPostById>>> } => !!item)
    .sort((a, b) => {
      if (a.bookmark.createdAt === b.bookmark.createdAt) {
        return b.bookmark.id.localeCompare(a.bookmark.id);
      }
      return b.bookmark.createdAt.localeCompare(a.bookmark.createdAt);
    });
}

export async function exportBookmarks(ownerAddress: string) {
  return listBookmarks(ownerAddress);
}

export async function deleteBookmarks(ownerAddress: string) {
  const owner = normalizeAddress(ownerAddress);
  const store = await loadStore();
  const next = store.filter((bookmark) => bookmark.ownerAddress !== owner);
  const removed = store.length - next.length;
  if (removed > 0) {
    cache = sortBookmarks(next);
    await saveStore(cache);
  }
  return { removed };
}
