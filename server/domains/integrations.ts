/**
 * Integrações (CRM LIDIA, automações): webhook opcional por organização, alimentado pelo outbox.
 *
 * - Nada é enviado sem configuração explícita: eventos só entram no outbox quando a organização tem
 *   um webhook ativo que assina o tópico. Sem webhook, nenhum dado pessoal é copiado para a fila.
 * - Nenhuma mensagem de WhatsApp/e-mail é enviada pela plataforma; o webhook apenas entrega o evento
 *   ao sistema da organização.
 * - Entrega: POST JSON assinado com HMAC-SHA256 (cabeçalho X-Gestalt-Signature: sha256=<hex> sobre
 *   "<timestamp>.<corpo>"), novas tentativas com backoff exponencial e status PENDENTE/ENVIADO/FALHOU.
 * - Várias instâncias: cada item é reservado (next_attempt_at no futuro) com FOR UPDATE SKIP LOCKED
 *   antes da entrega, então só uma instância o envia por vez.
 */
import crypto from "node:crypto";
import { isIP } from "node:net";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../context";
import { rowsOf, type Tx } from "../db/client";
import { events, integrationOutbox, integrationWebhooks, participantAnswers, satisfactionVotes, sessionParticipants } from "../db/schema";
import type { Actor } from "../auth/auth";
import { authorize } from "../auth/permissions";
import { badRequest, notFound } from "../lib/errors";
import { log } from "../lib/logger";
import { audit } from "./audit";

export const INTEGRATION_TOPICS = {
  "participant.joined": "Participante entrou em uma sessão (somente com consentimento de marketing vigente)",
  "session.ended": "Sessão encerrada (resumo agregado, sem dados de contato)",
} as const;
export type IntegrationTopic = keyof typeof INTEGRATION_TOPICS;
const TOPIC_KEYS = Object.keys(INTEGRATION_TOPICS) as [IntegrationTopic, ...IntegrationTopic[]];

export const OUTBOX_MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 6 * 3_600_000;
/** Tempo de reserva de um item durante a entrega (maior que o timeout da requisição). */
const LEASE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export function backoffMs(attempts: number) {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(attempts - 1, 0), MAX_BACKOFF_MS);
}

/* ================================================================== enfileiramento */
/**
 * Enfileira um evento se a organização tiver webhook ativo que assina o tópico. Use dentro da
 * transação da operação de origem (o evento só existe se a operação for confirmada).
 */
export async function enqueueIntegration(
  tx: Tx,
  now: Date,
  orgId: string,
  topic: IntegrationTopic,
  payload: Record<string, unknown>,
  opts: { participantId?: string } = {},
) {
  const [hook] = await tx
    .select({ enabled: integrationWebhooks.enabled, topics: integrationWebhooks.topics })
    .from(integrationWebhooks)
    .where(eq(integrationWebhooks.orgId, orgId));
  if (!hook?.enabled || !hook.topics.includes(topic)) return false;
  await tx.insert(integrationOutbox).values({
    orgId,
    topic,
    payload,
    participantId: opts.participantId ?? null,
    nextAttemptAt: now,
    createdAt: now,
  });
  return true;
}

/** participant.joined — somente com consentimento de marketing concedido neste cadastro (o vigente). */
export async function enqueueParticipantJoined(
  tx: Tx,
  now: Date,
  input: {
    session: { id: string; orgId: string; eventId: string; code: string; name: string };
    person: { id: string; fullName: string; email: string | null; phone: string | null };
    sp: { id: string; displayName: string; joinedAt: Date };
    custom: { key: string; value: string }[];
    consentVersion: string;
  },
) {
  const [ev] = await tx.select({ id: events.id, title: events.title }).from(events).where(eq(events.id, input.session.eventId));
  return enqueueIntegration(
    tx,
    now,
    input.session.orgId,
    "participant.joined",
    {
      participant: { id: input.person.id, fullName: input.person.fullName, email: input.person.email, phone: input.person.phone },
      sessionParticipant: { id: input.sp.id, displayName: input.sp.displayName, joinedAt: input.sp.joinedAt.toISOString() },
      session: { id: input.session.id, code: input.session.code, name: input.session.name },
      event: { id: ev?.id ?? input.session.eventId, title: ev?.title ?? null },
      customFields: Object.fromEntries(input.custom.map((c) => [c.key, c.value])),
      consent: { marketing: true, textVersion: input.consentVersion },
    },
    { participantId: input.person.id },
  );
}

