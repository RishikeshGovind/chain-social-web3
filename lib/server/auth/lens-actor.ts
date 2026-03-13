//lib/server/auth/lens-actor.ts

import { cookies } from "next/headers";
import { normalizeAddress } from "@/lib/posts/content";
import { lensRequest } from "@/lib/lens";

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

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function isTokenExpired(token: string): boolean {
  const payload = parseJwtPayload(token);
  if (!payload) return true;
  
  const exp = payload.exp;
  if (typeof exp !== "number") return true;
  
  // Add 60 second buffer
  const now = Math.floor(Date.now() / 1000);
  return exp < now + 60;
}

type CachedActor = {
  address: string;
  expiresAtMs: number;
};

const actorCache = new Map<string, CachedActor>();
const ACTOR_CACHE_TTL_MS = 15_000;

function findAddressInGraph(value: unknown): string | null {
  const queue: unknown[] = [value];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    if (typeof current === "string") {
      const match = current.match(/0x[a-fA-F0-9]{40}/);
      if (match) return normalizeAddress(match[0]);
      continue;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const object = asObject(current);
    if (!object) continue;
    queue.push(...Object.values(object));
  }
  return null;
}

function findAddressInClaims(payload: Record<string, unknown>): string | null {
  const candidateKeys = ["sub", "address", "wallet", "owner", "account", "actor", "managedBy"];
  for (const key of candidateKeys) {
    if (!(key in payload)) continue;
    const value = payload[key];
    const found = findAddressInGraph(value);
    if (found) return found;
  }
  return null;
}

async function resolveActorAddressFromLens(accessToken: string): Promise<string | null> {
  const cached = actorCache.get(accessToken);
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.address;
  }

  const variants: string[] = [
    // Lens v3: me returns MeResult with account field (not a union)
    `
      query Me {
        me {
          account {
            address
            owner
          }
        }
      }
    `,
    // Lens v3 alternative: request loggedInAs
    `
      query Me {
        me {
          loggedInAs {
            account {
              address
            }
          }
        }
      }
    `,
    // Legacy / alternative schema
    `
      query Me {
        me {
          __typename
          ... on Account {
            address
            owner {
              address
            }
          }
        }
      }
    `,
    `
      query MeAddress {
        me {
          __typename
          address
        }
      }
    `,
  ];

  for (const query of variants) {
    try {
      const data = await lensRequest(query, undefined, accessToken);
      const root = asObject(data);
      const prioritized =
        asString(asObject(asObject(root?.me)?.account)?.address) ??
        asString(asObject(asObject(asObject(root?.me)?.loggedInAs)?.account)?.address) ??
        asString(asObject(asObject(root?.viewer)?.account)?.address) ??
        asString(asObject(asObject(root?.authenticatedUser)?.account)?.address) ??
        asString(asObject(root?.me)?.address) ??
        asString(asObject(root?.viewer)?.address) ??
        asString(asObject(root?.authenticatedUser)?.address) ??
        findAddressInGraph(root);

      if (prioritized) {
        const normalized = normalizeAddress(prioritized);
        actorCache.set(accessToken, {
          address: normalized,
          expiresAtMs: Date.now() + ACTOR_CACHE_TTL_MS,
        });
        return normalized;
      }
    } catch {
      // Try next variant.
    }
  }

  // Do NOT fall back to unsigned JWT claims — only trust identity proven
  // by a successful Lens introspection/me call above.
  return null;
}

export async function getActorAddressFromLensToken(accessToken: string) {
  if (!accessToken) return null;
  if (isTokenExpired(accessToken)) return null;
  return resolveActorAddressFromLens(accessToken);
}

export async function getActorAddressFromLensCookie() {
  const cookieStore = await cookies();
  const lensToken = cookieStore.get("lensAccessToken")?.value;

  return getActorAddressFromLensToken(lensToken ?? "");
}

export async function getLensAccessTokenFromCookie() {
  const cookieStore = await cookies();
  return cookieStore.get("lensAccessToken")?.value ?? null;
}
