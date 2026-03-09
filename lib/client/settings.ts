"use client";

import { useEffect, useState } from "react";

export type UserSettings = {
  compactFeed: boolean;
  autoplayVideos: boolean;
  hideMediaPreviews: boolean;
};

type SettingsResponse = {
  authenticated?: boolean;
  settings?: Partial<UserSettings> & { updatedAt?: string | null };
  error?: string;
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  compactFeed: false,
  autoplayVideos: true,
  hideMediaPreviews: false,
};

export const USER_SETTINGS_CHANGED_EVENT = "chainsocial:user-settings-changed";

let cachedSettings: UserSettings = DEFAULT_USER_SETTINGS;

function normalizeSettings(input?: Partial<UserSettings>): UserSettings {
  return {
    compactFeed: !!input?.compactFeed,
    autoplayVideos: input?.autoplayVideos !== false,
    hideMediaPreviews: !!input?.hideMediaPreviews,
  };
}

function dispatchUserSettingsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(USER_SETTINGS_CHANGED_EVENT));
}

export function readUserSettings() {
  return cachedSettings;
}

export async function loadUserSettings() {
  const res = await fetch("/api/settings", {
    credentials: "include",
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as SettingsResponse;
  if (!res.ok) {
    throw new Error(data.error || "Failed to load settings");
  }
  cachedSettings = normalizeSettings(data.settings);
  dispatchUserSettingsChanged();
  return cachedSettings;
}

export async function updateUserSettings(updates: Partial<UserSettings>) {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(updates),
  });
  const data = (await res.json().catch(() => ({}))) as SettingsResponse;
  if (res.status === 401) {
    throw new Error("Connect Lens to save settings.");
  }
  if (!res.ok) {
    throw new Error(data.error || "Failed to update settings");
  }
  cachedSettings = normalizeSettings(data.settings);
  dispatchUserSettingsChanged();
  return cachedSettings;
}

export function useUserSettings() {
  const [settings, setSettings] = useState<UserSettings>(cachedSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    loadUserSettings()
      .then((next) => {
        if (!cancelled) setSettings(next);
      })
      .catch(() => {
        if (!cancelled) setSettings(DEFAULT_USER_SETTINGS);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const onSettingsChanged = () => {
      setSettings(readUserSettings());
    };

    window.addEventListener(USER_SETTINGS_CHANGED_EVENT, onSettingsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(USER_SETTINGS_CHANGED_EVENT, onSettingsChanged);
    };
  }, []);

  return { settings, loading };
}
