"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { readBookmarks, toggleBookmarkId } from "@/lib/client/bookmarks";
import AppShell from "@/components/AppShell";

type Post = {
  id: string;
  timestamp: string;
  metadata?: {
    content?: string;
    media?: string[];
  };
  author: {
    username?: {
      localName?: string;
    };
    address: string;
  };
};

type FeedResponse = {
  posts?: Post[];
  nextCursor?: string | null;
};

const URL_SPLIT_REGEX = /(https?:\/\/[^\s]+)/gi;

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function sanitizeDisplayContent(raw?: string): string {
  if (!raw) return "";

  return raw
    .replace(/<\/*imagedata\b[^>]*>/gi, "")
    .replace(/<\/*image\b[^>]*>/gi, "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderContentWithWrappedLinks(raw?: string) {
  const content = sanitizeDisplayContent(raw);
  if (!content) return "";

  const parts = content.split(URL_SPLIT_REGEX);
  return parts.map((part, index) => {
    if (/^https?:\/\/[^\s]+$/i.test(part)) {
      return (
        <span key={`url-${index}`} className="break-all text-blue-300">
          {part}
        </span>
      );
    }
    return <span key={`txt-${index}`}>{part}</span>;
  });
}

function getMediaKind(url: string): "video" | "gif" | "image" {
  if (/[?&]__media=video(\b|&|$)/i.test(url)) return "video";
  if (/[?&]__media=gif(\b|&|$)/i.test(url)) return "gif";
  if (/\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(url)) return "video";
  if (/\.(gif)(\?|$)/i.test(url)) return "gif";
  if (/\/(video|videos)\//i.test(url)) return "video";
  return "image";
}

export default function BookmarksPage() {
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>([]);
  const [postsById, setPostsById] = useState<Record<string, Post>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setBookmarkedIds(readBookmarks());
    const onBookmarksChanged = () => setBookmarkedIds(readBookmarks());
    window.addEventListener("chainsocial:bookmarks-changed", onBookmarksChanged);
    return () =>
      window.removeEventListener("chainsocial:bookmarks-changed", onBookmarksChanged);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPosts() {
      setLoading(true);
      try {
        const collected = new Map<string, Post>();
        let cursor: string | null = null;
        for (let page = 0; page < 8; page += 1) {
          const params = new URLSearchParams({ limit: "50" });
          if (cursor) params.set("cursor", cursor);
          const res = await fetch(`/api/posts?${params.toString()}`, {
            credentials: "include",
            cache: "no-store",
          });
          const data = (await res.json()) as FeedResponse;
          for (const post of data.posts ?? []) {
            collected.set(post.id, post);
          }
          cursor = data.nextCursor ?? null;
          if (!cursor) break;
        }

        if (!cancelled) {
          setPostsById(Object.fromEntries(collected.entries()));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPosts();
    return () => {
      cancelled = true;
    };
  }, []);

  const bookmarkedPosts = useMemo(() => {
    return bookmarkedIds
      .map((id) => postsById[id])
      .filter((post): post is Post => !!post)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [bookmarkedIds, postsById]);

  return (
    <AppShell active="Bookmarks">
      <div className="w-full max-w-3xl px-6 py-8 text-white">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Bookmarks</h1>
          <Link href="/feed" className="text-sm text-blue-400 hover:underline">
            Back to Feed
          </Link>
        </div>

        {loading && <p className="text-gray-400">Loading bookmarks...</p>}
        {!loading && bookmarkedIds.length === 0 && (
          <p className="text-gray-500">No bookmarks yet. Save posts from the feed.</p>
        )}
        {!loading && bookmarkedIds.length > 0 && bookmarkedPosts.length === 0 && (
          <p className="text-gray-500">
            Bookmarked posts are outside the loaded feed window. Scroll further in feed, then come
            back.
          </p>
        )}

        <div className="space-y-4">
          {bookmarkedPosts.map((post) => (
            <article
              key={post.id}
              className="rounded-2xl border border-gray-700 bg-gray-900 p-4 shadow-sm transition-shadow hover:bg-gray-800 hover:shadow-lg"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <img
                    src={`https://api.dicebear.com/7.x/bottts/svg?seed=${post.author.address}`}
                    alt="avatar"
                    className="h-6 w-6 rounded-full border border-gray-700 bg-white"
                  />
                  <Link href={`/profile/${post.author.address}`} className="font-semibold hover:underline">
                    {post.author.username?.localName ?? shortenAddress(post.author.address)}
                  </Link>
                  <span className="text-xs text-gray-500">{shortenAddress(post.author.address)}</span>
                </div>
                <button
                  onClick={() => setBookmarkedIds(toggleBookmarkId(post.id))}
                  className="rounded px-2 py-1 text-xs text-yellow-400 hover:bg-gray-800 hover:underline"
                >
                  Unbookmark
                </button>
              </div>

              <div className="mb-2 whitespace-pre-wrap break-words text-gray-100">
                {renderContentWithWrappedLinks(post.metadata?.content)}
              </div>

              {post.metadata?.media && post.metadata.media.length > 0 && (
                <div
                  className={`mb-2 ${
                    post.metadata.media.length === 1 ? "max-w-xl" : "grid grid-cols-2 gap-2"
                  }`}
                >
                  {post.metadata.media.map((url, idx) => {
                    const mediaKind = getMediaKind(url);
                    const isSingle = post.metadata!.media!.length === 1;
                    const frameClass = isSingle
                      ? "overflow-hidden rounded-xl border border-gray-700 bg-black"
                      : "overflow-hidden rounded-xl border border-gray-700 bg-black aspect-square";

                    if (mediaKind === "video") {
                      return (
                        <div key={idx} className={frameClass}>
                          <video
                            src={url}
                            controls
                            className={isSingle ? "w-full max-h-96 object-contain" : "h-full w-full object-cover"}
                          />
                        </div>
                      );
                    }

                    return (
                      <div key={idx} className={frameClass}>
                        <img
                          src={url}
                          alt="media"
                          className={
                            mediaKind === "gif"
                              ? isSingle
                                ? "w-full max-h-96 object-contain"
                                : "h-full w-full object-contain"
                              : isSingle
                                ? "w-full max-h-96 object-cover"
                                : "h-full w-full object-cover"
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="text-xs text-gray-500">{new Date(post.timestamp).toLocaleString()}</p>
            </article>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
