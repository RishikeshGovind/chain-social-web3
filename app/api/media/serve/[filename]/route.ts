import { NextRequest, NextResponse } from "next/server";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { isMediaBlockedOrQuarantined } from "@/lib/server/moderation/store";

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Prevent path traversal
  const sanitized = path.basename(filename);
  if (sanitized !== filename || filename.includes("..")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  // Check if the media is blocked or quarantined
  const serveUrl = `/api/media/serve/${sanitized}`;
  const legacyUrl = `/uploads/${sanitized}`;
  if (
    (await isMediaBlockedOrQuarantined(serveUrl)) ||
    (await isMediaBlockedOrQuarantined(legacyUrl))
  ) {
    return NextResponse.json(
      { error: "This media is not available." },
      { status: 403 }
    );
  }

  const filePath = path.join(process.cwd(), "private-uploads", sanitized);
  try {
    // Resolve symlinks and verify the file is within the allowed directory
    const resolvedPath = await realpath(filePath);
    const allowedDir = path.resolve(process.cwd(), "private-uploads");
    if (!resolvedPath.startsWith(allowedDir + path.sep) && resolvedPath !== allowedDir) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }
    const data = await readFile(resolvedPath);
    const ext = path.extname(sanitized).slice(1).toLowerCase();
    const contentType = MIME_MAP[ext] ?? "application/octet-stream";

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "CDN-Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
