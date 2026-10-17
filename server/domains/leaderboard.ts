/**
 * Ranking em tempo real, congelamento visual, resultado final, pódio e premiação.
 *
 * Desempate oficial (determinístico, nunca aleatório):
 *  1. maior pontuação  2. mais acertos  3. menor soma de tempos em acertos
 *  4. inscrição mais antiga  5. id do participante
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import { rowsOf, type Tx } from "../db/client";
import {
  disqualifications,
  eventPrizes,
  eventSessions,
  leaderboardSnapshots,
  presentationStates,
  prizeAwards,
  sessionEvents,
  sessionParticipants,
} from "../db/schema";
import type { Actor } from "../auth/auth";
import { badRequest, conflict, notFound } from "../lib/errors";
import { audit } from "./audit";
import type { SessionRow } from "./sessions";
import type { LeaderboardDTO, LeaderboardEntryDTO, MyStandingDTO, PodiumDTO, PrizeDTO } from "@shared/types";

export interface RankedRow {
  position: number;
  id: string;
  displayName: string;
  score: number;
  correctCount: number;
  answeredCount: number;
  correctTimeMs: number;
  joinedAt: Date;
}

export interface SnapshotEntry {
  position: number;
  id: string;
  displayName: string;
  score: number;
  correctCount: number;
  answeredCount: number;
  correctTimeMs: number;
}

type PresentationRow = typeof presentationStates.$inferSelect;

/* ------------------------------------------------------------------ cálculo com cache curto */
const cache = new Map<string, { at: number; rows: RankedRow[] }>();
const CACHE_MS = 400;

export function invalidateRanking(sessionId: string) {
  cache.delete(sessionId);
}

