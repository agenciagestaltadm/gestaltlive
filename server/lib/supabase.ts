/**
 * Integração com o Supabase (modo Vercel / serverless):
 *  - Realtime: o servidor publica pela API REST de broadcast (chave service_role) em canais PRIVADOS;
 *    os clientes só recebem (política RLS de leitura em realtime.messages, sem política de escrita),
 *    então ninguém consegue forjar eventos com a chave anon.
 *  - Storage: imagens (logos, slides) em buckets do Supabase em vez do disco local.
 *
 * Aceita os nomes padrão (SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY) e as variações usadas no .env
 * do projeto (SUPABASE_ANNON_KEY, SUPABASE_ROLE_KEY).
 */
import { sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { log } from "./logger";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceKey: string;
  /** Bucket público com as imagens servidas (logos, perguntas, slides). */
  bucket: string;
  /** Bucket privado que recebe os envios diretos do navegador antes do processamento. */
  incomingBucket: string;
}

export function supabaseConfig(env: NodeJS.ProcessEnv = process.env): SupabaseConfig | null {
  const url = (env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const anonKey = (env.SUPABASE_ANON_KEY ?? env.SUPABASE_ANNON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_ROLE_KEY ?? "").trim();
  if (!url || !anonKey || !serviceKey) return null;
  return {
    url,
    anonKey,
    serviceKey,
    bucket: env.SUPABASE_BUCKET || "gestalt-live",
    incomingBucket: env.SUPABASE_INCOMING_BUCKET || "gestalt-live-envios",
  };
}

export function serviceHeaders(cfg: SupabaseConfig, extra: Record<string, string> = {}) {
  return { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, ...extra };
}

export interface BroadcastMessage {
  topic: string;
  event: string;
  payload: unknown;
}

/** Publica mensagens em canais privados (lotes de até 100 por requisição). */
export async function broadcastMessages(cfg: SupabaseConfig, messages: BroadcastMessage[]) {
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100).map((m) => ({ ...m, private: true }));
    const res = await fetch(`${cfg.url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: serviceHeaders(cfg, { "Content-Type": "application/json" }),
      body: JSON.stringify({ messages: batch }),
    });
    if (!res.ok) throw new Error(`broadcast do Supabase falhou (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
}

/** Prefixo de todos os canais do Gestalt Live (a política RLS libera leitura apenas para eles). */
export const TOPIC_PREFIX = "gl-";

/**
 * Prepara o projeto Supabase (idempotente): política de leitura dos canais privados e buckets.
 * Executado no build da Vercel (npm run db:migrate) e na inicialização do servidor próprio.
 */
export async function setupSupabase(db: DB, cfg: SupabaseConfig) {
  await db.execute(sql`
    do $$
    begin
      if exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages')
         and not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'gestalt_live_receber') then
        execute $p$
          create policy gestalt_live_receber on realtime.messages
            for select to anon, authenticated
            using (realtime.messages.extension = 'broadcast' and (select realtime.topic()) like 'gl-%')
        $p$;
      end if;
    end $$;
  `);
  await ensureBucket(cfg, cfg.bucket, { public: true, file_size_limit: 25 * 1024 * 1024, allowed_mime_types: ["image/png", "image/jpeg", "image/gif", "image/webp"] });
  await ensureBucket(cfg, cfg.incomingBucket, { public: false, file_size_limit: 20 * 1024 * 1024, allowed_mime_types: ["image/png", "image/jpeg"] });
}

async function ensureBucket(cfg: SupabaseConfig, id: string, opts: { public: boolean; file_size_limit: number; allowed_mime_types: string[] }) {
  const get = await fetch(`${cfg.url}/storage/v1/bucket/${id}`, { headers: serviceHeaders(cfg) });
  const body = { id, name: id, ...opts };
  if (get.ok) {
    const res = await fetch(`${cfg.url}/storage/v1/bucket/${id}`, { method: "PUT", headers: serviceHeaders(cfg, { "Content-Type": "application/json" }), body: JSON.stringify(body) });
    if (!res.ok) log.warn("não foi possível atualizar o bucket do Supabase", { id, status: res.status });
    return;
  }
  const res = await fetch(`${cfg.url}/storage/v1/bucket`, { method: "POST", headers: serviceHeaders(cfg, { "Content-Type": "application/json" }), body: JSON.stringify(body) });
  if (!res.ok && res.status !== 409) throw new Error(`não foi possível criar o bucket "${id}" no Supabase (${res.status}): ${(await res.text()).slice(0, 200)}`);
}
