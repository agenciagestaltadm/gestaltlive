/** Ponto de entrada do servidor Gestalt Live (API + tempo real + interface Next.js). */
import fs from "node:fs";
import { createRuntime, startHttpServer } from "./runtime";
import { seedDatabase } from "./db/seed";
import { log } from "./lib/logger";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

async function main() {
  const runtime = await createRuntime({ databaseUrl: process.env.DATABASE_URL ?? "pglite:./.data/db" });
  log.info("banco de dados pronto", { kind: runtime.database.kind });
  await seedDatabase(runtime.ctx, {
    superadminEmail: process.env.SEED_SUPERADMIN_EMAIL,
    superadminPassword: process.env.SEED_SUPERADMIN_PASSWORD,
    demo: process.env.SEED_DEMO !== "false",
  });
  const srv = await startHttpServer(runtime, { port, withNext: process.env.DISABLE_NEXT !== "true", dev });
  log.info(`Gestalt Live disponível em http://localhost:${srv.port}`, { dev });

  const shutdown = async (signal: string) => {
    log.info("encerrando", { signal });
    await srv.stop().catch(() => undefined);
    await runtime.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("falha ao iniciar o servidor", { err });
  process.exit(1);
});
