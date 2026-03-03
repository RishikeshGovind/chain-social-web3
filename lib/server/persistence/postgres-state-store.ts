import type { ChainSocialState, StateStore } from "./types";

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS chainsocial_state (
  id INTEGER PRIMARY KEY,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
`;

type PgClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
};

type PgClientConfig = {
  connectionString: string;
  connectionTimeoutMillis?: number;
  statement_timeout?: number;
  query_timeout?: number;
};

async function importPg() {
  const importer = new Function("moduleName", "return import(moduleName)") as (
    moduleName: string
  ) => Promise<Record<string, unknown>>;
  const mod = (await importer("pg")) as Record<string, unknown> & {
    default?: Record<string, unknown>;
  };
  const ClientCtor = (mod["Client"] ?? mod.default?.["Client"]) as
    | (new (config: PgClientConfig) => PgClient)
    | undefined;
  if (!ClientCtor) {
    throw new Error("Postgres backend selected but 'pg' is not installed.");
  }
  return ClientCtor;
}

export class PostgresStateStore implements StateStore {
  constructor(
    private readonly connectionString: string,
    private readonly options?: {
      connectTimeoutMs?: number;
      queryTimeoutMs?: number;
      operationTimeoutMs?: number;
    }
  ) {}

  private withTimeout<T>(promise: Promise<T>, ms: number, label: string) {
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Postgres ${label} timed out after ${ms}ms`));
      }, ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timer) clearTimeout(timer);
    }) as Promise<T>;
  }

  private async withClient<T>(fn: (client: PgClient) => Promise<T>) {
    const ClientCtor = await importPg();
    const connectTimeoutMs = this.options?.connectTimeoutMs ?? 2500;
    const queryTimeoutMs = this.options?.queryTimeoutMs ?? 3000;
    const operationTimeoutMs = this.options?.operationTimeoutMs ?? 3500;

    const client = new ClientCtor({
      connectionString: this.connectionString,
      connectionTimeoutMillis: connectTimeoutMs,
      statement_timeout: queryTimeoutMs,
      query_timeout: queryTimeoutMs,
    });
    try {
      const op = (async () => {
        await client.query("BEGIN");
        await client.query(TABLE_SQL);
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      })();
      const result = await this.withTimeout(op, operationTimeoutMs, "operation");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback failures after timeout/network errors.
      }
      throw error;
    } finally {
      try {
        await client.end();
      } catch {
        // Ignore end failures on already-broken connections.
      }
    }
  }

  async read(): Promise<ChainSocialState | null> {
    return this.withClient(async (client) => {
      const result = await client.query("SELECT state FROM chainsocial_state WHERE id = 1 LIMIT 1");
      const row = result.rows[0];
      if (!row) return null;
      return row.state as ChainSocialState;
    });
  }

  async write(state: ChainSocialState): Promise<void> {
    await this.withClient(async (client) => {
      await client.query(
        `
          INSERT INTO chainsocial_state (id, state, updated_at)
          VALUES (1, $1::jsonb, NOW())
          ON CONFLICT (id)
          DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()
        `,
        [JSON.stringify(state)]
      );
    });
  }
}