/** session.ended — resumo agregado (sem e-mail/telefone; o pódio usa o nome de exibição público). */
export async function enqueueSessionEnded(
  tx: Tx,
  now: Date,
  session: { id: string; orgId: string; eventId: string; code: string; name: string; startedAt: Date | null; endedAt: Date | null },
  podium: { position: number; displayName: string; score: number; correctCount: number }[],
) {
  const [hook] = await tx.select({ enabled: integrationWebhooks.enabled, topics: integrationWebhooks.topics }).from(integrationWebhooks).where(eq(integrationWebhooks.orgId, session.orgId));
  if (!hook?.enabled || !hook.topics.includes("session.ended")) return false;
  const [ev] = await tx.select({ id: events.id, title: events.title }).from(events).where(eq(events.id, session.eventId));
  const [t] = rowsOf<{ participants: number; interacted: number; answers: number; positive: number; negative: number }>(
    await tx.execute(sql`select
      (select count(*)::int from ${sessionParticipants} where session_id = ${session.id}) as participants,
      (select count(distinct session_participant_id)::int from ${participantAnswers} where session_id = ${session.id} and status = 'ACCEPTED') as interacted,
      (select count(*)::int from ${participantAnswers} where session_id = ${session.id} and status = 'ACCEPTED') as answers,
      (select count(*)::int from ${satisfactionVotes} where session_id = ${session.id} and value = 'POSITIVO') as positive,
      (select count(*)::int from ${satisfactionVotes} where session_id = ${session.id} and value = 'NEGATIVO') as negative`),
  );
  return enqueueIntegration(tx, now, session.orgId, "session.ended", {
    session: {
      id: session.id,
      code: session.code,
      name: session.name,
      startedAt: session.startedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
    },
    event: { id: ev?.id ?? session.eventId, title: ev?.title ?? null },
    totals: { participants: t.participants, interacted: t.interacted, answers: t.answers },
    satisfaction: { positive: t.positive, negative: t.negative },
    podium: podium.slice(0, 3).map((e) => ({ position: e.position, displayName: e.displayName, score: e.score, correctCount: e.correctCount })),
  });
}

/* ================================================================== assinatura e entrega */
export function signPayload(secret: string, timestamp: string, body: string) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export type FetchLike = (url: string, init: RequestInit) => Promise<{ status: number }>;

interface DeliveryInput {
  id: string;
  orgId: string;
  topic: string;
  payload: unknown;
  createdAt: Date;
}

async function deliver(fetchFn: FetchLike, url: string, secret: string, item: DeliveryInput, now: Date) {
  const body = JSON.stringify({ id: item.id, topic: item.topic, orgId: item.orgId, createdAt: item.createdAt.toISOString(), data: item.payload });
  const timestamp = String(Math.floor(now.getTime() / 1000));
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "GestaltLive-Webhook/1",
        "x-gestalt-event": item.topic,
        "x-gestalt-delivery": item.id,
        "x-gestalt-timestamp": timestamp,
        "x-gestalt-signature": signPayload(secret, timestamp, body),
      },
      body,
      // redirecionamentos não são seguidos (o destino é sempre o configurado)
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status >= 200 && res.status < 300) return { ok: true as const, status: res.status };
    return { ok: false as const, status: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; errors?: { code?: string }[] } };
    const code = e.cause?.code ?? e.cause?.errors?.[0]?.code;
    const msg = e.name === "TimeoutError" ? "Tempo esgotado" : code ? `Falha de conexão (${code})` : e.message === "fetch failed" ? "Falha de conexão" : e.message;
    return { ok: false as const, status: null, error: String(msg || "Falha de conexão").slice(0, 300) };
  }
}

