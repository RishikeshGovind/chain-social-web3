import { NextResponse } from "next/server";
import {
  isValidAddress,
  parseAndValidateContent,
} from "@/lib/posts/content";
import { deletePost, editPost } from "@/lib/posts/store";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";

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

    const result = await editPost(postId, actorAddress, parsedContent.content);
    if (result.type === "not_found") {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    if (result.type === "forbidden") {
      return NextResponse.json({ error: "You can only edit your own posts" }, { status: 403 });
    }

    return NextResponse.json({ success: true, post: result.post });
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

    const result = await deletePost(postId, actorAddress);
    if (result.type === "not_found") {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    if (result.type === "forbidden") {
      return NextResponse.json({ error: "You can only delete your own posts" }, { status: 403 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete post";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
