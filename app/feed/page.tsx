"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import Link from "next/link";
import { clearDeduplicationCache, deduplicatedRequest } from "@/lib/request-deduplicator";
import { retryWithBackoff } from "@/lib/retry-backoff";
import { compressImages, getFileSize, getCompressionRatio } from "@/lib/image-compression";
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
    profileImage?: string;
    avatar?: string;
  };
  likes?: string[];
  reposts?: string[];
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

function isReply(value: unknown): value is Reply {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.postId === "string" &&
    typeof obj.timestamp === "string" &&
    !!obj.author &&
    typeof obj.author === "object" &&
    typeof (obj.author as Record<string, unknown>).address === "string"
  );
}

type FeedResponse = {
  posts?: Post[];
  nextCursor?: string | null;
  error?: string;
  source?: "lens" | "local";
  lensFallbackError?: string;
};

const PAGE_SIZE = 20;
const MAX_POST_LENGTH = 280;

function comparePostsDesc(a: Post, b: Post): number {
  if (a.timestamp === b.timestamp) {
    return b.id.localeCompare(a.id);
  }
  return b.timestamp.localeCompare(a.timestamp);
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

const URL_SPLIT_REGEX = /(https?:\/\/[^\s]+)/gi;

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

export default function FeedPage() {
    const [hasLensProfile, setHasLensProfile] = useState<boolean | null>(null);
    const [lensAccountAddress, setLensAccountAddress] = useState<string | null>(null);
    const [checkingProfile, setCheckingProfile] = useState(false);
    const [showMintPrompt, setShowMintPrompt] = useState(false);
    const [isLensAuthenticated, setIsLensAuthenticated] = useState(false);
    const [checkingLensSession, setCheckingLensSession] = useState(true);
    const [authenticatingLens, setAuthenticatingLens] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [feedStatus, setFeedStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextCursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const loadMoreAnchorRef = useRef<HTMLDivElement | null>(null);

  const [newPost, setNewPost] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [mediaPreview, setMediaPreview] = useState<string[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  // Cleanup blob URLs on unmount or when previews change
  useEffect(() => {
    return () => {
      mediaPreview.forEach((url) => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [mediaPreview]);

  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [editingLoading, setEditingLoading] = useState(false);

  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [repliesByPost, setRepliesByPost] = useState<Record<string, Reply[]>>({});
  const [replyDraftByPost, setReplyDraftByPost] = useState<Record<string, string>>({});
  const [replyLoadingByPost, setReplyLoadingByPost] = useState<Record<string, boolean>>({});
  const [bookmarkedPostIds, setBookmarkedPostIds] = useState<string[]>([]);
  const [sidebarSearch, setSidebarSearch] = useState("");

  const { authenticated, user, logout } = usePrivy();
  const { wallets } = useWallets();
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
    try {
      if (localStorage.getItem("lensAuthenticated") === "1") {
        setIsLensAuthenticated(true);
      }
    } catch {
      // ignore storage access errors
    }
  }, []);

  useEffect(() => {
    setBookmarkedPostIds(readBookmarks());
    const onBookmarksChanged = () => setBookmarkedPostIds(readBookmarks());
    window.addEventListener("chainsocial:bookmarks-changed", onBookmarksChanged);
    return () =>
      window.removeEventListener("chainsocial:bookmarks-changed", onBookmarksChanged);
  }, []);

  useEffect(() => {
    // Check for Lens profile after wallet connect
    if (viewerAddress && isAuthReady && authenticated) {
      setCheckingProfile(true);
      fetch("/api/lens/check-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: viewerAddress }),
        cache: "no-store",
      })
        .then(res => res.json())
        .then(data => {
          setHasLensProfile(data.hasProfile);
          setLensAccountAddress(typeof data.accountAddress === "string" ? data.accountAddress : null);
          setShowMintPrompt(!data.hasProfile);
        })
        .catch(() => {
          setHasLensProfile(false);
          setLensAccountAddress(null);
          setShowMintPrompt(true);
        })
        .finally(() => setCheckingProfile(false));
    } else {
      setHasLensProfile(null);
      setLensAccountAddress(null);
      setShowMintPrompt(false);
    }
  }, [viewerAddress, isAuthReady, authenticated]);

  // Check for existing Lens session on page load
  useEffect(() => {
    if (!isAuthReady || !authenticated) {
      setCheckingLensSession(false);
      return;
    }

    console.log("[Lens] Checking session...");
    fetch("/api/lens/session", { credentials: "include", cache: "no-store" })
      .then(res => res.json())
      .then(data => {
        console.log("[Lens] Session check result:", data);
        if (data.authenticated) {
          setIsLensAuthenticated(true);
          try {
            localStorage.setItem("lensAuthenticated", "1");
          } catch {
            // ignore storage access errors
          }
          console.log("[Lens] Session restored successfully");
        } else {
          try {
            localStorage.removeItem("lensAuthenticated");
          } catch {
            // ignore storage access errors
          }
          setIsLensAuthenticated(false);
          console.log("[Lens] No valid session found, reason:", data.reason);
        }
      })
      .catch(err => {
        console.warn("[Lens] Session check failed:", err);
      })
      .finally(() => {
        setCheckingLensSession(false);
      });
  }, [isAuthReady, authenticated]);

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
      const url = `/api/posts?${params.toString()}`;

      // Deduplicate identical requests to prevent race conditions
      const data = await deduplicatedRequest(url, () =>
        retryWithBackoff(() => fetch(url, { credentials: "include", cache: "no-store" }).then((res) => res.json()), {
          maxAttempts: 2,
          initialDelayMs: 300,
          maxDelayMs: 2000,
        })
      ) as FeedResponse;

      if (!data) {
        throw new Error("No data received");
      }

      const incomingPosts = data.posts ?? [];
      setPosts((prev) => {
        const merged = reset ? incomingPosts : [...prev, ...incomingPosts];
        const deduped = new Map<string, Post>();
        for (const post of merged) {
          deduped.set(post.id, post);
        }
        return Array.from(deduped.values()).sort(comparePostsDesc);
      });
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

  useEffect(() => {
    const anchor = loadMoreAnchorRef.current;
    if (!anchor) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (!nextCursorRef.current || loadingMoreRef.current) return;
        void fetchPosts({ reset: false });
      },
      { rootMargin: "300px 0px" }
    );

    observer.observe(anchor);
    return () => observer.disconnect();
  }, [fetchPosts]);

  async function handleLensAuth() {
    if (!viewerAddress) return;
    setAuthenticatingLens(true);
    setError(null);

    try {
      // Step 1: Get challenge
      const challengeRes = await fetch("/api/lens/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: viewerAddress }),
        credentials: "include",
      });

      if (!challengeRes.ok) {
        throw new Error("Failed to get Lens challenge");
      }

      const { challenge } = await challengeRes.json();
      const { id: challengeId, text: challengeText } = challenge;

      // Step 2: Sign challenge with wallet using Privy's provider
      let signature: string | null = null;

      // Find the connected wallet from Privy
      const wallet = wallets.find(w => w.address.toLowerCase() === viewerAddress.toLowerCase());
      
      if (!wallet) {
        throw new Error("No wallet found. Please reconnect your wallet.");
      }

      try {
        // Get the Privy-managed provider for this wallet
        const provider = await wallet.getEthereumProvider();
        signature = await provider.request({
          method: 'personal_sign',
          params: [challengeText, viewerAddress],
        }) as string;
      } catch (err) {
        console.warn("Signing failed:", err);
        throw new Error("Failed to sign with wallet. Please approve the signing request.");
      }

      if (!signature) {
        throw new Error("Failed to sign with wallet");
      }

      // Step 3: Authenticate with signed message
      const authRes = await fetch("/api/lens/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: challengeId, address: viewerAddress, signature }),
        credentials: "include",
      });

      if (!authRes.ok) {
        const errorData = await authRes.json();
        throw new Error(errorData.error || "Failed to authenticate with Lens");
      }

      console.log("[Lens] Authentication successful!");
      setIsLensAuthenticated(true);
      try {
        localStorage.setItem("lensAuthenticated", "1");
      } catch {
        // ignore storage access errors
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lens authentication failed";
      setError(message);
    } finally {
      setAuthenticatingLens(false);
    }
  }

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
        // Compress images before upload to reduce bandwidth
        const compressedFiles = await compressImages(mediaFiles, {
          maxWidth: 1920,
          maxHeight: 1920,
          quality: 0.85,
          format: 'webp',
        });

        // Log compression stats
        const originalSize = mediaFiles.reduce((sum, f) => sum + f.size, 0);
        const compressedSize = compressedFiles.reduce((sum, f) => sum + f.size, 0);
        console.log(
          `Compressed images: ${getFileSize(originalSize)} → ${getFileSize(compressedSize)} (${getCompressionRatio(originalSize, compressedSize).toFixed(1)}% reduction)`
        );

        const uploadPromises = compressedFiles.map(async (file) => {
          // Dynamically import IPFS helper
          const { uploadToIPFS } = await import("@/lib/ipfs");
          return await uploadToIPFS(file);
        });
        mediaUrls = await Promise.all(uploadPromises);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_err) {
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
      const postWithRetry = async (retryCount = 0): Promise<{ ok: boolean; data: Record<string, unknown> }> => {
        const res = await fetch("/api/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, media: mediaUrls }),
          credentials: "include",
        });
        const data = await res.json();
        console.log("[Post] Response:", res.status, data);

        // If we get an auth error, try refreshing the token once
        if ((res.status === 401 || (data.error && data.error.includes("Unauthenticated"))) && retryCount === 0) {
          console.log("[Post] Auth error, attempting token refresh...");
          const refreshRes = await fetch("/api/lens/refresh", {
            method: "POST",
            credentials: "include",
          });
          if (refreshRes.ok) {
            console.log("[Post] Token refreshed, retrying post...");
            return postWithRetry(1);
          } else {
            // Refresh failed, user needs to reconnect
            setIsLensAuthenticated(false);
            try {
              localStorage.removeItem("lensAuthenticated");
            } catch {
              // ignore storage access errors
            }
            throw new Error("Session expired. Please reconnect Lens.");
          }
        }

        return { ok: res.ok, data };
      };

      const { ok, data } = await postWithRetry();

      if (!ok) {
        throw new Error(data.error as string || "Failed to publish post");
      }

      // Update the optimistic post with the real data
      const returnedPost = data.post as Post;
      setPosts((prev) => prev.map((post) => (post.id === tempId ? { ...returnedPost, optimistic: false } : post)));
      clearDeduplicationCache();
      console.log("[Post] Successfully created post:", returnedPost?.id);
      
    } catch (e) {
      setPosts((prev) => prev.filter((post) => post.id !== tempId));
      const message = e instanceof Error ? e.message : "Failed to publish post";
      console.error("[Post] Failed:", message);
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

          setIsLensAuthenticated(false);
          try {
            localStorage.removeItem("lensAuthenticated");
          } catch {
            // ignore storage access errors
          }
          throw new Error("Session expired. Please reconnect Lens.");
        }

        return { ok: res.ok, data };
      };

      const { ok, data } = await likeWithRetry();
      if (!ok) throw new Error((data.error as string) || "Failed to update like");
      if (isPost(data.post)) {
        const updatedPost = data.post;
        setPosts((prev) => prev.map((post) => (post.id === postId ? updatedPost : post)));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to update like";
      setError(message);
      await fetchPosts({ reset: true });
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
        const reposted = reposts.includes(viewerAddress);
        return {
          ...post,
          reposts: reposted
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

          setIsLensAuthenticated(false);
          try {
            localStorage.removeItem("lensAuthenticated");
          } catch {
            // ignore storage access errors
          }
          throw new Error("Session expired. Please reconnect Lens.");
        }

        return { ok: res.ok, data };
      };

      const { ok, data } = await repostWithRetry();
      if (!ok) throw new Error((data.error as string) || "Failed to update repost");
      if (isPost(data.post)) {
        const updatedPost = data.post;
        setPosts((prev) => prev.map((post) => (post.id === postId ? updatedPost : post)));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to update repost";
      setError(message);
      await fetchPosts({ reset: true });
    }
  }

  async function fetchReplies(postId: string) {
    setReplyLoadingByPost((prev) => ({ ...prev, [postId]: true }));

    try {
      const res = await fetch(`/api/posts/${postId}/replies?limit=20`, {
        credentials: "include",
      });
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
      const replyWithRetry = async (
        retryCount = 0
      ): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> => {
        const res = await fetch(`/api/posts/${postId}/replies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
          credentials: "include",
        });
        const data = await res.json();

        // If Lens session expired, refresh once and retry.
        if (
          (res.status === 401 ||
            (typeof data.error === "string" && data.error.includes("Unauthenticated"))) &&
          retryCount === 0
        ) {
          const refreshRes = await fetch("/api/lens/refresh", {
            method: "POST",
            credentials: "include",
          });
          if (refreshRes.ok) {
            return replyWithRetry(1);
          }

          setIsLensAuthenticated(false);
          try {
            localStorage.removeItem("lensAuthenticated");
          } catch {
            // ignore storage access errors
          }
          throw new Error("Session expired. Please reconnect Lens.");
        }

        return { ok: res.ok, status: res.status, data };
      };

      const { ok, data } = await replyWithRetry();
      if (!ok) {
        throw new Error((data.error as string) || "Failed to post reply");
      }
      const createdReply = data.reply;
      if (!isReply(createdReply)) {
        throw new Error("Failed to post reply");
      }
      const replyCountFromApi =
        typeof data.replyCount === "number" ? data.replyCount : undefined;

      setReplyDraftByPost((prev) => ({ ...prev, [postId]: "" }));
      setRepliesByPost((prev) => ({
        ...prev,
        [postId]: [createdReply, ...(prev[postId] ?? [])],
      }));
      if (data.status !== "pending_indexing") {
        await fetchReplies(postId);
      }
      setPosts((prev) =>
        prev.map((post) =>
          post.id === postId
            ? { ...post, replyCount: replyCountFromApi ?? (post.replyCount ?? 0) + 1 }
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
        credentials: "include",
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
        credentials: "include",
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

  function handleBookmark(postId: string) {
    setBookmarkedPostIds(toggleBookmarkId(postId));
  }

  const trimmedPost = newPost.trim();
  const remainingChars = MAX_POST_LENGTH - trimmedPost.length;
  const postTooLong = remainingChars < 0;
  const canSubmit = !!viewerAddress && !!trimmedPost && !postTooLong && !submitting;
  const profileHref =
    isAuthReady && authenticated && user?.wallet?.address
      ? `/profile/${lensAccountAddress ?? user.wallet.address}`
      : null;

  const sidebarItems: Array<{
    label: string;
    href: string;
    active?: boolean;
  }> = [
    { label: "Home", href: "/feed", active: true },
    { label: "Explore", href: "/explore" },
    { label: "Notifications", href: "/notifications" },
    { label: "Messages", href: "/messages" },
    { label: "Bookmarks", href: "/bookmarks" },
    { label: "Lists", href: "/lists" },
    ...(profileHref ? [{ label: "Profile", href: profileHref }] : []),
    { label: "Settings", href: "/settings" },
  ];

  const sidebarSearchResults = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    if (!q) return [];
    return posts
      .filter((post) => {
        const content = post.metadata?.content?.toLowerCase() ?? "";
        const username = post.author.username?.localName?.toLowerCase() ?? "";
        const address = post.author.address.toLowerCase();
        return content.includes(q) || username.includes(q) || address.includes(q);
      })
      .slice(0, 8);
  }, [posts, sidebarSearch]);

  return (
    <div className="min-h-screen bg-black text-white grid grid-cols-12">
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
          {isAuthReady && authenticated && user?.wallet?.address ? (
            <>
              <button
                onClick={logout}
                className="rounded-lg px-3 py-2 text-gray-300 hover:bg-gray-900 hover:text-red-400 text-left"
              >
                Logout
              </button>
            </>
          ) : (
            <div className="text-gray-400 mt-8">
              <p className="mb-4">Welcome to ChainSocial!</p>
              <p className="mb-2">Sign in with your wallet to post and follow others.</p>
              <div className="mb-2 text-xs text-gray-500">
                <span role="img" aria-label="wallet">💳</span> Supported wallets: MetaMask, Coinbase, WalletConnect
              </div>
              <Link href="https://claim.lens.xyz/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                Mint a Lens profile
              </Link>
              <div className="mt-6 text-xs text-gray-500">
                <p>Viewing public feed. No login required.</p>
                <p className="mt-2">We use wallet login for secure, passwordless access. Your funds are never at risk.</p>
                <Link href="/help" className="text-blue-400 hover:underline mt-2 inline-block">How wallet login works</Link>
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="col-span-12 md:col-span-9 lg:col-span-8 flex justify-center">
        <div className="w-full max-w-2xl px-6 py-6">
          <h2 className="text-2xl font-semibold mb-6">Global Feed</h2>

          {isAuthReady && authenticated && (
            <div className="bg-black pt-2 pb-4 -mx-6 px-6 border-b border-gray-800">
              {checkingProfile || checkingLensSession ? (
                <div className="text-gray-400">Checking Lens profile...</div>
              ) : hasLensProfile ? (
                isLensAuthenticated ? (
                  <form
                    onSubmit={handlePostSubmit}
                    className="bg-gray-900 rounded-xl p-4 border border-gray-800 shadow"
                  >
                    <textarea
                      className="w-full bg-black text-white rounded p-2 mb-2 border border-gray-700"
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
                      className="block mb-2 text-gray-300"
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
                            className="w-16 h-16 object-cover rounded border border-gray-700 inline-block"
                          />
                        ))}
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span
                        className={`text-xs ${postTooLong ? "text-red-400" : "text-gray-400"}`}
                      >
                        {remainingChars} chars left
                      </span>
                      <button
                        type="submit"
                        className="bg-blue-600 px-4 py-2 rounded disabled:opacity-50"
                        disabled={!canSubmit || uploadingMedia}
                      >
                        {submitting || uploadingMedia ? "Posting..." : "Post"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 shadow text-center">
                    <p className="mb-4 text-gray-300">Authenticate with Lens to post</p>
                    <button
                      onClick={handleLensAuth}
                      disabled={authenticatingLens}
                      className="bg-blue-600 px-6 py-2 rounded text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {authenticatingLens ? "Connecting..." : "Connect Lens"}
                    </button>
                  </div>
                )
              ) : showMintPrompt ? (
                <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 shadow text-center">
                  <p className="mb-4 text-red-400">You need a Lens profile to post.</p>
                  <a
                    href="https://claim.lens.xyz/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-blue-600 px-4 py-2 rounded text-white inline-block"
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
                className="rounded border border-red-700 px-2 py-1 text-xs"
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

          <div className="space-y-4">
            {posts.map((post) => {
              const liked = (post.likes ?? []).includes(viewerAddress);
              const reposted = (post.reposts ?? []).includes(viewerAddress);
              const bookmarked = bookmarkedPostIds.includes(post.id);
              const isOwner = viewerAddress === post.author.address.toLowerCase();
              const isEditing = editingPostId === post.id;
              const repliesOpen = !!expandedReplies[post.id];
              const replies = repliesByPost[post.id] ?? [];

              return (
                <div
                  key={post.id}
                  className="border border-gray-700 bg-gray-900 rounded-2xl p-4 flex gap-4 transition-shadow hover:shadow-lg hover:bg-gray-800 shadow-sm"
                >
                  <Link href={`/profile/${post.author.address}`} className="shrink-0">
                    {/* Profile picture removed, only mini avatar will show next to username */}
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <img
                          src={`https://api.dicebear.com/7.x/bottts/svg?seed=${post.author.address}`}
                          alt="cute avatar"
                          className="w-6 h-6 rounded-full border border-gray-700 bg-white mr-1 inline-block align-middle"
                        />
                        <Link
                          href={`/profile/${post.author.address}`}
                          className="font-semibold hover:underline inline-block align-middle"
                        >
                          {post.author.username?.localName ||
                            post.author.address}
                        </Link>
                        <span className="text-xs text-gray-500">
                          {post.author.address}
                        </span>
                        {post.optimistic && (
                          <span className="text-xs text-amber-400">Sending...</span>
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
                          className="w-full bg-black text-white rounded p-2 border border-gray-700"
                          rows={3}
                          value={editingContent}
                          onChange={(event) => setEditingContent(event.target.value)}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => void saveEdit(post.id)}
                            disabled={editingLoading}
                            className="bg-blue-600 px-3 py-1 rounded text-sm disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingPostId(null);
                              setEditingContent("");
                            }}
                            className="border border-gray-600 px-3 py-1 rounded text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                          <div className="mb-2 whitespace-pre-wrap break-words">
                            {renderContentWithWrappedLinks(post.metadata?.content)}
                          </div>
                        {post.metadata?.media && post.metadata.media.length > 0 && (
                          <div
                            className={`mb-2 ${
                              post.metadata.media.length === 1
                                ? "max-w-xl"
                                : "grid grid-cols-2 gap-2"
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
                                      className={isSingle ? "w-full max-h-96 object-contain" : "w-full h-full object-cover"}
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
                                          : "w-full h-full object-contain"
                                        : isSingle
                                          ? "w-full max-h-96 object-cover"
                                          : "w-full h-full object-cover"
                                    }
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}

                    <div className="flex items-center gap-4 mt-2">
                      <button
                        className={`flex items-center gap-1 text-sm px-2 py-1 rounded hover:bg-gray-800 transition-colors ${liked ? "text-pink-500" : "text-gray-400"}`}
                        onClick={() => void handleLike(post.id)}
                        disabled={!isAuthReady || !authenticated || post.optimistic}
                        aria-label={liked ? "Unlike" : "Like"}
                      >
                        <span>Like</span>
                        <span>{post.likes?.length || 0}</span>
                      </button>

                      <button
                        className={`flex items-center gap-1 text-sm px-2 py-1 rounded hover:bg-gray-800 transition-colors ${reposted ? "text-green-400" : "text-gray-400"}`}
                        onClick={() => void handleRepost(post.id)}
                        disabled={!isAuthReady || !authenticated || post.optimistic}
                        aria-label={reposted ? "Undo repost" : "Repost"}
                      >
                        <span>{reposted ? "Reposted" : "Repost"}</span>
                        <span>{post.reposts?.length || 0}</span>
                      </button>

                      <button
                        className="flex items-center gap-1 text-sm px-2 py-1 rounded hover:bg-gray-800 text-gray-400"
                        onClick={() => toggleReplies(post.id)}
                        disabled={post.optimistic}
                      >
                        <span>{repliesOpen ? "Hide Replies" : "Replies"}</span>
                        <span>{post.replyCount ?? 0}</span>
                      </button>

                      <button
                        className={`flex items-center gap-1 text-sm px-2 py-1 rounded hover:bg-gray-800 transition-colors ${
                          bookmarked ? "text-yellow-400" : "text-gray-400"
                        }`}
                        onClick={() => handleBookmark(post.id)}
                        disabled={post.optimistic}
                      >
                        <span>{bookmarked ? "Bookmarked" : "Bookmark"}</span>
                      </button>

                      <span className="text-xs text-gray-500">
                        {new Date(post.timestamp).toLocaleString()}
                      </span>
                    </div>

                    {repliesOpen && (
                      <div className="mt-3 border-t border-gray-700 pt-3 space-y-3">
                        {isAuthReady && authenticated && (
                          <div className="space-y-2">
                            <textarea
                              className="w-full bg-black text-white rounded p-2 border border-gray-700 text-sm"
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
                              className="bg-blue-600 px-3 py-1 rounded text-xs disabled:opacity-50"
                            >
                              Reply
                            </button>
                          </div>
                        )}

                        {replyLoadingByPost[post.id] && replies.length === 0 && (
                          <p className="text-xs text-gray-400">Loading replies...</p>
                        )}

                        {replies.map((reply) => (
                          <div key={reply.id} className="rounded-lg bg-black/40 border border-gray-800 p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <Link
                                href={`/profile/${reply.author.address}`}
                                className="text-sm font-medium hover:underline"
                              >
                                {reply.author.username?.localName || reply.author.address}
                              </Link>
                              <span className="text-xs text-gray-500">
                                {new Date(reply.timestamp).toLocaleString()}
                              </span>
                            </div>
                            <div className="text-sm whitespace-pre-wrap break-words">
                              {renderContentWithWrappedLinks(reply.metadata?.content)}
                            </div>
                          </div>
                        ))}

                        {!replyLoadingByPost[post.id] && replies.length === 0 && (
                          <p className="text-xs text-gray-500">No replies yet.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {nextCursor && (
            <div className="flex flex-col items-center mt-8 gap-3">
              <div ref={loadMoreAnchorRef} className="h-1 w-full" />
              <button
                onClick={() => void fetchPosts({ reset: false })}
                disabled={loadingMore}
                className="px-4 py-2 bg-gray-800 rounded disabled:opacity-50"
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </div>
      </main>

      <aside className="hidden lg:flex lg:col-span-2 flex-col border-l border-gray-800 py-8 px-6">
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
          <div className="mb-8">
            <h3 className="font-bold mb-3">Search</h3>
            <input
              value={sidebarSearch}
              onChange={(event) => setSidebarSearch(event.target.value)}
              placeholder="Search posts, users, wallets"
              className="mb-3 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
            />
            {sidebarSearch.trim().length === 0 && (
              <p className="text-xs text-gray-500">Type to search in loaded feed posts.</p>
            )}
            {sidebarSearch.trim().length > 0 && sidebarSearchResults.length === 0 && (
              <p className="text-xs text-gray-500">No matches found.</p>
            )}
            <div className="space-y-2">
              {sidebarSearchResults.map((post) => (
                <div key={post.id} className="rounded-lg border border-gray-800 bg-gray-900 p-2">
                  <div className="mb-1 text-xs text-gray-300">
                    {post.author.username?.localName || shortenAddress(post.author.address)}
                  </div>
                  <div className="line-clamp-3 text-xs text-gray-400 whitespace-pre-wrap break-words">
                    {sanitizeDisplayContent(post.metadata?.content) || "(No text content)"}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="font-bold mb-4">Trends</h3>
            <ul className="space-y-2 text-gray-400">
              <li>#Web3</li>
              <li>#DeFi</li>
              <li>#Crypto</li>
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
