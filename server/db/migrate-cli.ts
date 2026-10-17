/** Aplica as migrações pendentes (também aplicadas automaticamente na inicialização do servidor). */
import fs from "node:fs";
import { createDatabase } from "./client";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const db = await createDatabase(process.env.DATABASE_URL ?? "pglite:./.data/db");
console.log(`Migrações aplicadas (${db.kind}).`);
await db.close();
