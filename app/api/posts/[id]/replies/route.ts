import { NextResponse } from "next/server";
import { checkPostRateLimit } from "@/lib/posts/rate-limit";
import { isValidAddress, parseAndValidateContent } from "@/lib/posts/content";
import { createReply, listReplies } from "@/lib/posts/store";
import { createLensReply } from "@/lib/lens/writes";
import {
  getActorAddressFromLensCookie,
  getLensAccessTokenFromCookie,
} from "@/lib/server/auth/lens-actor";

export async function GET(
  req: Request,
  context: { params: { id: string } }
) {
  try {
    const postId = context.params.id;
    if (!postId) {
      return NextResponse.json({ error: "Missing post id" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Number.parseInt(searchParams.get("limit") ?? "20", 10);
    const cursor = searchParams.get("cursor") ?? undefined;

    const data = await listReplies({
      postId,
      limit: Number.isNaN(limit) ? 20 : limit,
      cursor,
    });

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load replies";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  context: { params: { id: string } }
) {
  try {
    const actorAddress = await getActorAddressFromLensCookie();
    if (!actorAddress || !isValidAddress(actorAddress)) {
      return NextResponse.json(
        { error: "Unauthorized. Connect Lens before replying." },
        { status: 401 }
      );
    }

    const rateLimit = checkPostRateLimit(actorAddress);
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

    const postId = context.params.id;
    if (!postId) {
      return NextResponse.json({ error: "Missing post id" }, { status: 400 });
    }

    const body = await req.json();
    const parsedContent = parseAndValidateContent(body?.content);
    if (!parsedContent.ok) {
      return NextResponse.json({ error: parsedContent.error }, { status: 400 });
    }

    const username =
      typeof body?.author?.username?.localName === "string"
        ? body.author.username.localName.trim().slice(0, 32)
        : undefined;

    const useLensData =
      process.env.LENS_POSTS_SOURCE === "lens" ||
      process.env.NEXT_PUBLIC_LENS_POSTS_SOURCE === "lens";

    if (useLensData) {
      const accessToken = await getLensAccessTokenFromCookie();
      if (!accessToken) {
        return NextResponse.json(
          { error: "Lens access token missing. Reconnect Lens." },
          { status: 401 }
        );
      }

      try {
        const reply = await createLensReply({
          postId,
          content: parsedContent.content,
          actorAddress,
          accessToken,
        });
        return NextResponse.json({
          success: true,
          reply,
          replyCount: null,
          source: "lens",
        });
      } catch (lensError) {
        console.warn(
          "Lens reply mutation failed, falling back to local store:",
          lensError instanceof Error ? lensError.message : "unknown error"
        );
      }
    }

    const result = await createReply({
      postId,
      address: actorAddress,
      content: parsedContent.content,
      username,
    });

    if (result.type === "not_found") {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      reply: result.reply,
      replyCount: result.replyCount,
      source: "local",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create reply";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
