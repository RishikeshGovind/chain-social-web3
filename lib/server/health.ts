import axios from "axios";
import { ensureRuntimeConfig } from "@/lib/server/runtime-config";

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function importPg() {
  const importer = new Function("moduleName", "return import(moduleName)") as (
    moduleName: string
  ) => Promise<Record<string, unknown>>;
  const mod = (await importer("pg")) as Record<string, unknown> & {
    default?: Record<string, unknown>;
  };
  const ClientCtor = (mod.Client ?? mod.default?.Client) as
    | (new (config: {
        connectionString: string;
        connectionTimeoutMillis?: number;
        statement_timeout?: number;
        query_timeout?: number;
      }) => {
        query: (sql: string) => Promise<unknown>;
        end: () => Promise<void>;
      })
    | undefined;
  if (!ClientCtor) {
    throw new Error("Postgres backend selected but 'pg' is not installed.");
  }
  return ClientCtor;
}

async function checkPostgres() {
  const backend = (process.env.CHAINSOCIAL_STATE_BACKEND ?? "file").trim().toLowerCase();
  if (backend !== "postgres") {
    return { status: "skipped" as const, detail: "state backend not set to postgres" };
  }

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    return { status: "fail" as const, detail: "DATABASE_URL missing" };
  }

  const ClientCtor = await importPg();
  const connectTimeoutMs = parsePositiveInt(process.env.CHAINSOCIAL_DB_CONNECT_TIMEOUT_MS, 2500);
  const queryTimeoutMs = parsePositiveInt(process.env.CHAINSOCIAL_DB_QUERY_TIMEOUT_MS, 3000);
  const client = new ClientCtor({
    connectionString,
    connectionTimeoutMillis: connectTimeoutMs,
    statement_timeout: queryTimeoutMs,
    query_timeout: queryTimeoutMs,
  });

  const startedAt = Date.now();
  try {
    try {
      await client.query("SELECT 1");
      return { status: "ok" as const, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: "fail" as const,
        detail: error instanceof Error ? error.message : "Postgres health check failed",
      };
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    return { status: "skipped" as const, detail: "Upstash Redis not configured" };
  }

  const timeoutMs = parsePositiveInt(process.env.CHAINSOCIAL_UPSTASH_TIMEOUT_MS, 2000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${url}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { status: "fail" as const, detail: `Upstash responded ${response.status}` };
    }
    const body = await response.text();
    return {
      status: body.toUpperCase().includes("PONG") ? ("ok" as const) : ("fail" as const),
      latencyMs: Date.now() - startedAt,
      detail: body.trim() || undefined,
    };
  } catch (error) {
    return {
      status: "fail" as const,
      detail:
        error instanceof Error && error.name === "AbortError"
          ? `Upstash timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : "Redis health check failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkLens() {
  const source =
    process.env.LENS_POSTS_SOURCE?.trim().toLowerCase() ||
    process.env.NEXT_PUBLIC_LENS_POSTS_SOURCE?.trim().toLowerCase() ||
    "local";
  if (source !== "lens") {
    return { status: "skipped" as const, detail: "Lens mode disabled" };
  }

  const envUrl = process.env.LENS_API_URL?.trim();
  const url = envUrl?.replace(/\/$/, "").endsWith("/graphql")
    ? envUrl.replace(/\/$/, "")
    : envUrl
      ? `${envUrl.replace(/\/$/, "")}/graphql`
      : "https://api.lens.xyz/graphql";
  const timeoutMs = parsePositiveInt(process.env.CHAINSOCIAL_LENS_TIMEOUT_MS, 8000);
  const appOrigin =
    process.env.LENS_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000";
  const startedAt = Date.now();

  try {
    const response = await axios.post(
      url,
      { query: "query HealthCheck { __typename }" },
      {
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Origin: appOrigin,
          Referer: appOrigin.endsWith("/") ? appOrigin : `${appOrigin}/`,
        },
      }
    );
    if (response.data?.errors?.length) {
      return {
        status: "fail" as const,
        latencyMs: Date.now() - startedAt,
        detail: response.data.errors[0]?.message || "Lens GraphQL error",
      };
    }
    return { status: "ok" as const, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      status: "fail" as const,
      detail: error instanceof Error ? error.message : "Lens health check failed",
    };
  }
}

export async function runHealthChecks() {
  const config = (() => {
    try {
      ensureRuntimeConfig();
      return { status: "ok" as const, issues: [] as string[] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const issues = message
        .split("\n")
        .slice(1)
        .map((line) => line.replace(/^- /, "").trim())
        .filter(Boolean);
      return { status: "fail" as const, issues };
    }
  })();

  const [postgres, redis, lens] = await Promise.all([
    checkPostgres(),
    checkRedis(),
    checkLens(),
  ]);

  const overall =
    config.status === "fail" ||
    postgres.status === "fail" ||
    redis.status === "fail" ||
    lens.status === "fail"
      ? "fail"
      : "ok";

  return {
    status: overall,
    checkedAt: new Date().toISOString(),
    services: {
      config,
      postgres,
      redis,
      lens,
    },
  };
}
