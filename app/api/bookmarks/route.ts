import { NextResponse } from "next/server";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { getActorAddressFromLensCookie, getLensAccessTokenFromCookie } from "@/lib/server/auth/lens-actor";
import {
  listBookmarkIds,
  resolveBookmarkedPosts,
  toggleBookmark,
} from "@/lib/server/bookmarks/store";
import { logger } from "@/lib/server/logger";
import {
  filterVisiblePosts,
  isAddressBanned,
  moderateIncomingPosts,
} from "@/lib/server/moderation/store";

async function parseJsonBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  try {
    const body = await req.json();
    return { ok: true, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    logger.warn("bookmarks.json_parse_failed", { error: message });
    return { ok: false, error: "Invalid JSON body" };
  }
}

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
  if (await isAddressBanned(actor)) {
    return NextResponse.json({ error: "Your account is restricted from using bookmarks." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const includePosts = searchParams.get("includePosts") === "1";
  const ids = await listBookmarkIds(actor);

  if (!includePosts) {
    return NextResponse.json({ actor, ids });
  }

  const accessToken = await getLensAccessTokenFromCookie();
  const resolved = await resolveBookmarkedPosts(actor, accessToken ?? undefined);
  const visiblePosts = await moderateIncomingPosts(
    await filterVisiblePosts(resolved.map((item) => item.post))
  );
  const visibleIds = new Set(visiblePosts.map((post) => post.id));
  const visibleResolved = resolved.filter((item) => visibleIds.has(item.post.id));
  return NextResponse.json({
    actor,
    ids,
    items: visibleResolved.map((item) => item.bookmark),
    posts: visiblePosts,
  });
}

export async function PATCH(req: Request) {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (await isAddressBanned(actor)) {
    return NextResponse.json({ error: "Your account is restricted from using bookmarks." }, { status: 403 });
  }

  const parsed = await parseJsonBody(req);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed.body as Record<string, unknown>;
  const postId = typeof body?.postId === "string" ? body.postId.trim() : "";
  if (!postId) {
    return NextResponse.json({ error: "Missing post id" }, { status: 400 });
  }

  const result = await toggleBookmark(actor, postId);
  logger.info("bookmarks.toggled", { actor, postId, bookmarked: result.bookmarked });
  return NextResponse.json({
    actor,
    ...result,
  });
}
