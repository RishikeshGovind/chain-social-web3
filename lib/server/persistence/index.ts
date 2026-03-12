import path from "node:path";
import { ensureRuntimeConfig } from "@/lib/server/runtime-config";
import { FileStateStore } from "./file-state-store";
import { FailoverStateStore } from "./failover-state-store";
import { PostgresStateStore } from "./postgres-state-store";
import { createEmptyState, type ChainSocialState, type StateStore } from "./types";

let singleton: StateStore | null = null;
let mergeChain = Promise.resolve();

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function getStateStore(): StateStore {
  if (singleton) return singleton;
  ensureRuntimeConfig();

  const filePath =
    process.env.CHAINSOCIAL_STATE_FILE?.trim() || path.join(process.cwd(), "data", "posts.json");
  const fileStore = new FileStateStore(filePath);

  const backend = (process.env.CHAINSOCIAL_STATE_BACKEND ?? "file").trim().toLowerCase();
  if (backend === "postgres") {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error("CHAINSOCIAL_STATE_BACKEND=postgres requires DATABASE_URL");
    }
    const postgresStore = new PostgresStateStore(connectionString, {
      connectTimeoutMs: parsePositiveInt(process.env.CHAINSOCIAL_DB_CONNECT_TIMEOUT_MS, 2500),
      queryTimeoutMs: parsePositiveInt(process.env.CHAINSOCIAL_DB_QUERY_TIMEOUT_MS, 3000),
      operationTimeoutMs: parsePositiveInt(process.env.CHAINSOCIAL_DB_OPERATION_TIMEOUT_MS, 3500),
    });
    const failoverEnabled = parseBoolean(
      process.env.CHAINSOCIAL_STATE_FAILOVER_TO_FILE,
      true
    );

    singleton = failoverEnabled
      ? new FailoverStateStore(postgresStore, fileStore, {
          cooldownMs: parsePositiveInt(process.env.CHAINSOCIAL_DB_FAILOVER_COOLDOWN_MS, 30000),
          warnPrefix: "[StateStore/PostgresFailover]",
        })
      : postgresStore;
    return singleton;
  }

  singleton = fileStore;
  return singleton;
}

// Deduplicate concurrent readState() calls — only one in-flight at a time.
// Without this, multiple modules calling readState() simultaneously each open
// separate Postgres connections, each burning the full timeout before failover.
let readStateInflight: Promise<ChainSocialState> | null = null;

export async function readState(): Promise<ChainSocialState> {
  if (readStateInflight) return readStateInflight;
  const promise = (async () => {
    try {
      return (await getStateStore().read()) ?? createEmptyState();
    } finally {
      readStateInflight = null;
    }
  })();
  readStateInflight = promise;
  return promise;
}

export async function mergeState(partial: Partial<ChainSocialState>): Promise<void> {
  const operation = mergeChain.then(async () => {
    const current = await readState();
    await getStateStore().write({
      ...current,
      ...partial,
    });
  });
  mergeChain = operation.catch(() => undefined);
  await operation;
}

export function isPrimaryStateStoreHealthy(): boolean {
  const store = getStateStore();
  if (store instanceof FailoverStateStore) {
    return store.isPrimaryAvailable();
  }
  return true;
}
