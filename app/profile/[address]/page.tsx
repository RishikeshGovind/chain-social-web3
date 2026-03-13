"use client";

import Image from "next/image";
import { notFound } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import PostMedia from "@/components/PostMedia";
import { useUserSettings } from "@/lib/client/settings";
import ReportButton from "@/components/ReportButton";

type ProfilePost = {
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

type FollowStats = {
  followers: number;
  following: number;
  isFollowing: boolean;
  isSelf: boolean;
};

type PublicTrust = {
  trustScore: number;
  riskLevel: "low" | "medium" | "high";
  labels: string[];
};

const PROFILE_INITIAL_PAGE_SIZE = 10;
const PROFILE_LOAD_MORE_SIZE = 10;

function sanitizeDisplayContent(raw?: string) {
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

function postSignature(post: ProfilePost) {
  const content = post.metadata?.content?.trim() ?? "";
  const media = (post.metadata?.media ?? []).join("|");
  return `${post.author.address.toLowerCase()}|${content}|${media}`;
}

function profilePostsCacheKey(address: string) {
  return `chainsocial:profile-posts:${address.toLowerCase()}`;
}

function readCachedProfilePosts(address: string): ProfilePost[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(profilePostsCacheKey(address));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ProfilePost[]) : [];
  } catch {
    return [];
  }
}

function writeCachedProfilePosts(address: string, posts: ProfilePost[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(profilePostsCacheKey(address), JSON.stringify(posts.slice(0, 200)));
  } catch {
    // Ignore storage quota/errors.
  }
}

