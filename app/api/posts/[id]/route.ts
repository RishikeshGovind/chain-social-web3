import { NextResponse } from "next/server";
import {
  isValidAddress,
  parseAndValidateContent,
} from "@/lib/posts/content";
import { deletePost, editPost } from "@/lib/posts/store";
import { deleteLensPost, editLensPost } from "@/lib/lens/writes";
import {
  getActorAddressFromLensCookie,
  getLensAccessTokenFromCookie,
} from "@/lib/server/auth/lens-actor";

export async function PATCH(
  req: Request,
  context: { params: { id: string } }
) {
  try {
    const actorAddress = await getActorAddressFromLensCookie();
    if (!actorAddress || !isValidAddress(actorAddress)) {
      return NextResponse.json(
        { error: "Unauthorized. Connect Lens before editing." },
        { status: 401 }
      let media = Array.isArray(body?.media) ? body.media.filter((url) => typeof url === "string") : undefined;
      // Basic backend validation for media URLs
      if (media && media.length > 0) {
        media = media.filter((url) => url.startsWith("http://") || url.startsWith("https://"));
        if (media.length > 4) {
          return NextResponse.json({ error: "Max 4 images per post." }, { status: 400 });
        }
        for (const url of media) {
          if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(url.split('?')[0])) {
            return NextResponse.json({ error: "Only image URLs are allowed." }, { status: 400 });
          }
        }
      }
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
        await editLensPost({
          postId,
          content: parsedContent.content,
          accessToken,
        });
        return NextResponse.json({
          success: true,
          source: "lens",
        });
      } catch (lensError) {
        console.warn(
          "Lens edit mutation failed, falling back to local store:",
          lensError instanceof Error ? lensError.message : "unknown error"
        );
      }
    }

    const result = await editPost(postId, actorAddress, parsedContent.content);
    if (result.type === "not_found") {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    if (result.type === "forbidden") {
      return NextResponse.json({ error: "You can only edit your own posts" }, { status: 403 });
    }

    return NextResponse.json({ success: true, post: result.post, source: "local" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to edit post";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  context: { params: { id: string } }
) {
  try {
    const actorAddress = await getActorAddressFromLensCookie();
    if (!actorAddress || !isValidAddress(actorAddress)) {
      return NextResponse.json(
        { error: "Unauthorized. Connect Lens before deleting." },
        { status: 401 }
      );
    }

    const postId = context.params.id;
    if (!postId) {
      return NextResponse.json({ error: "Missing post id" }, { status: 400 });
    }

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
        await deleteLensPost({ postId, accessToken });
        return NextResponse.json({ success: true, source: "lens" });
      } catch (lensError) {
        console.warn(
          "Lens delete mutation failed, falling back to local store:",
          lensError instanceof Error ? lensError.message : "unknown error"
        );
      }
    }

    const result = await deletePost(postId, actorAddress);
    if (result.type === "not_found") {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    if (result.type === "forbidden") {
      return NextResponse.json({ error: "You can only delete your own posts" }, { status: 403 });
    }

    return NextResponse.json({ success: true, source: "local" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete post";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