export async function computeRanking(tx: Tx, sessionId: string, useCache = true): Promise<RankedRow[]> {
  const hit = cache.get(sessionId);
  if (useCache && hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const rows = await tx
    .select({
      id: sessionParticipants.id,
      displayName: sessionParticipants.displayName,
      score: sessionParticipants.score,
      correctCount: sessionParticipants.correctCount,
      answeredCount: sessionParticipants.answeredCount,
      correctTimeMs: sessionParticipants.correctTimeMs,
      joinedAt: sessionParticipants.joinedAt,
    })
    .from(sessionParticipants)
    .where(and(eq(sessionParticipants.sessionId, sessionId), isNull(sessionParticipants.disqualifiedAt)))
    .orderBy(
      desc(sessionParticipants.score),
      desc(sessionParticipants.correctCount),
      asc(sessionParticipants.correctTimeMs),
      asc(sessionParticipants.joinedAt),
      asc(sessionParticipants.id),
    );
  const ranked = rows.map((r, i) => ({ ...r, correctTimeMs: Number(r.correctTimeMs), position: i + 1 }));
  cache.set(sessionId, { at: Date.now(), rows: ranked });
  return ranked;
}

const toEntry = (r: RankedRow | SnapshotEntry): SnapshotEntry => ({
  position: r.position,
  id: r.id,
  displayName: r.displayName,
  score: r.score,
  correctCount: r.correctCount,
  answeredCount: r.answeredCount,
  correctTimeMs: r.correctTimeMs,
});

/* ------------------------------------------------------------------ snapshots */
export async function createSnapshot(
  tx: Tx,
  session: Pick<SessionRow, "id" | "orgId">,
  kind: "PUBLICACAO" | "CONGELADO" | "FINAL",
  extra: { sessionQuestionId?: string | null; reason?: string | null; actorId?: string | null; revision?: number } = {},
) {
  const rows = await computeRanking(tx, session.id, false);
  const [snap] = await tx
    .insert(leaderboardSnapshots)
    .values({
      orgId: session.orgId,
      sessionId: session.id,
      kind,
      revision: extra.revision ?? 1,
      sessionQuestionId: extra.sessionQuestionId ?? null,
      entries: rows.map(toEntry),
      reason: extra.reason ?? null,
      createdByUserId: extra.actorId ?? null,
    })
    .returning();
  return snap;
}

async function snapshotById(tx: Tx, id: string) {
  const [s] = await tx.select().from(leaderboardSnapshots).where(eq(leaderboardSnapshots.id, id));
  return s ?? null;
}

/** Posições na publicação anterior à mais recente — base do indicador de movimentação. */
async function previousPositions(tx: Tx, sessionId: string): Promise<Map<string, number> | null> {
  const snaps = await tx
    .select({ entries: leaderboardSnapshots.entries })
    .from(leaderboardSnapshots)
    .where(and(eq(leaderboardSnapshots.sessionId, sessionId), eq(leaderboardSnapshots.kind, "PUBLICACAO")))
    .orderBy(desc(leaderboardSnapshots.createdAt))
    .limit(2);
  if (snaps.length < 2) return null;
  const prev = snaps[1].entries as SnapshotEntry[];
  return new Map(prev.map((e) => [e.id, e.position]));
}

function withMovement(entries: SnapshotEntry[], prev: Map<string, number> | null): LeaderboardEntryDTO[] {
  return entries.map((e) => {
    const before = prev?.get(e.id);
    return {
      position: e.position,
      sessionParticipantId: e.id,
      displayName: e.displayName,
      score: e.score,
      correctCount: e.correctCount,
      answeredCount: e.answeredCount,
      movement: before === undefined ? null : before - e.position,
    };
  });
}

export async function latestFinal(tx: Tx, sessionId: string) {
  const [s] = await tx
    .select()
    .from(leaderboardSnapshots)
    .where(and(eq(leaderboardSnapshots.sessionId, sessionId), eq(leaderboardSnapshots.kind, "FINAL")))
    .orderBy(desc(leaderboardSnapshots.revision), desc(leaderboardSnapshots.createdAt))
    .limit(1);
  return s ?? null;
}

/* ------------------------------------------------------------------ visões */
/** Ranking para o público (participantes e telão): respeita ocultação e congelamento. */
export async function publicLeaderboard(tx: Tx, session: SessionRow, pres: PresentationRow, limit = 10): Promise<LeaderboardDTO> {
  const now = new Date().toISOString();
  if (pres.leaderboardHidden) {
    return { entries: [], totalRanked: 0, frozen: false, hidden: true, final: false, updatedAt: now };
  }
  if (session.finalizedAt) {
    const fin = await latestFinal(tx, session.id);
    if (fin) {
      const entries = fin.entries as SnapshotEntry[];
      return { entries: withMovement(entries.slice(0, limit), null), totalRanked: entries.length, frozen: false, hidden: false, final: true, updatedAt: fin.createdAt.toISOString() };
    }
  }
  if (pres.leaderboardFrozenSnapshotId) {
    const snap = await snapshotById(tx, pres.leaderboardFrozenSnapshotId);
    if (snap) {
      const entries = snap.entries as SnapshotEntry[];
      return { entries: withMovement(entries.slice(0, limit), null), totalRanked: entries.length, frozen: true, hidden: false, final: false, updatedAt: snap.createdAt.toISOString() };
    }
  }
  return controlLeaderboard(tx, session.id, limit);
}

/** Ranking oficial ao vivo (sempre atualizado; usado pelo painel do palestrante). */
export async function controlLeaderboard(tx: Tx, sessionId: string, limit = 10): Promise<LeaderboardDTO> {
  const rows = await computeRanking(tx, sessionId);
  const prev = await previousPositions(tx, sessionId);
  return {
    entries: withMovement(rows.slice(0, limit).map(toEntry), prev),
    totalRanked: rows.length,
    frozen: false,
    hidden: false,
    final: false,
    updatedAt: new Date().toISOString(),
  };
}

/** Posição individual. Com ranking congelado/oculto, a posição exibida segue a visão pública. */
export function standingFrom(
  rows: { id: string; position: number; score: number; correctCount: number; answeredCount: number; displayName: string }[],
  sp: { id: string; displayName: string; score: number; correctCount: number; answeredCount: number; disqualifiedAt: Date | null },
  opts: { hidden: boolean },
): MyStandingDTO {
  const idx = rows.findIndex((r) => r.id === sp.id);
  const me = idx >= 0 ? rows[idx] : null;
  const above = idx > 0 ? rows[idx - 1] : null;
  return {
    sessionParticipantId: sp.id,
    displayName: sp.displayName,
    position: opts.hidden || !me ? null : me.position,
    totalRanked: rows.length,
    score: me?.score ?? sp.score,
    correctCount: me?.correctCount ?? sp.correctCount,
    answeredCount: me?.answeredCount ?? sp.answeredCount,
    gapToNext: opts.hidden || !me || !above ? null : Math.max(0, above.score - me.score),
    disqualified: !!sp.disqualifiedAt,
  };
}

export async function rowsForStanding(tx: Tx, session: SessionRow, pres: PresentationRow) {
  if (session.finalizedAt) {
    const fin = await latestFinal(tx, session.id);
    if (fin) return fin.entries as SnapshotEntry[];
  }
  if (pres.leaderboardFrozenSnapshotId) {
    const snap = await snapshotById(tx, pres.leaderboardFrozenSnapshotId);
    if (snap) return snap.entries as SnapshotEntry[];
  }
  return computeRanking(tx, session.id);
}

export async function myStanding(tx: Tx, session: SessionRow, pres: PresentationRow, spId: string): Promise<MyStandingDTO> {
  const [sp] = await tx.select().from(sessionParticipants).where(eq(sessionParticipants.id, spId));
  const rows = await rowsForStanding(tx, session, pres);
  return standingFrom(rows, sp, { hidden: pres.leaderboardHidden });
}

/* ------------------------------------------------------------------ prêmios e pódio */
export async function sessionPrizes(tx: Tx, session: Pick<SessionRow, "eventId">): Promise<PrizeDTO[]> {
  const rows = await tx.select().from(eventPrizes).where(eq(eventPrizes.eventId, session.eventId)).orderBy(asc(eventPrizes.rank));
  return rows.map((p) => ({
    id: p.id,
    rank: p.rank,
    name: p.name,
    description: p.description,
    imageUrl: p.imageUrl,
    estimatedValueCents: p.estimatedValueCents,
    eligibility: p.eligibility,
    pickupInfo: p.pickupInfo,
  }));
}

export async function prizesRevealed(tx: Tx, sessionId: string) {
  const [e] = await tx
    .select({ id: sessionEvents.id })
    .from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, sessionId), eq(sessionEvents.type, "prizes.revealed")))
    .limit(1);
  return !!e;
}

