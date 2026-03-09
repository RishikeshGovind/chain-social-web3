"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readConsent, writeConsent } from "@/lib/client/consent";

export default function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = readConsent();
    const hasChoice = consent.updatedAt !== new Date(0).toISOString();
    if (!hasChoice) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-700 bg-black/95 px-4 py-3 text-sm text-gray-200">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p>
          We use essential storage for sign-in and optional storage for preferences/bookmarks. See{" "}
          <Link href="/legal/cookies" className="text-blue-400 underline">
            Cookie Policy
          </Link>
          .
        </p>
        <div className="flex gap-2">
          <button
            className="rounded border border-gray-600 px-3 py-1"
            onClick={() => {
              writeConsent({ functional: false, analytics: false });
              setVisible(false);
            }}
          >
            Reject Optional
          </button>
          <button
            className="rounded bg-white px-3 py-1 text-black"
            onClick={() => {
              writeConsent({ functional: true, analytics: true });
              setVisible(false);
            }}
          >
            Accept All
          </button>
        </div>
      </div>
    </div>
  );
}
