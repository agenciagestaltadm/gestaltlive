/**
 * Cliente de banco de dados.
 *
 * DATABASE_URL:
 *  - "pglite:memory"            → PostgreSQL em memória (testes)
 *  - "pglite:./.data/db"        → PostgreSQL embutido persistido em disco (desenvolvimento)
 *  - "postgres://..."           → PostgreSQL real (produção) via node-postgres
 *
 * Ambos expõem a mesma API do Drizzle (PgDatabase) e usam as mesmas migrações SQL.
 */
import path from "node:path";
import fs from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Schema = typeof schema;
export type DB = PgDatabase<PgQueryResultHKT, Schema>;
/** Transação ou conexão — serviços aceitam ambos. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

export interface Database {
  db: DB;
  kind: "pglite" | "postgres";
  close: () => Promise<void>;
}

/** Normaliza o retorno de tx.execute() (PGlite e node-postgres expõem `.rows`). */
export function rowsOf<T>(result: unknown): T[] {
  const r = result as { rows?: T[] };
  return r?.rows ?? (Array.isArray(result) ? (result as T[]) : []);
}

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "server/db/migrations");

export async function createDatabase(url: string): Promise<Database> {
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const target = url.slice("pglite:".length);
    let client: InstanceType<typeof PGlite>;
    if (target === "memory" || target === "") {
      client = new PGlite();
    } else {
      const dir = path.resolve(process.cwd(), target);
      fs.mkdirSync(dir, { recursive: true });
      client = new PGlite(dir);
    }
    await client.waitReady;
    const db = drizzle(client, { schema }) as unknown as DB;
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
    return { db, kind: "pglite", close: () => client.close() };
  }

  const pg = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new pg.default.Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX ?? 20),
    idleTimeoutMillis: 30_000,
  });
  const db = drizzle(pool, { schema }) as unknown as DB;
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, kind: "postgres", close: () => pool.end() };
}
