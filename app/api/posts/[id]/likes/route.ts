import { NextResponse } from "next/server";
import { isValidAddress } from "@/lib/posts/content";
import { toggleLike } from "@/lib/posts/store";
import { toggleLensLike } from "@/lib/lens/writes";
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
        { error: "Unauthorized. Connect Lens before liking." },
        { status: 401 }
      );
    }

    const postId = context.params.id;
    if (!postId) {
      return NextResponse.json({ error: "Missing post id" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const currentlyLiked =
      typeof body?.currentlyLiked === "boolean" ? body.currentlyLiked : false;

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
        const lensResult = await toggleLensLike({
          postId,
          currentlyLiked,
          accessToken,
        });
        return NextResponse.json({ success: true, ...lensResult, source: "lens" });
      } catch (lensError) {
        console.warn(
          "Lens like mutation failed, falling back to local store:",
          lensError instanceof Error ? lensError.message : "unknown error"
        );
      }
    }

    const result = await toggleLike(postId, actorAddress);
    if (!result) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, ...result, source: "local" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update like";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
