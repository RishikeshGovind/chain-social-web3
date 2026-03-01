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

async function importPg() {
  const importer = new Function("moduleName", "return import(moduleName)") as (
    moduleName: string
  ) => Promise<Record<string, unknown>>;
  const mod = (await importer("pg")) as Record<string, unknown> & {
    default?: Record<string, unknown>;
  };
  const ClientCtor = (mod["Client"] ?? mod.default?.["Client"]) as
    | (new (config: { connectionString: string }) => PgClient)
    | undefined;
  if (!ClientCtor) {
    throw new Error("Postgres backend selected but 'pg' is not installed.");
  }
  return ClientCtor;
}

export class PostgresStateStore implements StateStore {
  constructor(private readonly connectionString: string) {}

  private async withClient<T>(fn: (client: PgClient) => Promise<T>) {
    const ClientCtor = await importPg();
    const client = new ClientCtor({ connectionString: this.connectionString });
    try {
      await client.query("BEGIN");
      await client.query(TABLE_SQL);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      await client.end();
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
