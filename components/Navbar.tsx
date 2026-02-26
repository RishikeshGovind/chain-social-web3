"use client";

import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";

export default function Navbar() {
  const { login, logout, authenticated, user } = usePrivy();
  const [lensAccountAddress, setLensAccountAddress] = useState<string | null>(null);

  const walletAddress = useMemo(
    () => user?.wallet?.address ?? "",
    [user?.wallet?.address]
  );

  useEffect(() => {
    if (!authenticated || !walletAddress) {
      setLensAccountAddress(null);
      return;
    }
    fetch("/api/lens/check-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: walletAddress }),
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
  }, [authenticated, walletAddress]);


  return (
    <nav className="border-b border-gray-800 px-4 py-3 flex justify-between items-center">
      <h1 className="text-xl font-bold">ChainSocial</h1>

      <div className="flex items-center gap-4">
        {authenticated && user?.wallet?.address && (
          <>
            <Link
              href={`/profile/${lensAccountAddress ?? user.wallet.address}`}
              className="text-sm text-blue-400 hover:underline"
            >
              Profile
            </Link>
            <button
              onClick={logout}
              className="text-sm text-gray-400 hover:text-red-400"
            >
              Logout
            </button>
          </>
        )}
        {!authenticated && (
          <button
            onClick={login}
            className="bg-white text-black px-3 py-1 rounded-lg text-sm font-medium"
            title="Secure login with your wallet. Your funds are never at risk."
          >
            Sign in with your wallet
          </button>
        )}
      </div>
    </nav>
  );
}
