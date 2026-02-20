import { NextResponse } from "next/server";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import { normalizeAddress } from "@/lib/posts/content";

// In-memory user profile store (resets on server restart)
const profiles: Record<string, { displayName?: string; bio?: string; location?: string; website?: string; coverImage?: string }> = {};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");
  if (address) {
    return NextResponse.json({ profile: profiles[normalizeAddress(address)] || {} });
  }
  return NextResponse.json({ profiles });
}

export async function POST(req: Request) {
  try {
    const actorAddress = await getActorAddressFromLensCookie();
    if (!actorAddress) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { displayName, bio, location, website, coverImage } = await req.json();
    const address = normalizeAddress(actorAddress);
    profiles[address] = {
      displayName: typeof displayName === "string" ? displayName : profiles[address]?.displayName || "",
      bio: typeof bio === "string" ? bio : profiles[address]?.bio || "",
      location: typeof location === "string" ? location : profiles[address]?.location || "",
      website: typeof website === "string" ? website : profiles[address]?.website || "",
      coverImage: typeof coverImage === "string" ? coverImage : profiles[address]?.coverImage || "",
    };
    return NextResponse.json({ success: true, profile: profiles[address] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update profile";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
