"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";

export default function Navbar() {
  const { login, logout, authenticated, user, signMessage } = usePrivy();
  const [loading, setLoading] = useState(false);

  const walletAddress = user?.wallet?.address;

  const handleLensAuth = async () => {
    if (!walletAddress) return;

    setLoading(true);

    try {
      // 1️⃣ Get challenge
      const challengeRes = await fetch("/api/lens/auth", {
        method: "POST",
        body: JSON.stringify({ address: walletAddress }),
      });

      const { challengeId, challengeText } = await challengeRes.json();

      console.log("Lens Challenge:", challengeText);

      // 2️⃣ Sign with Privy wallet
      const signature = await signMessage({ message: challengeText });

      console.log("Signature:", signature);

      // 3️⃣ Authenticate
      await fetch("/api/lens/authenticate", {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            challengeId,
            signature,
        }),
        });


      alert("Lens authenticated successfully 🚀");
    } catch (err) {
      console.error(err);
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
                onClick={async () => {
                    const res = await fetch("/api/lens/create-account", {
                    method: "POST",
                    credentials: "include",
                    });
                    const data = await res.json();
                    console.log("Create Account:", data);
                    alert(JSON.stringify(data, null, 2));
                }}
                className="border border-gray-600 px-3 py-1 rounded-lg text-sm"
                >
                Create Lens Account
            </button>

            <button
                onClick={async () => {
                const res = await fetch("/api/lens/me", {
                credentials: "include",
                });
                const data = await res.json();
                console.log("My Lens Account:", data);
                alert(JSON.stringify(data, null, 2));
                }}
                className="border border-gray-600 px-3 py-1 rounded-lg text-sm"
            >
                Check Account
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
