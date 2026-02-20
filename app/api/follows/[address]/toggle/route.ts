import { NextResponse } from "next/server";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { toggleFollow } from "@/lib/posts/store";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";

export async function PATCH(
  _req: Request,
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

    const targetAddress = normalizeAddress(context.params.address || "");
    if (!isValidAddress(targetAddress)) {
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }

    const result = await toggleFollow({
      follower: actorAddress,
      following: targetAddress,
    });

    if (result.type === "invalid") {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update follow";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
