import { NextResponse } from "next/server";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { toggleFollow } from "@/lib/posts/store";
import { toggleLensFollow } from "@/lib/lens/writes";
import { notifyFollowed } from "@/lib/server/notifications/helpers";
import { logger } from "@/lib/server/logger";
import {
  evaluateFollowSafety,
  isAddressBanned,
  isProfileHidden,
} from "@/lib/server/moderation/store";
import {
  getActorAddressFromLensCookie,
  getLensAccessTokenFromCookie,
} from "@/lib/server/auth/lens-actor";

export async function PATCH(
  req: Request,
  context: { params: { address: string } }
) {
  try {
    const actorAddress = await getActorAddressFromLensCookie();
    if (!actorAddress || !isValidAddress(actorAddress)) {
      return NextResponse.json(
        { error: "Unauthorized. Connect Lens before following." },
        { status: 401 }
      );
    }
    if (await isAddressBanned(actorAddress)) {
      return NextResponse.json({ error: "Your account is restricted from following accounts." }, { status: 403 });
    }

    const targetAddress = normalizeAddress(context.params.address || "");
    if (!isValidAddress(targetAddress)) {
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }
    if (await isProfileHidden(targetAddress)) {
      return NextResponse.json({ error: "Profile unavailable" }, { status: 404 });
    }
    const followSafety = await evaluateFollowSafety(actorAddress, targetAddress);
    if (followSafety.thresholdTriggered) {
      return NextResponse.json(
        { error: "Following restricted due to unusual activity. Try again later." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const currentlyFollowing =
      typeof body?.currentlyFollowing === "boolean" ? body.currentlyFollowing : false;

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
        const lensResult = await toggleLensFollow({
          targetAddress,
          currentlyFollowing,
          accessToken,
        });
        if (lensResult.isFollowing) {
          await notifyFollowed({ targetAddress, actorAddress });
        }
        return NextResponse.json({ success: true, ...lensResult, source: "lens" });
      } catch (lensError) {
        const message = lensError instanceof Error ? lensError.message : "unknown error";
        logger.warn("follows.toggle.lens_failed", { error: message });
        return NextResponse.json(
          { error: `Lens follow failed: ${message}. Action was not published to Lens.` },
          { status: 502 }
        );
      }
    }

    const result = await toggleFollow({
      follower: actorAddress,
      following: targetAddress,
    });

    if (result.type === "invalid") {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }
    if (result.isFollowing) {
      await notifyFollowed({ targetAddress, actorAddress });
    }

    return NextResponse.json({ success: true, ...result, source: "local" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update follow";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
