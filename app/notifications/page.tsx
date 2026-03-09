"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { usePrivy } from "@privy-io/react-auth";

type NotificationItem = {
  id: string;
  type: "like" | "reply" | "follow" | "repost" | "message";
  actorAddress: string;
  recipientAddress: string;
  message: string;
  createdAt: string;
  readAt?: string;
  entityId?: string;
  entityHref?: string;
};

type NotificationsResponse = {
  items?: NotificationItem[];
  unreadCount?: number;
  error?: string;
};

export default function NotificationsPage() {
  const { authenticated } = usePrivy();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadNotifications() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications?limit=100", {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await res.json()) as NotificationsResponse;
      if (!res.ok) {
        throw new Error(data.error || "Failed to load notifications");
      }
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (fetchError) {
      setItems([]);
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadNotifications();
  }, []);

  useEffect(() => {
    const onFocus = () => {
      void loadNotifications();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  async function markAllRead() {
    setError(null);
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as NotificationsResponse;
      if (!res.ok) {
        throw new Error(data.error || "Failed to mark notifications as read");
      }
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : "Failed to mark notifications as read"
      );
    }
  }

  async function clearAll() {
    setError(null);
    try {
      const res = await fetch("/api/notifications", {
        method: "DELETE",
        credentials: "include",
      });
      const data = (await res.json()) as NotificationsResponse;
      if (!res.ok) {
        throw new Error(data.error || "Failed to clear notifications");
      }
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to clear notifications");
    }
  }

  return (
    <AppShell active="Notifications">
      <div className="w-full max-w-3xl px-6 py-8 text-white">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <Link href="/feed" className="text-sm text-blue-400 hover:underline">
            Back to Feed
          </Link>
        </div>
        <div className="mb-4 flex gap-2">
          <button
            onClick={markAllRead}
            disabled={!authenticated || loading || items.length === 0}
            className="rounded border border-gray-700 px-3 py-1 text-sm text-gray-200 hover:bg-gray-900"
          >
            Mark All Read
          </button>
          <button
            onClick={clearAll}
            disabled={!authenticated || loading || items.length === 0}
            className="rounded border border-gray-700 px-3 py-1 text-sm text-gray-200 hover:bg-gray-900"
          >
            Clear
          </button>
        </div>
        <div className="space-y-3">
          {error && <p className="text-sm text-red-300">{error}</p>}
          {!authenticated && !loading && (
            <p className="text-gray-500">Connect Lens to view your notifications.</p>
          )}
          {loading && <p className="text-gray-500">Loading notifications...</p>}
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.entityHref ?? "/feed"}
              className={`block rounded-xl border p-4 ${item.readAt ? "border-gray-800 bg-gray-900" : "border-blue-700 bg-gray-900"}`}
            >
              <p className="text-sm text-gray-100">{item.message}</p>
              <p className="mt-1 text-xs text-gray-500">{new Date(item.createdAt).toLocaleString()}</p>
            </Link>
          ))}
          {!loading && authenticated && items.length === 0 && (
            <p className="text-gray-500">No notifications yet.</p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
