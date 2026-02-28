"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

type UserSettings = {
  compactFeed: boolean;
  autoplayVideos: boolean;
  hideSensitiveMedia: boolean;
};

const STORAGE_KEY = "chainsocial:settings";

const DEFAULT_SETTINGS: UserSettings = {
  compactFeed: false,
  autoplayVideos: true,
  hideSensitiveMedia: false,
};

function readSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      compactFeed: !!parsed.compactFeed,
      autoplayVideos: parsed.autoplayVideos !== false,
      hideSensitiveMedia: !!parsed.hideSensitiveMedia,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: UserSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(readSettings());
  }, []);

  function update<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    writeSettings(next);
  }

  return (
    <AppShell active="Settings">
      <div className="w-full max-w-3xl px-6 py-8 text-white">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <Link href="/feed" className="text-sm text-blue-400 hover:underline">
            Back to Feed
          </Link>
        </div>
        <div className="space-y-3">
          <label className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 p-4">
            <span className="text-sm">Compact feed layout</span>
            <input
              type="checkbox"
              checked={settings.compactFeed}
              onChange={(event) => update("compactFeed", event.target.checked)}
            />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 p-4">
            <span className="text-sm">Autoplay videos</span>
            <input
              type="checkbox"
              checked={settings.autoplayVideos}
              onChange={(event) => update("autoplayVideos", event.target.checked)}
            />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 p-4">
            <span className="text-sm">Hide sensitive media</span>
            <input
              type="checkbox"
              checked={settings.hideSensitiveMedia}
              onChange={(event) => update("hideSensitiveMedia", event.target.checked)}
            />
          </label>
        </div>
      </div>
    </AppShell>
  );
}
