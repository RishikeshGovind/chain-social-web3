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
        const message = lensError instanceof Error ? lensError.message : "unknown error";
        console.warn("Lens edit mutation failed:", message);
        return NextResponse.json(
          { error: `Lens edit failed: ${message}. Edit was not published to Lens.` },
          { status: 502 }
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
        const message = lensError instanceof Error ? lensError.message : "unknown error";
        console.warn("Lens delete mutation failed:", message);
        return NextResponse.json(
          { error: `Lens delete failed: ${message}. Delete was not published to Lens.` },
          { status: 502 }
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
