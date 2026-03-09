"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { UserSettings } from "@/lib/client/settings";

type PostMediaProps = {
  media: string[];
  settings: UserSettings;
};

function getMediaKind(url: string): "video" | "gif" | "image" {
  if (/[?&]__media=video(\b|&|$)/i.test(url)) return "video";
  if (/[?&]__media=gif(\b|&|$)/i.test(url)) return "gif";
  if (/\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(url)) return "video";
  if (/\.(gif)(\?|$)/i.test(url)) return "gif";
  if (/\/(video|videos)\//i.test(url)) return "video";
  return "image";
}

export default function PostMedia({ media, settings }: PostMediaProps) {
  const [revealed, setRevealed] = useState(!settings.hideMediaPreviews);
  const isSingle = media.length === 1;
  const singleHeightClass = settings.compactFeed ? "max-h-72" : "max-h-96";

  useEffect(() => {
    setRevealed(!settings.hideMediaPreviews);
  }, [settings.hideMediaPreviews]);

  if (!revealed) {
    return (
      <div className="mb-2 rounded-xl border border-gray-700 bg-black/60 p-4">
        <p className="text-sm text-gray-300">Media preview hidden by your settings.</p>
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="mt-3 rounded-lg border border-gray-600 px-3 py-1.5 text-sm text-white hover:bg-gray-800"
        >
          Reveal media
        </button>
      </div>
    );
  }

  return (
    <div className={`mb-2 ${isSingle ? "mx-auto max-w-xl" : "grid grid-cols-2 gap-2"}`}>
      {media.map((url, idx) => {
        const mediaKind = getMediaKind(url);
        const frameClass = isSingle
          ? "mx-auto overflow-hidden rounded-xl border border-gray-700 bg-black"
          : "overflow-hidden rounded-xl border border-gray-700 bg-black aspect-square";

        if (mediaKind === "video") {
          return (
            <div key={idx} className={frameClass}>
              <video
                src={url}
                controls
                autoPlay={settings.autoplayVideos}
                muted={settings.autoplayVideos}
                loop={settings.autoplayVideos}
                playsInline
                className={isSingle ? `w-full ${singleHeightClass} object-contain` : "h-full w-full object-cover"}
              />
            </div>
          );
        }

        return (
          <div key={idx} className={frameClass}>
            <Image
              src={url}
              alt="media"
              width={1200}
              height={900}
              unoptimized
              className={
                mediaKind === "gif"
                  ? isSingle
                    ? `w-full ${singleHeightClass} object-contain`
                    : "h-full w-full object-contain"
                  : isSingle
                    ? `w-full ${singleHeightClass} object-cover`
                    : "h-full w-full object-cover"
              }
            />
          </div>
        );
      })}
    </div>
  );
}
