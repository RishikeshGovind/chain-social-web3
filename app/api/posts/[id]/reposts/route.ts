import { NextResponse } from "next/server";
import { isValidAddress } from "@/lib/posts/content";
import { getRepostRecord, toggleRepost, toggleRepostWithPublicationId } from "@/lib/posts/store";
import { notifyPostReposted } from "@/lib/server/notifications/helpers";
import { createLensRepost, deleteLensPost } from "@/lib/lens/writes";
import { getActorAddressFromLensCookie, getLensAccessTokenFromCookie } from "@/lib/server/auth/lens-actor";
import { isAddressBanned } from "@/lib/server/moderation/store";

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
    if (await isAddressBanned(actorAddress)) {
      return NextResponse.json({ error: "Your account is restricted from reposting." }, { status: 403 });
    }

    const postId = context.params.id;
    if (!postId) {
      return NextResponse.json({ error: "Missing post id" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const currentlyReposted =
      typeof body?.currentlyReposted === "boolean" ? body.currentlyReposted : false;

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

      if (currentlyReposted) {
        const existing = await getRepostRecord(postId, actorAddress);
        const publicationId = existing?.publicationId;
        if (!publicationId) {
          return NextResponse.json(
            {
              error:
                "This repost cannot be removed because its Lens publication id is unavailable.",
            },
            { status: 409 }
          );
        }

        await deleteLensPost({ postId: publicationId, accessToken });
        const result = await toggleRepost(postId, actorAddress);
        return NextResponse.json({ success: true, ...result, source: "lens" });
      }

      const lensResult = await createLensRepost({ postId, accessToken });
      const result = await toggleRepostWithPublicationId(
        postId,
        actorAddress,
        lensResult.publicationId
      );
      if (result.reposted) {
        await notifyPostReposted({ postId, actorAddress, accessToken });
      }
      return NextResponse.json({ success: true, ...result, source: "lens" });
    }

    const result = await toggleRepost(postId, actorAddress);
    if (result.reposted) {
      await notifyPostReposted({ postId, actorAddress });
    }
    return NextResponse.json({ success: true, ...result, source: "local" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update repost";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
