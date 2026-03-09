"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import AppShell from "@/components/AppShell";
import {
  readUserSettings,
  type UserSettings,
  updateUserSettings,
  useUserSettings,
  USER_SETTINGS_CHANGED_EVENT,
} from "@/lib/client/settings";

export default function SettingsPage() {
  const { authenticated } = usePrivy();
  const { settings, loading } = useUserSettings();
  const [draft, setDraft] = useState<UserSettings>(readUserSettings());
  const [savingKey, setSavingKey] = useState<keyof UserSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    const syncDraft = () => setDraft(readUserSettings());
    window.addEventListener(USER_SETTINGS_CHANGED_EVENT, syncDraft);
    return () => window.removeEventListener(USER_SETTINGS_CHANGED_EVENT, syncDraft);
  }, []);

  async function update<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setSavingKey(key);
    setError(null);
    try {
      await updateUserSettings({ [key]: value });
    } catch (updateError) {
      setDraft(settings);
      setError(
        updateError instanceof Error ? updateError.message : "Failed to save settings"
      );
    } finally {
      setSavingKey(null);
    }
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
        <p className="mb-4 text-sm text-gray-400">
          These preferences are saved to your account and applied across the app.
        </p>
        {!authenticated && (
          <div className="mb-4 rounded-xl border border-yellow-800 bg-yellow-950 px-4 py-3 text-sm text-yellow-200">
            Connect Lens to save account preferences.
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-xl border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}
        <div className="space-y-3">
          <label className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 p-4">
            <span className="text-sm">Compact feed layout</span>
            <input
              type="checkbox"
              checked={draft.compactFeed}
              disabled={!authenticated || loading}
              onChange={(event) => update("compactFeed", event.target.checked)}
            />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 p-4">
            <span className="text-sm">Autoplay videos</span>
            <input
              type="checkbox"
              checked={draft.autoplayVideos}
              disabled={!authenticated || loading}
              onChange={(event) => update("autoplayVideos", event.target.checked)}
            />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 p-4">
            <span className="text-sm">Hide media previews until revealed</span>
            <input
              type="checkbox"
              checked={draft.hideMediaPreviews}
              disabled={!authenticated || loading}
              onChange={(event) => update("hideMediaPreviews", event.target.checked)}
            />
          </label>
        </div>
        <p className="mt-4 text-xs text-gray-500">
          {savingKey ? "Saving changes..." : loading ? "Loading preferences..." : "Preferences saved."}
        </p>
      </div>
    </AppShell>
  );
}
