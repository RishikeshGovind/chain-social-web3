"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";

export default function Navbar() {
  const { login, logout, authenticated, user, signMessage } = usePrivy();
  const [loading, setLoading] = useState(false);

  const walletAddress = user?.wallet?.address;

  console.log("Wallet Address:", walletAddress);

  const handleLensAuth = async () => {
    if (!walletAddress) {
      alert("Wallet not ready yet");
      return;
    }

    setLoading(true);

    try {
      // 1️⃣ Get challenge
      const challengeRes = await fetch("/api/lens/challenge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: walletAddress }),
      });

      const challengeData = await challengeRes.json();

      if (!challengeRes.ok) {
        throw new Error(challengeData.error || "Challenge failed");
      }

      const { id, text } = challengeData;

      if (!text) {
        throw new Error("Challenge text missing");
      }

      // 2️⃣ Sign challenge text
      const signature = await signMessage({
        message: text,
      });

      // 3️⃣ Authenticate
      const authRes = await fetch("/api/lens/authenticate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id,
          address: walletAddress,
          signature,
        }),
      });

      const result = await authRes.json();

      if (!authRes.ok) {
        throw new Error(result.error || "Authentication failed");
      }

      alert("Lens authenticated successfully 🚀");

    } catch (err) {
      console.error(err);
      alert("Lens authentication failed ❌");
    }

    setLoading(false);
  };

  return (
    <nav className="border-b border-gray-800 px-4 py-3 flex justify-between items-center">
      <h1 className="text-xl font-bold">ChainSocial</h1>

      <div className="flex items-center gap-4">
        {!authenticated ? (
          <button
            onClick={login}
            className="bg-white text-black px-3 py-1 rounded-lg text-sm font-medium"
          >
            Login
          </button>
        ) : (
          <>
            <button
              onClick={handleLensAuth}
              disabled={loading}
              className="border border-gray-600 px-3 py-1 rounded-lg text-sm"
            >
              {loading ? "Connecting..." : "Connect Lens"}
            </button>

            <button
              onClick={logout}
              className="border border-gray-600 px-3 py-1 rounded-lg text-sm"
            >
              Logout
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
