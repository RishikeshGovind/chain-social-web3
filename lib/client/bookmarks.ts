const BOOKMARK_STORAGE_KEY = "chainsocial:bookmarks";

export function readBookmarks(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(BOOKMARK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function writeBookmarks(ids: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(ids));
  window.dispatchEvent(new Event("chainsocial:bookmarks-changed"));
}

export function toggleBookmarkId(postId: string): string[] {
  const existing = readBookmarks();
  const next = existing.includes(postId)
    ? existing.filter((id) => id !== postId)
    : [postId, ...existing];
  writeBookmarks(next);
  return next;
}
