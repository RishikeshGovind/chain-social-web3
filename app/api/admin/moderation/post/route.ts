import { NextRequest, NextResponse } from "next/server";
import { getAdminOperator } from "@/lib/server/compliance/operator-auth";
import { getPostById } from "@/lib/posts/store";
import { fetchLensPostById } from "@/lib/lens/feed";

export async function GET(req: NextRequest) {
  const operator = await getAdminOperator(req.headers);
  if (!operator) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  // Try local store first
  const localPost = await getPostById(id);
  if (localPost) {
    return NextResponse.json({
      id: localPost.id,
      content: localPost.metadata?.content ?? "",
      media: localPost.metadata?.media ?? [],
      author: localPost.author?.address ?? "",
      username: localPost.author?.username?.localName ?? "",
      timestamp: localPost.timestamp,
      source: "local",
    });
  }

  // Try fetching from Lens API
  try {
    const lensPost = await fetchLensPostById({ postId: id });
    if (lensPost) {
      return NextResponse.json({
        id: lensPost.id,
        content: lensPost.metadata?.content ?? "",
        media: lensPost.metadata?.media ?? [],
        author: lensPost.author?.address ?? "",
        username: lensPost.author?.username?.localName ?? "",
        timestamp: lensPost.timestamp ?? null,
        source: "lens",
      });
    }
  } catch {
    // Fall through to not_found
  }

  return NextResponse.json({
    id,
    content: null,
    media: [],
    author: "",
    username: "",
    timestamp: null,
    source: "not_found",
  });
}
