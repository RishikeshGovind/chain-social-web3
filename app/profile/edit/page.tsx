"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";

export default function EditProfilePage() {
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [avatar, setAvatar] = useState("");
  const [saved, setSaved] = useState(false);
  const { user } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (!user?.wallet?.address) return;
    fetch(`/api/lens/profile?address=${user.wallet.address}`)
      .then(res => res.json())
      .then(data => {
        if (data.profile) {
          setDisplayName(data.profile.displayName || "");
          setBio(data.profile.bio || "");
          setLocation(data.profile.location || "");
          setWebsite(data.profile.website || "");
          setCoverImage(data.profile.coverImage || "");
          setAvatar(data.profile.avatar || "");
        }
      });
  }, [user?.wallet?.address]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.wallet?.address) return;
    const walletAddress = user.wallet.address;
    await fetch("/api/lens/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: walletAddress,
        displayName,
        bio,
        location,
        website,
        coverImage,
        avatar,
      }),
    });
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      router.push(`/profile/${walletAddress}`);
    }, 1200);
  }

  return (
    <div className="min-h-screen bg-black/80 text-white p-8 flex flex-col items-center justify-center" style={{background: 'transparent'}}>
      <div className="bg-card/80 border border-border rounded-2xl p-10 w-full max-w-lg shadow-lg">
        <h2 className="text-3xl font-bold mb-8 text-center text-white drop-shadow">Edit Profile</h2>
        <form onSubmit={handleSave} className="space-y-6">
          <label className="block mb-2 text-gray-200 text-lg font-semibold">Display Name</label>
          <input
            className="w-full p-3 rounded-lg bg-black/80 border border-gray-700 text-white focus:outline-none focus:border-blue-500 text-lg shadow"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            maxLength={32}
            placeholder="Enter a display name"
          />
          <label className="block mb-2 text-gray-200 text-lg font-semibold">Bio</label>
          <textarea
            className="w-full p-3 rounded-lg bg-black/80 border border-gray-700 text-white focus:outline-none focus:border-blue-500 text-lg shadow"
            value={bio}
            onChange={e => setBio(e.target.value)}
            maxLength={160}
            placeholder="Tell us about yourself"
            rows={3}
          />
          <label className="block mb-2 text-gray-200 text-lg font-semibold">Location</label>
          <input
            className="w-full p-3 rounded-lg bg-black/80 border border-gray-700 text-white focus:outline-none focus:border-blue-500 text-lg shadow"
            value={location}
            onChange={e => setLocation(e.target.value)}
            maxLength={32}
            placeholder="Where are you?"
          />
          <label className="block mb-2 text-gray-200 text-lg font-semibold">Website</label>
          <input
            className="w-full p-3 rounded-lg bg-black/80 border border-gray-700 text-white focus:outline-none focus:border-blue-500 text-lg shadow"
            value={website}
            onChange={e => setWebsite(e.target.value)}
            maxLength={64}
            placeholder="yourwebsite.com"
          />
          <label className="block mb-2 text-gray-200 text-lg font-semibold">Avatar Image URL</label>
          <input
            className="w-full p-3 rounded-lg bg-black/80 border border-gray-700 text-white focus:outline-none focus:border-blue-500 text-lg shadow"
            value={avatar}
            onChange={e => setAvatar(e.target.value)}
            maxLength={256}
            placeholder="Paste an image URL for your avatar"
          />
          <label className="block mb-2 text-gray-200 text-lg font-semibold">Cover Image URL</label>
          <input
            className="w-full p-3 rounded-lg bg-black/80 border border-gray-700 text-white focus:outline-none focus:border-blue-500 text-lg shadow"
            value={coverImage}
            onChange={e => setCoverImage(e.target.value)}
            maxLength={256}
            placeholder="Paste an image URL for your cover"
          />
          <button
            type="submit"
            className="bg-primary hover:bg-secondary/80 text-white px-8 py-3 rounded-xl w-full font-bold text-lg shadow-lg focus:ring-2 focus:ring-primary focus:outline-none transition"
          >
            Save
          </button>
          {saved && <div className="text-primary mt-4 text-center text-lg font-semibold">Saved!</div>}
        </form>
      </div>
    </div>
  );
}