function isEvmAddress(value: string) {
  return /^0x[a-f0-9]{40}$/i.test(value);
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export default function UserProfilePage({ params }: { params: { address: string } }) {
  const [posts, setPosts] = useState<ProfilePost[]>([]);
  const [postsSource, setPostsSource] = useState<"lens" | "local" | null>(null);
  const [resolvedAuthor, setResolvedAuthor] = useState<string>("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [displayName, setDisplayName] = useState<string>("");
  const [bio, setBio] = useState<string>("");
  const [location, setLocation] = useState<string>("");
  const [website, setWebsite] = useState<string>("");
  const [coverImage, setCoverImage] = useState<string>("");
  const [avatar, setAvatar] = useState<string>("");
  const [trust, setTrust] = useState<PublicTrust>({
    trustScore: 78,
    riskLevel: "low",
    labels: [],
  });
  const [viewerLensAccountAddress, setViewerLensAccountAddress] = useState<string>("");
  const [followStats, setFollowStats] = useState<FollowStats>({
    followers: 0,
    following: 0,
    isFollowing: false,
    isSelf: false,
  });
  const [followLoading, setFollowLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { authenticated, user } = usePrivy();
  const { settings } = useUserSettings();
  const nextCursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const loadMoreAnchorRef = useRef<HTMLDivElement | null>(null);

  const viewerAddress = useMemo(
    () => user?.wallet?.address?.toLowerCase() ?? "",
    [user?.wallet?.address]
  );
  const targetAddress = useMemo(() => params.address.toLowerCase(), [params.address]);
  const sortedPosts = useMemo(
    () => [...posts].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [posts]
  );
  const profileHandle = useMemo(() => {
    return (
      sortedPosts.find((post) => post.author.username?.localName)?.author.username?.localName ?? ""
    );
  }, [sortedPosts]);
  const headerTitle = displayName || profileHandle || params.address;
  const showHeaderAddressRow = !!displayName || !!profileHandle;
  const isOwnProfile =
    !!targetAddress &&
    (targetAddress === viewerAddress || targetAddress === viewerLensAccountAddress);

  useEffect(() => {
    nextCursorRef.current = nextCursor;
  }, [nextCursor]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  useEffect(() => {
    if (!viewerAddress) {
      setViewerLensAccountAddress("");
      return;
    }
    fetch("/api/lens/check-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: viewerAddress }),
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        setViewerLensAccountAddress(
          typeof data?.accountAddress === "string" ? data.accountAddress.toLowerCase() : ""
        );
      })
      .catch(() => {
        setViewerLensAccountAddress("");
      });
  }, [viewerAddress]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/lens/profile?address=${params.address}`, { cache: "no-store" }).then((res) =>
        res.json()
      ),
      fetch(`/api/follows/${params.address}`, { cache: "no-store" }).then((res) => res.json()),
    ])
      .then(([profileData, followData]) => {
        if (cancelled) return;
        if (profileData.profile) {
          setDisplayName(profileData.profile.displayName || "");
          setBio(profileData.profile.bio || "");
          setLocation(profileData.profile.location || "");
          setWebsite(profileData.profile.website || "");
          setCoverImage(profileData.profile.coverImage || "");
          setAvatar(profileData.profile.avatar || "");
        }
        if (profileData.trust) {
          setTrust({
            trustScore:
              typeof profileData.trust.trustScore === "number"
                ? profileData.trust.trustScore
                : 78,
            riskLevel:
              profileData.trust.riskLevel === "high" || profileData.trust.riskLevel === "medium"
                ? profileData.trust.riskLevel
                : "low",
            labels: Array.isArray(profileData.trust.labels) ? profileData.trust.labels : [],
          });
        }
        setFollowStats({
          followers: followData.followers || 0,
          following: followData.following || 0,
          isFollowing: !!followData.isFollowing,
          isSelf: !!followData.isSelf,
        });
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load profile");
      });
    return () => {
      cancelled = true;
    };
  }, [params.address]);

  useEffect(() => {
    let cancelled = false;
    const cached = readCachedProfilePosts(params.address);
    if (cached.length > 0) {
      setPosts(cached);
      setLoading(false);
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const aliasSet = new Set<string>([params.address.toLowerCase()]);
        if (targetAddress === viewerAddress || targetAddress === viewerLensAccountAddress) {
          if (viewerAddress) aliasSet.add(viewerAddress.toLowerCase());
          if (viewerLensAccountAddress) aliasSet.add(viewerLensAccountAddress.toLowerCase());
        }
        const authors = Array.from(aliasSet).filter((address) => isEvmAddress(address));
        const primaryAuthor = authors[0] ?? params.address.toLowerCase();

        const responses = await Promise.all(
          authors.map(async (author) => {
            const lensData = await fetch(`/api/posts?author=${author}&limit=${PROFILE_INITIAL_PAGE_SIZE}&quick=1`, {
              cache: "no-store",
            }).then((res) => res.json());
            const effectiveAuthor =
              typeof lensData?.resolvedAuthor === "string" && lensData.resolvedAuthor
                ? lensData.resolvedAuthor
                : author;
            return { author, lensData, effectiveAuthor };
          })
        );

        const primary = responses.find((item) => item.author === primaryAuthor) ?? responses[0];
        const lensPosts = responses.flatMap((item) =>
          Array.isArray(item.lensData?.posts) ? (item.lensData.posts as ProfilePost[]) : []
        );
        let localPosts: ProfilePost[] = [];
        const localAuthor = primary?.effectiveAuthor ?? primaryAuthor;
        try {
          const localData = await fetchJsonWithTimeout(
            `/api/posts?author=${localAuthor}&limit=${PROFILE_INITIAL_PAGE_SIZE}&source=local`,
            1200
          );
          if (Array.isArray(localData?.posts)) {
            localPosts = localData.posts as ProfilePost[];
          }
        } catch {
          // Best-effort local mirror fetch; ignore timeout/errors to keep profile responsive.
        }
        const seenIds = new Set<string>();
        const seenSigs = new Set<string>();
        const mergedPosts: ProfilePost[] = [];

        for (const post of [...localPosts, ...lensPosts]) {
          if (seenIds.has(post.id)) continue;
          const sig = postSignature(post);
          if (seenSigs.has(sig)) continue;
          seenIds.add(post.id);
          seenSigs.add(sig);
          mergedPosts.push(post);
        }

        const cachedPosts = readCachedProfilePosts(params.address);
        const mergedWithCache: ProfilePost[] = [];
        const mergedSeenIds = new Set<string>();
        const mergedSeenSigs = new Set<string>();
        for (const post of [...mergedPosts, ...cachedPosts]) {
          if (mergedSeenIds.has(post.id)) continue;
          const sig = postSignature(post);
          if (mergedSeenSigs.has(sig)) continue;
          mergedSeenIds.add(post.id);
          mergedSeenSigs.add(sig);
          mergedWithCache.push(post);
        }

        const postsData = {
          ...(primary?.lensData ?? {}),
          posts: mergedWithCache,
          resolvedAuthor: primary?.effectiveAuthor ?? primaryAuthor,
        };

        if (cancelled) return;
        setPosts(postsData.posts || []);
        writeCachedProfilePosts(params.address, postsData.posts || []);
        setNextCursor(typeof postsData?.nextCursor === "string" ? postsData.nextCursor : null);
        setPostsSource(postsData?.source === "local" ? "local" : "lens");
        setResolvedAuthor(
          typeof postsData?.resolvedAuthor === "string" && postsData.resolvedAuthor
            ? postsData.resolvedAuthor
            : params.address
        );
      } catch {
        if (!cancelled) {
          const fallback = readCachedProfilePosts(params.address);
          if (fallback.length > 0) {
            setPosts(fallback);
          } else {
            setError("Failed to load profile posts");
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.address, targetAddress, viewerAddress, viewerLensAccountAddress]);

  async function loadMorePosts() {
    if (!nextCursor || !resolvedAuthor || loadingMore) return;
    setLoadingMore(true);
    try {
      const query = new URLSearchParams({
        author: resolvedAuthor,
        limit: String(PROFILE_LOAD_MORE_SIZE),
        cursor: nextCursor,
      });
      if (postsSource) query.set("source", postsSource);
      const data = await fetch(`/api/posts?${query.toString()}`, {
        cache: "no-store",
      }).then((res) => res.json());
      const incoming = Array.isArray(data?.posts) ? (data.posts as ProfilePost[]) : [];
      setPosts((prev) => {
        const seen = new Set(prev.map((post) => post.id));
        return [...prev, ...incoming.filter((post) => !seen.has(post.id))];
      });
      setNextCursor(typeof data?.nextCursor === "string" ? data.nextCursor : null);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const anchor = loadMoreAnchorRef.current;
    if (!anchor) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (!nextCursorRef.current || loadingMoreRef.current) return;
        void loadMorePosts();
      },
      { rootMargin: "280px 0px" }
    );

    observer.observe(anchor);
    return () => observer.disconnect();
  }, [resolvedAuthor, postsSource]);

  async function handleToggleFollow() {
    if (!authenticated || !viewerAddress || followStats.isSelf) return;

    setFollowLoading(true);
    setError(null);

    const prev = followStats;
    const nextFollowing = !followStats.isFollowing;
    setFollowStats((current) => ({
      ...current,
      isFollowing: nextFollowing,
      followers: Math.max(0, current.followers + (nextFollowing ? 1 : -1)),
    }));

    try {
      const res = await fetch(`/api/follows/${params.address}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentlyFollowing: prev.isFollowing }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update follow status");
      }

      setFollowStats((current) => ({
        ...current,
        isFollowing: !!data.isFollowing,
        followers: typeof data.followers === "number" ? data.followers : current.followers,
        following: typeof data.following === "number" ? data.following : current.following,
      }));
    } catch {
      setFollowStats(prev);
      setError("Failed to update follow status");
    } finally {
      setFollowLoading(false);
    }
  }

  if (!params.address) return notFound();

  return (
    <AppShell active="Profile">
      <div className="w-full max-w-3xl text-white">
        <section className="animate-fade-up overflow-hidden rounded-[2.25rem] border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur">
        <div className="h-44 w-full relative">
          {coverImage ? (
            <Image src={coverImage} alt="cover" fill unoptimized className="object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-r from-cyan-900 via-slate-900 to-lime-900" />
          )}
          <div className="absolute inset-0 bg-black/20" />
          <div className="absolute left-1/2 transform -translate-x-1/2 top-24 z-10">
            <Image
              src={avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${params.address}`}
              alt="avatar"
              width={128}
              height={128}
              unoptimized
              className="w-32 h-32 rounded-full border-4 border-black shadow-xl bg-white object-cover"
            />
          </div>
        </div>

        <div className="pt-20 pb-8 px-6 flex flex-col items-center border-t border-white/5 bg-transparent">
          <div className="text-center">
            <p className="mb-3 inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-cyan-200">
              Profile
            </p>
            <div className="text-3xl font-black uppercase tracking-[-0.05em] text-white">{headerTitle}</div>
          </div>
          {showHeaderAddressRow && (
            <div className="text-blue-300 text-sm mb-2 mt-2 break-all">
              {params.address}
            </div>
          )}

          {isOwnProfile && (
            <div className="mb-3 flex items-center gap-2">
              <Link
                href="/profile/edit"
                className="rounded-full border border-white/10 px-4 py-2 text-sm transition hover:bg-white/[0.06]"
              >
                Edit Profile
              </Link>
              <Link
                href="/profile/edit"
                className="rounded-full border border-cyan-400/20 px-4 py-2 text-sm text-cyan-200 transition hover:bg-cyan-400/10"
              >
                Migrate Legacy Posts
              </Link>
            </div>
          )}

          {!isOwnProfile && authenticated && (
            <div className="mb-3 flex items-center gap-2">
              <button
                onClick={() => void handleToggleFollow()}
                disabled={followLoading}
                className="rounded-full border border-white/10 px-4 py-2 text-sm transition hover:bg-white/[0.06] disabled:opacity-50"
              >
                {followStats.isFollowing ? "Unfollow" : "Follow"}
              </button>
              <ReportButton
                entityType="profile"
                entityId={params.address}
                targetAddress={params.address}
                compact
              />
            </div>
          )}

          {bio && (
            <div className="text-gray-300 text-base text-center mb-2 whitespace-pre-line max-w-xl leading-7">{bio}</div>
          )}
          <div className="flex flex-wrap justify-center gap-4 text-gray-400 text-sm mt-2">
            {location && <span>{location}</span>}
            {website && (
              <span>
                <a
                  href={website.startsWith("http") ? website : `https://${website}`}
                  target="_blank"
                  rel="noopener"
                  className="text-blue-400 hover:underline"
                >
                  {website}
                </a>
              </span>
            )}
          </div>

          <div className="mt-5 grid w-full max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-4 text-center">
              <div className="text-xl font-bold text-white">{sortedPosts.length}</div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">Posts</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-4 text-center">
              <div className="text-xl font-bold text-white">{followStats.followers}</div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">Followers</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-4 text-center">
              <div className="text-xl font-bold text-white">{followStats.following}</div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">Following</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-4 text-center">
              <div className="text-xl font-bold text-white">{trust.trustScore}</div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">Trust</div>
              <div className="mt-2 text-[10px] uppercase tracking-[0.16em] text-cyan-200">
                {trust.riskLevel === "high" ? "High risk" : trust.riskLevel === "medium" ? "Monitor" : "Low risk"}
              </div>
            </div>
          </div>

          {trust.labels.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {trust.labels.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-gray-300"
                >
                  {label.replaceAll("-", " ")}
                </span>
              ))}
            </div>
          )}

          {sortedPosts.length > 0 && (
            <div className="text-xs text-gray-500 mt-2">
              Joined {new Date(sortedPosts[sortedPosts.length - 1].timestamp).toLocaleDateString()}
            </div>
          )}
        </div>
        </section>

        <div className="animate-fade-up animate-fade-up-delay-1 mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold text-white">Posts</h3>
              <p className="text-xs text-gray-400">
                {postsSource === "local" ? "Showing app-managed local records." : "Showing public profile posts."}
              </p>
            </div>
            <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-gray-400">
              {resolvedAuthor ? "Active" : "Loading"}
            </span>
          </div>
          {loading ? (
            <div className="space-y-5">
              <ProfilePostSkeleton compact={settings.compactFeed} />
              <ProfilePostSkeleton compact={settings.compactFeed} />
            </div>
          ) : error ? (
            <p className="text-sm text-red-300">{error}</p>
          ) : sortedPosts.length === 0 ? (
            <p className="text-sm text-gray-500">No posts yet.</p>
          ) : (
            <div className="space-y-5">
              {sortedPosts.map((post, index) => (
                (() => {
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
                  const hasMedia = (post.metadata?.media?.length ?? 0) > 0;
                  return (
                    <article
                      key={post.id}
                      className={`animate-fade-up rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[0.07] via-white/[0.04] to-transparent shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition duration-200 hover:border-white/15 hover:bg-white/[0.07] ${
                        settings.compactFeed ? "p-4" : "p-5"
                      }`}
                      style={{ animationDelay: `${Math.min(index, 5) * 60}ms` }}
                    >
                      <Link href={`/profile/${post.author.address}`} className="shrink-0">
                        <Image
                          src={avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${post.author.address}`}
                          alt="avatar"
                          width={40}
                          height={40}
                          unoptimized
                          className="w-10 h-10 rounded-full border border-white/10 bg-white object-cover shadow-sm"
                        />
                      </Link>
                      <div className="flex-1 min-w-0">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <Link
                              href={`/profile/${post.author.address}`}
                              className="max-w-[18rem] break-all text-[15px] font-semibold text-white hover:underline"
                            >
                              {primaryAuthorLabel}
                            </Link>
                            <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-gray-400">
                              {hasMedia ? "Media post" : "Text post"}
                            </span>
                            {secondaryAuthorLabel && (
                              <span className="text-xs text-gray-500 break-all max-w-[18rem]">
                                {secondaryAuthorLabel}
                              </span>
                            )}
                          </div>
                          {!isOwnProfile && (
                            <ReportButton
                              entityType="post"
                              entityId={post.id}
                              targetAddress={post.author.address}
                              compact
                            />
                          )}
                        </div>

                        <div className={`text-white mb-4 whitespace-pre-wrap break-words ${settings.compactFeed ? "text-sm leading-6" : "text-[15px] leading-7"}`}>
                          {renderContentWithWrappedLinks(post.metadata?.content)}
                        </div>

                        {post.metadata?.media && post.metadata.media.length > 0 && (
                          <PostMedia media={post.metadata.media} settings={settings} />
                        )}

                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4 text-sm text-gray-400">
                          <span className="rounded-full border border-white/10 px-3 py-2 text-xs uppercase tracking-[0.18em]">Like / {post.likes?.length ?? 0}</span>
                          <span className="rounded-full border border-white/10 px-3 py-2 text-xs uppercase tracking-[0.18em]">Repost / {post.reposts?.length ?? 0}</span>
                          <span className="rounded-full border border-white/10 px-3 py-2 text-xs uppercase tracking-[0.18em]">Replies / {post.replyCount ?? 0}</span>
                          <span className="text-xs text-gray-500">
                            {new Date(post.timestamp).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </article>
                  );
                })()
              ))}
              {nextCursor && (
                <>
                  <div ref={loadMoreAnchorRef} className="h-1 w-full" />
                  <button
                    onClick={() => void loadMorePosts()}
                    disabled={loadingMore}
                    className="w-full rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-gray-200 transition hover:bg-white/[0.06] disabled:opacity-50"
                  >
                    {loadingMore ? "Loading..." : "Load more posts"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function ProfilePostSkeleton({ compact }: { compact: boolean }) {
  return (
    <div
      className={`animate-pulse rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[0.07] via-white/[0.04] to-transparent shadow-[0_0_0_1px_rgba(255,255,255,0.02)] ${
        compact ? "p-4" : "p-5"
      }`}
      aria-hidden="true"
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-white/10" />
        <div className="space-y-2">
          <div className="h-4 w-36 rounded-full bg-white/10" />
          <div className="h-3 w-28 rounded-full bg-white/5" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-4 w-full rounded-full bg-white/10" />
        <div className="h-4 w-[82%] rounded-full bg-white/10" />
      </div>
      <div className="mt-4 flex gap-2 border-t border-white/10 pt-4">
        <div className="h-9 w-20 rounded-full bg-white/10" />
        <div className="h-9 w-24 rounded-full bg-white/5" />
      </div>
    </div>
  );
}
