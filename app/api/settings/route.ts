import { NextResponse } from "next/server";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import {
  DEFAULT_USER_SETTINGS,
  getUserSettings,
  upsertUserSettings,
} from "@/lib/server/settings/store";
import { logger } from "@/lib/server/logger";

async function parseJsonBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  try {
    const body = await req.json();
    return { ok: true, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    logger.warn("settings.json_parse_failed", { error: message });
    return { ok: false, error: "Invalid JSON body" };
  }
}

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

  const parsed = await parseJsonBody(req);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed.body as Record<string, unknown>;
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
  logger.info("settings.updated", { actor });
  return NextResponse.json({
    actor,
    settings,
  });
}
