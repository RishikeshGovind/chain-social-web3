import { timingSafeEqual } from "node:crypto";
import { ensureRuntimeConfig } from "@/lib/server/runtime-config";

export function isLegacyAdminTokenRequest(headers: Headers) {
  ensureRuntimeConfig();
  const allowLegacyToken =
    (process.env.CHAINSOCIAL_ALLOW_LEGACY_ADMIN_TOKEN ?? "").trim().toLowerCase();
  if (allowLegacyToken !== "1" && allowLegacyToken !== "true" && allowLegacyToken !== "yes") {
    return false;
  }
  const configured = process.env.CHAINSOCIAL_ADMIN_TOKEN?.trim();
  if (!configured) return false;
  const provided = headers.get("x-admin-token")?.trim();
  if (!provided) return false;

  const configuredBuffer = Buffer.from(configured);
  const providedBuffer = Buffer.from(provided);
  if (configuredBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(configuredBuffer, providedBuffer);
}