/* ================================================================== consumidor */
export interface ProcessOptions {
  fetch?: FetchLike;
  batchSize?: number;
}

/**
 * Processa um lote do outbox: reserva itens PENDENTE vencidos (de organizações com webhook ativo),
 * entrega e atualiza o status. Retorna quantos itens foram enviados/reagendados/falharam.
 */
export async function processOutbox(ctx: AppContext, opts: ProcessOptions = {}) {
  const fetchFn: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const now = ctx.now();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const batchSize = opts.batchSize ?? 50;

  const claimed = rowsOf<{ id: string }>(
    await ctx.db.execute(sql`
      update ${integrationOutbox} o set next_attempt_at = ${leaseUntil.toISOString()}::timestamptz
       where o.id in (
         select i.id from ${integrationOutbox} i
           join ${integrationWebhooks} w on w.org_id = i.org_id and w.enabled = true
          where i.status = 'PENDENTE' and coalesce(i.next_attempt_at, i.created_at) <= ${now.toISOString()}::timestamptz
          order by i.created_at
          limit ${batchSize}
          for update of i skip locked)
       returning o.id`),
  );
  const result = { sent: 0, retried: 0, failed: 0 };
  for (const { id } of claimed) {
    const [item] = await ctx.db
      .select({
        id: integrationOutbox.id,
        orgId: integrationOutbox.orgId,
        topic: integrationOutbox.topic,
        payload: integrationOutbox.payload,
        attempts: integrationOutbox.attempts,
        createdAt: integrationOutbox.createdAt,
        url: integrationWebhooks.url,
        secret: integrationWebhooks.secret,
      })
      .from(integrationOutbox)
      .innerJoin(integrationWebhooks, eq(integrationWebhooks.orgId, integrationOutbox.orgId))
      .where(eq(integrationOutbox.id, id));
    if (!item) continue; // removido (ex.: anonimização) entre a reserva e a entrega
    const r = await deliver(fetchFn, item.url, item.secret, item, now);
    const attempts = item.attempts + 1;
    const done = ctx.now();
    if (r.ok) {
      result.sent++;
      await ctx.db
        .update(integrationOutbox)
        .set({ status: "ENVIADO", attempts, processedAt: done, nextAttemptAt: null, lastError: null })
        .where(eq(integrationOutbox.id, id));
    } else if (attempts >= OUTBOX_MAX_ATTEMPTS) {
      result.failed++;
      await ctx.db
        .update(integrationOutbox)
        .set({ status: "FALHOU", attempts, processedAt: done, nextAttemptAt: null, lastError: r.error })
        .where(eq(integrationOutbox.id, id));
      log.warn("webhook: entrega desistida após o limite de tentativas", { id, orgId: item.orgId, topic: item.topic, error: r.error });
    } else {
      result.retried++;
      await ctx.db
        .update(integrationOutbox)
        .set({ attempts, nextAttemptAt: new Date(done.getTime() + backoffMs(attempts)), lastError: r.error })
        .where(eq(integrationOutbox.id, id));
    }
  }
  return result;
}

/* ================================================================== configuração (admin) */
const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i;

function isPrivateIp(host: string) {
  const h = host.replace(/^\[|\]$/g, "");
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) return h === "::1" || h === "::" || /^f[cd]/i.test(h) || /^fe80/i.test(h) || /^::ffff:/i.test(h);
  return false;
}

