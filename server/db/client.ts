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
import type { AnyPgColumn, PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { getTableName, sql } from "drizzle-orm";
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

export const MIGRATIONS_FOLDER = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "server/db/migrations");

/**
 * SSL do PostgreSQL. DB_SSL: "disable" | "require" (criptografa sem validar o certificado) | "verify".
 * Sem DB_SSL: "require" para provedores gerenciados (Supabase, Neon, RDS...) e desligado para localhost.
 * O `sslmode` da URL é removido porque o node-postgres o trataria como "verify" e ignoraria esta configuração.
 */
export function sslConfig(url: string): { connectionString: string; ssl: false | { rejectUnauthorized: boolean } } {
  const u = new URL(url);
  const fromUrl = u.searchParams.get("sslmode");
  u.searchParams.delete("sslmode");
  const local = ["localhost", "127.0.0.1", "::1", "db", "postgres"].includes(u.hostname);
  const mode = process.env.DB_SSL ?? (fromUrl === "disable" ? "disable" : fromUrl === "verify-full" || fromUrl === "verify-ca" ? "verify" : fromUrl || !local ? "require" : "disable");
  const ssl = mode === "disable" ? false : { rejectUnauthorized: mode === "verify" };
  return { connectionString: u.toString(), ssl };
}

const isSupabase = (url: string) => /\.supabase\.(co|com)$/.test(new URL(url).hostname);

/**
 * No Supabase, as tabelas do schema `public` ficam expostas pela API REST automática (chave `anon`, que é pública).
 * O Gestalt Live não usa essa API — o servidor conecta direto como dono das tabelas, que ignora RLS —, então
 * ligamos RLS sem políticas em todas as tabelas: a API externa não lê nem grava nada e a aplicação segue igual.
 */
async function lockPublicSchema(db: DB) {
  await db.execute(sql`
    do $$
    declare t record;
    begin
      for t in select tablename from pg_tables where schemaname = 'public' and not rowsecurity loop
        execute format('alter table public.%I enable row level security', t.tablename);
      end loop;
    end $$;
  `);
}

export async function createDatabase(url: string, opts: { migrate?: boolean } = {}): Promise<Database> {
  const runMigrations = opts.migrate ?? true;
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const target = url.slice("pglite:".length);
    let client: InstanceType<typeof PGlite>;
    if (target === "memory" || target === "") {
      client = new PGlite();
    } else {
      const dir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), target);
      fs.mkdirSync(dir, { recursive: true });
      client = new PGlite(dir);
    }
    await client.waitReady;
    const db = drizzle(client, { schema }) as unknown as DB;
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    if (runMigrations) await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
    return { db, kind: "pglite", close: () => client.close() };
  }

  const pg = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { connectionString, ssl } = sslConfig(url);
  const pool = new pg.default.Pool({
    connectionString,
    ssl,
    max: Number(process.env.DB_POOL_MAX ?? (process.env.VERCEL ? 3 : 20)),
    // funções serverless: devolve conexões ociosas rapidamente ao pooler
    idleTimeoutMillis: process.env.VERCEL ? 5_000 : 30_000,
  });
  const db = drizzle(pool, { schema }) as unknown as DB;
  if (runMigrations) {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
    if (isSupabase(url)) await lockPublicSchema(db);
  }
  return { db, kind: "postgres", close: () => pool.end() };
}

/**
 * Referência qualificada ("tabela"."coluna") para usar em subconsultas correlacionadas.
 * O Drizzle renderiza colunas sem o nome da tabela dentro de sql``; numa subconsulta, a coluna
 * da consulta externa seria resolvida contra a tabela interna (ex.: "id" → id da tabela interna).
 */
export function qc(column: AnyPgColumn) {
  return sql.raw(`"${getTableName(column.table)}"."${column.name}"`);
}
