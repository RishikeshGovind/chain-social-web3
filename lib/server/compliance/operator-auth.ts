import { normalizeAddress, isValidAddress } from "@/lib/posts/content";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import { ensureRuntimeConfig } from "@/lib/server/runtime-config";

export type AdminOperator = {
  address: string;
  authMethod: "wallet";
};

function getAdminAddresses() {
  return (process.env.CHAINSOCIAL_ADMIN_ADDRESSES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => normalizeAddress(value));
}

/**
 * Resolve the admin operator identity.
 *
 * 1. Prefer the Lens session cookie (strong server-verified identity).
 * 2. Fall back to a wallet address sent via `x-wallet-address` header
 *    (e.g. from the Privy-connected wallet). The address is only accepted
 *    if it appears in the CHAINSOCIAL_ADMIN_ADDRESSES allowlist, so a
 *    spoofed header from a non-admin wallet is harmless.
 */
export async function getAdminOperator(
  headers?: Headers,
): Promise<AdminOperator | null> {
  ensureRuntimeConfig();
  const allowed = new Set(getAdminAddresses());

  // Path 1: Lens session cookie
  const actorAddress = await getActorAddressFromLensCookie();
  if (actorAddress) {
    const normalized = normalizeAddress(actorAddress);
    if (allowed.has(normalized)) {
      return { address: normalized, authMethod: "wallet" };
    }
  }

  // Path 2: Wallet address header (Privy fallback, still checked against allowlist)
  const headerAddress = headers?.get("x-wallet-address")?.trim();
  if (headerAddress && isValidAddress(headerAddress)) {
    const normalized = normalizeAddress(headerAddress);
    if (allowed.has(normalized)) {
      return { address: normalized, authMethod: "wallet" };
    }
  }

  return null;
}
