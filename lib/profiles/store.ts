import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { normalizeAddress } from "@/lib/posts/content";

export type ProfileRecord = {
  displayName?: string;
  bio?: string;
  location?: string;
  website?: string;
  coverImage?: string;
  avatar?: string;
};

type ProfilesStore = Record<string, ProfileRecord>;

const DATA_DIR = path.join(process.cwd(), "data");
const PROFILES_FILE = path.join(DATA_DIR, "profiles.json");

// Cache with TTL for memory management
let cache: ProfilesStore | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let writeChain = Promise.resolve();

function isCacheValid(): boolean {
  return cache !== null && Date.now() - cacheTimestamp < CACHE_TTL_MS;
}

async function loadStore(): Promise<ProfilesStore> {
  if (isCacheValid()) return cache!;
  try {
    const raw = await readFile(PROFILES_FILE, "utf8");
    const parsed = JSON.parse(raw) as ProfilesStore;
    cache = parsed && typeof parsed === "object" ? parsed : {};
    cacheTimestamp = Date.now();
  } catch {
    cache = {};
    cacheTimestamp = Date.now();
  }
  return cache;
}

async function persist(store: ProfilesStore) {
  await mkdir(DATA_DIR, { recursive: true });
  
  // Atomic write: write to temp file first, then rename
  const tempPath = path.join(DATA_DIR, `.profiles.json.tmp.${Date.now()}`);
  try {
    await writeFile(tempPath, JSON.stringify(store, null, 2), "utf8");
    await rename(tempPath, PROFILES_FILE);
  } catch (error) {
    // Clean up temp file on error
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

async function saveStore(store: ProfilesStore) {
  writeChain = writeChain.then(() => persist(store));
  await writeChain;
}

export async function getProfile(address: string): Promise<ProfileRecord> {
  const store = await loadStore();
  return store[normalizeAddress(address)] || {};
}

export async function setProfile(addresses: string[], profile: ProfileRecord) {
  const store = await loadStore();
  for (const address of addresses) {
    store[normalizeAddress(address)] = profile;
  }
  await saveStore(store);
}

export async function deleteProfiles(addresses: string[]) {
  const store = await loadStore();
  let deleted = 0;
  for (const address of addresses) {
    const key = normalizeAddress(address);
    if (Object.prototype.hasOwnProperty.call(store, key)) {
      delete store[key];
      deleted += 1;
    }
  }
  await saveStore(store);
  return deleted;
}

export async function exportProfiles(addresses: string[]) {
  const store = await loadStore();
  const exported: Record<string, ProfileRecord> = {};
  for (const address of addresses) {
    const key = normalizeAddress(address);
    if (store[key]) {
      exported[key] = store[key];
    }
  }
  return exported;
}
