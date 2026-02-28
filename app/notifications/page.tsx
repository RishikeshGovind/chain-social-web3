"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

type NotificationItem = {
  id: string;
  message: string;
  createdAt: string;
  read: boolean;
};

const STORAGE_KEY = "chainsocial:notifications";

function readNotifications(): NotificationItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as NotificationItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeNotifications(items: NotificationItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);

  useEffect(() => {
    const existing = readNotifications();
    if (existing.length === 0) {
      const seeded: NotificationItem[] = [
        {
          id: crypto.randomUUID(),
          message: "Welcome to ChainSocial notifications.",
          createdAt: new Date().toISOString(),
          read: false,
        },
      ];
      writeNotifications(seeded);
      setItems(seeded);
      return;
    }
    setItems(existing);
  }, []);

  const markAllRead = () => {
    const next = items.map((item) => ({ ...item, read: true }));
    setItems(next);
    writeNotifications(next);
  };

  const clearAll = () => {
    setItems([]);
    writeNotifications([]);
  };

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
            className="rounded border border-gray-700 px-3 py-1 text-sm text-gray-200 hover:bg-gray-900"
          >
            Mark All Read
          </button>
          <button
            onClick={clearAll}
            className="rounded border border-gray-700 px-3 py-1 text-sm text-gray-200 hover:bg-gray-900"
          >
            Clear
          </button>
        </div>
        <div className="space-y-3">
          {items.map((item) => (
            <article
              key={item.id}
              className={`rounded-xl border p-4 ${item.read ? "border-gray-800 bg-gray-900" : "border-blue-700 bg-gray-900"}`}
            >
              <p className="text-sm text-gray-100">{item.message}</p>
              <p className="mt-1 text-xs text-gray-500">{new Date(item.createdAt).toLocaleString()}</p>
            </article>
          ))}
          {items.length === 0 && <p className="text-gray-500">No notifications yet.</p>}
        </div>
      </div>
    </AppShell>
  );
}
