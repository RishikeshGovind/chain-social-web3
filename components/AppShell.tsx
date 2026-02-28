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
    <div className="min-h-screen grid grid-cols-12 bg-black text-white">
      <aside className="hidden md:flex md:col-span-3 lg:col-span-2 flex-col border-r border-gray-800 px-6 py-4">
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
          <p className="mb-6 text-xl font-bold text-white">ChainSocial</p>
          <nav className="mb-8 space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`block rounded-lg px-3 py-2 transition ${
                  item.label === active
                    ? "bg-gray-900 text-white font-semibold"
                    : "text-gray-300 hover:bg-gray-900 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {authenticated && (
            <button
              onClick={logout}
              className="rounded-lg px-3 py-2 text-left text-gray-300 hover:bg-gray-900 hover:text-red-400"
            >
              Logout
            </button>
          )}
        </div>
      </aside>

      <main className="col-span-12 md:col-span-9 lg:col-span-8 flex justify-center">
        {children}
      </main>

      <aside className="hidden lg:block lg:col-span-2 border-l border-gray-800 px-6 py-4">
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
          {rightSidebar ?? (
            <div>
              <h3 className="mb-4 font-bold">Trends</h3>
              <ul className="space-y-2 text-gray-400">
                <li>#Web3</li>
                <li>#Lens</li>
                <li>#DeFi</li>
              </ul>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
