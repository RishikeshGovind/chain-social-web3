"use client";

import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const { login, logout, authenticated, user } = usePrivy();
  const [lensAccountAddress, setLensAccountAddress] = useState<string | null>(null);
  const pathname = usePathname();

  const walletAddress = useMemo(
    () => user?.wallet?.address ?? "",
    [user?.wallet?.address]
  );
  const profileHref = lensAccountAddress ?? user?.wallet?.address ?? "";
  const isAppShellRoute =
    pathname === "/feed" ||
    pathname === "/explore" ||
    pathname === "/notifications" ||
    pathname === "/messages" ||
    pathname === "/bookmarks" ||
    pathname === "/lists" ||
    pathname === "/settings" ||
    pathname === "/help" ||
    pathname === "/profile/edit" ||
    pathname.startsWith("/profile/");

  const appNavItems = [
    { label: "Home", href: "/feed" },
    { label: "Explore", href: "/explore" },
    { label: "Alerts", href: "/notifications" },
    { label: "Messages", href: "/messages" },
    { label: "Bookmarks", href: "/bookmarks" },
    { label: "Lists", href: "/lists" },
    ...(profileHref ? [{ label: "Profile", href: `/profile/${profileHref}` }] : []),
    { label: "Settings", href: "/settings" },
  ];

  const utilityItems = [
    { label: "Feed", href: "/feed" },
    { label: "Privacy", href: "/legal/privacy" },
    { label: "Terms", href: "/legal/terms" },
    { label: "Community", href: "/legal/community" },
  ];

  useEffect(() => {
    const controller = new AbortController();

    if (!authenticated || !walletAddress) {
      setLensAccountAddress(null);
      return;
    }

    async function resolveLensAccountAddress() {
      try {
        const res = await fetch("/api/lens/check-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: walletAddress }),
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => ({}))) as { accountAddress?: string };
        if (!res.ok) {
          setLensAccountAddress(null);
          return;
        }
        setLensAccountAddress(
          typeof data.accountAddress === "string" ? data.accountAddress : null
        );
      } catch {
        if (!controller.signal.aborted) {
          setLensAccountAddress(null);
        }
      }
    }

    void resolveLensAccountAddress();
    return () => controller.abort();
  }, [authenticated, walletAddress]);


  return (
    <nav className="relative z-[250] border-b border-gray-800 bg-black/90 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-3">
        <Link href={isAppShellRoute ? "/feed" : "/"} className="text-xl font-bold text-white">
          ChainSocial
        </Link>

        <div className="flex items-center gap-4">
          {authenticated && user?.wallet?.address && (
            <>
              {!isAppShellRoute && (
                <Link
                  href={`/profile/${profileHref}`}
                  className="text-sm text-blue-400 hover:underline"
                >
                  Profile
                </Link>
              )}
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
              className="rounded-lg bg-white px-3 py-1 text-sm font-medium text-black"
              title="Secure login with your wallet. Your funds are never at risk."
            >
              Sign in
            </button>
          )}
        </div>
      </div>

      {isAppShellRoute ? (
        <div className="md:hidden border-t border-white/5 px-4 py-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {appNavItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.14em] ${
                    active
                      ? "border-cyan-400/30 bg-cyan-400/10 text-white"
                      : "border-white/10 text-gray-300"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="px-4 pb-3 pt-1">
          <div className="flex flex-wrap gap-3 text-sm text-gray-300">
            {utilityItems.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-white">
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
