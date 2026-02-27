"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";

type AvatarMode = "dicebear" | "custom";

function buildDicebearUrl(seed: string) {
  return `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(seed)}`;
}

function extractDicebearSeed(url: string): string | null {
  try {
    const parsed = new URL(url);
    const isDicebear = parsed.hostname.includes("dicebear.com");
    if (!isDicebear) return null;
    const seed = parsed.searchParams.get("seed");
    return seed && seed.trim() ? seed : null;
  } catch {
    return null;
  }
}

export default function EditProfilePage() {
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [avatar, setAvatar] = useState("");
  const [avatarMode, setAvatarMode] = useState<AvatarMode>("dicebear");
  const [dicebearSeed, setDicebearSeed] = useState("avatar");
  const [lensAccountAddress, setLensAccountAddress] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const { user } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (!user?.wallet?.address) return;
    const defaultSeed = user.wallet.address.toLowerCase();
    setDicebearSeed(defaultSeed);
    setAvatar(buildDicebearUrl(defaultSeed));
    setAvatarMode("dicebear");

    fetch("/api/lens/check-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: user.wallet.address }),
    })
      .then((res) => res.json())
      .then((data) => {
        setLensAccountAddress(
          typeof data?.accountAddress === "string" ? data.accountAddress : null
        );
      })
      .catch(() => {
        setLensAccountAddress(null);
      });

    fetch(`/api/lens/profile?address=${user.wallet.address}`)
      .then(res => res.json())
      .then(data => {
        if (data.profile) {
          setDisplayName(data.profile.displayName || "");
          setBio(data.profile.bio || "");
          setLocation(data.profile.location || "");
          setWebsite(data.profile.website || "");
          setCoverImage(data.profile.coverImage || "");
          const savedAvatar = typeof data.profile.avatar === "string" ? data.profile.avatar : "";
          const seed = extractDicebearSeed(savedAvatar);
          if (seed) {
            setAvatarMode("dicebear");
            setDicebearSeed(seed);
            setAvatar(buildDicebearUrl(seed));
          } else if (savedAvatar) {
            setAvatarMode("custom");
            setAvatar(savedAvatar);
          }
        }
      });
  }, [user?.wallet?.address]);

  async function uploadImage(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/media/upload", {
      method: "POST",
      body: formData,
    });
    const raw = await res.text();
    let data: { url?: string; error?: string } = {};
    try {
      data = raw ? (JSON.parse(raw) as { url?: string; error?: string }) : {};
    } catch {
      throw new Error("Upload endpoint returned an invalid response");
    }
    if (!res.ok || !data?.url) {
      throw new Error(data?.error || "Image upload failed");
    }
    return data.url as string;
  }

  async function handleAvatarUpload(file: File) {
    setError(null);
    setUploadingAvatar(true);
    try {
      const url = await uploadImage(file);
      setAvatarMode("custom");
      setAvatar(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload avatar");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleCoverUpload(file: File) {
    setError(null);
    setUploadingCover(true);
    try {
      const url = await uploadImage(file);
      setCoverImage(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload banner image");
    } finally {
      setUploadingCover(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.wallet?.address) return;
    setSaving(true);
    setError(null);
    const walletAddress = user.wallet.address;
    try {
      const res = await fetch("/api/lens/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: walletAddress,
          lensAccountAddress,
          displayName,
          bio,
          location,
          website,
          coverImage,
          avatar:
            avatarMode === "dicebear"
              ? buildDicebearUrl(dicebearSeed || user.wallet.address.toLowerCase())
              : avatar,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save profile");
      }
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        router.push(`/profile/${lensAccountAddress ?? walletAddress}`);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white p-6 flex flex-col items-center justify-center">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-md">
        <h2 className="text-2xl font-semibold mb-6">Edit Profile</h2>
        <form onSubmit={handleSave}>
          <div className="mb-6">
            <label className="block mb-2 text-gray-300">Avatar</label>
            <div className="flex items-center gap-2 mb-3">
              <button
                type="button"
                onClick={() => setAvatarMode("dicebear")}
                className={`rounded px-3 py-1 text-sm border ${
                  avatarMode === "dicebear"
                    ? "border-blue-500 text-blue-300 bg-blue-950/40"
                    : "border-gray-700 text-gray-300 hover:bg-gray-800"
                }`}
              >
                Dicebear
              </button>
              <button
                type="button"
                onClick={() => setAvatarMode("custom")}
                className={`rounded px-3 py-1 text-sm border ${
                  avatarMode === "custom"
                    ? "border-blue-500 text-blue-300 bg-blue-950/40"
                    : "border-gray-700 text-gray-300 hover:bg-gray-800"
                }`}
              >
                Custom
              </button>
            </div>
            <div className="flex items-center gap-3">
              <img
                src={
                  avatarMode === "dicebear"
                    ? buildDicebearUrl(dicebearSeed || "avatar")
                    : (avatar || "https://api.dicebear.com/7.x/bottts/svg?seed=avatar")
                }
                alt="avatar preview"
                className="w-16 h-16 rounded-full border border-gray-700 bg-white object-cover"
              />
              {avatarMode === "dicebear" ? (
                <button
                  type="button"
                  onClick={() => {
                    const nextSeed = `bot-${Math.random().toString(36).slice(2, 10)}`;
                    setDicebearSeed(nextSeed);
                    setAvatar(buildDicebearUrl(nextSeed));
                  }}
                  className="rounded border border-gray-600 px-3 py-2 text-sm hover:bg-gray-800"
                >
                  Randomize
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="rounded border border-gray-600 px-3 py-2 text-sm hover:bg-gray-800 disabled:opacity-50"
                >
                  {uploadingAvatar ? "Uploading..." : "Upload Avatar"}
                </button>
              )}
            </div>
            {avatarMode === "dicebear" && (
              <div className="text-xs text-gray-400 mt-2">
                Seed: <span className="text-gray-300">{dicebearSeed}</span>
              </div>
            )}
            {avatarMode === "custom" && (
              <>
                <label className="block mt-3 mb-2 text-gray-300 text-sm">Avatar Image URL</label>
                <input
                  className="w-full p-2 rounded bg-black border border-gray-700 text-white mb-2 focus:outline-none focus:border-blue-500"
                  value={avatar}
                  onChange={(e) => setAvatar(e.target.value)}
                  maxLength={256}
                  placeholder="Paste an image URL for your avatar"
                />
              </>
            )}
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleAvatarUpload(file);
                e.currentTarget.value = "";
              }}
            />
          </div>

          <div className="mb-6">
            <label className="block mb-2 text-gray-300">Banner Image</label>
            <div className="space-y-3">
              <div className="h-24 w-full rounded-lg border border-gray-700 bg-black overflow-hidden">
                {coverImage ? (
                  <img src={coverImage} alt="banner preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-r from-blue-900 to-purple-900" />
                )}
              </div>
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                disabled={uploadingCover}
                className="rounded border border-gray-600 px-3 py-2 text-sm hover:bg-gray-800 disabled:opacity-50"
              >
                {uploadingCover ? "Uploading..." : "Upload Banner"}
              </button>
            </div>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleCoverUpload(file);
                e.currentTarget.value = "";
              }}
            />
          </div>

          <label className="block mb-2 text-gray-300">Display Name</label>
          <input
            className="w-full p-2 rounded bg-black border border-gray-700 text-white mb-4 focus:outline-none focus:border-blue-500"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            maxLength={32}
            placeholder="Enter a display name"
          />
          <label className="block mb-2 text-gray-300">Bio</label>
          <textarea
            className="w-full p-2 rounded bg-black border border-gray-700 text-white mb-4 focus:outline-none focus:border-blue-500"
            value={bio}
            onChange={e => setBio(e.target.value)}
            maxLength={160}
            placeholder="Tell us about yourself"
            rows={3}
          />
          <label className="block mb-2 text-gray-300">Location</label>
          <input
            className="w-full p-2 rounded bg-black border border-gray-700 text-white mb-4 focus:outline-none focus:border-blue-500"
            value={location}
            onChange={e => setLocation(e.target.value)}
            maxLength={32}
            placeholder="Where are you?"
          />
          <label className="block mb-2 text-gray-300">Website</label>
          <input
            className="w-full p-2 rounded bg-black border border-gray-700 text-white mb-4 focus:outline-none focus:border-blue-500"
            value={website}
            onChange={e => setWebsite(e.target.value)}
            maxLength={64}
            placeholder="yourwebsite.com"
          />
          <label className="block mb-2 text-gray-300">Cover Image URL</label>
          <input
            className="w-full p-2 rounded bg-black border border-gray-700 text-white mb-4 focus:outline-none focus:border-blue-500"
            value={coverImage}
            onChange={e => setCoverImage(e.target.value)}
            maxLength={256}
            placeholder="Paste an image URL for your cover"
          />
          <button
            type="submit"
            disabled={saving || uploadingAvatar || uploadingCover}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded w-full disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {error && <div className="text-red-400 mt-2 text-center">{error}</div>}
          {saved && <div className="text-green-400 mt-2 text-center">Saved!</div>}
        </form>
      </div>
    </div>
  );
}
