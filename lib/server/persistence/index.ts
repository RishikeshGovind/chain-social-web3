import path from "node:path";
import { FileStateStore } from "./file-state-store";
import { PostgresStateStore } from "./postgres-state-store";
import type { StateStore } from "./types";

let singleton: StateStore | null = null;

export function getStateStore(): StateStore {
  if (singleton) return singleton;

  const backend = (process.env.CHAINSOCIAL_STATE_BACKEND ?? "file").trim().toLowerCase();
  if (backend === "postgres") {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error("CHAINSOCIAL_STATE_BACKEND=postgres requires DATABASE_URL");
    }
    singleton = new PostgresStateStore(connectionString);
    return singleton;
  }

  const filePath =
    process.env.CHAINSOCIAL_STATE_FILE?.trim() || path.join(process.cwd(), "data", "posts.json");
  singleton = new FileStateStore(filePath);
  return singleton;
}
