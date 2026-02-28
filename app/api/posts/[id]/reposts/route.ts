import { NextResponse } from "next/server";
import { isValidAddress } from "@/lib/posts/content";
import { toggleRepost } from "@/lib/posts/store";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";

export async function PATCH(
  req: Request,
  context: { params: { id: string } }
) {
  try {
    const actorAddress = await getActorAddressFromLensCookie();
    if (!actorAddress || !isValidAddress(actorAddress)) {
      return NextResponse.json(
        { error: "Unauthorized. Connect Lens before reposting." },
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
      return NextResponse.json(
        {
          error:
            "Repost is not yet implemented as a Lens-native action in this app. Action was not published.",
        },
        { status: 501 }
      );
    }

    const result = await toggleRepost(postId, actorAddress);
    return NextResponse.json({ success: true, ...result, source: "local" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update repost";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
