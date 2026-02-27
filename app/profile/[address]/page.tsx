"use client";

import { notFound } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";

type ProfilePost = {
  id: string;
  timestamp: string;
  metadata?: {
    content?: string;
  };
  author: {
    address: string;
  };
};

type FollowStats = {
  followers: number;
  following: number;
  isFollowing: boolean;
  isSelf: boolean;
};

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

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

export default function UserProfilePage({ params }: { params: { address: string } }) {
  const [posts, setPosts] = useState<ProfilePost[]>([]);
  const [loading, setLoading] = useState(true);
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
    setLoading(true);
    setError(null);

    fetch("/api/lens/check-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: params.address }),
      cache: "no-store",
    })
      .then((res) => res.json())
      .catch(() => ({ hasProfile: false }))
      .then((accountData) => {
        const resolvedAuthor =
          typeof accountData?.accountAddress === "string" && accountData.accountAddress
            ? accountData.accountAddress
            : params.address;
        return Promise.all([
          fetch(`/api/posts?author=${resolvedAuthor}&limit=50`, { cache: "no-store" }).then((res) => res.json()),
          fetch(`/api/lens/profile?address=${params.address}`, { cache: "no-store" }).then((res) => res.json()),
          fetch(`/api/follows/${params.address}`, { cache: "no-store" }).then((res) => res.json()),
        ]);
      })
      .then(([postsData, profileData, followData]) => {
        setPosts(postsData.posts || []);
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
        setError("Failed to load profile");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [params.address]);

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
    <div className="min-h-screen bg-black text-white flex justify-center">
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
          <div className="text-2xl font-bold text-white">
            {displayName ? displayName : shortenAddress(params.address)}
          </div>
          <div className="text-blue-400 text-sm mb-2">{shortenAddress(params.address)}</div>

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
            <span><span className="font-bold text-white">{posts.length}</span> Posts</span>
            <span><span className="font-bold text-white">{followStats.followers}</span> Followers</span>
            <span><span className="font-bold text-white">{followStats.following}</span> Following</span>
          </div>

          {posts.length > 0 && (
            <div className="text-xs text-gray-500 mt-2">
              Joined {new Date(posts[posts.length - 1].timestamp).toLocaleDateString()}
            </div>
          )}
        </div>

        <div className="px-6 py-8">
          <h3 className="text-xl font-semibold mb-4">Posts</h3>
          {loading ? (
            <p className="text-gray-400">Loading...</p>
          ) : error ? (
            <p className="text-red-400">{error}</p>
          ) : posts.length === 0 ? (
            <p className="text-gray-500">No posts yet.</p>
          ) : (
            <div className="space-y-4">
              {posts.map((post) => (
                <div key={post.id} className="border border-gray-800 bg-gray-900 rounded-xl p-4">
                  <div className="text-white mb-2 whitespace-pre-wrap break-words">
                    {renderContentWithWrappedLinks(post.metadata?.content)}
                  </div>
                  <div className="text-xs text-gray-500">{new Date(post.timestamp).toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
