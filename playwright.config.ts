import { defineConfig, devices } from "@playwright/test";

/**
 * E2E com o build de produção (execute `npm run build` antes) e banco em memória.
 * Desktop (admin, palestrante, telão) e celular (participante).
 */
const PORT = 3020;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure", locale: "pt-BR" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node dist/server.mjs",
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      DATABASE_URL: "pglite:memory",
      APP_SECRET: "segredo-e2e-0123456789abcdef",
      COOKIE_SECURE: "false",
      SEED_SUPERADMIN_EMAIL: "admin@e2e.test",
      SEED_SUPERADMIN_PASSWORD: "SenhaE2E12345",
      SEED_DEMO: "true",
      PUBLIC_URL: "",
      LOG_LEVEL: "warn",
      // isolado do .env: nunca usa o Supabase real nos testes
      REALTIME_TRANSPORT: "socket",
      STORAGE_DRIVER: "disk",
      UPLOAD_DIR: "./.data/e2e-uploads",
      SUPABASE_URL: "",
      SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      SUPABASE_ANNON_KEY: "",
      SUPABASE_ROLE_KEY: "",
    },
  },
});
