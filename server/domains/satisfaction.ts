/**
 * Termômetro do Treinamento — avaliação permanente de satisfação.
 *
 * - Cada participante tem UMA avaliação atual (upsert); mudar substitui a anterior no indicador.
 * - Toda mudança é registrada no histórico (append-only) com data e hora.
 * - Percentuais calculados apenas sobre avaliações registradas; ausência de voto não é presumida.
 */
import { asc, count, eq, inArray, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import type { Tx } from "../db/client";
import { eventSessions, satisfactionVoteHistory, satisfactionVotes, sessionParticipants } from "../db/schema";
import { AppError } from "../lib/errors";
import { satisfactionInputSchema } from "@shared/schemas";
import { satisfactionSummary } from "@shared/scoring";
import type { SatisfactionDTO } from "@shared/types";
import type { ParticipantAuth } from "./participants";
import { ACTIVE_STATUSES } from "./sessions";

export type SatisfactionValue = "POSITIVO" | "NEGATIVO";

export async function vote(ctx: AppContext, auth: ParticipantAuth, raw: unknown) {
  const { value } = satisfactionInputSchema.parse(raw);
  const changed = await ctx.db.transaction(async (tx) => {
    const [session] = await tx.select({ status: eventSessions.status }).from(eventSessions).where(eq(eventSessions.id, auth.session.id));
    if (!(ACTIVE_STATUSES as readonly string[]).includes(session.status)) {
      throw new AppError(409, "SESSAO_NAO_ATIVA", "A avaliação está disponível apenas durante a sessão.");
    }
    const [current] = await tx.select().from(satisfactionVotes).where(eq(satisfactionVotes.sessionParticipantId, auth.sp.id)).for("update");
    if (current?.value === value) return false;
    const now = ctx.now();
    if (current) {
      await tx
        .update(satisfactionVotes)
        .set({ value, changes: current.changes + 1, updatedAt: now })
        .where(eq(satisfactionVotes.id, current.id));
    } else {
      const ins = await tx
        .insert(satisfactionVotes)
        .values({ orgId: auth.session.orgId, sessionId: auth.session.id, sessionParticipantId: auth.sp.id, value, createdAt: now, updatedAt: now })
        .onConflictDoNothing()
        .returning();
      if (ins.length === 0) {
        // requisição concorrente criou o voto: aplica como alteração
        await tx.update(satisfactionVotes).set({ value, updatedAt: now }).where(eq(satisfactionVotes.sessionParticipantId, auth.sp.id));
      }
    }
    await tx.insert(satisfactionVoteHistory).values({
      orgId: auth.session.orgId,
      sessionId: auth.session.id,
      sessionParticipantId: auth.sp.id,
      value,
      previousValue: current?.value ?? null,
      createdAt: now,
    });
    return true;
  });
  if (changed) ctx.rt.satisfactionDirty(auth.session.id);
  return { value, changed };
}

export async function myVote(tx: Tx, spId: string): Promise<SatisfactionValue | null> {
  const [v] = await tx.select({ value: satisfactionVotes.value }).from(satisfactionVotes).where(eq(satisfactionVotes.sessionParticipantId, spId));
  return v?.value ?? null;
}

/** Indicadores agregados + evolução temporal (reconstruída a partir do histórico). */
export async function satisfactionData(tx: Tx, sessionId: string, maxPoints = 60): Promise<SatisfactionDTO> {
  const counts = await tx
    .select({ value: satisfactionVotes.value, n: count() })
    .from(satisfactionVotes)
    .where(eq(satisfactionVotes.sessionId, sessionId))
    .groupBy(satisfactionVotes.value);
  const positive = Number(counts.find((c) => c.value === "POSITIVO")?.n ?? 0);
  const negative = Number(counts.find((c) => c.value === "NEGATIVO")?.n ?? 0);
  const [reg] = await tx.select({ n: count() }).from(sessionParticipants).where(eq(sessionParticipants.sessionId, sessionId));
  const registered = Number(reg.n);
  const summary = satisfactionSummary(positive, negative);

  const history = await tx
    .select({ sp: satisfactionVoteHistory.sessionParticipantId, value: satisfactionVoteHistory.value, at: satisfactionVoteHistory.createdAt })
    .from(satisfactionVoteHistory)
    .where(eq(satisfactionVoteHistory.sessionId, sessionId))
    .orderBy(asc(satisfactionVoteHistory.createdAt));
  const timeline: SatisfactionDTO["timeline"] = [];
  if (history.length) {
    const start = history[0].at.getTime();
    const end = history[history.length - 1].at.getTime();
    const bucket = Math.max(10_000, Math.ceil((end - start) / maxPoints / 10_000) * 10_000);
    const state = new Map<string, SatisfactionValue>();
    let p = 0;
    let n = 0;
    let cursor = start + bucket;
    for (const h of history) {
      while (h.at.getTime() >= cursor) {
        timeline.push({ t: new Date(cursor).toISOString(), positive: p, negative: n });
        cursor += bucket;
      }
      const prev = state.get(h.sp);
      if (prev === "POSITIVO") p--;
      if (prev === "NEGATIVO") n--;
      state.set(h.sp, h.value);
      if (h.value === "POSITIVO") p++;
      else n++;
    }
    timeline.push({ t: new Date(Math.max(cursor, end)).toISOString(), positive: p, negative: n });
  }
  return {
    summary,
    registered,
    notVoted: Math.max(0, registered - summary.total),
    participationPct: registered > 0 ? (summary.total / registered) * 100 : null,
    timeline,
  };
}

/** Comparativo entre sessões (mesmo evento) — percentual final de cada turma. */
export async function satisfactionBySession(tx: Tx, sessionIds: string[]) {
  if (sessionIds.length === 0) return [];
  const rows = await tx
    .select({
      sessionId: satisfactionVotes.sessionId,
      positive: sql<number>`count(*) filter (where ${satisfactionVotes.value} = 'POSITIVO')::int`,
      negative: sql<number>`count(*) filter (where ${satisfactionVotes.value} = 'NEGATIVO')::int`,
    })
    .from(satisfactionVotes)
    .where(inArray(satisfactionVotes.sessionId, sessionIds))
    .groupBy(satisfactionVotes.sessionId);
  return sessionIds.map((id) => {
    const r = rows.find((x) => x.sessionId === id);
    return { sessionId: id, ...satisfactionSummary(Number(r?.positive ?? 0), Number(r?.negative ?? 0)) };
  });
}


