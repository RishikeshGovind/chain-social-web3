import { NextResponse } from "next/server";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import {
  DEFAULT_USER_SETTINGS,
  getUserSettings,
  upsertUserSettings,
} from "@/lib/server/settings/store";

async function getActor() {
  const actorAddress = await getActorAddressFromLensCookie();
  if (!actorAddress || !isValidAddress(actorAddress)) return null;
  return normalizeAddress(actorAddress);
}

export async function GET() {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({
      authenticated: false,
      settings: DEFAULT_USER_SETTINGS,
    });
  }

  const settings = await getUserSettings(actor);
  return NextResponse.json({
    authenticated: true,
    actor,
    settings: {
      compactFeed: settings.compactFeed,
      autoplayVideos: settings.autoplayVideos,
      hideMediaPreviews: settings.hideMediaPreviews,
      updatedAt: settings.updatedAt ?? null,
    },
  });
}

export async function PATCH(req: Request) {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const updates = {
    compactFeed:
      typeof body.compactFeed === "boolean" ? body.compactFeed : undefined,
    autoplayVideos:
      typeof body.autoplayVideos === "boolean" ? body.autoplayVideos : undefined,
    hideMediaPreviews:
      typeof body.hideMediaPreviews === "boolean" ? body.hideMediaPreviews : undefined,
  };

  if (Object.values(updates).every((value) => typeof value !== "boolean")) {
    return NextResponse.json({ error: "No valid settings provided" }, { status: 400 });
  }

  const settings = await upsertUserSettings(actor, updates);
  return NextResponse.json({
    actor,
    settings,
  });
}
