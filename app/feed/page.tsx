"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import Image from "next/image";
import Link from "next/link";
import { clearDeduplicationCache, deduplicatedRequest } from "@/lib/request-deduplicator";
import { retryWithBackoff } from "@/lib/retry-backoff";
import { compressImages } from "@/lib/image-compression";
import { BOOKMARKS_CHANGED_EVENT, loadBookmarks, readBookmarks, toggleBookmarkId } from "@/lib/client/bookmarks";
import { hasFunctionalConsent } from "@/lib/client/consent";
import { useUserSettings } from "@/lib/client/settings";
import PostMedia from "@/components/PostMedia";
import { MAX_POST_LENGTH } from "@/lib/posts/content";

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

function setLensAuthHint(value: "1" | null) {
  if (!hasFunctionalConsent()) return;
  try {
    if (value === null) {
      localStorage.removeItem("lensAuthenticated");
    } else {
      localStorage.setItem("lensAuthenticated", value);
    }
  } catch {
    // ignore storage access errors
  }
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
  const { settings } = useUserSettings();

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

    fetch("/api/lens/session", { credentials: "include", cache: "no-store" })
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) {
          setIsLensAuthenticated(true);
          setLensAuthHint("1");
        } else {
          setLensAuthHint(null);
          setIsLensAuthenticated(false);
        }
      })
      .catch(() => undefined)
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
        setError((current) => current ?? "Using the local fallback feed right now.");
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
      } catch {
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

      setIsLensAuthenticated(true);
      setLensAuthHint("1");
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

        // If we get an auth error, try refreshing the token once
        if ((res.status === 401 || (data.error && data.error.includes("Unauthenticated"))) && retryCount === 0) {
          const refreshRes = await fetch("/api/lens/refresh", {
            method: "POST",
            credentials: "include",
          });
          if (refreshRes.ok) {
            return postWithRetry(1);
          } else {
            // Refresh failed, user needs to reconnect
            setIsLensAuthenticated(false);
            setLensAuthHint(null);
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
          setLensAuthHint(null);
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
          setLensAuthHint(null);
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
          setLensAuthHint(null);
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

  async function handleBookmark(postId: string) {
    if (!isAuthReady || !authenticated || !viewerAddress) return;
    try {
      const ids = await toggleBookmarkId(postId);
      setBookmarkedPostIds(ids);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to update bookmark";
      setError(message);
    }
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
    <div className="min-h-screen bg-black text-white">
      <div className="relative isolate grid min-h-screen grid-cols-12">
        <div className="absolute inset-x-0 top-[-18rem] -z-10 flex justify-center blur-3xl">
          <div className="h-[36rem] w-[36rem] rounded-full bg-cyan-500/16" />
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
          {isAuthReady && authenticated && user?.wallet?.address ? (
            <>
              <button
                onClick={logout}
                className="w-full rounded-xl border border-white/10 px-4 py-3 text-left text-gray-300 transition hover:bg-white/[0.06] hover:text-red-300"
              >
                Logout
              </button>
            </>
          ) : (
            <div className="mt-8 rounded-[1.5rem] border border-white/10 bg-black/30 p-4 text-gray-400">
              <p className="text-sm font-semibold text-white">Browse publicly. Post when ready.</p>
              <p className="mt-2 text-sm text-gray-400">
                You can read the feed without logging in. Connect a wallet only when you want to post, reply, or follow.
              </p>
              <Link
                href="/help"
                className="mt-4 inline-flex rounded-full border border-white/10 px-4 py-2 text-xs font-semibold text-gray-200 transition hover:bg-white/[0.06]"
              >
                How wallet access works
              </Link>
              <div className="mt-4 text-xs text-gray-500">
                Supported wallets include MetaMask, Coinbase Wallet, and WalletConnect-compatible apps.
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="col-span-12 md:col-span-9 lg:col-span-8 flex justify-center px-4 py-6 md:px-6">
        <div className="w-full max-w-3xl">
          <section className="animate-fade-up rounded-[2.25rem] border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="mb-3 inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-cyan-200">
                  Global Feed
                </p>
                <h2 className="text-3xl font-black uppercase leading-none tracking-[-0.05em] text-white sm:text-5xl">
                  The public timeline,
                  <br />
                  without the clutter.
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-gray-300 sm:text-base sm:leading-7">
                  Read the live conversation, post from your wallet, and keep the useful parts of a social product close at hand.
                </p>
              </div>
              <div className="w-full space-y-3 sm:max-w-sm">
                <div className="overflow-hidden rounded-[1.75rem] border border-cyan-400/15 bg-gradient-to-br from-cyan-400/12 via-white/[0.05] to-lime-300/10 p-4 shadow-[0_20px_70px_rgba(6,182,212,0.08)]">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200">Live feed state</p>
                    <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-gray-300">
                      {feedStatus === "ready" ? "Stable" : feedStatus}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-gray-200">
                    Public posts are readable immediately, while saving, replying, and posting unlock once your wallet is connected.
                  </p>
                  <div className="mt-4 flex gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.9)]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-lime-300/80 shadow-[0_0_12px_rgba(190,242,100,0.7)]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/60" />
                  </div>
                </div>

                <div className="grid w-full grid-cols-3 gap-2">
                  <div className="min-w-0 rounded-2xl border border-white/10 bg-black/30 px-3 py-4 text-center">
                    <p className="text-xl font-bold text-white">{posts.length}</p>
                    <p className="mt-1 break-words text-[10px] uppercase leading-tight tracking-[0.12em] text-gray-400">
                      Loaded
                    </p>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-white/10 bg-black/30 px-3 py-4 text-center">
                    <p className="text-xl font-bold text-white">{bookmarkedPostIds.length}</p>
                    <p className="mt-1 break-words text-[10px] uppercase leading-tight tracking-[0.12em] text-gray-400">
                      Saved
                    </p>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-white/10 bg-black/30 px-3 py-4 text-center">
                    <p className="text-xl font-bold text-white">{authenticated ? "On" : "Off"}</p>
                    <p className="mt-1 break-words text-[10px] uppercase leading-tight tracking-[0.12em] text-gray-400">
                      Access
                    </p>
                  </div>
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

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-gray-400">Quick Search</p>
                  <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-gray-500">
                    Loaded posts
                  </span>
                </div>
                <input
                  value={sidebarSearch}
                  onChange={(event) => setSidebarSearch(event.target.value)}
                  placeholder="Search posts, users, wallets"
                  className="mb-3 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white"
                />
                {sidebarSearch.trim().length === 0 ? (
                  <p className="text-xs leading-5 text-gray-500">Search the posts already loaded on this screen.</p>
                ) : sidebarSearchResults.length === 0 ? (
                  <p className="text-xs text-gray-500">No matches found.</p>
                ) : (
                  <div className="space-y-2">
                    {sidebarSearchResults.slice(0, 3).map((post) => (
                      <div key={`mobile-search-${post.id}`} className="rounded-2xl border border-white/10 bg-black/30 p-3">
                        <div className="mb-1 text-xs font-medium text-gray-200">
                          {post.author.username?.localName || shortenAddress(post.author.address)}
                        </div>
                        <div className="line-clamp-2 whitespace-pre-wrap break-words text-xs leading-5 text-gray-400">
                          {sanitizeDisplayContent(post.metadata?.content) || "(No text content)"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
                <p className="text-[11px] uppercase tracking-[0.22em] text-gray-400">Session State</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Read</p>
                    <p className="mt-2 text-sm font-medium text-white">Open</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Post</p>
                    <p className="mt-2 text-sm font-medium text-white">{authenticated ? "Connected" : "Idle"}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-gray-500">
                  Browse freely now. Connect only when you want to post, reply, or save.
                </p>
              </div>
            </div>
          </section>

          {isAuthReady && authenticated && (
            <div className="animate-fade-up animate-fade-up-delay-2 mt-6">
              {checkingProfile || checkingLensSession ? (
                <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-gray-400 backdrop-blur">
                  Checking your posting access...
                </div>
              ) : hasLensProfile ? (
                isLensAuthenticated ? (
                  <form
                    onSubmit={handlePostSubmit}
                    className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur"
                  >
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">Share an update</p>
                        <p className="text-xs text-gray-400">Post publicly from your connected account.</p>
                      </div>
                      <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-cyan-200">
                        Live
                      </span>
                    </div>
                    <textarea
                      className="mb-3 w-full rounded-[1.25rem] border border-white/10 bg-black/40 p-4 text-white placeholder:text-gray-500"
                      rows={4}
                      placeholder="What feels worth sharing right now?"
                      value={newPost}
                      onChange={(event) => setNewPost(event.target.value)}
                      disabled={submitting || uploadingMedia}
                    />
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="mb-3 block text-sm text-gray-300 file:mr-4 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:text-xs file:font-semibold file:text-black hover:file:bg-gray-200"
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        setMediaFiles(files);
                        setMediaPreview(files.map((file) => URL.createObjectURL(file)));
                      }}
                      disabled={submitting || uploadingMedia}
                    />
                    {mediaPreview.length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-2">
                        {mediaPreview.map((url, idx) => (
                          <Image
                            key={idx}
                            src={url}
                            alt="preview"
                            width={80}
                            height={80}
                            unoptimized
                            className="h-20 w-20 rounded-2xl border border-white/10 object-cover"
                          />
                        ))}
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span
                        className={`text-xs ${postTooLong ? "text-red-300" : "text-gray-400"}`}
                      >
                        {remainingChars} chars left
                      </span>
                      <button
                        type="submit"
                        className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-gray-200 disabled:opacity-50"
                        disabled={!canSubmit || uploadingMedia}
                      >
                        {submitting || uploadingMedia ? "Posting..." : "Post"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-5 text-center shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur">
                    <p className="mb-2 text-sm font-semibold text-white">One more step before posting</p>
                    <p className="mb-4 text-sm text-gray-400">Connect your posting account to publish publicly.</p>
                    <button
                      onClick={handleLensAuth}
                      disabled={authenticatingLens}
                      className="rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-black transition hover:bg-gray-200 disabled:opacity-50"
                    >
                      {authenticatingLens ? "Connecting..." : "Enable posting"}
                    </button>
                  </div>
                )
              ) : showMintPrompt ? (
                <div className="rounded-[1.75rem] border border-red-400/20 bg-red-500/10 p-5 text-center shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur">
                  <p className="mb-2 text-sm font-semibold text-white">Posting isn’t enabled on this account yet</p>
                  <p className="mb-4 text-sm text-red-100/80">Set up your public profile first, then come back here to post.</p>
                  <a
                    href="https://claim.lens.xyz/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-gray-200"
                  >
                    Set up profile
                  </a>
                </div>
              ) : null}
            </div>
          )}

          {error && (
            <div className="mt-6 flex items-center justify-between gap-3 rounded-[1.5rem] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              <span>{error}</span>
              <button
                onClick={() => void fetchPosts({ reset: true })}
                className="rounded-full border border-red-300/20 px-3 py-1 text-xs"
              >
                Retry
              </button>
            </div>
          )}

          {feedStatus === "loading" && (
            <div className="mt-6 space-y-5">
              <FeedSkeletonCard compact={settings.compactFeed} />
              <FeedSkeletonCard compact={settings.compactFeed} />
              <FeedSkeletonCard compact={settings.compactFeed} hasMedia />
            </div>
          )}

          {feedStatus === "error" && (
            <p className="mt-6 text-sm text-gray-500">Feed unavailable right now.</p>
          )}

          {feedStatus === "ready" && posts.length === 0 && (
            <p className="mt-6 text-sm text-gray-500">No posts found.</p>
          )}

          <div className="mt-6 space-y-5">
            {posts.map((post, index) => {
              const liked = (post.likes ?? []).includes(viewerAddress);
              const reposted = (post.reposts ?? []).includes(viewerAddress);
              const bookmarked = bookmarkedPostIds.includes(post.id);
              const isOwner = viewerAddress === post.author.address.toLowerCase();
              const isEditing = editingPostId === post.id;
              const repliesOpen = !!expandedReplies[post.id];
              const replies = repliesByPost[post.id] ?? [];
              const hasMedia = (post.metadata?.media?.length ?? 0) > 0;
              const rawUsername = post.author.username?.localName?.trim() ?? "";
              const hasDistinctUsername =
                rawUsername.length > 0 &&
                rawUsername.toLowerCase() !== post.author.address.toLowerCase();
              const primaryAuthorLabel = hasDistinctUsername
                ? rawUsername
                : post.author.address;
              const secondaryAuthorLabel = hasDistinctUsername
                ? post.author.address
                : "";
              const timestamp = new Date(post.timestamp);
              const timestampLabel = Number.isNaN(timestamp.getTime())
                ? post.timestamp
                : timestamp.toLocaleString();
              const postKindLabel = hasMedia ? "Media post" : "Text post";

              return (
                <article
                  key={post.id}
                  className={`animate-fade-up rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[0.07] via-white/[0.04] to-transparent shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition duration-200 hover:border-white/15 hover:bg-white/[0.07] ${
                    settings.compactFeed ? "p-4" : "p-5"
                  }`}
                  style={{ animationDelay: `${Math.min(index, 5) * 60}ms` }}
                >
                  <div className="min-w-0">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <Image
                          src={`https://api.dicebear.com/7.x/bottts/svg?seed=${post.author.address}`}
                          alt="cute avatar"
                          width={40}
                          height={40}
                          unoptimized
                          className="mt-0.5 h-10 w-10 rounded-full border border-white/10 bg-white object-cover shadow-sm"
                        />
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <Link
                              href={`/profile/${post.author.address}`}
                              className="inline-block max-w-[18rem] break-all text-[15px] font-semibold text-white hover:underline"
                            >
                              {primaryAuthorLabel}
                            </Link>
                            <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-gray-400">
                              {postKindLabel}
                            </span>
                            {post.optimistic && (
                              <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-amber-200">
                                Sending
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-gray-500">
                            {secondaryAuthorLabel && (
                              <span className="max-w-[18rem] break-all">{secondaryAuthorLabel}</span>
                            )}
                            <span>{timestampLabel}</span>
                          </div>
                        </div>
                      </div>
                      {isOwner && !post.optimistic && !isEditing && (
                        <div className="flex items-center gap-2 text-xs">
                          <button
                            onClick={() => beginEdit(post)}
                            className="rounded-full border border-white/10 px-3 py-1.5 text-gray-300 transition hover:bg-white/[0.06] hover:text-white"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => void removePost(post.id)}
                            className="rounded-full border border-red-400/20 px-3 py-1.5 text-red-300 transition hover:bg-red-500/10"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          className="w-full rounded-[1.25rem] border border-white/10 bg-black/40 p-3 text-white"
                          rows={3}
                          value={editingContent}
                          onChange={(event) => setEditingContent(event.target.value)}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => void saveEdit(post.id)}
                            disabled={editingLoading}
                            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingPostId(null);
                              setEditingContent("");
                            }}
                            className="rounded-full border border-white/10 px-4 py-2 text-sm text-gray-300"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div
                          className={`mb-4 whitespace-pre-wrap break-words text-gray-100 ${
                            settings.compactFeed ? "text-sm leading-6" : "text-[15px] leading-7"
                          }`}
                        >
                          {renderContentWithWrappedLinks(post.metadata?.content)}
                        </div>
                        {post.metadata?.media && post.metadata.media.length > 0 && (
                          <PostMedia media={post.metadata.media} settings={settings} />
                        )}
                      </>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
                      <button
                        className={`flex items-center gap-2 rounded-full px-3.5 py-2 text-sm transition-colors ${liked ? "bg-pink-500/10 text-pink-300" : "border border-white/10 text-gray-300 hover:bg-white/[0.06]"}`}
                        onClick={() => void handleLike(post.id)}
                        disabled={!isAuthReady || !authenticated || post.optimistic}
                        aria-label={liked ? "Unlike" : "Like"}
                      >
                        <span className="text-xs uppercase tracking-[0.18em]">Like</span>
                        <span className="text-xs text-current/80">/</span>
                        <span>{post.likes?.length || 0}</span>
                      </button>

                      <button
                        className={`flex items-center gap-2 rounded-full px-3.5 py-2 text-sm transition-colors ${reposted ? "bg-lime-400/10 text-lime-200" : "border border-white/10 text-gray-300 hover:bg-white/[0.06]"}`}
                        onClick={() => void handleRepost(post.id)}
                        disabled={!isAuthReady || !authenticated || post.optimistic}
                        aria-label={reposted ? "Undo repost" : "Repost"}
                      >
                        <span className="text-xs uppercase tracking-[0.18em]">{reposted ? "Reposted" : "Repost"}</span>
                        <span className="text-xs text-current/80">/</span>
                        <span>{post.reposts?.length || 0}</span>
                      </button>

                      <button
                        className="flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-2 text-sm text-gray-300 transition hover:bg-white/[0.06]"
                        onClick={() => toggleReplies(post.id)}
                        disabled={post.optimistic}
                      >
                        <span className="text-xs uppercase tracking-[0.18em]">
                          {repliesOpen ? "Hide Replies" : "Replies"}
                        </span>
                        <span className="text-xs text-current/80">/</span>
                        <span>{post.replyCount ?? 0}</span>
                      </button>

                      <button
                        className={`flex items-center gap-2 rounded-full px-3.5 py-2 text-sm transition-colors ${
                          bookmarked ? "bg-yellow-400/10 text-yellow-200" : "border border-white/10 text-gray-300 hover:bg-white/[0.06]"
                        }`}
                        onClick={() => void handleBookmark(post.id)}
                        disabled={!isAuthReady || !authenticated || post.optimistic}
                      >
                        <span className="text-xs uppercase tracking-[0.18em]">
                          {bookmarked ? "Saved" : "Save"}
                        </span>
                      </button>
                    </div>

                    {repliesOpen && (
                      <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
                        {isAuthReady && authenticated && (
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
                </article>
              );
            })}
          </div>

          {nextCursor && (
            <div className="animate-fade-up animate-fade-up-delay-3 mt-8 flex flex-col items-center gap-3">
              <div ref={loadMoreAnchorRef} className="h-1 w-full" />
              <button
                onClick={() => void fetchPosts({ reset: false })}
                disabled={loadingMore}
                className="rounded-full border border-white/10 bg-white/[0.04] px-5 py-2.5 text-sm text-white transition hover:bg-white/[0.06] disabled:opacity-50"
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </div>
      </main>

      <aside className="hidden lg:flex lg:col-span-2 flex-col px-5 py-6 lg:px-6">
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur">
          <div className="mb-6 rounded-[1.6rem] border border-cyan-400/20 bg-gradient-to-br from-cyan-400/10 via-white/[0.03] to-lime-300/10 p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">Feed Companion</p>
            <h3 className="mt-2 text-xl font-semibold text-white">Read the room before you post.</h3>
            <p className="mt-2 text-sm leading-6 text-gray-300">
              Search what is already loaded, track the live state of this feed, and keep your place in the public conversation.
            </p>
          </div>

          <div className="mb-8">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-300">Search</h3>
              <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-gray-400">
                Loaded only
              </span>
            </div>
            <input
              value={sidebarSearch}
              onChange={(event) => setSidebarSearch(event.target.value)}
              placeholder="Search posts, users, wallets"
              className="mb-3 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white"
            />
            {sidebarSearch.trim().length === 0 && (
              <p className="text-xs leading-5 text-gray-500">Type to scan the posts currently loaded into this feed view.</p>
            )}
            {sidebarSearch.trim().length > 0 && sidebarSearchResults.length === 0 && (
              <p className="text-xs text-gray-500">No matches found.</p>
            )}
            <div className="space-y-2">
              {sidebarSearchResults.map((post) => (
                <div key={post.id} className="rounded-2xl border border-white/10 bg-black/30 p-3 transition hover:bg-white/[0.05]">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-gray-200">
                      {post.author.username?.localName || shortenAddress(post.author.address)}
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">
                      Match
                    </div>
                  </div>
                  <div className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-gray-400">
                    {sanitizeDisplayContent(post.metadata?.content) || "(No text content)"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-8">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-gray-300">Feed Signals</h3>
            <div className="space-y-3 text-sm text-gray-300">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <p className="font-medium text-white">Open by default</p>
                <p className="mt-2 text-xs leading-5 text-gray-400">
                  Anyone can read the public timeline before connecting a wallet.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <p className="font-medium text-white">Search stays local to this view</p>
                <p className="mt-2 text-xs leading-5 text-gray-400">
                  The rail search scans the posts already loaded into this feed so it stays fast and focused.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <p className="font-medium text-white">Actions unlock when connected</p>
                <p className="mt-2 text-xs leading-5 text-gray-400">
                  Posting, replying, saving, and follow actions become available once your account is connected.
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 pt-4 text-xs text-gray-400">
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

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function FeedSkeletonCard({
  compact,
  hasMedia = false,
}: {
  compact: boolean;
  hasMedia?: boolean;
}) {
  return (
    <div
      className={`animate-pulse rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[0.07] via-white/[0.04] to-transparent shadow-[0_0_0_1px_rgba(255,255,255,0.02)] ${
        compact ? "p-4" : "p-5"
      }`}
      aria-hidden="true"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-white/10" />
          <div className="min-w-0 space-y-2">
            <div className="h-4 w-36 rounded-full bg-white/10" />
            <div className="h-3 w-48 rounded-full bg-white/5" />
          </div>
        </div>
        <div className="h-8 w-20 rounded-full bg-white/5" />
      </div>

      <div className="space-y-2">
        <div className="h-4 w-full rounded-full bg-white/10" />
        <div className="h-4 w-[88%] rounded-full bg-white/10" />
        <div className="h-4 w-[56%] rounded-full bg-white/5" />
      </div>

      {hasMedia && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="aspect-square rounded-[1.4rem] bg-white/10" />
          <div className="aspect-square rounded-[1.4rem] bg-white/5" />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
        <div className="h-10 w-24 rounded-full bg-white/10" />
        <div className="h-10 w-28 rounded-full bg-white/5" />
        <div className="h-10 w-28 rounded-full bg-white/10" />
        <div className="h-10 w-20 rounded-full bg-white/5" />
      </div>
    </div>
  );
}
