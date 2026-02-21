//lib/posts/authz.ts

import { normalizeAddress } from "./content";

export function canMutateOwnedResource(actorAddress: string, ownerAddress: string) {
  return normalizeAddress(actorAddress) === normalizeAddress(ownerAddress);
}

export function canToggleFollow(actorAddress: string, targetAddress: string) {
  return normalizeAddress(actorAddress) !== normalizeAddress(targetAddress);
}
