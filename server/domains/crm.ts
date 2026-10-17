/**
 * CRM e captação de leads: lista, busca, segmentação, perfil individual, consentimentos,
 * revogação, anonimização (LGPD) e exportação autorizada.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AppContext } from "../context";
import { qc, type Tx } from "../db/client";
import {
  answerOptionSelections,
  consentRecords,
  eventSessions,
  events,
  integrationOutbox,
  participantAnswers,
  participantCustomFields,
  participantCustomValues,
  participants,
  scoreTransactions,
  sessionParticipants,
  sessionQuestions,
} from "../db/schema";
import type { Actor } from "../auth/auth";
import { authorize } from "../auth/permissions";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "./audit";
import { getSnapshot } from "./snapshots";
import { toCsv } from "./reports";

export interface ParticipantFilter {
  q?: string;
  eventId?: string;
  sessionId?: string;
  marketing?: "sim" | "nao";
  fieldKey?: string;
  fieldValue?: string;
  /** Segmentação por resposta: pergunta (questions.id) e alternativa escolhida. */
  questionId?: string;
  optionId?: string;
  page?: number;
  pageSize?: number;
}

const latestMarketing = sql<boolean | null>`(
  select cr.granted from ${consentRecords} cr
   where cr.participant_id = ${qc(participants.id)} and cr.purpose = 'MARKETING'
   order by cr.created_at desc limit 1)`;

function whereFor(orgId: string, f: ParticipantFilter): SQL {
  const conds: SQL[] = [eq(participants.orgId, orgId)];
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(participants.fullName, like), ilike(participants.email, like), ilike(participants.phone, like))!);
  }
  if (f.sessionId || f.eventId) {
    conds.push(sql`exists (select 1 from ${sessionParticipants} sp join ${eventSessions} es on es.id = sp.session_id
      where sp.participant_id = ${qc(participants.id)}
      ${f.sessionId ? sql`and sp.session_id = ${f.sessionId}` : sql``}
      ${f.eventId ? sql`and es.event_id = ${f.eventId}` : sql``})`);
  }
  if (f.marketing === "sim") conds.push(sql`${latestMarketing} = true`);
  if (f.marketing === "nao") conds.push(sql`coalesce(${latestMarketing}, false) = false`);
  if (f.fieldKey && f.fieldValue) {
    conds.push(sql`exists (select 1 from ${participantCustomValues} v
      join ${participantCustomFields} cf on cf.id = v.field_id
      join ${sessionParticipants} sp on sp.id = v.session_participant_id
      where sp.participant_id = ${qc(participants.id)} and cf.key = ${f.fieldKey} and v.value = ${f.fieldValue})`);
  }
  if (f.questionId && f.optionId) {
    conds.push(sql`exists (select 1 from ${participantAnswers} pa
      join ${sessionParticipants} sp on sp.id = pa.session_participant_id
      join ${sessionQuestions} sq on sq.id = pa.session_question_id
      join ${answerOptionSelections} aos on aos.answer_id = pa.id
      where sp.participant_id = ${qc(participants.id)} and pa.status = 'ACCEPTED'
        and sq.question_id = ${f.questionId} and aos.option_id = ${f.optionId})`);
  }
  return and(...conds)!;
}

