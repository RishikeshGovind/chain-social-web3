import { readFile } from "node:fs/promises";
import path from "node:path";
import { mergeState, readState } from "@/lib/server/persistence";
import type { PersistedComplianceState } from "@/lib/server/persistence/types";

export type DsarType = "access" | "delete" | "rectify" | "restrict" | "object" | "portability";
export type DsarStatus = "open" | "in_review" | "completed" | "rejected";

export type DsarRequest = {
  id: string;
  actor: string;
  type: DsarType;
  status: DsarStatus;
  details?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
};

export type ComplianceAuditEvent = {
  id: string;
  type: string;
  actor?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

type ComplianceStore = {
  dsarRequests: DsarRequest[];
  auditEvents: ComplianceAuditEvent[];
};

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "compliance.json");

let cache: ComplianceStore | null = null;
let writeChain = Promise.resolve();

function defaultStore(): ComplianceStore {
  return {
    dsarRequests: [],
    auditEvents: [],
  };
}

async function loadStore(): Promise<ComplianceStore> {
  if (cache) return cache;

  const state = await readState();
  const persisted = state.compliance;
  if (persisted) {
    cache = {
      dsarRequests: Array.isArray(persisted.dsarRequests) ? (persisted.dsarRequests as DsarRequest[]) : [],
      auditEvents: Array.isArray(persisted.auditEvents) ? (persisted.auditEvents as ComplianceAuditEvent[]) : [],
    };
    return cache;
  }

  try {
    const raw = await readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<ComplianceStore>;
    cache = {
      dsarRequests: Array.isArray(parsed.dsarRequests) ? parsed.dsarRequests : [],
      auditEvents: Array.isArray(parsed.auditEvents) ? parsed.auditEvents : [],
    };
    await saveStore(cache);
  } catch {
    cache = defaultStore();
  }
  return cache;
}

async function saveStore(store: ComplianceStore) {
  writeChain = writeChain.then(() =>
    mergeState({
      compliance: {
        dsarRequests: store.dsarRequests,
        auditEvents: store.auditEvents,
      } satisfies PersistedComplianceState,
    })
  );
  await writeChain;
}

export async function createDsarRequest(input: {
  actor: string;
  type: DsarType;
  details?: string;
}) {
  const store = await loadStore();
  const now = new Date().toISOString();
  const request: DsarRequest = {
    id: crypto.randomUUID(),
    actor: input.actor,
    type: input.type,
    status: "open",
    details: input.details,
    createdAt: now,
    updatedAt: now,
  };
  store.dsarRequests.unshift(request);
  await saveStore(store);
  return request;
}

export async function listDsarRequestsForActor(actor: string) {
  const store = await loadStore();
  return store.dsarRequests.filter((item) => item.actor === actor);
}

export async function listAllDsarRequests() {
  const store = await loadStore();
  return store.dsarRequests;
}

export async function updateDsarStatus(input: {
  id: string;
  status: DsarStatus;
}) {
  const store = await loadStore();
  const item = store.dsarRequests.find((request) => request.id === input.id);
  if (!item) return null;
  item.status = input.status;
  item.updatedAt = new Date().toISOString();
  if (input.status === "completed" || input.status === "rejected") {
    item.resolvedAt = new Date().toISOString();
  }
  await saveStore(store);
  return item;
}

export async function appendComplianceAuditEvent(event: {
  type: string;
  actor?: string;
  metadata?: Record<string, unknown>;
}) {
  const store = await loadStore();
  store.auditEvents.unshift({
    id: crypto.randomUUID(),
    type: event.type,
    actor: event.actor,
    timestamp: new Date().toISOString(),
    metadata: event.metadata,
  });
  await saveStore(store);
}

export async function runComplianceRetention(input?: {
  auditDays?: number;
  completedDsarDays?: number;
}) {
  const store = await loadStore();
  const now = Date.now();
  const auditDays = input?.auditDays ?? Number(process.env.CHAINSOCIAL_RETENTION_DAYS_AUDIT ?? "90");
  const completedDsarDays =
    input?.completedDsarDays ?? Number(process.env.CHAINSOCIAL_RETENTION_DAYS_DSAR_COMPLETED ?? "365");

  const auditCutoff = now - Math.max(1, auditDays) * 24 * 60 * 60 * 1000;
  const dsarCutoff = now - Math.max(1, completedDsarDays) * 24 * 60 * 60 * 1000;

  const before = {
    auditEvents: store.auditEvents.length,
    dsarRequests: store.dsarRequests.length,
  };

  store.auditEvents = store.auditEvents.filter((event) => {
    const ts = Date.parse(event.timestamp);
    return Number.isNaN(ts) ? true : ts >= auditCutoff;
  });

  store.dsarRequests = store.dsarRequests.filter((request) => {
    const terminal = request.status === "completed" || request.status === "rejected";
    if (!terminal) return true;
    const ts = Date.parse(request.updatedAt);
    return Number.isNaN(ts) ? true : ts >= dsarCutoff;
  });

  await saveStore(store);

  return {
    retained: {
      auditEvents: store.auditEvents.length,
      dsarRequests: store.dsarRequests.length,
    },
    removed: {
      auditEvents: before.auditEvents - store.auditEvents.length,
      dsarRequests: before.dsarRequests - store.dsarRequests.length,
    },
    config: {
      auditDays,
      completedDsarDays,
    },
  };
}