export async function podium(tx: Tx, session: SessionRow, forControl = false): Promise<PodiumDTO | null> {
  const prizes = await sessionPrizes(tx, session);
  const revealed = await prizesRevealed(tx, session.id);
  if (!forControl && !revealed) return { final: !!session.finalizedAt, revealed: false, finalizedAt: session.finalizedAt?.toISOString() ?? null, winners: [] };
  const fin = session.finalizedAt ? await latestFinal(tx, session.id) : null;
  const entries = fin ? (fin.entries as SnapshotEntry[]) : (await computeRanking(tx, session.id)).map(toEntry);
  return {
    final: !!fin,
    revealed,
    finalizedAt: session.finalizedAt?.toISOString() ?? null,
    winners: entries.slice(0, 3).map((e) => ({
      rank: e.position,
      displayName: e.displayName,
      score: e.score,
      correctCount: e.correctCount,
      prize: prizes.find((p) => p.rank === e.position) ?? null,
    })),
  };
}

/** Congela oficialmente a classificação (snapshot FINAL) e registra os prêmios do Top 3. Idempotente. */
export async function finalizeLeaderboard(tx: Tx, session: SessionRow, now: Date, actor: Actor | null) {
  if (session.finalizedAt) return null;
  const snap = await createSnapshot(tx, session, "FINAL", { actorId: actor?.user.id ?? null, reason: "Encerramento da sessão" });
  await tx.update(eventSessions).set({ finalizedAt: now }).where(eq(eventSessions.id, session.id));
  await createAwards(tx, session, snap.id, snap.entries as SnapshotEntry[]);
  return snap;
}

async function createAwards(tx: Tx, session: Pick<SessionRow, "id" | "orgId" | "eventId">, snapshotId: string, entries: SnapshotEntry[]) {
  const prizes = await sessionPrizes(tx, session);
  for (const e of entries.slice(0, 3)) {
    const prize = prizes.find((p) => p.rank === e.position) ?? null;
    if (!prize) continue;
    await tx.insert(prizeAwards).values({
      orgId: session.orgId,
      sessionId: session.id,
      prizeId: prize.id,
      rank: e.position,
      sessionParticipantId: e.id,
      snapshotId,
      prizeSnapshot: prize,
    });
  }
}

/* ------------------------------------------------------------------ revisão: desclassificação */
/**
 * Desclassifica um participante com justificativa. Se a sessão já foi finalizada, gera uma NOVA
 * revisão do resultado final (a anterior é preservada) e reemite as premiações afetadas.
 */
