/**
 * Aplica as migrações pendentes (também aplicadas automaticamente na inicialização do servidor próprio).
 * Com SUPABASE_* configurado, prepara também o Realtime (política dos canais) e o Storage (buckets).
 * Na Vercel roda no build (npm run vercel-build), antes do `next build`.
 */
import fs from "node:fs";
import { createDatabase } from "./client";
import { setupSupabase, supabaseConfig } from "../lib/supabase";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.DATABASE_URL ?? "pglite:./.data/db";
if (process.env.VERCEL && url.startsWith("pglite:")) {
  console.error("Na Vercel, defina DATABASE_URL com a conexão do PostgreSQL (Supabase). O banco embutido não persiste em funções serverless.");
  process.exit(1);
}
const db = await createDatabase(url);
console.log(`Migrações aplicadas (${db.kind}).`);
const sb = supabaseConfig();
if (sb && db.kind === "postgres") {
  await setupSupabase(db.db, sb);
  console.log("Supabase preparado (Realtime e Storage).");
}
await db.close();
