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
      }),
    });
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      router.push(`/profile/${walletAddress}`);
    }, 1200);
  }

  return (
    <div className="min-h-screen bg-black text-white p-6 flex flex-col items-center justify-center">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-md">
        <h2 className="text-2xl font-semibold mb-6">Edit Profile</h2>
        <form onSubmit={handleSave}>
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
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded w-full"
          >
            Save
          </button>
          {saved && <div className="text-green-400 mt-2 text-center">Saved!</div>}
        </form>
      </div>
    </div>
  );
}
