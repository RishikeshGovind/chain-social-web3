"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { BOOKMARKS_CHANGED_EVENT, loadBookmarks, readBookmarks, toggleBookmarkId } from "@/lib/client/bookmarks";
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
  likes?: string[];
  reposts?: string[];
  replyCount?: number;
};

type Reply = {
  id: string;
  postId: string;
  timestamp: string;
  metadata?: {
    content?: string;
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

function isPost(value: unknown): value is Post {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  const author = obj.author;
  return (
    typeof obj.id === "string" &&
    typeof obj.timestamp === "string" &&
    !!author &&
    typeof author === "object" &&
    typeof (author as Record<string, unknown>).address === "string"
  );
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const URL_SPLIT_REGEX = /(https?:\/\/[^\s]+)/gi;

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

function didAuthExpire(status: number, error: unknown) {
  return (
    status === 401 ||
    (typeof error === "string" && error.includes("Unauthenticated"))
  );
}

export default function ExplorePage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [repliesByPost, setRepliesByPost] = useState<Record<string, Reply[]>>({});
  const [replyDraftByPost, setReplyDraftByPost] = useState<Record<string, string>>({});
  const [replyLoadingByPost, setReplyLoadingByPost] = useState<Record<string, boolean>>({});
  const [bookmarkedPostIds, setBookmarkedPostIds] = useState<string[]>([]);
  const { settings } = useUserSettings();

  const { authenticated, user, logout } = usePrivy();
  const viewerAddress = useMemo(
    () => user?.wallet?.address?.toLowerCase() ?? "",
    [user?.wallet?.address]
  );

  useEffect(() => {
    let cancelled = false;
    loadBookmarks()
      .then((ids) => {
        if (!cancelled) setBookmarkedPostIds(ids);
      })
      .catch(() => {
        if (!cancelled) setBookmarkedPostIds([]);
      });
    const onBookmarksChanged = () => setBookmarkedPostIds(readBookmarks());
    window.addEventListener(BOOKMARKS_CHANGED_EVENT, onBookmarksChanged);
    return () =>
      {
        cancelled = true;
        window.removeEventListener(BOOKMARKS_CHANGED_EVENT, onBookmarksChanged);
      };
  }, [viewerAddress]);

  useEffect(() => {
    let cancelled = false;
    async function loadPosts() {
      try {
        const collected = new Map<string, Post>();
        let cursor: string | null = null;
        for (let page = 0; page < 4; page += 1) {
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
        if (!cancelled) setPosts(Array.from(collected.values()));
      } catch {
        if (!cancelled) setPosts([]);
      }
    }
    void loadPosts();
    return () => {
      cancelled = true;
    };
  }, []);

  const ranked = useMemo(() => {
    const q = query.trim().toLowerCase();
    const subset = !q
      ? posts
      : posts.filter((post) => {
          const text = post.metadata?.content?.toLowerCase() ?? "";
          const userName = post.author.username?.localName?.toLowerCase() ?? "";
          return (
            text.includes(q) ||
            userName.includes(q) ||
            post.author.address.toLowerCase().includes(q)
          );
        });

    const now = Date.now();
    const score = (post: Post) => {
      const likes = post.likes?.length ?? 0;
      const replies = post.replyCount ?? 0;
      const reposts = post.reposts?.length ?? 0;
      const ageHours = Math.max(
        1,
        (now - (Number.isNaN(Date.parse(post.timestamp)) ? now : Date.parse(post.timestamp))) /
          (1000 * 60 * 60)
      );
      return (likes * 1.8 + replies * 3 + reposts * 2.2 + 1) / Math.pow(ageHours, 1.25);
    };

    return [...subset]
      .map((post) => ({ post, score: score(post) }))
      .sort((a, b) => {
        const delta = b.score - a.score;
        if (delta !== 0) return delta;
        return b.post.timestamp.localeCompare(a.post.timestamp);
      });
  }, [posts, query]);

  async function handleLike(postId: string) {
    if (!viewerAddress) return;
    setError(null);
    const previousPosts = posts;
    const currentlyLiked =
      posts.find((post) => post.id === postId)?.likes?.includes(viewerAddress) ?? false;

    setPosts((prev) =>
      prev.map((post) => {
        if (post.id !== postId) return post;
        const likes = post.likes ?? [];
        return {
          ...post,
          likes: currentlyLiked
            ? likes.filter((address) => address !== viewerAddress)
            : [...likes, viewerAddress],
        };
      })
    );

    try {
      const likeWithRetry = async (
        retryCount = 0
      ): Promise<{ ok: boolean; data: Record<string, unknown> }> => {
        const res = await fetch(`/api/posts/${postId}/likes`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentlyLiked }),
          credentials: "include",
        });
        const data = await res.json();

        if (didAuthExpire(res.status, data.error) && retryCount === 0) {
          const refreshRes = await fetch("/api/lens/refresh", {
            method: "POST",
            credentials: "include",
          });
          if (refreshRes.ok) return likeWithRetry(1);
          throw new Error("Session expired. Please reconnect Lens.");
        }
        return { ok: res.ok, data };
      };

      const { ok, data } = await likeWithRetry();
      if (!ok) throw new Error((data.error as string) || "Failed to update like");
      if (isPost(data.post)) {
        const updated = data.post;
        setPosts((prev) => prev.map((post) => (post.id === postId ? updated : post)));
      }
    } catch (e) {
      setPosts(previousPosts);
      setError(e instanceof Error ? e.message : "Failed to update like");
    }
  }

  async function handleRepost(postId: string) {
    if (!viewerAddress) return;
    setError(null);
    const previousPosts = posts;
    const currentlyReposted =
      posts.find((post) => post.id === postId)?.reposts?.includes(viewerAddress) ?? false;

    setPosts((prev) =>
      prev.map((post) => {
        if (post.id !== postId) return post;
        const reposts = post.reposts ?? [];
        return {
          ...post,
          reposts: currentlyReposted
            ? reposts.filter((address) => address !== viewerAddress)
            : [...reposts, viewerAddress],
        };
      })
    );

    try {
      const repostWithRetry = async (
        retryCount = 0
      ): Promise<{ ok: boolean; data: Record<string, unknown> }> => {
        const res = await fetch(`/api/posts/${postId}/reposts`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentlyReposted }),
          credentials: "include",
        });
        const data = await res.json();

        if (didAuthExpire(res.status, data.error) && retryCount === 0) {
          const refreshRes = await fetch("/api/lens/refresh", {
            method: "POST",
            credentials: "include",
          });
          if (refreshRes.ok) return repostWithRetry(1);
          throw new Error("Session expired. Please reconnect Lens.");
        }
        return { ok: res.ok, data };
      };

      const { ok, data } = await repostWithRetry();
      if (!ok) throw new Error((data.error as string) || "Failed to update repost");
      if (isPost(data.post)) {
        const updated = data.post;
        setPosts((prev) => prev.map((post) => (post.id === postId ? updated : post)));
      }
    } catch (e) {
      setPosts(previousPosts);
      setError(e instanceof Error ? e.message : "Failed to update repost");
    }
  }

  async function handleBookmark(postId: string) {
    if (!authenticated || !viewerAddress) return;
    try {
      const ids = await toggleBookmarkId(postId);
      setBookmarkedPostIds(ids);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update bookmark");
    }
  }

  async function fetchReplies(postId: string) {
    setReplyLoadingByPost((prev) => ({ ...prev, [postId]: true }));
    try {
      const res = await fetch(`/api/posts/${postId}/replies?limit=20`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load replies");
      setRepliesByPost((prev) => ({ ...prev, [postId]: data.replies ?? [] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load replies");
    } finally {
      setReplyLoadingByPost((prev) => ({ ...prev, [postId]: false }));
    }
  }

  function toggleReplies(postId: string) {
    const isOpen = !!expandedReplies[postId];
    setExpandedReplies((prev) => ({ ...prev, [postId]: !isOpen }));
    if (!isOpen && !repliesByPost[postId]) {
      void fetchReplies(postId);
    }
  }

  async function submitReply(postId: string) {
    const content = (replyDraftByPost[postId] ?? "").trim();
    if (!content || !viewerAddress) return;

    setReplyLoadingByPost((prev) => ({ ...prev, [postId]: true }));
    setError(null);
    try {
      const submitWithRetry = async (
        retryCount = 0
      ): Promise<{ ok: boolean; data: Record<string, unknown> }> => {
        const res = await fetch(`/api/posts/${postId}/replies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
          credentials: "include",
        });
        const data = await res.json();

        if (didAuthExpire(res.status, data.error) && retryCount === 0) {
          const refreshRes = await fetch("/api/lens/refresh", {
            method: "POST",
            credentials: "include",
          });
          if (refreshRes.ok) return submitWithRetry(1);
          throw new Error("Session expired. Please reconnect Lens.");
        }

        return { ok: res.ok, data };
      };

      const { ok, data } = await submitWithRetry();
      if (!ok) throw new Error((data.error as string) || "Failed to post reply");
      setReplyDraftByPost((prev) => ({ ...prev, [postId]: "" }));
      await fetchReplies(postId);
      const nextReplyCount =
        typeof data.replyCount === "number" ? data.replyCount : null;
      if (nextReplyCount !== null) {
        setPosts((prev) =>
          prev.map((post) =>
            post.id === postId ? { ...post, replyCount: nextReplyCount } : post
          )
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post reply");
    } finally {
      setReplyLoadingByPost((prev) => ({ ...prev, [postId]: false }));
    }
  }

  const profileHref = user?.wallet?.address ? `/profile/${user.wallet.address}` : null;
  const sidebarItems: Array<{ label: string; href: string; active?: boolean }> = [
    { label: "Home", href: "/feed" },
    { label: "Explore", href: "/explore", active: true },
    { label: "Notifications", href: "/notifications" },
    { label: "Messages", href: "/messages" },
    { label: "Bookmarks", href: "/bookmarks" },
    { label: "Lists", href: "/lists" },
    ...(profileHref ? [{ label: "Profile", href: profileHref }] : []),
    { label: "Settings", href: "/settings" },
  ];

  const searchMatches = ranked.slice(0, 3);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="relative isolate grid min-h-screen grid-cols-12">
        <div className="absolute inset-x-0 top-[-18rem] -z-10 flex justify-center blur-3xl">
          <div className="h-[36rem] w-[36rem] rounded-full bg-cyan-500/14" />
        </div>
        <div className="absolute left-[-8rem] top-56 -z-10 h-72 w-72 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute right-[-10rem] top-80 -z-10 h-80 w-80 rounded-full bg-lime-400/10 blur-3xl" />

      <aside className="hidden md:flex md:col-span-3 lg:col-span-2 flex-col px-5 py-6 lg:px-6">
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur">
          <p className="mb-6 text-xl font-black uppercase tracking-[-0.04em] text-white">ChainSocial</p>
          <nav className="mb-8 space-y-2">
            {sidebarItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`block rounded-xl px-4 py-3 text-sm transition ${
                  item.active
                    ? "border border-cyan-400/30 bg-cyan-400/10 font-semibold text-white"
                    : "text-gray-300 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {authenticated && (
            <button
              onClick={logout}
              className="w-full rounded-xl border border-white/10 px-4 py-3 text-left text-gray-300 transition hover:bg-white/[0.06] hover:text-red-300"
            >
              Logout
            </button>
          )}
        </div>
      </aside>

      <main className="col-span-12 md:col-span-9 lg:col-span-8 flex justify-center px-4 py-6 md:px-6">
        <div className="w-full max-w-3xl">
          <section className="animate-fade-up rounded-[2.25rem] border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="mb-3 inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-cyan-200">
                  Explore
                </p>
                <h1 className="text-3xl font-black uppercase leading-none tracking-[-0.05em] text-white sm:text-5xl">
                  Find the posts
                  <br />
                  pulling attention.
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-gray-300 sm:text-base sm:leading-7">
                  Search the loaded graph, surface active conversations, and scan what is rising right now.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:max-w-xs">
                <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-4 text-center">
                  <p className="text-xl font-bold text-white">{posts.length}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">Loaded</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-4 text-center">
                  <p className="text-xl font-bold text-white">{ranked.length}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">Ranked</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-4 text-center">
                  <p className="text-xl font-bold text-white">{query.trim() ? "Live" : "Open"}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">Search</p>
                </div>
              </div>
            </div>
          </section>

          <section className="animate-fade-up animate-fade-up-delay-1 mt-4 space-y-4 lg:hidden">
            <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {sidebarItems.map((item) => (
                <Link
                  key={`mobile-${item.label}`}
                  href={item.href}
                  className={`shrink-0 rounded-full px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                    item.active
                      ? "border border-cyan-400/30 bg-cyan-400/10 text-white"
                      : "border border-white/10 bg-white/[0.04] text-gray-300"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>

            <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-[11px] uppercase tracking-[0.22em] text-gray-400">Search</p>
                <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-gray-500">
                  Ranked live
                </span>
              </div>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search posts, usernames, or addresses"
                className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white"
              />
            </div>
          </section>

          <div className="animate-fade-up animate-fade-up-delay-2 mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Search the graph</p>
                <p className="text-xs text-gray-400">Usernames, addresses, and post content from what is currently loaded.</p>
              </div>
              <span className="hidden rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-cyan-200 sm:inline-flex">
                Explore
              </span>
            </div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search posts, usernames, or addresses"
              className="hidden w-full rounded-[1.25rem] border border-white/10 bg-black/30 px-4 py-3 text-sm text-white lg:block"
            />
          </div>

          {error && (
            <div className="mt-6 rounded-[1.5rem] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          )}

          <div className="mt-6 space-y-5">
            {ranked.map(({ post, score }, index) => {
              const liked = (post.likes ?? []).includes(viewerAddress);
              const reposted = (post.reposts ?? []).includes(viewerAddress);
              const bookmarked = bookmarkedPostIds.includes(post.id);
              const repliesOpen = !!expandedReplies[post.id];
              const replies = repliesByPost[post.id] ?? [];
              const hasMedia = (post.metadata?.media?.length ?? 0) > 0;
              const timestamp = new Date(post.timestamp);
              const timestampLabel = Number.isNaN(timestamp.getTime())
                ? post.timestamp
                : timestamp.toLocaleString();
              const displayName = post.author.username?.localName ?? shortenAddress(post.author.address);

              return (
                <article
                  key={post.id}
                  className={`animate-fade-up rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[0.07] via-white/[0.04] to-transparent shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition duration-200 hover:border-white/15 hover:bg-white/[0.07] ${
                    settings.compactFeed ? "p-4" : "p-5"
                  }`}
                  style={{ animationDelay: `${Math.min(index, 5) * 60}ms` }}
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <Image
                        src={`https://api.dicebear.com/7.x/bottts/svg?seed=${post.author.address}`}
                        alt="avatar"
                        width={40}
                        height={40}
                        unoptimized
                        className="mt-0.5 h-10 w-10 rounded-full border border-white/10 bg-white object-cover shadow-sm"
                      />
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Link href={`/profile/${post.author.address}`} className="inline-block max-w-[18rem] break-all text-[15px] font-semibold text-white hover:underline">
                            {displayName}
                          </Link>
                          <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-gray-400">
                            {hasMedia ? "Media post" : "Text post"}
                          </span>
                          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-200">
                            Hot {score.toFixed(1)}
                          </span>
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-gray-500">
                          <span className="max-w-[18rem] break-all">{shortenAddress(post.author.address)}</span>
                          <span>{timestampLabel}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={`mb-4 whitespace-pre-wrap break-words text-gray-100 ${settings.compactFeed ? "text-sm leading-6" : "text-[15px] leading-7"}`}>
                    {renderContentWithWrappedLinks(post.metadata?.content)}
                  </div>

                  {post.metadata?.media && post.metadata.media.length > 0 && (
                    <PostMedia media={post.metadata.media} settings={settings} />
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
                    <button
                      className={`flex items-center gap-2 rounded-full px-3.5 py-2 text-sm transition-colors ${liked ? "bg-pink-500/10 text-pink-300" : "border border-white/10 text-gray-300 hover:bg-white/[0.06]"}`}
                      onClick={() => void handleLike(post.id)}
                      disabled={!authenticated}
                    >
                      <span className="text-xs uppercase tracking-[0.18em]">Like</span>
                      <span className="text-xs text-current/80">/</span>
                      <span>{post.likes?.length ?? 0}</span>
                    </button>
                    <button
                      className={`flex items-center gap-2 rounded-full px-3.5 py-2 text-sm transition-colors ${reposted ? "bg-lime-400/10 text-lime-200" : "border border-white/10 text-gray-300 hover:bg-white/[0.06]"}`}
                      onClick={() => void handleRepost(post.id)}
                      disabled={!authenticated}
                    >
                      <span className="text-xs uppercase tracking-[0.18em]">{reposted ? "Reposted" : "Repost"}</span>
                      <span className="text-xs text-current/80">/</span>
                      <span>{post.reposts?.length ?? 0}</span>
                    </button>
                    <button
                      className="flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-2 text-sm text-gray-300 transition hover:bg-white/[0.06]"
                      onClick={() => toggleReplies(post.id)}
                    >
                      <span className="text-xs uppercase tracking-[0.18em]">{repliesOpen ? "Hide Replies" : "Replies"}</span>
                      <span className="text-xs text-current/80">/</span>
                      <span>{post.replyCount ?? 0}</span>
                    </button>
                    <button
                      className={`flex items-center gap-2 rounded-full px-3.5 py-2 text-sm transition-colors ${bookmarked ? "bg-yellow-400/10 text-yellow-200" : "border border-white/10 text-gray-300 hover:bg-white/[0.06]"}`}
                      onClick={() => void handleBookmark(post.id)}
                      disabled={!authenticated}
                    >
                      <span className="text-xs uppercase tracking-[0.18em]">{bookmarked ? "Saved" : "Save"}</span>
                    </button>
                  </div>

                  {repliesOpen && (
                    <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
                      {authenticated && (
                        <div className="space-y-2">
                          <textarea
                            className="w-full rounded-[1.25rem] border border-white/10 bg-black/40 p-3 text-sm text-white"
                            rows={2}
                            placeholder="Write a reply"
                            value={replyDraftByPost[post.id] ?? ""}
                            onChange={(event) =>
                              setReplyDraftByPost((prev) => ({
                                ...prev,
                                [post.id]: event.target.value,
                              }))
                            }
                          />
                          <button
                            onClick={() => void submitReply(post.id)}
                            disabled={replyLoadingByPost[post.id]}
                            className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-50"
                          >
                            Reply
                          </button>
                        </div>
                      )}
                      {replyLoadingByPost[post.id] && replies.length === 0 && (
                        <p className="text-xs text-gray-400">Loading replies...</p>
                      )}
                      {replies.map((reply) => (
                        <div key={reply.id} className="rounded-[1.25rem] border border-white/10 bg-black/30 p-3">
                          <div className="mb-1 flex items-center gap-2">
                            <Link href={`/profile/${reply.author.address}`} className="text-sm font-medium hover:underline">
                              {reply.author.username?.localName ?? shortenAddress(reply.author.address)}
                            </Link>
                            <span className="text-xs text-gray-500">{new Date(reply.timestamp).toLocaleString()}</span>
                          </div>
                          <div className="whitespace-pre-wrap break-words text-sm">
                            {renderContentWithWrappedLinks(reply.metadata?.content)}
                          </div>
                        </div>
                      ))}
                      {!replyLoadingByPost[post.id] && replies.length === 0 && (
                        <p className="text-xs text-gray-500">No replies yet.</p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            {ranked.length === 0 && <p className="text-sm text-gray-500">No posts match your search.</p>}
          </div>
        </div>
      </main>

      <aside className="hidden lg:block lg:col-span-2 px-5 py-6 lg:px-6">
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur">
          <div className="mb-6 rounded-[1.6rem] border border-cyan-400/20 bg-gradient-to-br from-cyan-400/10 via-white/[0.03] to-lime-300/10 p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">Explore Signals</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Why these posts rise</h2>
            <p className="mt-2 text-sm leading-6 text-gray-300">
              Explore favors conversation energy over raw recency so the page surfaces what is actively moving.
            </p>
          </div>
          <div className="space-y-3 text-sm text-gray-300">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              Replies carry the strongest weight because they signal actual conversation.
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              Likes and reposts still matter, but they trail replies in the score.
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              Older posts decay over time, so fresh activity can overtake stale winners.
            </div>
          </div>
          {query.trim() && (
            <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Current query</p>
              <p className="mt-2 text-sm text-white">“{query.trim()}”</p>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                {searchMatches.length === 0
                  ? "Nothing loaded matches yet."
                  : `${searchMatches.length} high-signal result${searchMatches.length === 1 ? "" : "s"} visible now.`}
              </p>
            </div>
          )}
          <div className="mt-8 border-t border-white/10 pt-4 text-xs text-gray-400">
            <div className="flex flex-col gap-2">
              <Link href="/legal/privacy" className="hover:text-white">Privacy</Link>
              <Link href="/legal/terms" className="hover:text-white">Terms</Link>
              <Link href="/legal/cookies" className="hover:text-white">Cookies</Link>
            </div>
          </div>
        </div>
      </aside>
      </div>
    </div>
  );
}
