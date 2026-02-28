"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { readBookmarks, toggleBookmarkId } from "@/lib/client/bookmarks";

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

function getMediaKind(url: string): "video" | "gif" | "image" {
  if (/[?&]__media=video(\b|&|$)/i.test(url)) return "video";
  if (/[?&]__media=gif(\b|&|$)/i.test(url)) return "gif";
  if (/\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(url)) return "video";
  if (/\.(gif)(\?|$)/i.test(url)) return "gif";
  if (/\/(video|videos)\//i.test(url)) return "video";
  return "image";
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

  const { authenticated, user, logout } = usePrivy();
  const viewerAddress = useMemo(
    () => user?.wallet?.address?.toLowerCase() ?? "",
    [user?.wallet?.address]
  );

  useEffect(() => {
    setBookmarkedPostIds(readBookmarks());
    const onBookmarksChanged = () => setBookmarkedPostIds(readBookmarks());
    window.addEventListener("chainsocial:bookmarks-changed", onBookmarksChanged);
    return () =>
      window.removeEventListener("chainsocial:bookmarks-changed", onBookmarksChanged);
  }, []);

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

        if (
          (res.status === 401 ||
            (typeof data.error === "string" && data.error.includes("Unauthenticated"))) &&
          retryCount === 0
        ) {
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
      if (data.post) {
        setPosts((prev) => prev.map((post) => (post.id === postId ? data.post : post)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update like");
    }
  }

  async function handleRepost(postId: string) {
    if (!viewerAddress) return;
    setError(null);
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

        if (
          (res.status === 401 ||
            (typeof data.error === "string" && data.error.includes("Unauthenticated"))) &&
          retryCount === 0
        ) {
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
      if (data.post) {
        setPosts((prev) => prev.map((post) => (post.id === postId ? data.post : post)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update repost");
    }
  }

  function handleBookmark(postId: string) {
    setBookmarkedPostIds(toggleBookmarkId(postId));
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
      const res = await fetch(`/api/posts/${postId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to post reply");
      setReplyDraftByPost((prev) => ({ ...prev, [postId]: "" }));
      await fetchReplies(postId);
      if (typeof data.replyCount === "number") {
        setPosts((prev) =>
          prev.map((post) =>
            post.id === postId ? { ...post, replyCount: data.replyCount } : post
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

  return (
    <div className="min-h-screen grid grid-cols-12 bg-black text-white">
      <aside className="hidden md:flex md:col-span-3 lg:col-span-2 flex-col border-r border-gray-800 py-8 px-6">
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
          <p className="text-xl font-bold mb-6 text-white">ChainSocial</p>
          <nav className="mb-8 space-y-1">
            {sidebarItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`block rounded-lg px-3 py-2 transition ${
                  item.active
                    ? "bg-gray-900 text-white font-semibold"
                    : "text-gray-300 hover:bg-gray-900 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {authenticated && (
            <button
              onClick={logout}
              className="rounded-lg px-3 py-2 text-left text-gray-300 hover:bg-gray-900 hover:text-red-400"
            >
              Logout
            </button>
          )}
        </div>
      </aside>

      <main className="col-span-12 md:col-span-9 lg:col-span-8 flex justify-center">
        <div className="w-full max-w-2xl px-6 py-6">
          <h1 className="mb-2 text-2xl font-semibold">Explore</h1>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search posts, usernames, or addresses"
            className="mb-4 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm"
          />

          {error && (
            <div className="mb-4 rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {ranked.map(({ post, score }) => {
              const liked = (post.likes ?? []).includes(viewerAddress);
              const reposted = (post.reposts ?? []).includes(viewerAddress);
              const bookmarked = bookmarkedPostIds.includes(post.id);
              const repliesOpen = !!expandedReplies[post.id];
              const replies = repliesByPost[post.id] ?? [];

              return (
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
                    <span className="rounded-full bg-emerald-950 px-2 py-1 text-xs text-emerald-300">
                      Hot {score.toFixed(1)}
                    </span>
                  </div>

                  <div className="mb-2 whitespace-pre-wrap break-words text-gray-100">
                    {renderContentWithWrappedLinks(post.metadata?.content)}
                  </div>

                  {post.metadata?.media && post.metadata.media.length > 0 && (
                    <div className={`mb-2 ${post.metadata.media.length === 1 ? "max-w-xl" : "grid grid-cols-2 gap-2"}`}>
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

                  <div className="mt-2 flex items-center gap-4">
                    <button
                      className={`rounded px-2 py-1 text-sm hover:bg-gray-800 ${liked ? "text-pink-500" : "text-gray-400"}`}
                      onClick={() => void handleLike(post.id)}
                      disabled={!authenticated}
                    >
                      Like {post.likes?.length ?? 0}
                    </button>
                    <button
                      className={`rounded px-2 py-1 text-sm hover:bg-gray-800 ${reposted ? "text-green-400" : "text-gray-400"}`}
                      onClick={() => void handleRepost(post.id)}
                      disabled={!authenticated}
                    >
                      {reposted ? "Reposted" : "Repost"} {post.reposts?.length ?? 0}
                    </button>
                    <button
                      className="rounded px-2 py-1 text-sm text-gray-400 hover:bg-gray-800"
                      onClick={() => toggleReplies(post.id)}
                    >
                      {repliesOpen ? "Hide Replies" : "Replies"} {post.replyCount ?? 0}
                    </button>
                    <button
                      className={`rounded px-2 py-1 text-sm hover:bg-gray-800 ${bookmarked ? "text-yellow-400" : "text-gray-400"}`}
                      onClick={() => handleBookmark(post.id)}
                    >
                      {bookmarked ? "Bookmarked" : "Bookmark"}
                    </button>
                    <span className="text-xs text-gray-500">{new Date(post.timestamp).toLocaleString()}</span>
                  </div>

                  {repliesOpen && (
                    <div className="mt-3 space-y-3 border-t border-gray-700 pt-3">
                      {authenticated && (
                        <div className="space-y-2">
                          <textarea
                            className="w-full rounded border border-gray-700 bg-black p-2 text-sm text-white"
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
                            className="rounded bg-blue-600 px-3 py-1 text-xs disabled:opacity-50"
                          >
                            Reply
                          </button>
                        </div>
                      )}
                      {replyLoadingByPost[post.id] && replies.length === 0 && (
                        <p className="text-xs text-gray-400">Loading replies...</p>
                      )}
                      {replies.map((reply) => (
                        <div key={reply.id} className="rounded-lg border border-gray-800 bg-black/40 p-3">
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
            {ranked.length === 0 && <p className="text-gray-500">No posts match your search.</p>}
          </div>
        </div>
      </main>

      <aside className="hidden lg:block lg:col-span-2 border-l border-gray-800 px-4 py-8">
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">Explore Signals</h2>
          <div className="space-y-2 text-xs text-gray-500">
            <p>Replies have highest weight.</p>
            <p>Reposts and likes boost rank.</p>
            <p>Older posts decay over time.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
