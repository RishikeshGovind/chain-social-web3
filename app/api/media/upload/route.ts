import { NextResponse } from "next/server";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import { isValidAddress } from "@/lib/posts/content";
import { getMediaStorage } from "@/lib/server/storage/media-storage";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
const UPLOADS_PER_MINUTE = 20;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const uploadRateState = new Map<string, { windowStart: number; count: number }>();

function checkUploadRateLimit(address: string) {
  const now = Date.now();
  const state = uploadRateState.get(address) ?? { windowStart: now, count: 0 };
  if (now - state.windowStart >= 60_000) {
    state.windowStart = now;
    state.count = 0;
  }
  if (state.count >= UPLOADS_PER_MINUTE) {
    return {
      ok: false as const,
      retryAfterMs: 60_000 - (now - state.windowStart),
    };
  }
  state.count += 1;
  uploadRateState.set(address, state);
  return { ok: true as const };
}

function hasValidImageSignature(buffer: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg") {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return (
      buffer.length > 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (mimeType === "image/gif") {
    return (
      buffer.length > 6 &&
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38
    );
  }
  if (mimeType === "image/webp") {
    return (
      buffer.length > 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

function extensionForMime(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

export async function POST(req: Request) {
  try {
    const actorAddress = await getActorAddressFromLensCookie();
    if (!actorAddress || !isValidAddress(actorAddress)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const uploadRateLimit = checkUploadRateLimit(actorAddress);
    if (!uploadRateLimit.ok) {
      const retryAfterSeconds = Math.max(1, Math.ceil(uploadRateLimit.retryAfterMs / 1000));
      return NextResponse.json(
        { error: "Upload rate limit reached. Please try again shortly." },
        { status: 429, headers: { "Retry-After": `${retryAfterSeconds}` } }
      );
    }

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data")) {
      return NextResponse.json({ error: "Invalid content type" }, { status: 400 });
    }

    const formData = await req.formData();
    const file = formData.get("file");

    const isFileLike =
      !!file &&
      typeof file === "object" &&
      "arrayBuffer" in file &&
      typeof (file as { arrayBuffer?: unknown }).arrayBuffer === "function";

    if (!isFileLike) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const uploadFile = file as {
      arrayBuffer: () => Promise<ArrayBuffer>;
      size?: number;
      type?: string;
    };
    const mimeType = typeof uploadFile.type === "string" ? uploadFile.type : "";
    if (!ALLOWED_MIME.has(mimeType)) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }

    if (typeof uploadFile.size === "number" && uploadFile.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File too large. Max size is 5MB." }, { status: 413 });
    }

    const buffer = Buffer.from(await uploadFile.arrayBuffer());
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File too large. Max size is 5MB." }, { status: 413 });
    }
    if (!hasValidImageSignature(buffer, mimeType)) {
      return NextResponse.json({ error: "File content does not match image type" }, { status: 400 });
    }

    const ext = extensionForMime(mimeType);
    const url = await getMediaStorage().putImage({
      data: buffer,
      mimeType,
      extension: ext,
    });

    return NextResponse.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