export async function disqualify(ctx: AppContext, tx: Tx, actor: Actor, session: SessionRow, spId: string, reason: string) {
  const [sp] = await tx.select().from(sessionParticipants).where(and(eq(sessionParticipants.id, spId), eq(sessionParticipants.sessionId, session.id)));
  if (!sp) throw notFound("Participante não encontrado.");
  if (sp.disqualifiedAt) throw conflict("Participante já desclassificado.");
  await tx.update(sessionParticipants).set({ disqualifiedAt: ctx.now() }).where(eq(sessionParticipants.id, spId));
  await tx.insert(disqualifications).values({ orgId: session.orgId, sessionId: session.id, sessionParticipantId: spId, reason, createdByUserId: actor.user.id });
  invalidateRanking(session.id);
  await audit(tx, actor, session.orgId, "participant.disqualify", "session_participant", spId, { reason, sessionId: session.id });
  if (session.finalizedAt) await reviseFinal(tx, actor, session, `Desclassificação: ${reason}`);
}

export async function reinstate(ctx: AppContext, tx: Tx, actor: Actor, session: SessionRow, spId: string, reason: string) {
  const [sp] = await tx.select().from(sessionParticipants).where(and(eq(sessionParticipants.id, spId), eq(sessionParticipants.sessionId, session.id)));
  if (!sp) throw notFound("Participante não encontrado.");
  if (!sp.disqualifiedAt) throw badRequest("Participante não está desclassificado.");
  await tx.update(sessionParticipants).set({ disqualifiedAt: null }).where(eq(sessionParticipants.id, spId));
  await tx
    .update(disqualifications)
    .set({ revertedAt: ctx.now(), revertedByUserId: actor.user.id, revertReason: reason })
    .where(and(eq(disqualifications.sessionParticipantId, spId), isNull(disqualifications.revertedAt)));
  invalidateRanking(session.id);
  await audit(tx, actor, session.orgId, "participant.reinstate", "session_participant", spId, { reason, sessionId: session.id });
  if (session.finalizedAt) await reviseFinal(tx, actor, session, `Reintegração: ${reason}`);
}

export async function reviseFinal(tx: Tx, actor: Actor, session: SessionRow, reason: string) {
  const prev = await latestFinal(tx, session.id);
  const snap = await createSnapshot(tx, session, "FINAL", { actorId: actor.user.id, reason, revision: (prev?.revision ?? 0) + 1 });
  const entries = snap.entries as SnapshotEntry[];
  const current = await tx.select().from(prizeAwards).where(and(eq(prizeAwards.sessionId, session.id), inArray(prizeAwards.status, ["PENDENTE", "ENTREGUE"])));
  for (const a of current) {
    const now = entries.find((e) => e.position === a.rank);
    if (!now || now.id !== a.sessionParticipantId) {
      await tx.update(prizeAwards).set({ status: "REVOGADO", revokedAt: new Date(), notes: reason }).where(eq(prizeAwards.id, a.id));
    }
  }
  const prizes = await sessionPrizes(tx, session);
  for (const e of entries.slice(0, 3)) {
    const keep = current.find((a) => a.rank === e.position && a.sessionParticipantId === e.id);
    const prize = prizes.find((p) => p.rank === e.position);
    if (keep || !prize) continue;
    await tx.insert(prizeAwards).values({
      orgId: session.orgId,
      sessionId: session.id,
      prizeId: prize.id,
      rank: e.position,
      sessionParticipantId: e.id,
      snapshotId: snap.id,
      prizeSnapshot: prize,
    });
  }
  await audit(tx, actor, session.orgId, "leaderboard.revise_final", "session", session.id, { revision: snap.revision, reason });
}

/** Lista das premiações (com contato do vencedor para entrega — acesso restrito a administradores). */
export interface AwardRow {
  id: string;
  rank: number;
  status: "PENDENTE" | "ENTREGUE" | "REVOGADO";
  awardedAt: string;
  deliveredAt: string | null;
  revokedAt: string | null;
  notes: string | null;
  prize: PrizeDTO | null;
  displayName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  sessionParticipantId: string;
  deliveredBy: string | null;
}

export async function listAwards(tx: Tx, sessionId: string): Promise<AwardRow[]> {
  const r = await tx.execute(sql`
    select pa.id, pa.rank, pa.status, pa.awarded_at as "awardedAt", pa.delivered_at as "deliveredAt", pa.revoked_at as "revokedAt",
           pa.notes, pa.prize_snapshot as "prize", sp.display_name as "displayName", p.full_name as "fullName",
           p.email, p.phone, sp.id as "sessionParticipantId", u.name as "deliveredBy"
      from prize_awards pa
      join session_participants sp on sp.id = pa.session_participant_id
      join participants p on p.id = sp.participant_id
      left join users u on u.id = pa.delivered_by_user_id
     where pa.session_id = ${sessionId}
     order by pa.awarded_at desc, pa.rank asc
  `);
  return rowsOf<AwardRow>(r);
}
