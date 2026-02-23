"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";

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
    profileImage?: string;
    avatar?: string;
  };
  likes?: string[];
  replyCount?: number;
  optimistic?: boolean;
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
  error?: string;
  source?: "lens" | "local";
  lensFallbackError?: string;
};

const PAGE_SIZE = 10;
const MAX_POST_LENGTH = 280;

export default function FeedPage() {
    const [hasLensProfile, setHasLensProfile] = useState<boolean | null>(null);
    const [checkingProfile, setCheckingProfile] = useState(false);
    const [showMintPrompt, setShowMintPrompt] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [feedStatus, setFeedStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextCursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);

  const [newPost, setNewPost] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [mediaPreview, setMediaPreview] = useState<string[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [editingLoading, setEditingLoading] = useState(false);

  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [repliesByPost, setRepliesByPost] = useState<Record<string, Reply[]>>({});
  const [replyDraftByPost, setReplyDraftByPost] = useState<Record<string, string>>({});
  const [replyLoadingByPost, setReplyLoadingByPost] = useState<Record<string, boolean>>({});

  const { authenticated, user, logout } = usePrivy();
  const [isAuthReady, setIsAuthReady] = useState(false);

  const viewerAddress = useMemo(
    () => user?.wallet?.address?.toLowerCase() ?? "",
    [user?.wallet?.address]
  );

  useEffect(() => {
    if (typeof authenticated === "boolean") {
      setIsAuthReady(true);
    }
  }, [authenticated]);

  useEffect(() => {
    // Check for Lens profile after wallet connect
    if (viewerAddress && isAuthReady && authenticated) {
      setCheckingProfile(true);
      fetch(`${process.env.NEXT_PUBLIC_LENS_API_URL || "https://api-v2.lens.dev"}/profiles?ownedBy=${viewerAddress}`)
        .then(res => res.json())
        .then(data => {
          const hasProfile = !!data?.data?.profiles?.items?.length;
          setHasLensProfile(hasProfile);
          setShowMintPrompt(!hasProfile);
        })
        .catch(() => {
          setHasLensProfile(false);
          setShowMintPrompt(true);
        })
        .finally(() => setCheckingProfile(false));
    } else {
      setHasLensProfile(null);
      setShowMintPrompt(false);
    }
  }, [viewerAddress, isAuthReady, authenticated]);

  useEffect(() => {
    nextCursorRef.current = nextCursor;
  }, [nextCursor]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  const fetchPosts = useCallback(async ({ reset }: { reset: boolean }) => {
    const cursor = reset ? null : nextCursorRef.current;

    if (reset) {
      setFeedStatus("loading");
      setError(null);
    } else {
      if (!cursor || loadingMoreRef.current) return;
      setLoadingMore(true);
      loadingMoreRef.current = true;
    }

    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor) params.set("cursor", cursor);

      const res = await fetch(`/api/posts?${params.toString()}`);
      const data = (await res.json()) as FeedResponse;

      if (!res.ok) {
        throw new Error(data.error || "Failed to load feed");
      }

      const incomingPosts = data.posts ?? [];
      setPosts((prev) => (reset ? incomingPosts : [...prev, ...incomingPosts]));
      setNextCursor(data.nextCursor ?? null);
      setFeedStatus("ready");
      
      // Show Lens fallback warning if we fell back to local store
      if (data.source === "local" && data.lensFallbackError) {
        console.warn("Using local store instead of Lens. Error:", data.lensFallbackError);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load feed";
      setError(message);
      if (reset) setFeedStatus("error");
    } finally {
      if (!reset) {
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    void fetchPosts({ reset: true });
  }, [fetchPosts]);

  async function handlePostSubmit(e: React.FormEvent) {
    e.preventDefault();

    const content = newPost.trim();
    if (!content || !viewerAddress || content.length > MAX_POST_LENGTH) return;

    setSubmitting(true);
    setError(null);

    let mediaUrls: string[] = [];
    if (mediaFiles.length > 0) {
      // Validate file type and size (max 5MB per image, images only)
      for (const file of mediaFiles) {
        if (!file.type.startsWith("image/")) {
          setError("Only image files are allowed.");
          setSubmitting(false);
          return;
        }
        if (file.size > 5 * 1024 * 1024) {
          setError("Each image must be under 5MB.");
          setSubmitting(false);
          return;
        }
      }
      setUploadingMedia(true);
      try {
        const uploadPromises = mediaFiles.map(async (file) => {
          // Dynamically import IPFS helper
          const { uploadToIPFS } = await import("@/lib/ipfs");
          return await uploadToIPFS(file);
        });
        mediaUrls = await Promise.all(uploadPromises);
      } catch (err) {
        setError("Failed to upload media");
        setSubmitting(false);
        setUploadingMedia(false);
        return;
      }
      setUploadingMedia(false);
    }

    const tempId = `temp-${crypto.randomUUID()}`;
    const optimisticPost: Post = {
      id: tempId,
      timestamp: new Date().toISOString(),
      metadata: { content, media: mediaUrls },
      author: {
        address: viewerAddress,
      },
      likes: [],
      replyCount: 0,
      optimistic: true,
    };

    setNewPost("");
    setMediaFiles([]);
    setMediaPreview([]);
    setPosts((prev) => [optimisticPost, ...prev]);

    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, media: mediaUrls }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to publish post");
      }

      setPosts((prev) => prev.map((post) => (post.id === tempId ? data.post : post)));
    } catch (e) {
      setPosts((prev) => prev.filter((post) => post.id !== tempId));
      const message = e instanceof Error ? e.message : "Failed to publish post";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLike(postId: string) {
    if (!viewerAddress) return;

    setError(null);
    const currentlyLiked =
      posts.find((post) => post.id === postId)?.likes?.includes(viewerAddress) ?? false;

    setPosts((prev) =>
      prev.map((post) => {
        if (post.id !== postId) return post;
        const likes = post.likes ?? [];
        const liked = likes.includes(viewerAddress);
        return {
          ...post,
          likes: liked
            ? likes.filter((address) => address !== viewerAddress)
            : [...likes, viewerAddress],
        };
      })
    );

    try {
      const res = await fetch(`/api/posts/${postId}/likes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentlyLiked }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update like");
      }

      if (data.post) {
        setPosts((prev) => prev.map((post) => (post.id === postId ? data.post : post)));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to update like";
      setError(message);
      await fetchPosts({ reset: true });
    }
  }

  async function fetchReplies(postId: string) {
    setReplyLoadingByPost((prev) => ({ ...prev, [postId]: true }));

    try {
      const res = await fetch(`/api/posts/${postId}/replies?limit=20`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load replies");
      }

      setRepliesByPost((prev) => ({ ...prev, [postId]: data.replies ?? [] }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load replies";
      setError(message);
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
    if (!content || !viewerAddress || content.length > MAX_POST_LENGTH) return;

    setReplyLoadingByPost((prev) => ({ ...prev, [postId]: true }));
    setError(null);

    try {
      const res = await fetch(`/api/posts/${postId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to post reply");
      }

      setReplyDraftByPost((prev) => ({ ...prev, [postId]: "" }));
      setRepliesByPost((prev) => ({
        ...prev,
        [postId]: [data.reply, ...(prev[postId] ?? [])],
      }));
      setPosts((prev) =>
        prev.map((post) =>
          post.id === postId
            ? { ...post, replyCount: data.replyCount ?? (post.replyCount ?? 0) + 1 }
            : post
        )
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to post reply";
      setError(message);
    } finally {
      setReplyLoadingByPost((prev) => ({ ...prev, [postId]: false }));
    }
  }

  function beginEdit(post: Post) {
    setEditingPostId(post.id);
    setEditingContent(post.metadata?.content ?? "");
  }

  async function saveEdit(postId: string) {
    const content = editingContent.trim();
    if (!content || content.length > MAX_POST_LENGTH) return;

    setEditingLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to edit post");
      }

      if (data.post) {
        setPosts((prev) => prev.map((post) => (post.id === postId ? data.post : post)));
      } else {
        setPosts((prev) =>
          prev.map((post) =>
            post.id === postId
              ? { ...post, metadata: { content } }
              : post
          )
        );
      }
      setEditingPostId(null);
      setEditingContent("");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to edit post";
      setError(message);
    } finally {
      setEditingLoading(false);
    }
  }

  async function removePost(postId: string) {
    setError(null);
    const previous = posts;
    setPosts((prev) => prev.filter((post) => post.id !== postId));

    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete post");
      }
    } catch (e) {
      setPosts(previous);
      const message = e instanceof Error ? e.message : "Failed to delete post";
      setError(message);
    }
  }

  const trimmedPost = newPost.trim();
  const remainingChars = MAX_POST_LENGTH - trimmedPost.length;
  const postTooLong = remainingChars < 0;
  const canSubmit = !!viewerAddress && !!trimmedPost && !postTooLong && !submitting;

  return (
    <div className="min-h-screen text-text grid grid-cols-12" style={{background: 'transparent'}}>
      <aside className="hidden md:flex md:col-span-3 lg:col-span-2 flex-col border-r border-border py-8 px-6 bg-card shadow-sm">
        <Link
          href="/feed"
          className="text-xl font-bold mb-8 text-white hover:text-blue-400"
        >
          Home
        </Link>
        {isAuthReady && authenticated && user?.wallet?.address ? (
          <>
            <Link
              href={`/profile/${user.wallet.address}`}
              className="text-secondary hover:text-primary mb-4"
            >
              Profile
            </Link>
            <button
              onClick={logout}
              className="text-text-light hover:text-red-500 text-left transition"
            >
              Logout
            </button>
          </>
        ) : (
          <div className="text-text-light mt-8">
            <p className="mb-4">Welcome to ChainSocial!</p>
            <p className="mb-2">Sign in with your wallet to post and follow others.</p>
            <div className="mb-2 text-xs text-text-light">
              <span role="img" aria-label="wallet">💳</span> Supported wallets: MetaMask, Coinbase, WalletConnect
            </div>
            <Link href="https://claim.lens.xyz/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Mint a Lens profile
            </Link>
            <div className="mt-6 text-xs text-text-light">
              <p>Viewing public feed. No login required.</p>
              <p className="mt-2">We use wallet login for secure, passwordless access. Your funds are never at risk.</p>
              <Link href="/help" className="text-primary hover:underline mt-2 inline-block">How wallet login works</Link>
            </div>
          </div>
        )}
      </aside>

      <main className="col-span-12 md:col-span-9 lg:col-span-8 flex justify-center" style={{background: 'transparent'}}>
        <div className="w-full max-w-2xl px-6 py-6">
          <h2 className="text-3xl font-bold mb-8 text-white">Global Feed</h2>

          {isAuthReady && authenticated && (
            <div className="sticky top-0 z-20 bg-background pt-2 pb-4 -mx-6 px-6 border-b border-border">
              {checkingProfile ? (
                <div className="text-gray-400">Checking Lens profile...</div>
              ) : hasLensProfile ? (
                <form
                  onSubmit={handlePostSubmit}
                  className="bg-card/80 rounded-2xl p-6 border border-border shadow-md space-y-4"
                >
                  <textarea
                    className="w-full bg-background text-text rounded-lg p-3 mb-4 border border-border focus:ring-2 focus:ring-primary focus:outline-none transition text-lg"
                    rows={3}
                    placeholder="What's happening?"
                    value={newPost}
                    onChange={(event) => setNewPost(event.target.value)}
                    disabled={submitting || uploadingMedia}
                  />
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="block mb-4 text-text-light bg-background border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:outline-none transition"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      setMediaFiles(files);
                      setMediaPreview(files.map((file) => URL.createObjectURL(file)));
                    }}
                    disabled={submitting || uploadingMedia}
                  />
                  {mediaPreview.length > 0 && (
                    <div className="flex gap-2 mb-2">
                      {mediaPreview.map((url, idx) => (
                        <img
                          key={idx}
                          src={url}
                          alt="preview"
                          className="w-16 h-16 object-cover rounded border border-border"
                        />
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between items-center mt-2">
                    <span
                      className={`text-xs ${postTooLong ? "text-red-400" : "text-text-light"}`}
                    >
                      {remainingChars} chars left
                    </span>
                    <button
                      type="submit"
                      className="bg-primary text-white px-5 py-2 rounded-lg font-semibold shadow-md disabled:opacity-50 hover:bg-secondary/80 focus:ring-2 focus:ring-primary focus:outline-none transition"
                      disabled={!canSubmit || uploadingMedia}
                    >
                      {submitting || uploadingMedia ? "Posting..." : "Post"}
                    </button>
                  </div>
                </form>
              ) : showMintPrompt ? (
                <div className="bg-card/80 rounded-2xl p-6 border border-border shadow-md text-center">
                  <p className="mb-4 text-red-400">You need a Lens profile to post.</p>
                  <a
                    href="https://claim.lens.xyz/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-primary px-4 py-2 rounded text-white inline-block hover:bg-secondary/80 focus:ring-2 focus:ring-primary focus:outline-none transition"
                  >
                    Mint Lens Profile
                  </a>
                </div>
              ) : null}
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200 flex items-center justify-between gap-2">
              <span>{error}</span>
              <button
                onClick={() => void fetchPosts({ reset: true })}
                className="rounded border border-red-700 px-2 py-1 text-xs hover:bg-red-50 hover:text-red-700 transition"
              >
                Retry
              </button>
            </div>
          )}

          {feedStatus === "loading" && <p className="text-gray-400">Loading...</p>}

          {feedStatus === "error" && (
            <p className="text-gray-500">Feed unavailable right now.</p>
          )}

          {feedStatus === "ready" && posts.length === 0 && (
            <p className="text-gray-500">No posts found.</p>
          )}

          <div className="space-y-6">
            {posts.map((post) => {
              const liked = (post.likes ?? []).includes(viewerAddress);
              const isOwner = viewerAddress === post.author.address.toLowerCase();
              const isEditing = editingPostId === post.id;
              const repliesOpen = !!expandedReplies[post.id];
              const replies = repliesByPost[post.id] ?? [];

              return (
                <div
                  key={post.id}
                  className="border border-border bg-card/80 rounded-2xl p-6 flex gap-6 transition-shadow hover:shadow-lg hover:bg-accent/40 shadow-md"
                >
                  <Link href={`/profile/${post.author.address}`} className="shrink-0">
                    {/* Profile picture removed, only mini avatar will show next to username */}
                  </Link>
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <img
                          src={`https://api.dicebear.com/7.x/bottts/svg?seed=${post.author.address}`}
                          alt="cute avatar"
                          className="w-8 h-8 rounded-full border border-gray-700 bg-white mr-2 shadow"
                          style={{ display: 'inline-block', verticalAlign: 'middle' }}
                        />
                        <Link
                          href={`/profile/${post.author.address}`}
                          className="font-semibold text-white hover:underline"
                          style={{ display: 'inline-block', verticalAlign: 'middle' }}
                        >
                          {post.author.username?.localName ||
                            shortenAddress(post.author.address)}
                        </Link>
                        <span className="text-xs text-gray-400">
                          {shortenAddress(post.author.address)}
                        </span>
                        {post.optimistic && (
                          <span className="text-xs text-yellow-300">Sending...</span>
                        )}
                      </div>
                      {isOwner && !post.optimistic && !isEditing && (
                        <div className="flex items-center gap-2 text-xs">
                          <button
                            onClick={() => beginEdit(post)}
                            className="text-blue-400 hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => void removePost(post.id)}
                            className="text-red-400 hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          className="w-full bg-black text-white rounded-lg p-3 border border-gray-700 text-lg focus:ring-2 focus:ring-primary focus:outline-none transition"
                          rows={3}
                          value={editingContent}
                          onChange={(event) => setEditingContent(event.target.value)}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => void saveEdit(post.id)}
                            disabled={editingLoading}
                            className="bg-blue-600 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 shadow-md hover:bg-blue-700 transition"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingPostId(null);
                              setEditingContent("");
                            }}
                            className="border border-gray-600 px-4 py-2 rounded-lg text-sm shadow-md hover:bg-gray-700 transition"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mb-2 whitespace-pre-wrap break-words text-text" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{post.metadata?.content}</div>
                        {post.metadata?.media && post.metadata.media.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {post.metadata.media.map((url, idx) => (
                              <img
                                key={idx}
                                src={url}
                                alt="media"
                                className="max-h-48 rounded border border-border bg-background"
                                style={{ maxWidth: '100%', objectFit: 'cover' }}
                              />
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    <div className="flex items-center gap-4 mt-2">
                      <button
                        className={`flex items-center gap-1 text-sm px-2 py-1 rounded hover:bg-accent/40 transition-colors ${liked ? "text-pink-500" : "text-text-light"}`}
                        onClick={() => void handleLike(post.id)}
                        disabled={!isAuthReady || !authenticated || post.optimistic}
                        aria-label={liked ? "Unlike" : "Like"}
                      >
                        <span>Like</span>
                        <span>{post.likes?.length || 0}</span>
                      </button>

                      <button
                        className="flex items-center gap-1 text-sm px-2 py-1 rounded hover:bg-accent/40 text-text-light"
                        onClick={() => toggleReplies(post.id)}
                        disabled={post.optimistic}
                      >
                        <span>{repliesOpen ? "Hide Replies" : "Replies"}</span>
                        <span>{post.replyCount ?? 0}</span>
                      </button>

                      <span className="text-xs text-text-light">
                        {new Date(post.timestamp).toLocaleString()}
                      </span>
                    </div>

                    {repliesOpen && (
                      <div className="mt-3 border-t border-border pt-3 space-y-3">
                        {isAuthReady && authenticated && (
                          <div className="space-y-2">
                            <textarea
                              className="w-full bg-background text-text rounded p-2 border border-border text-sm"
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
                              className="bg-primary px-3 py-1 rounded text-xs disabled:opacity-50 hover:bg-secondary transition"
                            >
                              Reply
                            </button>
                          </div>
                        )}

                        {replyLoadingByPost[post.id] && replies.length === 0 && (
                          <p className="text-xs text-text-light">Loading replies...</p>
                        )}

                        {replies.map((reply) => (
                          <div key={reply.id} className="rounded-xl bg-black/60 border border-gray-800 p-4 shadow">
                            <div className="flex items-center gap-2 mb-1">
                              <Link
                                href={`/profile/${reply.author.address}`}
                                className="text-sm font-medium hover:underline"
                              >
                                {reply.author.username?.localName || shortenAddress(reply.author.address)}
                              </Link>
                              <span className="text-xs text-gray-500">
                                {new Date(reply.timestamp).toLocaleString()}
                              </span>
                            </div>
                            <div className="text-sm whitespace-pre-wrap">{reply.metadata?.content}</div>
                          </div>
                        ))}

                        {!replyLoadingByPost[post.id] && replies.length === 0 && (
                          <p className="text-xs text-text-light">No replies yet.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {nextCursor && (
            <div className="flex justify-center mt-10">
              <button
                onClick={() => void fetchPosts({ reset: false })}
                disabled={loadingMore}
                className="px-6 py-2 bg-primary text-white rounded-lg font-semibold shadow-md disabled:opacity-50 hover:bg-secondary/80 focus:ring-2 focus:ring-primary focus:outline-none transition border border-white"
                style={{color: '#fff'}}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </div>
      </main>

      <aside className="hidden lg:flex lg:col-span-2 flex-col border-l border-border py-8 px-6 bg-card shadow-sm">
        <div>
          <h3 className="font-bold mb-4">Trends</h3>
          <ul className="space-y-2 text-gray-400">
            <li>#Web3</li>
            <li>#DeFi</li>
            <li>#Crypto</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
