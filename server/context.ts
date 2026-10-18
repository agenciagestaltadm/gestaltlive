/**
 * Contexto da aplicação: dependências injetadas em serviços, rotas e gateway de tempo real.
 * Permite instanciar o servidor completo em testes com banco em memória e relógio controlado.
 */
import path from "node:path";
import crypto from "node:crypto";
import type { DB } from "./db/client";
import type { RateLimits } from "./lib/rate-limit";
import type { Realtime } from "./realtime/realtime";
import type { BlobStore } from "./lib/storage";

export interface AppConfig {
  env: "development" | "production" | "test";
  /** URL pública fixa (ex.: https://live.gestalt.com.br). Se nula, deriva do cabeçalho Host da requisição. */
  publicUrl: string | null;
  cookieSecure: boolean;
  uploadDir: string;
  appSecret: string;
  trustProxy: boolean;
  maxUploadBytes: number;
}

export interface AppContext {
  db: DB;
  config: AppConfig;
  limits: RateLimits;
  rt: Realtime;
  storage: BlobStore;
  now: () => Date;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV as AppConfig["env"]) || "development";
  let appSecret = env.APP_SECRET ?? "";
  if (!appSecret || appSecret === "troque-este-segredo-em-producao") {
    if (nodeEnv === "production") throw new Error("APP_SECRET precisa ser definido em produção.");
    appSecret = appSecret || crypto.randomBytes(32).toString("hex");
  }
  return {
    env: nodeEnv,
    publicUrl: env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, "") : null,
    cookieSecure: env.COOKIE_SECURE === "true" || (nodeEnv === "production" && env.COOKIE_SECURE !== "false"),
    uploadDir: path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.UPLOAD_DIR || "./uploads"),
    appSecret,
    // na Vercel o IP real do cliente vem em x-forwarded-for
    trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY === "true" : !!env.VERCEL,
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES ?? 3 * 1024 * 1024),
  };
}