/** Em produção, exige HTTPS e bloqueia destinos de rede interna. */
export function validateWebhookUrl(raw: string, env: AppContext["config"]["env"]) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest("URL inválida.", [{ path: "url", message: "Informe uma URL completa (https://...)" }]);
  }
  if (url.username || url.password) throw badRequest("URL inválida.", [{ path: "url", message: "Não inclua usuário/senha na URL" }]);
  if (env === "production") {
    if (url.protocol !== "https:") throw badRequest("URL inválida.", [{ path: "url", message: "Use HTTPS" }]);
    if (PRIVATE_HOST.test(url.hostname) || isPrivateIp(url.hostname)) {
      throw badRequest("URL inválida.", [{ path: "url", message: "Endereços de rede interna não são permitidos" }]);
    }
  } else if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw badRequest("URL inválida.", [{ path: "url", message: "Use HTTP ou HTTPS" }]);
  }
  return url.toString();
}

export const webhookInputSchema = z.object({
  url: z.string().trim().min(1, "Informe a URL").max(2000),
  enabled: z.boolean().default(true),
  topics: z.array(z.enum(TOPIC_KEYS)).min(1, "Selecione ao menos um evento"),
});

const newSecret = () => "whsec_" + crypto.randomBytes(24).toString("base64url");
const secretHint = (s: string) => `whsec_…${s.slice(-4)}`;

function webhookDTO(w: typeof integrationWebhooks.$inferSelect | undefined) {
  if (!w) return null;
  return { url: w.url, enabled: w.enabled, topics: w.topics, secretHint: secretHint(w.secret), createdAt: w.createdAt, updatedAt: w.updatedAt };
}

/** Configuração + situação da fila (sem payloads: podem conter dados pessoais). */
export async function getIntegrations(ctx: AppContext, actor: Actor, orgId: string) {
  authorize(actor, orgId, "members.manage");
  const [w] = await ctx.db.select().from(integrationWebhooks).where(eq(integrationWebhooks.orgId, orgId));
  const counts = await ctx.db
    .select({ status: integrationOutbox.status, n: sql<number>`count(*)::int` })
    .from(integrationOutbox)
    .where(eq(integrationOutbox.orgId, orgId))
    .groupBy(integrationOutbox.status);
  const recent = await ctx.db
    .select({
      id: integrationOutbox.id,
      topic: integrationOutbox.topic,
      status: integrationOutbox.status,
      attempts: integrationOutbox.attempts,
      nextAttemptAt: integrationOutbox.nextAttemptAt,
      lastError: integrationOutbox.lastError,
      createdAt: integrationOutbox.createdAt,
      processedAt: integrationOutbox.processedAt,
    })
    .from(integrationOutbox)
    .where(eq(integrationOutbox.orgId, orgId))
    .orderBy(desc(integrationOutbox.createdAt))
    .limit(50);
  const byStatus = { PENDENTE: 0, ENVIADO: 0, FALHOU: 0 } as Record<string, number>;
  for (const c of counts) byStatus[c.status] = c.n;
  return {
    webhook: webhookDTO(w),
    topics: Object.entries(INTEGRATION_TOPICS).map(([key, label]) => ({ key, label })),
    maxAttempts: OUTBOX_MAX_ATTEMPTS,
    counts: byStatus,
    recent,
  };
}

/** Cria ou altera o webhook. Na criação devolve o segredo (única vez em que ele é exibido). */
export async function saveWebhook(ctx: AppContext, actor: Actor, orgId: string, raw: unknown) {
  authorize(actor, orgId, "members.manage");
  const input = webhookInputSchema.parse(raw);
  const url = validateWebhookUrl(input.url, ctx.config.env);
  return ctx.db.transaction(async (tx) => {
    const [existing] = await tx.select().from(integrationWebhooks).where(eq(integrationWebhooks.orgId, orgId));
    let secret: string | null = null;
    let row: typeof integrationWebhooks.$inferSelect;
    if (existing) {
      [row] = await tx
        .update(integrationWebhooks)
        .set({ url, enabled: input.enabled, topics: input.topics, updatedAt: ctx.now() })
        .where(eq(integrationWebhooks.orgId, orgId))
        .returning();
    } else {
      secret = newSecret();
      [row] = await tx
        .insert(integrationWebhooks)
        .values({ orgId, url, secret, enabled: input.enabled, topics: input.topics, createdAt: ctx.now(), updatedAt: ctx.now() })
        .returning();
    }
    await audit(tx, actor, orgId, existing ? "integration.webhook.update" : "integration.webhook.create", "integration", orgId, {
      url,
      enabled: input.enabled,
      topics: input.topics,
    });
    return { webhook: webhookDTO(row), secret };
  });
}

