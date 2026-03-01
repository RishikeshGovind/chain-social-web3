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
  if (!address) {
    return NextResponse.json({ error: "address query param is required" }, { status: 400 });
  }
  if (!isValidAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  return NextResponse.json({ profile: profiles[normalizeAddress(address)] || {} });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const actorAddress = await getActorAddressFromLensCookie();

    if (!actorAddress || !isValidAddress(actorAddress)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const primaryAddress = normalizeAddress(actorAddress);
    const requestedAddress =
      typeof body?.address === "string" && isValidAddress(body.address)
        ? normalizeAddress(body.address)
        : null;
    const requestedLensAccount =
      typeof body?.lensAccountAddress === "string" && isValidAddress(body.lensAccountAddress)
        ? normalizeAddress(body.lensAccountAddress)
        : null;

    if (requestedAddress && requestedAddress !== primaryAddress) {
      return NextResponse.json(
        { error: "You can only update your own profile" },
        { status: 403 }
      );
    }

    const aliases = new Set<string>([primaryAddress]);
    if (requestedLensAccount === primaryAddress) {
      aliases.add(requestedLensAccount);
    }

    const cleanText = (value: unknown, maxLen: number) =>
      typeof value === "string" ? value.trim().slice(0, maxLen) : "";
    const cleanUrl = (value: unknown, maxLen: number) => {
      if (typeof value !== "string") return "";
      const candidate = value.trim().slice(0, maxLen);
      if (!candidate) return "";
      if (/^https?:\/\//i.test(candidate)) return candidate;
      if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(candidate)) return `https://${candidate}`;
      return "";
    };

    const nextProfile = {
      displayName: cleanText(body?.displayName, 64),
      bio: cleanText(body?.bio, 280),
      location: cleanText(body?.location, 64),
      website: cleanUrl(body?.website, 256),
      coverImage: cleanUrl(body?.coverImage, 512),
      avatar: cleanUrl(body?.avatar, 512),
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
