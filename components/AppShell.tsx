"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";

type AppShellProps = {
  active:
    | "Home"
    | "Explore"
    | "Notifications"
    | "Messages"
    | "Bookmarks"
    | "Lists"
    | "Settings"
    | "Profile";
  children: ReactNode;
  rightSidebar?: ReactNode;
};

export default function AppShell({ active, children, rightSidebar }: AppShellProps) {
  const { authenticated, user, logout } = usePrivy();
  const profileHref = user?.wallet?.address ? `/profile/${user.wallet.address}` : null;

  const navItems: Array<{ label: AppShellProps["active"]; href: string }> = [
    { label: "Home", href: "/feed" },
    { label: "Explore", href: "/explore" },
    { label: "Notifications", href: "/notifications" },
    { label: "Messages", href: "/messages" },
    { label: "Bookmarks", href: "/bookmarks" },
    { label: "Lists", href: "/lists" },
    ...(profileHref ? [{ label: "Profile" as const, href: profileHref }] : []),
    { label: "Settings", href: "/settings" },
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="relative isolate grid min-h-screen grid-cols-12">
        <div className="absolute inset-x-0 top-[-18rem] -z-10 flex justify-center blur-3xl">
          <div className="h-[34rem] w-[34rem] rounded-full bg-cyan-500/14" />
        </div>
        <div className="absolute left-[-10rem] top-40 -z-10 h-72 w-72 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute right-[-10rem] top-72 -z-10 h-80 w-80 rounded-full bg-lime-400/10 blur-3xl" />

      <aside className="hidden md:flex md:col-span-3 lg:col-span-2 flex-col px-5 py-6 lg:px-6">
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur">
          <p className="mb-6 text-xl font-black uppercase tracking-[-0.04em] text-white">ChainSocial</p>
          <nav className="mb-8 space-y-2">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`block rounded-xl px-4 py-3 text-sm transition ${
                  item.label === active
                    ? "border border-cyan-400/30 bg-cyan-400/10 font-semibold text-white"
                    : "text-gray-300 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {authenticated && (
            <button
              onClick={logout}
              className="w-full rounded-xl border border-white/10 px-4 py-3 text-left text-gray-300 transition hover:bg-white/[0.06] hover:text-red-300"
            >
              Logout
            </button>
          )}
        </div>
      </aside>

      <main className="col-span-12 md:col-span-9 lg:col-span-8 flex justify-center px-4 py-6 md:px-6">
        {children}
      </main>

      <aside className="hidden lg:block lg:col-span-2 px-5 py-6 lg:px-6">
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur">
          {rightSidebar ?? (
            <div>
              <div className="mb-6 rounded-[1.6rem] border border-cyan-400/20 bg-gradient-to-br from-cyan-400/10 via-white/[0.03] to-lime-300/10 p-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">Companion Panel</p>
                <h3 className="mt-2 text-xl font-semibold text-white">Keep the product in view.</h3>
                <p className="mt-2 text-sm leading-6 text-gray-300">
                  Quick context, legal links, and space for page-specific signals without crowding the main timeline.
                </p>
              </div>
              <div className="space-y-3 text-sm text-gray-300">
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  Wallet-based access removes the usual password flow.
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  Public activity stays readable even before you sign in.
                </div>
              </div>
              <div className="mt-8 border-t border-white/10 pt-4 text-xs text-gray-400">
                <div className="flex flex-col gap-2">
                  <Link href="/legal/privacy" className="hover:text-white">Privacy</Link>
                  <Link href="/legal/terms" className="hover:text-white">Terms</Link>
                  <Link href="/legal/cookies" className="hover:text-white">Cookies</Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
      </div>
    </div>
  );
}
