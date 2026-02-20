import { NextResponse } from "next/server";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { getFollowStats } from "@/lib/posts/store";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";

export async function GET(
  _req: Request,
  context: { params: { address: string } }
) {
  try {
    const targetAddress = normalizeAddress(context.params.address || "");
    if (!isValidAddress(targetAddress)) {
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }

    const actorAddress = await getActorAddressFromLensCookie();
    const data = await getFollowStats(targetAddress, actorAddress ?? undefined);

    return NextResponse.json({
      address: targetAddress,
      followers: data.followers,
      following: data.following,
      isFollowing: data.isFollowing,
      isSelf: actorAddress ? normalizeAddress(actorAddress) === targetAddress : false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load follow stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
