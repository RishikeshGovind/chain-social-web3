import { normalizeAddress } from "@/lib/posts/content";
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

export async function getAdminOperator(): Promise<AdminOperator | null> {
  ensureRuntimeConfig();
  const actorAddress = await getActorAddressFromLensCookie();
  if (!actorAddress) return null;

  const normalizedActor = normalizeAddress(actorAddress);
  const allowed = new Set(getAdminAddresses());
  if (!allowed.has(normalizedActor)) {
    return null;
  }

  return {
    address: normalizedActor,
    authMethod: "wallet",
  };
}
