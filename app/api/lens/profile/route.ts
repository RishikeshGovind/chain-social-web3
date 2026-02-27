// app/api/lens/profile/route.ts

import { NextResponse } from "next/server";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";

// In-memory user profile store (resets on server restart)
const profiles: Record<
  string,
  {
    displayName?: string;
    bio?: string;
    location?: string;
    website?: string;
    coverImage?: string;
    avatar?: string;
  }
> = {};

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
    const body = await req.json();
    const actorAddress = await getActorAddressFromLensCookie();
    const requestedAddress =
      typeof body?.address === "string" && isValidAddress(body.address)
        ? normalizeAddress(body.address)
        : null;
    const requestedLensAccount =
      typeof body?.lensAccountAddress === "string" && isValidAddress(body.lensAccountAddress)
        ? normalizeAddress(body.lensAccountAddress)
        : null;

    if (!actorAddress && !requestedAddress) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const primaryAddress = actorAddress
      ? normalizeAddress(actorAddress)
      : (requestedAddress as string);
    const aliases = new Set<string>([primaryAddress]);
    if (requestedAddress) aliases.add(requestedAddress);
    if (requestedLensAccount) aliases.add(requestedLensAccount);

    const nextProfile = {
      displayName:
        typeof body?.displayName === "string"
          ? body.displayName
          : profiles[primaryAddress]?.displayName || "",
      bio: typeof body?.bio === "string" ? body.bio : profiles[primaryAddress]?.bio || "",
      location:
        typeof body?.location === "string"
          ? body.location
          : profiles[primaryAddress]?.location || "",
      website:
        typeof body?.website === "string"
          ? body.website
          : profiles[primaryAddress]?.website || "",
      coverImage:
        typeof body?.coverImage === "string"
          ? body.coverImage
          : profiles[primaryAddress]?.coverImage || "",
      avatar:
        typeof body?.avatar === "string"
          ? body.avatar
          : profiles[primaryAddress]?.avatar || "",
    };

    // Keep profile reachable by both wallet and Lens-account routes.
    for (const key of aliases) {
      profiles[key] = nextProfile;
    }

    return NextResponse.json({ success: true, profile: nextProfile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update profile";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
