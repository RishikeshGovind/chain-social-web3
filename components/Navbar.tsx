"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
import Link from "next/link";

export default function Navbar() {
  const { login, logout, authenticated, user, signMessage } = usePrivy();
  const [loading, setLoading] = useState(false);

  const walletAddress = user?.wallet?.address;

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

      const { id, text } = challengeData as { id: string | null; text?: string };

      if (!text) {
        throw new Error("Challenge text missing");
      }

      // 2️⃣ Sign challenge text
      const signedMessageResult = await signMessage({
        message: text,
      });
      const signature =
        typeof signedMessageResult === "string"
          ? signedMessageResult
          : typeof signedMessageResult === "object" &&
              signedMessageResult !== null &&
              "signature" in signedMessageResult &&
              typeof (signedMessageResult as { signature?: unknown }).signature === "string"
            ? (signedMessageResult as { signature: string }).signature
            : null;

      if (!signature) {
        throw new Error("Wallet signature was not returned");
      }

      // 3️⃣ Authenticate
      const authRes = await fetch("/api/lens/authenticate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: id ?? undefined,
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
      const message = err instanceof Error ? err.message : "Lens authentication failed";
      console.error(message);
      alert(`Lens authentication failed ❌\n${message}`);
    }

    setLoading(false);
  };

  return (
    <nav className="border-b border-border bg-card/80 px-8 py-4 flex justify-between items-center shadow-md rounded-b-2xl backdrop-blur-md">
      <h1 className="text-2xl font-extrabold text-primary tracking-tight drop-shadow-lg">ChainSocial</h1>

      <div className="flex items-center gap-6">
        {authenticated && user?.wallet?.address && (
          <>
            <Link
              href={`/profile/${user.wallet.address}`}
              className="text-base text-secondary font-semibold hover:underline px-3 py-2 rounded-lg transition"
            >
              My Profile
            </Link>
            <Link
              href="/profile/edit"
              className="text-base text-secondary font-semibold hover:underline px-3 py-2 rounded-lg transition"
            >
              Edit Profile
            </Link>
            <button
              onClick={handleLensAuth}
              disabled={loading}
              className="px-5 py-2 rounded-xl text-base font-bold bg-primary text-white shadow-md hover:bg-secondary/80 focus:ring-2 focus:ring-primary focus:outline-none transition border border-border disabled:opacity-60"
            >
              {loading ? "Connecting..." : "Connect Lens"}
            </button>
            <button
              onClick={logout}
              className="px-5 py-2 rounded-xl text-base font-bold bg-accent text-text shadow-md hover:bg-secondary/60 focus:ring-2 focus:ring-primary focus:outline-none transition border border-border"
            >
              Logout
            </button>
          </>
        )}
        {!authenticated && (
          <button
            onClick={login}
            className="px-5 py-2 rounded-xl text-base font-bold bg-primary text-white shadow-md hover:bg-secondary/80 focus:ring-2 focus:ring-primary focus:outline-none transition border border-border"
            title="Secure login with your wallet. Your funds are never at risk."
          >
            Sign in with your wallet
          </button>
        )}
      </div>
    </nav>
  );
}