export async function listParticipants(ctx: AppContext, actor: Actor, orgId: string, f: ParticipantFilter) {
  authorize(actor, orgId, "participants.read");
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 200);
  const page = Math.max(f.page ?? 1, 1);
  const where = whereFor(orgId, f);
  const [{ total }] = await ctx.db.select({ total: sql<number>`count(*)::int` }).from(participants).where(where);
  const rows = await ctx.db
    .select({
      id: participants.id,
      fullName: participants.fullName,
      email: participants.email,
      phone: participants.phone,
      createdAt: participants.createdAt,
      anonymizedAt: participants.anonymizedAt,
      marketing: latestMarketing,
      sessions: sql<number>`(select count(*)::int from ${sessionParticipants} sp where sp.participant_id = ${qc(participants.id)})`,
      bestScore: sql<number | null>`(select max(sp.score)::int from ${sessionParticipants} sp where sp.participant_id = ${qc(participants.id)})`,
    })
    .from(participants)
    .where(where)
    .orderBy(desc(participants.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { total, page, pageSize, rows };
}

export async function participantDetail(ctx: AppContext, actor: Actor, id: string) {
  const [p] = await ctx.db.select().from(participants).where(eq(participants.id, id));
  if (!p) throw notFound("Participante não encontrado.");
  authorize(actor, p.orgId, "participants.read");
  const sessions = await ctx.db
    .select({
      sessionParticipantId: sessionParticipants.id,
      sessionId: eventSessions.id,
      sessionName: eventSessions.name,
      code: eventSessions.code,
      status: eventSessions.status,
      eventTitle: events.title,
      displayName: sessionParticipants.displayName,
      joinedAt: sessionParticipants.joinedAt,
      score: sessionParticipants.score,
      correctCount: sessionParticipants.correctCount,
      answeredCount: sessionParticipants.answeredCount,
      disqualifiedAt: sessionParticipants.disqualifiedAt,
      position: sql<number>`(select count(*)::int + 1 from ${sessionParticipants} o
        where o.session_id = ${qc(sessionParticipants.sessionId)} and o.disqualified_at is null and (
          o.score > ${qc(sessionParticipants.score)}
          or (o.score = ${qc(sessionParticipants.score)} and o.correct_count > ${qc(sessionParticipants.correctCount)})
          or (o.score = ${qc(sessionParticipants.score)} and o.correct_count = ${qc(sessionParticipants.correctCount)} and o.correct_time_ms < ${qc(sessionParticipants.correctTimeMs)})
          or (o.score = ${qc(sessionParticipants.score)} and o.correct_count = ${qc(sessionParticipants.correctCount)} and o.correct_time_ms = ${qc(sessionParticipants.correctTimeMs)} and (o.joined_at, o.id) < (${qc(sessionParticipants.joinedAt)}, ${qc(sessionParticipants.id)}))))`,
    })
    .from(sessionParticipants)
    .innerJoin(eventSessions, eq(eventSessions.id, sessionParticipants.sessionId))
    .innerJoin(events, eq(events.id, eventSessions.eventId))
    .where(eq(sessionParticipants.participantId, id))
    .orderBy(desc(sessionParticipants.joinedAt));
  const spIds = sessions.map((s) => s.sessionParticipantId);
  const custom = spIds.length
    ? await ctx.db
        .select({ spId: participantCustomValues.sessionParticipantId, label: participantCustomFields.label, key: participantCustomFields.key, value: participantCustomValues.value })
        .from(participantCustomValues)
        .innerJoin(participantCustomFields, eq(participantCustomFields.id, participantCustomValues.fieldId))
        .where(inArray(participantCustomValues.sessionParticipantId, spIds))
    : [];
  // respostas de perfil/opinião (para segmentação)
  const profileAnswers: { sessionParticipantId: string; question: string; answer: string }[] = [];
  if (spIds.length) {
    const ans = await ctx.db
      .select({ id: participantAnswers.id, spId: participantAnswers.sessionParticipantId, versionId: sessionQuestions.versionId, value: participantAnswers.numericValue })
      .from(participantAnswers)
      .innerJoin(sessionQuestions, eq(sessionQuestions.id, participantAnswers.sessionQuestionId))
      .where(and(inArray(participantAnswers.sessionParticipantId, spIds), eq(participantAnswers.status, "ACCEPTED")));
    const sels = ans.length ? await ctx.db.select().from(answerOptionSelections).where(inArray(answerOptionSelections.answerId, ans.map((a) => a.id))) : [];
    for (const a of ans) {
      const snap = await getSnapshot(ctx.db, a.versionId);
      if (!["PERFIL", "OPINIAO", "SIM_NAO", "ESCALA", "NPS"].includes(snap.type)) continue;
      const chosen = sels.filter((s) => s.answerId === a.id).map((s) => s.optionId);
      profileAnswers.push({
        sessionParticipantId: a.spId,
        question: snap.title,
        answer: a.value !== null ? String(a.value) : snap.options.filter((o) => chosen.includes(o.id)).map((o) => o.label).join(", "),
      });
    }
  }
  const scoreHistory = spIds.length
    ? await ctx.db
        .select({ spId: scoreTransactions.sessionParticipantId, kind: scoreTransactions.kind, points: scoreTransactions.points, reason: scoreTransactions.reason, createdAt: scoreTransactions.createdAt })
        .from(scoreTransactions)
        .where(inArray(scoreTransactions.sessionParticipantId, spIds))
        .orderBy(asc(scoreTransactions.createdAt))
    : [];
  const consents = await ctx.db.select().from(consentRecords).where(eq(consentRecords.participantId, id)).orderBy(desc(consentRecords.createdAt));
  return { participant: p, sessions, custom, profileAnswers, scoreHistory, consents };
}

export async function adminSetMarketing(ctx: AppContext, actor: Actor, participantId: string, granted: boolean, reason: string) {
  const [p] = await ctx.db.select().from(participants).where(eq(participants.id, participantId));
  if (!p) throw notFound();
  authorize(actor, p.orgId, "participants.manage");
  if (granted) throw badRequest("O consentimento de marketing só pode ser concedido pelo próprio participante.");
  await ctx.db.transaction(async (tx) => {
    await tx.insert(consentRecords).values({
      orgId: p.orgId,
      participantId: p.id,
      purpose: "MARKETING",
      granted: false,
      textVersion: "revogacao",
      textSnapshot: `Revogação registrada pela organização: ${reason}`,
      source: "ADMIN",
    });
    await audit(tx, actor, p.orgId, "consent.revoke", "participant", p.id, { reason });
  });
}

/** Anonimização (LGPD): remove dados identificáveis e preserva estatísticas agregadas. */
export async function anonymizeParticipant(ctx: AppContext, actor: Actor, participantId: string, reason: string) {
  const [p] = await ctx.db.select().from(participants).where(eq(participants.id, participantId));
  if (!p) throw notFound();
  authorize(actor, p.orgId, "participants.manage");
  if (p.anonymizedAt) throw badRequest("Participante já anonimizado.");
  await ctx.db.transaction(async (tx) => {
    await anonymizeParticipantData(tx, ctx.now(), p, { source: "ADMIN", note: "Dados anonimizados a pedido do titular/organização." });
    await audit(tx, actor, p.orgId, "participant.anonymize", "participant", p.id, { reason });
  });
}

/**
 * Núcleo da anonimização, sem autorização nem auditoria (o chamador registra quem agiu — usuário ou
 * rotina do sistema). Idempotente: devolve false se o participante já estava anonimizado.
 */
export async function anonymizeParticipantData(
  tx: Tx,
  now: Date,
  p: { id: string; orgId: string },
  opts: { source: "ADMIN" | "SISTEMA"; note: string },
) {
  const updated = await tx
    .update(participants)
    .set({ fullName: "Participante anonimizado", email: null, emailNorm: null, phone: null, phoneNorm: null, anonymizedAt: now, updatedAt: now })
    .where(and(eq(participants.id, p.id), isNull(participants.anonymizedAt)))
    .returning({ id: participants.id });
  if (!updated.length) return false;
  const sps = await tx.select({ id: sessionParticipants.id }).from(sessionParticipants).where(eq(sessionParticipants.participantId, p.id));
  if (sps.length) {
    const ids = sps.map((s) => s.id);
    await tx.update(sessionParticipants).set({ displayName: "Anônimo", uniqueEmail: null, uniquePhone: null }).where(inArray(sessionParticipants.id, ids));
    await tx.delete(participantCustomValues).where(inArray(participantCustomValues.sessionParticipantId, ids));
  }
  // eventos de integração ainda guardam os dados de contato — removidos junto (enviados ou não)
  await tx.delete(integrationOutbox).where(eq(integrationOutbox.participantId, p.id));
  await tx.insert(consentRecords).values({
    orgId: p.orgId,
    participantId: p.id,
    purpose: "MARKETING",
    granted: false,
    textVersion: "anonimizacao",
    textSnapshot: opts.note,
    source: opts.source,
  });
  return true;
}

export async function exportParticipantsCsv(ctx: AppContext, actor: Actor, orgId: string, f: ParticipantFilter) {
  authorize(actor, orgId, "participants.read");
  const where = whereFor(orgId, f);
  const rows = await ctx.db
    .select({
      fullName: participants.fullName,
      email: participants.email,
      phone: participants.phone,
      createdAt: participants.createdAt,
      anonymizedAt: participants.anonymizedAt,
      marketing: latestMarketing,
    })
    .from(participants)
    .where(and(where, isNull(participants.anonymizedAt)))
    .orderBy(asc(participants.fullName))
    .limit(50_000);
  await audit(ctx.db, actor, orgId, "export.participants", "organization", orgId, { filter: f, rows: rows.length });
  return toCsv(
    rows.map((r) => ({
      ...r,
      // contato somente com consentimento de marketing vigente
      email: r.marketing ? r.email : null,
      phone: r.marketing ? r.phone : null,
      marketing: r.marketing ? "Sim" : "Não",
    })),
    [
      { key: "fullName", label: "Nome" },
      { key: "email", label: "E-mail (com consentimento)" },
      { key: "phone", label: "WhatsApp (com consentimento)" },
      { key: "marketing", label: "Consentimento de marketing" },
      { key: "createdAt", label: "Primeiro cadastro" },
    ],
  );
}
