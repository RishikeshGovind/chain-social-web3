"use client";

import { notFound } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import AppShell from "@/components/AppShell";

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

function getMediaKind(url: string): "video" | "gif" | "image" {
  if (/[?&]__media=video(\b|&|$)/i.test(url)) return "video";
  if (/[?&]__media=gif(\b|&|$)/i.test(url)) return "gif";
  if (/\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(url)) return "video";
  if (/\.(gif)(\?|$)/i.test(url)) return "gif";
  if (/\/(video|videos)\//i.test(url)) return "video";
  return "image";
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
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const lensData = await fetch(
          `/api/posts?author=${params.address}&limit=20&quick=1`,
          {
            cache: "no-store",
          }
        ).then((res) => res.json());

        const postsData =
          Array.isArray(lensData?.posts) && lensData.posts.length > 0
            ? lensData
            : await fetch(`/api/posts?author=${params.address}&limit=20&source=local`, {
                cache: "no-store",
              }).then((res) => res.json());

        if (cancelled) return;
        setPosts(postsData.posts || []);
        setNextCursor(typeof postsData?.nextCursor === "string" ? postsData.nextCursor : null);
        setPostsSource(postsData?.source === "local" ? "local" : "lens");
        setResolvedAuthor(
          typeof postsData?.resolvedAuthor === "string" && postsData.resolvedAuthor
            ? postsData.resolvedAuthor
            : params.address
        );
      } catch {
        if (!cancelled) setError("Failed to load profile posts");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.address]);

  async function loadMorePosts() {
    if (!nextCursor || !resolvedAuthor || loadingMore) return;
    setLoadingMore(true);
    try {
      const query = new URLSearchParams({
        author: resolvedAuthor,
        limit: "50",
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
      <div className="w-full max-w-2xl bg-black">
        <div className="h-40 w-full relative">
          {coverImage ? (
            <img src={coverImage} alt="cover" className="object-cover w-full h-full" />
          ) : (
            <div className="w-full h-full bg-gradient-to-r from-blue-900 to-purple-900" />
          )}
          <div className="absolute left-1/2 transform -translate-x-1/2 top-24 z-10">
            <img
              src={avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${params.address}`}
              alt="avatar"
              className="w-32 h-32 rounded-full border-4 border-black shadow-xl bg-white"
            />
          </div>
        </div>

        <div className="pt-20 pb-6 px-6 flex flex-col items-center border-b border-gray-800 bg-black">
          <div className="text-2xl font-bold text-white">{headerTitle}</div>
          {showHeaderAddressRow && (
            <div className="text-blue-400 text-sm mb-2">
              {params.address}
            </div>
          )}

          {isOwnProfile && (
            <Link
              href="/profile/edit"
              className="mb-3 rounded-lg border border-gray-700 px-4 py-1 text-sm hover:bg-gray-900"
            >
              Edit Profile
            </Link>
          )}

          {!isOwnProfile && authenticated && (
            <button
              onClick={() => void handleToggleFollow()}
              disabled={followLoading}
              className="mb-3 rounded-lg border border-gray-700 px-4 py-1 text-sm hover:bg-gray-900 disabled:opacity-50"
            >
              {followStats.isFollowing ? "Unfollow" : "Follow"}
            </button>
          )}

          {bio && (
            <div className="text-gray-300 text-base text-center mb-2 whitespace-pre-line max-w-xl">{bio}</div>
          )}
          <div className="flex gap-4 text-gray-400 text-sm mt-2">
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

          <div className="flex gap-6 text-gray-400 text-sm mt-3">
            <span><span className="font-bold text-white">{sortedPosts.length}</span> Posts</span>
            <span><span className="font-bold text-white">{followStats.followers}</span> Followers</span>
            <span><span className="font-bold text-white">{followStats.following}</span> Following</span>
          </div>

          {sortedPosts.length > 0 && (
            <div className="text-xs text-gray-500 mt-2">
              Joined {new Date(sortedPosts[sortedPosts.length - 1].timestamp).toLocaleDateString()}
            </div>
          )}
        </div>

        <div className="px-6 py-8">
          <h3 className="text-xl font-semibold mb-4">Posts</h3>
          {loading ? (
            <p className="text-gray-400">Loading...</p>
          ) : error ? (
            <p className="text-red-400">{error}</p>
          ) : sortedPosts.length === 0 ? (
            <p className="text-gray-500">No posts yet.</p>
          ) : (
            <div className="space-y-4">
              {sortedPosts.map((post) => (
                <article
                  key={post.id}
                  className="border border-gray-700 bg-gray-900 rounded-2xl p-4 flex gap-4 shadow-sm transition-shadow hover:shadow-lg hover:bg-gray-800"
                >
                  <Link href={`/profile/${post.author.address}`} className="shrink-0">
                    <img
                      src={avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${post.author.address}`}
                      alt="avatar"
                      className="w-10 h-10 rounded-full border border-gray-700 bg-white object-cover"
                    />
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Link
                        href={`/profile/${post.author.address}`}
                        className="font-semibold hover:underline"
                      >
                        {post.author.username?.localName ||
                          displayName ||
                          post.author.address}
                      </Link>
                      <span className="text-xs text-gray-500">
                        {post.author.address}
                      </span>
                    </div>

                    <div className="text-white mb-2 whitespace-pre-wrap break-words">
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

                    <div className="flex items-center gap-4 mt-2 text-sm text-gray-400">
                      <span>Like {post.likes?.length ?? 0}</span>
                      <span>Repost {post.reposts?.length ?? 0}</span>
                      <span>Replies {post.replyCount ?? 0}</span>
                      <span className="text-xs text-gray-500">
                        {new Date(post.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
              {nextCursor && (
                <button
                  onClick={() => void loadMorePosts()}
                  disabled={loadingMore}
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50"
                >
                  {loadingMore ? "Loading..." : "Load more posts"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
