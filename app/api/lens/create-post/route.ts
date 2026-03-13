//app/api/lens/create-post/route.ts

import { NextResponse } from "next/server";
import { checkPostRateLimit } from "@/lib/server/rate-limit";
import {
  isValidAddress,
  parseAndValidateContent,
} from "@/lib/posts/content";
import { createPost, listPosts, toggleLike } from "@/lib/posts/store";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import {
  evaluateTextSafety,
  filterVisiblePosts,
  isAddressBanned,
  isMediaBlockedOrQuarantined,
  moderateIncomingPosts,
} from "@/lib/server/moderation/store";

// Backward-compatible route. Prefer /api/posts and /api/posts/:id/likes.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number.parseInt(searchParams.get("limit") ?? "50", 10);
    const data = await listPosts({
      limit: Number.isNaN(limit) ? 50 : limit,
      author: searchParams.get("author") ?? undefined,
    });
    const visiblePosts = await moderateIncomingPosts(await filterVisiblePosts(data.posts));

    return NextResponse.json({ posts: visiblePosts, nextCursor: data.nextCursor });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch posts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actorAddress = await getActorAddressFromLensCookie();
    if (!actorAddress || !isValidAddress(actorAddress)) {
      return NextResponse.json(
        { error: "Unauthorized. Connect Lens before posting." },
        { status: 401 }
      );
    }
    if (await isAddressBanned(actorAddress)) {
      return NextResponse.json(
        { error: "Your account is restricted from posting." },
        { status: 403 }
      );
    }

    const rateLimit = await checkPostRateLimit(actorAddress);
    if (!rateLimit.ok) {
      const retryAfterSeconds = Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000));
      return NextResponse.json(
        { error: rateLimit.error },
        {
          status: 429,
          headers: {
            "Retry-After": `${retryAfterSeconds}`,
          },
        }
      );
    }

    const body = await req.json();
    const parsedContent = parseAndValidateContent(body?.content);
    if (!parsedContent.ok) {
      return NextResponse.json({ error: parsedContent.error }, { status: 400 });
    }
    const safety = await evaluateTextSafety({
      address: actorAddress,
      text: parsedContent.content,
      type: "post",
    });
    if (safety.thresholdTriggered) {
      return NextResponse.json(
        { error: "Posting restricted due to unusual activity. Try again later." },
        { status: 429 }
      );
    }
    if (safety.decision === "block") {
      return NextResponse.json(
        { error: safety.reasons[0] ?? "Post blocked by safety system." },
        { status: 400 }
      );
    }
    if (safety.decision === "review") {
      return NextResponse.json(
        { error: "Post held by automated safety checks. Please edit and try again." },
        { status: 400 }
      );
    }

    const username =
      typeof body?.author?.username?.localName === "string"
        ? body.author.username.localName.trim().slice(0, 32)
        : undefined;
    const media =
      Array.isArray(body?.media) &&
      body.media.every((value: unknown) => typeof value === "string" && value.trim())
        ? (body.media as string[])
        : [];
    for (const url of media) {
      if (await isMediaBlockedOrQuarantined(url)) {
        return NextResponse.json(
          { error: "One or more media files are pending review or unavailable." },
          { status: 400 }
        );
      }
    }

    const post = await createPost({
      address: actorAddress,
      content: parsedContent.content,
      username,
      media: media.length > 0 ? media : undefined,
    });

    return NextResponse.json({ success: true, post });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create post";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const actorAddress = await getActorAddressFromLensCookie();
    if (!actorAddress || !isValidAddress(actorAddress)) {
      return NextResponse.json(
        { error: "Unauthorized. Connect Lens before liking." },
        { status: 401 }
      );
    }
    if (await isAddressBanned(actorAddress)) {
      return NextResponse.json({ error: "Your account is restricted from liking posts." }, { status: 403 });
    }

    const body = await req.json();
    const postId = typeof body?.postId === "string" ? body.postId : "";

    if (!postId) {
      return NextResponse.json({ error: "Missing post id" }, { status: 400 });
    }

    const result = await toggleLike(postId, actorAddress);
    if (!result) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update like";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
