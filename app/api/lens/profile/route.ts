// app/api/lens/profile/route.ts

import { NextResponse } from "next/server";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { getProfile, setProfile } from "@/lib/profiles/store";
import {
  evaluateTextSafety,
  getPublicTrustProfile,
  isAddressBanned,
  isMediaBlockedOrQuarantined,
  isProfileHidden,
} from "@/lib/server/moderation/store";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "address query param is required" }, { status: 400 });
  }
  if (!isValidAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  if (await isProfileHidden(address)) {
    return NextResponse.json({ error: "Profile unavailable" }, { status: 404 });
  }
  const profile = await getProfile(address);
  const trust = await getPublicTrustProfile(address);
  return NextResponse.json({ profile, trust });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const actorAddress = await getActorAddressFromLensCookie();

    if (!actorAddress || !isValidAddress(actorAddress)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (await isAddressBanned(actorAddress)) {
      return NextResponse.json(
        { error: "Your account is restricted from updating profile details." },
        { status: 403 }
      );
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
    const profileText = [nextProfile.displayName, nextProfile.bio, nextProfile.location, nextProfile.website].join(" ");
    const safety = await evaluateTextSafety({
      address: primaryAddress,
      text: profileText,
      type: "profile_update",
    });
    if (safety.thresholdTriggered) {
      return NextResponse.json(
        { error: "Profile editing restricted due to unusual activity. Try again later." },
        { status: 429 }
      );
    }
    if (safety.decision === "block") {
      return NextResponse.json(
        { error: safety.reasons[0] ?? "Profile blocked by safety system." },
        { status: 400 }
      );
    }
    if (safety.decision === "review") {
      return NextResponse.json(
        { error: "Profile update held by automated safety checks. Please revise it and try again." },
        { status: 400 }
      );
    }
    for (const mediaUrl of [nextProfile.avatar, nextProfile.coverImage]) {
      if (mediaUrl && (await isMediaBlockedOrQuarantined(mediaUrl))) {
        return NextResponse.json(
          { error: "Uploaded media is pending review or unavailable." },
          { status: 400 }
        );
      }
    }

    await setProfile(Array.from(aliases), nextProfile);

    return NextResponse.json({ success: true, profile: nextProfile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update profile";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