export async function rotateWebhookSecret(ctx: AppContext, actor: Actor, orgId: string) {
  authorize(actor, orgId, "members.manage");
  const secret = newSecret();
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.update(integrationWebhooks).set({ secret, updatedAt: ctx.now() }).where(eq(integrationWebhooks.orgId, orgId)).returning();
    if (!row) throw notFound("Nenhum webhook configurado.");
    await audit(tx, actor, orgId, "integration.webhook.rotate_secret", "integration", orgId, {});
    return { webhook: webhookDTO(row), secret };
  });
}

/** Remove o webhook; itens ainda pendentes são marcados como FALHOU (não serão enviados). */
export async function deleteWebhook(ctx: AppContext, actor: Actor, orgId: string) {
  authorize(actor, orgId, "members.manage");
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx.delete(integrationWebhooks).where(eq(integrationWebhooks.orgId, orgId)).returning();
    if (!row) throw notFound("Nenhum webhook configurado.");
    const cancelled = await tx
      .update(integrationOutbox)
      .set({ status: "FALHOU", lastError: "Webhook removido", processedAt: ctx.now(), nextAttemptAt: null })
      .where(and(eq(integrationOutbox.orgId, orgId), eq(integrationOutbox.status, "PENDENTE")))
      .returning({ id: integrationOutbox.id });
    await audit(tx, actor, orgId, "integration.webhook.delete", "integration", orgId, { url: row.url, cancelled: cancelled.length });
  });
}

/** Envia um evento de teste imediatamente (fora do outbox) e devolve o resultado. */
export async function testWebhook(ctx: AppContext, actor: Actor, orgId: string, opts: { fetch?: FetchLike } = {}) {
  authorize(actor, orgId, "members.manage");
  const [w] = await ctx.db.select().from(integrationWebhooks).where(eq(integrationWebhooks.orgId, orgId));
  if (!w) throw notFound("Nenhum webhook configurado.");
  const now = ctx.now();
  const r = await deliver(
    opts.fetch ?? ((url, init) => fetch(url, init)),
    w.url,
    w.secret,
    { id: crypto.randomUUID(), orgId, topic: "integration.test", payload: { message: "Teste de webhook do Gestalt Live" }, createdAt: now },
    now,
  );
  await audit(ctx.db, actor, orgId, "integration.webhook.test", "integration", orgId, { ok: r.ok, status: r.status });
  return { ok: r.ok, status: r.status, error: r.ok ? null : r.error };
}

/** Recoloca na fila um item que FALHOU (zera as tentativas). */
export async function retryOutboxItem(ctx: AppContext, actor: Actor, orgId: string, id: string) {
  authorize(actor, orgId, "members.manage");
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(integrationOutbox)
      .set({ status: "PENDENTE", attempts: 0, nextAttemptAt: ctx.now(), processedAt: null, lastError: null })
      .where(and(eq(integrationOutbox.id, id), eq(integrationOutbox.orgId, orgId), eq(integrationOutbox.status, "FALHOU")))
      .returning({ id: integrationOutbox.id, topic: integrationOutbox.topic });
    if (!row) throw notFound("Item não encontrado ou não está com falha.");
    await audit(tx, actor, orgId, "integration.outbox.retry", "integration", orgId, { outboxId: id, topic: row.topic });
  });
}
