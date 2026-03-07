"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { BOOKMARKS_CHANGED_EVENT, toggleBookmarkId } from "@/lib/client/bookmarks";
import AppShell from "@/components/AppShell";
import { useUserSettings } from "@/lib/client/settings";
import PostMedia from "@/components/PostMedia";

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

type BookmarksResponse = {
  ids?: string[];
  posts?: Post[];
  error?: string;
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

export default function BookmarksPage() {
  const { authenticated } = usePrivy();
  const { settings } = useUserSettings();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadBookmarksPage() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bookmarks?includePosts=1", {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await res.json()) as BookmarksResponse;
      if (!res.ok) {
        throw new Error(
          res.status === 401 ? "Connect Lens to view bookmarks." : data.error || "Failed to load bookmarks"
        );
      }
      setPosts(Array.isArray(data.posts) ? data.posts : []);
    } catch (loadError) {
      setPosts([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to load bookmarks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBookmarksPage();
    const onBookmarksChanged = () => {
      void loadBookmarksPage();
    };
    window.addEventListener(BOOKMARKS_CHANGED_EVENT, onBookmarksChanged);
    return () => window.removeEventListener(BOOKMARKS_CHANGED_EVENT, onBookmarksChanged);
  }, [authenticated]);

  async function handleUnbookmark(postId: string) {
    try {
      await toggleBookmarkId(postId);
      setPosts((prev) => prev.filter((post) => post.id !== postId));
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Failed to update bookmark");
    }
  }

  return (
    <AppShell active="Bookmarks">
      <div className="w-full max-w-3xl text-white">
        <section className="animate-fade-up rounded-[2.25rem] border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="mb-3 inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-cyan-200">
                Bookmarks
              </p>
              <h1 className="text-3xl font-black uppercase leading-none tracking-[-0.05em] text-white sm:text-5xl">
                Save what matters.
                <br />
                Revisit without hunting.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-gray-300 sm:text-base sm:leading-7">
                Keep the posts you want to come back to. Your saved view stays focused and fast.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:max-w-xs">
              <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-4 text-center">
                <p className="text-xl font-bold text-white">{posts.length}</p>
                <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">Saved</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-4 text-center">
                <p className="text-xl font-bold text-white">{authenticated ? "On" : "Off"}</p>
                <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">Access</p>
              </div>
            </div>
          </div>
        </section>

        {error && (
          <p className="mt-6 rounded-[1.5rem] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </p>
        )}
        {!authenticated && !loading && !error && (
          <p className="mt-6 text-sm text-gray-500">Connect your account to manage your saved posts.</p>
        )}
        {loading && <div className="mt-6 space-y-5"><BookmarkSkeleton compact={settings.compactFeed} /><BookmarkSkeleton compact={settings.compactFeed} /></div>}
        {!loading && posts.length === 0 && (
          <p className="mt-6 text-sm text-gray-500">No bookmarks yet. Save posts from the feed.</p>
        )}

        <div className="mt-6 space-y-5">
          {posts.map((post) => (
            <article
              key={post.id}
              className={`animate-fade-up rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[0.07] via-white/[0.04] to-transparent shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition duration-200 hover:border-white/15 hover:bg-white/[0.07] ${
                settings.compactFeed ? "p-4" : "p-5"
              }`}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <img
                    src={`https://api.dicebear.com/7.x/bottts/svg?seed=${post.author.address}`}
                    alt="avatar"
                    className="mt-0.5 h-10 w-10 rounded-full border border-white/10 bg-white object-cover shadow-sm"
                  />
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Link href={`/profile/${post.author.address}`} className="inline-block max-w-[18rem] break-all text-[15px] font-semibold text-white hover:underline">
                        {post.author.username?.localName ?? shortenAddress(post.author.address)}
                      </Link>
                      <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-gray-400">
                        {(post.metadata?.media?.length ?? 0) > 0 ? "Media post" : "Text post"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">{new Date(post.timestamp).toLocaleString()}</div>
                  </div>
                </div>
                <button
                  onClick={() => void handleUnbookmark(post.id)}
                  className="rounded-full border border-yellow-400/20 px-3 py-1.5 text-xs text-yellow-200 transition hover:bg-yellow-400/10"
                >
                  Remove
                </button>
              </div>

              <div className={`mb-4 whitespace-pre-wrap break-words text-gray-100 ${settings.compactFeed ? "text-sm leading-6" : "text-[15px] leading-7"}`}>
                {renderContentWithWrappedLinks(post.metadata?.content)}
              </div>

              {post.metadata?.media && post.metadata.media.length > 0 && (
                <PostMedia media={post.metadata.media} settings={settings} />
              )}
            </article>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function BookmarkSkeleton({ compact }: { compact: boolean }) {
  return (
    <div
      className={`animate-pulse rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[0.07] via-white/[0.04] to-transparent shadow-[0_0_0_1px_rgba(255,255,255,0.02)] ${
        compact ? "p-4" : "p-5"
      }`}
      aria-hidden="true"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-white/10" />
          <div className="space-y-2">
            <div className="h-4 w-36 rounded-full bg-white/10" />
            <div className="h-3 w-32 rounded-full bg-white/5" />
          </div>
        </div>
        <div className="h-8 w-20 rounded-full bg-white/5" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-full rounded-full bg-white/10" />
        <div className="h-4 w-[80%] rounded-full bg-white/10" />
      </div>
    </div>
  );
}
