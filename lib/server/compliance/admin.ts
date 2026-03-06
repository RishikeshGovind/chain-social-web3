import { timingSafeEqual } from "node:crypto";

export function isAdminRequest(headers: Headers) {
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
