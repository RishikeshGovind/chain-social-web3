import { NextResponse } from "next/server";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { getFollowStats } from "@/lib/posts/store";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import { isPrimaryStateStoreHealthy } from "@/lib/server/persistence";

const FOLLOW_STATS_TIMEOUT_MS = Number.parseInt(
  process.env.CHAINSOCIAL_FOLLOWS_TIMEOUT_MS ?? "1200",
  10
);

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return (await Promise.race([promise, timeoutPromise])) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
    let data: { followers: number; following: number; isFollowing: boolean } = {
      followers: 0,
      following: 0,
      isFollowing: false,
    };
    let degraded = false;

    if (isPrimaryStateStoreHealthy()) {
      try {
        data = await withTimeout(
          getFollowStats(targetAddress, actorAddress ?? undefined),
          Number.isFinite(FOLLOW_STATS_TIMEOUT_MS) && FOLLOW_STATS_TIMEOUT_MS > 0
            ? FOLLOW_STATS_TIMEOUT_MS
            : 1200,
          "follow stats read"
        );
      } catch (statsError) {
        degraded = true;
        const message = statsError instanceof Error ? statsError.message : "unknown error";
        console.warn("[Follows API] Returning degraded follow stats:", message);
      }
    } else {
      degraded = true;
      console.warn("[Follows API] Returning degraded follow stats: primary state store unhealthy.");
    }

    return NextResponse.json({
      address: targetAddress,
      followers: data.followers,
      following: data.following,
      isFollowing: data.isFollowing,
      isSelf: actorAddress ? normalizeAddress(actorAddress) === targetAddress : false,
      ...(degraded ? { degraded: true } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load follow stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
