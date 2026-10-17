import fs from "node:fs";
import { createRuntime } from "../runtime";
import { seedDatabase } from "./seed";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const runtime = await createRuntime({ databaseUrl: process.env.DATABASE_URL ?? "pglite:./.data/db" });
const r = await seedDatabase(runtime.ctx, {
  superadminEmail: process.env.SEED_SUPERADMIN_EMAIL,
  superadminPassword: process.env.SEED_SUPERADMIN_PASSWORD,
  demo: process.env.SEED_DEMO !== "false",
});
console.log(r.created ? "Seed aplicado." : "Seed já existente — nada a fazer.");
await runtime.close();
