"use client";

export type UploadedMediaResult =
  | { status: "ok"; url: string }
  | { status: "pending_review"; message: string };

export async function uploadMediaFile(file: File): Promise<UploadedMediaResult> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/media/upload", {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  const raw = await res.text();
  let data: { url?: string; error?: string; pendingReview?: boolean } = {};
  try {
    data = raw ? (JSON.parse(raw) as { url?: string; error?: string; pendingReview?: boolean }) : {};
  } catch {
    throw new Error("Upload endpoint returned an invalid response");
  }

  if (res.status === 202 || data.pendingReview) {
    return {
      status: "pending_review",
      message: data.error || "Upload queued for moderation review.",
    };
  }

  if (!res.ok || !data.url) {
    throw new Error(data.error || "Image upload failed");
  }

  return { status: "ok", url: data.url };
}
