export const BOOKMARKS_CHANGED_EVENT = "chainsocial:bookmarks-changed";

let cachedBookmarkIds: string[] = [];

function dispatchBookmarksChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(BOOKMARKS_CHANGED_EVENT));
}

export function readBookmarks(): string[] {
  return cachedBookmarkIds;
}

export async function loadBookmarks(): Promise<string[]> {
  const res = await fetch("/api/bookmarks", {
    credentials: "include",
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { ids?: string[]; error?: string };
  if (res.status === 401) {
    cachedBookmarkIds = [];
    dispatchBookmarksChanged();
    return cachedBookmarkIds;
  }
  if (!res.ok) {
    throw new Error(data.error || "Failed to load bookmarks");
  }
  cachedBookmarkIds = Array.isArray(data.ids)
    ? data.ids.filter((item): item is string => typeof item === "string")
    : [];
  dispatchBookmarksChanged();
  return cachedBookmarkIds;
}

export async function toggleBookmarkId(postId: string): Promise<string[]> {
  const res = await fetch("/api/bookmarks", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ postId }),
  });
  const data = (await res.json().catch(() => ({}))) as { ids?: string[]; error?: string };
  if (res.status === 401) {
    throw new Error("Connect Lens to save bookmarks.");
  }
  if (!res.ok) {
    throw new Error(data.error || "Failed to update bookmark");
  }
  cachedBookmarkIds = Array.isArray(data.ids)
    ? data.ids.filter((item): item is string => typeof item === "string")
    : [];
  dispatchBookmarksChanged();
  return cachedBookmarkIds;
}
