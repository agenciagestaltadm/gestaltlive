import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@server": path.resolve(import.meta.dirname, "server"),
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: "forks",
  },
});
