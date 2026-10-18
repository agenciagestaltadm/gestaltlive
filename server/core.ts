/**
 * Montagem do núcleo da aplicação (banco, contexto, API, publicador de tempo real e armazenamento),
 * sem servidor HTTP próprio, Socket.IO nem Next.js — usado pelo servidor residente (./runtime.ts),
 * pelas funções da Vercel (./serverless.ts) e pelos testes.
 *
 * Modos (variáveis de ambiente, com opção explícita em RuntimeOptions):
 *  - REALTIME_TRANSPORT: "socket" (padrão local/Docker) | "supabase" (padrão na Vercel).
 *  - STORAGE_DRIVER: "disk" | "supabase" (padrão: supabase quando SUPABASE_* estiver configurado).
 */
import { createDatabase, type Database } from "./db/client";
import { loadConfig, type AppConfig, type AppContext } from "./context";
import { closeRateLimits, createRateLimits } from "./lib/rate-limit";
import { Realtime, type RealtimeMode } from "./realtime/realtime";
import { createApp } from "./app";
import { supabaseConfig, setupSupabase, type BroadcastMessage } from "./lib/supabase";
import { DiskStore, SupabaseStore, type BlobStore } from "./lib/storage";
import { log } from "./lib/logger";

export interface RuntimeOptions {
  databaseUrl: string;
  config?: Partial<AppConfig>;
  now?: () => Date;
  rateLimitMultiplier?: number;
  /** Aplica migrações ao conectar (padrão: sim). Na Vercel elas rodam no build. */
  migrate?: boolean;
  realtime?: RealtimeMode;
  /** Substitui o envio ao Supabase Realtime (testes). */
  realtimeSend?: (messages: BroadcastMessage[]) => Promise<void>;
  storage?: BlobStore;
}

export interface Runtime {
  ctx: AppContext;
  app: ReturnType<typeof createApp>;
  database: Database;
  close: () => Promise<void>;
}

export function realtimeModeFromEnv(env: NodeJS.ProcessEnv = process.env): RealtimeMode {
  const v = env.REALTIME_TRANSPORT?.trim().toLowerCase();
  if (v === "supabase" || v === "socket") return v;
  return env.VERCEL ? "supabase" : "socket";
}

export async function createRuntime(opts: RuntimeOptions): Promise<Runtime> {
  const database = await createDatabase(opts.databaseUrl, { migrate: opts.migrate ?? true });
  const config = { ...loadConfig(), ...opts.config };
  const sb = supabaseConfig();
  const mode = opts.realtime ?? realtimeModeFromEnv();
  const rt = new Realtime({ mode, supabase: mode === "supabase" ? sb : null, send: opts.realtimeSend });

  const driver = process.env.STORAGE_DRIVER?.trim().toLowerCase();
  const useSupabaseStorage = driver ? driver === "supabase" : !!sb && config.env !== "test";
  if (useSupabaseStorage && !sb) throw new Error("STORAGE_DRIVER=supabase exige SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.");
  const storage = opts.storage ?? (useSupabaseStorage ? new SupabaseStore(sb!) : new DiskStore(config.uploadDir));

  // projeto Supabase: política de leitura dos canais e buckets (idempotente; na Vercel roda no build)
  if (sb && (opts.migrate ?? true) && database.kind === "postgres" && (mode === "supabase" || storage.kind === "supabase")) {
    await setupSupabase(database.db, sb).catch((err) => log.warn("não foi possível preparar o Supabase (Realtime/Storage)", { err }));
  }

  const limits = createRateLimits(opts.rateLimitMultiplier ?? 1);
  const ctx: AppContext = { db: database.db, config, limits, rt, storage, now: opts.now ?? (() => new Date()) };
  rt.bind(ctx);
  const app = createApp(ctx);
  return {
    ctx,
    app,
    database,
    close: async () => {
      rt.stop();
      closeRateLimits(limits);
      await database.close();
    },
  };
}
