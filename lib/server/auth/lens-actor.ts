//lib/server/auth/lens-actor.ts

import { cookies } from "next/headers";
import { normalizeAddress } from "@/lib/posts/content";

function parseJwtPayload(token: string) {
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const payload = Buffer.from(segment, "base64url").toString("utf8");
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function findAddress(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(/0x[a-fA-F0-9]{40}/);
    return match ? normalizeAddress(match[0]) : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const address = findAddress(item);
      if (address) return address;
    }
    return null;
  }

  if (value && typeof value === "object") {
    for (const nestedValue of Object.values(value)) {
      const address = findAddress(nestedValue);
      if (address) return address;
    }
  }

  return null;
}

export async function getActorAddressFromLensCookie() {
  const cookieStore = await cookies();
  const lensToken = cookieStore.get("lensAccessToken")?.value;

  if (!lensToken) return null;

  const payload = parseJwtPayload(lensToken);
  if (!payload) return null;

  return findAddress(payload);
}

export async function getLensAccessTokenFromCookie() {
  const cookieStore = await cookies();
  return cookieStore.get("lensAccessToken")?.value ?? null;
}
