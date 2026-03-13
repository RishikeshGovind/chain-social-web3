import { NextResponse } from "next/server";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import {
  clearNotifications,
  listNotificationsForRecipient,
  markNotificationsRead,
} from "@/lib/server/notifications/store";

async function getActor() {
  const actorAddress = await getActorAddressFromLensCookie();
  if (!actorAddress || !isValidAddress(actorAddress)) return null;
  return normalizeAddress(actorAddress);
}

export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rawLimit = Number.parseInt(searchParams.get("limit") ?? "100", 10);
  const limit = Number.isNaN(rawLimit) ? 100 : Math.min(Math.max(rawLimit, 1), 200);
  const data = await listNotificationsForRecipient(actor, { limit });
  return NextResponse.json({ actor, ...data });
}

export async function PATCH(req: Request) {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((item: unknown): item is string => typeof item === "string")
    : undefined;

  const result = await markNotificationsRead(actor, ids);
  const data = await listNotificationsForRecipient(actor);
  return NextResponse.json({ actor, ...result, ...data });
}

export async function DELETE() {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await clearNotifications(actor);
  return NextResponse.json({ actor, ...result, items: [], unreadCount: 0 });
}
