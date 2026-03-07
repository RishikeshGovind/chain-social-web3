import { NextResponse } from "next/server";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { getActorAddressFromLensCookie, getLensAccessTokenFromCookie } from "@/lib/server/auth/lens-actor";
import {
  listBookmarkIds,
  resolveBookmarkedPosts,
  toggleBookmark,
} from "@/lib/server/bookmarks/store";

async function getActor() {
  const actorAddress = await getActorAddressFromLensCookie();
  if (!actorAddress || !isValidAddress(actorAddress)) return null;
  return normalizeAddress(actorAddress);
}

export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const includePosts = searchParams.get("includePosts") === "1";
  const ids = await listBookmarkIds(actor);

  if (!includePosts) {
    return NextResponse.json({ actor, ids });
  }

  const accessToken = await getLensAccessTokenFromCookie();
  const resolved = await resolveBookmarkedPosts(actor, accessToken ?? undefined);
  return NextResponse.json({
    actor,
    ids,
    items: resolved.map((item) => item.bookmark),
    posts: resolved.map((item) => item.post),
  });
}

export async function PATCH(req: Request) {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const postId = typeof body?.postId === "string" ? body.postId.trim() : "";
  if (!postId) {
    return NextResponse.json({ error: "Missing post id" }, { status: 400 });
  }

  const result = await toggleBookmark(actor, postId);
  return NextResponse.json({
    actor,
    ...result,
  });
}
