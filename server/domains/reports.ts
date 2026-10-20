/**
 * Relatórios e inteligência: relatório por sessão, filtros por perfil, comparativo entre turmas
 * do mesmo treinamento e exportações (CSV/XLSX). Dados de contato só são exportados para
 * participantes com consentimento de marketing ativo.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import type { AppContext } from "../context";
import { qc, type Tx } from "../db/client";
import {
  answerOptionSelections,
  consentRecords,
  eventSessions,
  events,
  participantAnswers,
  participantCustomFields,
  participantCustomValues,
  participants,
  sessionParticipants,
  questions,
  sessionQuestions,
  users,
  wordCloudEntries,
} from "../db/schema";
import type { Actor } from "../auth/auth";
import { authorize } from "../auth/permissions";
import { loadSession } from "./sessions";
import { computeRanking } from "./leaderboard";
import { satisfactionBySession, satisfactionData } from "./satisfaction";
import { getSnapshot } from "./snapshots";
import { isSelectionCorrect, npsSummary } from "@shared/scoring";
import { audit } from "./audit";
import { notFound } from "../lib/errors";
import { wordCloudExportRows, wordCloudResults } from "./wordcloud";
import type { ChartConfig } from "@shared/schemas";
import type { WordCloudResultsDTO } from "@shared/types";

export interface ReportFilter {
  fieldKey?: string | null;
  fieldValue?: string | null;
  /** Filtra por resposta a uma pergunta de perfil (session_question + opção). */
  profileSqId?: string | null;
  profileOptionId?: string | null;
}

async function filteredParticipantIds(tx: Tx, sessionId: string, f: ReportFilter): Promise<Set<string> | null> {
  let ids: Set<string> | null = null;
  if (f.fieldKey && f.fieldValue) {
    const rows = await tx
      .select({ id: participantCustomValues.sessionParticipantId })
      .from(participantCustomValues)
      .innerJoin(participantCustomFields, eq(participantCustomFields.id, participantCustomValues.fieldId))
      .innerJoin(sessionParticipants, eq(sessionParticipants.id, participantCustomValues.sessionParticipantId))
      .where(and(eq(sessionParticipants.sessionId, sessionId), eq(participantCustomFields.key, f.fieldKey), eq(participantCustomValues.value, f.fieldValue)));
    ids = new Set(rows.map((r) => r.id));
  }
  if (f.profileSqId && f.profileOptionId) {
    const rows = await tx
      .select({ id: participantAnswers.sessionParticipantId })
      .from(participantAnswers)
      .innerJoin(answerOptionSelections, eq(answerOptionSelections.answerId, participantAnswers.id))
      .where(
        and(
          eq(participantAnswers.sessionId, sessionId),
          eq(participantAnswers.sessionQuestionId, f.profileSqId),
          eq(participantAnswers.status, "ACCEPTED"),
          eq(answerOptionSelections.optionId, f.profileOptionId),
        ),
      );
    const set = new Set(rows.map((r) => r.id));
    ids = ids ? new Set([...ids].filter((i) => set.has(i))) : set;
  }
  return ids;
}

export async function sessionReport(ctx: AppContext, actor: Actor, sessionId: string, filter: ReportFilter = {}) {
  const s = await loadSession(ctx, actor, sessionId, "reports.read");
  return buildSessionReport(ctx.db, s.id, filter);
}

export async function buildSessionReport(tx: Tx, sessionId: string, filter: ReportFilter = {}) {
  const [s] = await tx.select().from(eventSessions).where(eq(eventSessions.id, sessionId));
  if (!s) throw notFound();
  const [ev] = await tx.select().from(events).where(eq(events.id, s.eventId));
  const only = await filteredParticipantIds(tx, sessionId, filter);
  const inFilter = (spId: string) => !only || only.has(spId);

  const allSps = await tx
    .select({ id: sessionParticipants.id, displayName: sessionParticipants.displayName, score: sessionParticipants.score, correctCount: sessionParticipants.correctCount, joinedAt: sessionParticipants.joinedAt })
    .from(sessionParticipants)
    .where(eq(sessionParticipants.sessionId, sessionId));
  const sps = allSps.filter((p) => inFilter(p.id));
  const registered = sps.length;

  const answers = (
    await tx
      .select({
        id: participantAnswers.id,
        sqId: participantAnswers.sessionQuestionId,
        spId: participantAnswers.sessionParticipantId,
        rt: participantAnswers.responseTimeMs,
        value: participantAnswers.numericValue,
        isCorrect: participantAnswers.isCorrect,
      })
      .from(participantAnswers)
      .where(and(eq(participantAnswers.sessionId, sessionId), eq(participantAnswers.status, "ACCEPTED")))
  ).filter((a) => inFilter(a.spId));
  const sels = answers.length
    ? await tx
        .select()
        .from(answerOptionSelections)
        .where(inArray(answerOptionSelections.answerId, answers.map((a) => a.id)))
    : [];
  const selByAnswer = new Map<string, string[]>();
  for (const x of sels) selByAnswer.set(x.answerId, [...(selByAnswer.get(x.answerId) ?? []), x.optionId]);
  // nuvem de palavras: quem teve envio aprovado também interagiu
  const textSps = (
    await tx
      .select({ spId: wordCloudEntries.sessionParticipantId })
      .from(wordCloudEntries)
      .where(and(eq(wordCloudEntries.sessionId, sessionId), eq(wordCloudEntries.status, "APROVADA")))
  )
    .map((r) => r.spId)
    .filter(inFilter);
  const interacted = new Set([...answers.map((a) => a.spId), ...textSps]).size;

  const sqs = await tx.select().from(sessionQuestions).where(eq(sessionQuestions.sessionId, sessionId)).orderBy(asc(sessionQuestions.position));
  const questionsOut = [];
  const correctBySp = new Map<string, number>();
  for (const sq of sqs) {
    const snap = await getSnapshot(tx, sq.versionId);
    if (snap.type === "NUVEM_PALAVRAS") {
      const [qRow] = await tx.select({ chart: questions.chart }).from(questions).where(eq(questions.id, sq.questionId));
      const wc = await wordCloudResults(tx, sq, snap.wordCloud, (qRow?.chart ?? snap.chart) as ChartConfig, { only: inFilter, maxTerms: 50 });
      questionsOut.push({
        sessionQuestionId: sq.id,
        questionId: sq.questionId,
        position: sq.position + 1,
        title: snap.title,
        type: snap.type,
        category: snap.category,
        state: sq.state,
        scored: false,
        respondents: wc.totals.respondents,
        responseRatePct: registered ? (wc.totals.respondents / registered) * 100 : 0,
        avgResponseMs: null,
        categories: wc.terms.map((t) => ({ label: t.label, count: t.count, pct: t.pct, isCorrect: null })),
        accuracyPct: null,
        mean: null,
        nps: null,
        options: [],
        selectable: false,
        wordCloud: wc as WordCloudResultsDTO | null,
      });
      continue;
    }
    const qa = answers.filter((a) => a.sqId === sq.id);
    const numeric = snap.type === "ESCALA" || snap.type === "NPS";
    const respondents = qa.length;
    let categories: { label: string; count: number; pct: number; isCorrect: boolean | null }[];
    if (numeric) {
      const min = snap.scaleMin ?? 0;
      const max = snap.scaleMax ?? 10;
      categories = Array.from({ length: max - min + 1 }, (_, i) => {
        const v = min + i;
        const c = qa.filter((a) => a.value === v).length;
        return { label: String(v), count: c, pct: respondents ? (c / respondents) * 100 : 0, isCorrect: null };
      });
    } else {
      categories = snap.options.map((o) => {
        const c = qa.filter((a) => (selByAnswer.get(a.id) ?? []).includes(o.id)).length;
        return { label: o.label, count: c, pct: respondents ? (c / respondents) * 100 : 0, isCorrect: snap.scoring ? o.isCorrect : null };
      });
    }
    let accuracyPct: number | null = null;
    if (snap.scoring && respondents) {
      const correctIds = snap.options.filter((o) => o.isCorrect).map((o) => o.id);
      let ok = 0;
      for (const a of qa) {
        const correct = a.isCorrect ?? isSelectionCorrect(selByAnswer.get(a.id) ?? [], correctIds);
        if (correct) {
          ok++;
          correctBySp.set(a.spId, (correctBySp.get(a.spId) ?? 0) + 1);
        }
      }
      accuracyPct = (ok / respondents) * 100;
    }
    const values = qa.map((a) => a.value).filter((v): v is number => v !== null);
    questionsOut.push({
      sessionQuestionId: sq.id,
      questionId: sq.questionId,
      position: sq.position + 1,
      title: snap.title,
      type: snap.type,
      category: snap.category,
      state: sq.state,
      scored: !!snap.scoring,
      respondents,
      responseRatePct: registered ? (respondents / registered) * 100 : 0,
      avgResponseMs: respondents ? Math.round(qa.reduce((x, a) => x + a.rt, 0) / respondents) : null,
      categories,
      accuracyPct,
      mean: values.length ? values.reduce((x, v) => x + v, 0) / values.length : null,
      nps: snap.type === "NPS" ? npsSummary(values) : null,
      options: snap.options.map((o) => ({ id: o.id, label: o.label })),
      selectable: !numeric && snap.maxSelections === 1,
      wordCloud: null as WordCloudResultsDTO | null,
    });
  }
  const scored = questionsOut.filter((q) => q.scored);
  const ranking = (await computeRanking(tx, sessionId, false)).filter((r) => inFilter(r.id));
  const scores = ranking.map((r) => r.score);
  const maxScore = Math.max(0, ...scores);
  const minScore = Math.min(0, ...scores);
  const bucketSize = maxScore - minScore <= 0 ? 100 : Math.max(50, Math.ceil((maxScore - minScore) / 10 / 50) * 50);
  const histogram: { range: string; count: number }[] = [];
  // inclui faixas negativas (penalidades e ajustes) quando existirem
  const start = minScore < 0 ? -Math.ceil(-minScore / bucketSize) * bucketSize : 0;
  for (let b = start; b <= maxScore; b += bucketSize) {
    histogram.push({ range: `${b}–${b + bucketSize - 1}`, count: scores.filter((x) => x >= b && x < b + bucketSize).length });
  }

  // demografia: campos personalizados
  const fields = await tx.select().from(participantCustomFields).where(eq(participantCustomFields.eventId, s.eventId)).orderBy(asc(participantCustomFields.position));
  const values = await tx
    .select({ fieldId: participantCustomValues.fieldId, spId: participantCustomValues.sessionParticipantId, value: participantCustomValues.value })
    .from(participantCustomValues)
    .innerJoin(sessionParticipants, eq(sessionParticipants.id, participantCustomValues.sessionParticipantId))
    .where(eq(sessionParticipants.sessionId, sessionId));
  const demographics = fields.map((f) => {
    const counts = new Map<string, number>();
    for (const v of values) if (v.fieldId === f.id && inFilter(v.spId)) counts.set(v.value, (counts.get(v.value) ?? 0) + 1);
    return {
      key: f.key,
      label: f.label,
      values: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([value, n]) => ({ value, count: n })),
    };
  });

  const sat = await satisfactionData(tx, sessionId);
  return {
    session: { id: s.id, name: s.name, code: s.code, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, finalizedAt: s.finalizedAt },
    event: { id: ev.id, title: ev.title, speakerName: ev.speakerName },
    filter,
    totals: {
      registered,
      interacted,
      participationPct: registered ? (interacted / registered) * 100 : 0,
      questions: sqs.length,
      questionsDone: sqs.filter((q) => q.closedAt).length,
      scoredQuestions: scored.length,
      avgCorrect: registered ? [...correctBySp.values()].reduce((a, b) => a + b, 0) / registered : 0,
      avgAccuracyPct: scored.filter((q) => q.accuracyPct !== null).length
        ? scored.reduce((a, q) => a + (q.accuracyPct ?? 0), 0) / scored.filter((q) => q.accuracyPct !== null).length
        : null,
    },
    questions: questionsOut,
    hardest: [...scored].filter((q) => q.accuracyPct !== null).sort((a, b) => (a.accuracyPct ?? 0) - (b.accuracyPct ?? 0)).slice(0, 5),
    scoreHistogram: histogram,
    top10: ranking.slice(0, 10),
    ranking,
    satisfaction: sat,
    demographics,
    customFields: fields.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options })),
  };
}

/** Lista de sessões com indicadores, com filtros por evento, período e palestrante. */
export async function sessionsOverview(
  ctx: AppContext,
  actor: Actor,
  orgId: string,
  f: { eventId?: string; from?: string; to?: string; speakerUserId?: string },
) {
  authorize(actor, orgId, "reports.read");
  const conds = [eq(eventSessions.orgId, orgId)];
  if (f.eventId) conds.push(eq(eventSessions.eventId, f.eventId));
  if (f.from) conds.push(gte(eventSessions.createdAt, new Date(f.from)));
  if (f.to) conds.push(lte(eventSessions.createdAt, new Date(`${f.to}T23:59:59`)));
  if (f.speakerUserId) conds.push(eq(events.speakerUserId, f.speakerUserId));
  const rows = await ctx.db
    .select({
      id: eventSessions.id,
      name: eventSessions.name,
      code: eventSessions.code,
      status: eventSessions.status,
      startedAt: eventSessions.startedAt,
      endedAt: eventSessions.endedAt,
      createdAt: eventSessions.createdAt,
      eventId: events.id,
      eventTitle: events.title,
      speakerName: sql<string | null>`coalesce(${users.name}, ${events.speakerName})`,
      registered: sql<number>`(select count(*)::int from ${sessionParticipants} where ${sessionParticipants.sessionId} = ${qc(eventSessions.id)})`,
      interacted: sql<number>`(select count(distinct ${participantAnswers.sessionParticipantId})::int from ${participantAnswers} where ${participantAnswers.sessionId} = ${qc(eventSessions.id)} and ${participantAnswers.status} = 'ACCEPTED')`,
      answers: sql<number>`(select count(*)::int from ${participantAnswers} where ${participantAnswers.sessionId} = ${qc(eventSessions.id)} and ${participantAnswers.status} = 'ACCEPTED')`,
      accuracyPct: sql<number | null>`(select avg(case when ${participantAnswers.isCorrect} then 100.0 else 0 end)::float from ${participantAnswers} where ${participantAnswers.sessionId} = ${qc(eventSessions.id)} and ${participantAnswers.status} = 'ACCEPTED' and ${participantAnswers.isCorrect} is not null)`,
    })
    .from(eventSessions)
    .innerJoin(events, eq(events.id, eventSessions.eventId))
    .leftJoin(users, eq(users.id, events.speakerUserId))
    .where(and(...conds))
    .orderBy(desc(eventSessions.createdAt))
    .limit(500);
  const sat = await satisfactionBySession(ctx.db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, satisfaction: sat.find((x) => x.sessionId === r.id) ?? null }));
}

/** Comparativo entre turmas do mesmo treinamento (sem misturar dados entre sessões). */
export async function compareSessions(ctx: AppContext, actor: Actor, eventId: string) {
  const [ev] = await ctx.db.select().from(events).where(eq(events.id, eventId));
  if (!ev) throw notFound();
  authorize(actor, ev.orgId, "reports.read");
  const sessions = await ctx.db.select().from(eventSessions).where(eq(eventSessions.eventId, eventId)).orderBy(asc(eventSessions.createdAt));
  const reports: Awaited<ReturnType<typeof buildSessionReport>>[] = [];
  for (const s of sessions) reports.push(await buildSessionReport(ctx.db, s.id));
  const questionIds = [...new Set(reports.flatMap((r) => r.questions.map((q) => q.questionId)))];
  const byQuestion = questionIds.map((qid) => {
    const first = reports.flatMap((r) => r.questions).find((q) => q.questionId === qid)!;
    return {
      questionId: qid,
      title: first.title,
      scored: first.scored,
      type: first.type,
      perSession: reports.map((r) => {
        const q = r.questions.find((x) => x.questionId === qid);
        return {
          sessionId: r.session.id,
          responseRatePct: q?.responseRatePct ?? null,
          accuracyPct: q?.accuracyPct ?? null,
          mean: q?.mean ?? null,
          // nuvem de palavras: termos mais citados nesta turma (cada turma com os próprios dados)
          topTerms: q?.wordCloud ? q.wordCloud.terms.slice(0, 5).map((t) => ({ label: t.label, count: t.count, pct: t.pct })) : null,
        };
      }),
    };
  });
  return {
    event: { id: ev.id, title: ev.title },
    sessions: reports.map((r) => ({
      id: r.session.id,
      name: r.session.name,
      code: r.session.code,
      status: r.session.status,
      startedAt: r.session.startedAt,
      ...r.totals,
      satisfactionPct: r.satisfaction.summary.positivePct,
      satisfactionVotes: r.satisfaction.summary.total,
      topScore: r.top10[0]?.score ?? 0,
    })),
    byQuestion,
  };
}

/* ------------------------------------------------------------------ exportações */
const WORD_CLOUD_COLUMNS = [
  { header: "Nº", key: "pergunta", width: 6 },
  { header: "Pergunta", key: "enunciado", width: 44 },
  { header: "Enviado em", key: "horario", width: 24 },
  { header: "Participante", key: "participante", width: 24 },
  { header: "Texto original", key: "texto_original", width: 36 },
  { header: "Texto normalizado", key: "texto_normalizado", width: 36 },
  { header: "Termos", key: "termos", width: 36 },
  { header: "Status", key: "status", width: 12 },
  { header: "Motivo", key: "motivo", width: 22 },
  { header: "Moderado em", key: "moderado_em", width: 24 },
];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  // proteção contra injeção de fórmulas em planilhas
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rows: Record<string, unknown>[], headers: { key: string; label: string }[]): string {
  const lines = [headers.map((h) => csvCell(h.label)).join(";")];
  for (const r of rows) lines.push(headers.map((h) => csvCell(r[h.key])).join(";"));
  return "﻿" + lines.join("\r\n");
}

/** Participantes da sessão com contato apenas se houver consentimento de marketing vigente. */
async function participantsWithConsent(tx: Tx, sessionId: string) {
  const rows = await tx
    .select({
      spId: sessionParticipants.id,
      participantId: participants.id,
      displayName: sessionParticipants.displayName,
      fullName: participants.fullName,
      email: participants.email,
      phone: participants.phone,
      joinedAt: sessionParticipants.joinedAt,
      score: sessionParticipants.score,
      correctCount: sessionParticipants.correctCount,
      answeredCount: sessionParticipants.answeredCount,
      disqualifiedAt: sessionParticipants.disqualifiedAt,
      anonymizedAt: participants.anonymizedAt,
    })
    .from(sessionParticipants)
    .innerJoin(participants, eq(participants.id, sessionParticipants.participantId))
    .where(eq(sessionParticipants.sessionId, sessionId));
  const ids = rows.map((r) => r.participantId);
  const consents = ids.length
    ? await tx
        .select({ participantId: consentRecords.participantId, granted: consentRecords.granted, createdAt: consentRecords.createdAt })
        .from(consentRecords)
        .where(and(inArray(consentRecords.participantId, ids), eq(consentRecords.purpose, "MARKETING")))
        .orderBy(asc(consentRecords.createdAt))
    : [];
  const latest = new Map<string, boolean>();
  for (const c of consents) latest.set(c.participantId, c.granted);
  return rows.map((r) => {
    const marketing = latest.get(r.participantId) ?? false;
    return {
      ...r,
      marketing,
      email: marketing && !r.anonymizedAt ? r.email : null,
      phone: marketing && !r.anonymizedAt ? r.phone : null,
    };
  });
}

export async function exportSessionCsv(ctx: AppContext, actor: Actor, sessionId: string, kind: "ranking" | "respostas" | "participantes" | "nuvem") {
  const s = await loadSession(ctx, actor, sessionId, "reports.read");
  await audit(ctx.db, actor, s.orgId, "export.csv", "session", s.id, { kind });
  if (kind === "ranking") {
    const ranking = await computeRanking(ctx.db, s.id, false);
    return toCsv(ranking as unknown as Record<string, unknown>[], [
      { key: "position", label: "Posição" },
      { key: "displayName", label: "Nome no ranking" },
      { key: "score", label: "Pontos" },
      { key: "correctCount", label: "Acertos" },
      { key: "answeredCount", label: "Questões pontuadas respondidas" },
      { key: "correctTimeMs", label: "Tempo em acertos (ms)" },
    ]);
  }
  if (kind === "participantes") {
    const rows = await participantsWithConsent(ctx.db, s.id);
    return toCsv(rows.map((r) => ({ ...r, marketing: r.marketing ? "Sim" : "Não", disqualified: r.disqualifiedAt ? "Sim" : "Não" })), [
      { key: "displayName", label: "Nome no ranking" },
      { key: "fullName", label: "Nome completo" },
      { key: "email", label: "E-mail (com consentimento)" },
      { key: "phone", label: "WhatsApp (com consentimento)" },
      { key: "marketing", label: "Consentimento de marketing" },
      { key: "score", label: "Pontos" },
      { key: "correctCount", label: "Acertos" },
      { key: "joinedAt", label: "Inscrição" },
      { key: "disqualified", label: "Desclassificado" },
    ]);
  }
  if (kind === "nuvem") return toCsv(await wordCloudExportRows(ctx.db, s.id), WORD_CLOUD_COLUMNS.map((c) => ({ key: c.key, label: c.header })));
  const rows = await answersExportRows(ctx.db, s.id);
  return toCsv(rows, [
    { key: "position", label: "Nº" },
    { key: "question", label: "Pergunta" },
    { key: "displayName", label: "Participante" },
    { key: "answer", label: "Resposta" },
    { key: "isCorrect", label: "Correta" },
    { key: "points", label: "Pontos" },
    { key: "responseTimeMs", label: "Tempo de resposta (ms)" },
    { key: "receivedAt", label: "Recebida em" },
  ]);
}

async function answersExportRows(tx: Tx, sessionId: string) {
  const rows = await tx
    .select({
      id: participantAnswers.id,
      sqId: participantAnswers.sessionQuestionId,
      displayName: sessionParticipants.displayName,
      value: participantAnswers.numericValue,
      isCorrect: participantAnswers.isCorrect,
      points: participantAnswers.points,
      responseTimeMs: participantAnswers.responseTimeMs,
      receivedAt: participantAnswers.receivedAt,
    })
    .from(participantAnswers)
    .innerJoin(sessionParticipants, eq(sessionParticipants.id, participantAnswers.sessionParticipantId))
    .where(and(eq(participantAnswers.sessionId, sessionId), eq(participantAnswers.status, "ACCEPTED")))
    .orderBy(asc(participantAnswers.receivedAt));
  const sels = rows.length ? await tx.select().from(answerOptionSelections).where(inArray(answerOptionSelections.answerId, rows.map((r) => r.id))) : [];
  const sqs = await tx.select().from(sessionQuestions).where(eq(sessionQuestions.sessionId, sessionId));
  const snaps = new Map<string, Awaited<ReturnType<typeof getSnapshot>> & { position: number }>();
  for (const sq of sqs) snaps.set(sq.id, { ...(await getSnapshot(tx, sq.versionId)), position: sq.position + 1 });
  return rows
    .map((r) => {
      const snap = snaps.get(r.sqId)!;
      const chosen = sels.filter((x) => x.answerId === r.id).map((x) => x.optionId);
      return {
        position: snap.position,
        question: snap.title,
        displayName: r.displayName,
        answer: r.value !== null ? String(r.value) : snap.options.filter((o) => chosen.includes(o.id)).map((o) => o.label).join(" | "),
        isCorrect: r.isCorrect === null ? "" : r.isCorrect ? "Sim" : "Não",
        points: r.points ?? "",
        responseTimeMs: r.responseTimeMs,
        receivedAt: r.receivedAt,
      };
    })
    .sort((a, b) => a.position - b.position);
}

export async function exportSessionXlsx(ctx: AppContext, actor: Actor, sessionId: string): Promise<Buffer> {
  const s = await loadSession(ctx, actor, sessionId, "reports.read");
  await audit(ctx.db, actor, s.orgId, "export.xlsx", "session", s.id, {});
  const report = await buildSessionReport(ctx.db, s.id);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Gestalt Live";
  wb.created = new Date();
  const header = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1736" } };
  };
  const resumo = wb.addWorksheet("Resumo");
  resumo.columns = [{ header: "Indicador", key: "k", width: 42 }, { header: "Valor", key: "v", width: 30 }];
  header(resumo);
  const t = report.totals;
  resumo.addRows([
    { k: "Evento", v: report.event.title },
    { k: "Sessão", v: `${report.session.name} (${report.session.code})` },
    { k: "Inscritos", v: t.registered },
    { k: "Participantes que interagiram", v: t.interacted },
    { k: "Taxa de participação (%)", v: Number(t.participationPct.toFixed(1)) },
    { k: "Perguntas realizadas", v: `${t.questionsDone} de ${t.questions}` },
    { k: "Média de acertos por participante", v: Number(t.avgCorrect.toFixed(2)) },
    { k: "Acerto médio nas questões pontuadas (%)", v: t.avgAccuracyPct === null ? "—" : Number(t.avgAccuracyPct.toFixed(1)) },
    { k: "Satisfação — Valeu a pena (%)", v: report.satisfaction.summary.positivePct === null ? "Sem avaliações" : Number(report.satisfaction.summary.positivePct.toFixed(1)) },
    { k: "Satisfação — Insatisfeito (%)", v: report.satisfaction.summary.negativePct === null ? "Sem avaliações" : Number(report.satisfaction.summary.negativePct.toFixed(1)) },
    { k: "Avaliações registradas", v: report.satisfaction.summary.total },
  ]);
  const rk = wb.addWorksheet("Ranking");
  rk.columns = [
    { header: "Posição", key: "position", width: 10 },
    { header: "Participante", key: "displayName", width: 30 },
    { header: "Pontos", key: "score", width: 10 },
    { header: "Acertos", key: "correctCount", width: 10 },
    { header: "Pontuadas respondidas", key: "answeredCount", width: 22 },
    { header: "Tempo em acertos (s)", key: "time", width: 20 },
  ];
  header(rk);
  rk.addRows(report.ranking.map((r) => ({ ...r, time: Number((r.correctTimeMs / 1000).toFixed(2)) })));
  const qs = wb.addWorksheet("Perguntas");
  qs.columns = [
    { header: "Nº", key: "position", width: 6 },
    { header: "Pergunta", key: "title", width: 60 },
    { header: "Tipo", key: "type", width: 18 },
    { header: "Respondentes", key: "respondents", width: 14 },
    { header: "Taxa de resposta (%)", key: "rate", width: 20 },
    { header: "Acerto (%)", key: "acc", width: 12 },
    { header: "Distribuição", key: "dist", width: 80 },
  ];
  header(qs);
  qs.addRows(
    report.questions.map((q) => ({
      ...q,
      rate: Number(q.responseRatePct.toFixed(1)),
      acc: q.accuracyPct === null ? "" : Number(q.accuracyPct.toFixed(1)),
      dist: q.categories.map((c) => `${c.label}: ${c.count} (${c.pct.toFixed(0)}%)${c.isCorrect ? " ✓" : ""}`).join(" | "),
    })),
  );
  const ans = wb.addWorksheet("Respostas");
  ans.columns = [
    { header: "Nº", key: "position", width: 6 },
    { header: "Pergunta", key: "question", width: 50 },
    { header: "Participante", key: "displayName", width: 26 },
    { header: "Resposta", key: "answer", width: 40 },
    { header: "Correta", key: "isCorrect", width: 10 },
    { header: "Pontos", key: "points", width: 10 },
    { header: "Tempo (ms)", key: "responseTimeMs", width: 12 },
    { header: "Recebida em", key: "receivedAt", width: 24 },
  ];
  header(ans);
  ans.addRows(await answersExportRows(ctx.db, s.id));
  const part = wb.addWorksheet("Participantes");
  part.columns = [
    { header: "Nome no ranking", key: "displayName", width: 26 },
    { header: "Nome completo", key: "fullName", width: 32 },
    { header: "E-mail (com consentimento)", key: "email", width: 32 },
    { header: "WhatsApp (com consentimento)", key: "phone", width: 22 },
    { header: "Marketing", key: "marketing", width: 12 },
    { header: "Pontos", key: "score", width: 10 },
  ];
  header(part);
  part.addRows((await participantsWithConsent(ctx.db, s.id)).map((r) => ({ ...r, marketing: r.marketing ? "Sim" : "Não" })));
  const sat = wb.addWorksheet("Satisfação");
  sat.columns = [{ header: "Horário", key: "t", width: 26 }, { header: "Valeu a pena", key: "positive", width: 14 }, { header: "Insatisfeito", key: "negative", width: 14 }];
  header(sat);
  sat.addRows(report.satisfaction.timeline);
  const wcRows = await wordCloudExportRows(ctx.db, s.id);
  if (wcRows.length) {
    const wc = wb.addWorksheet("Nuvem de palavras");
    wc.columns = WORD_CLOUD_COLUMNS;
    header(wc);
    wc.addRows(wcRows);
    const terms = wb.addWorksheet("Termos da nuvem");
    terms.columns = [
      { header: "Nº", key: "position", width: 6 },
      { header: "Pergunta", key: "title", width: 50 },
      { header: "Termo", key: "label", width: 30 },
      { header: "Frequência", key: "count", width: 12 },
      { header: "Percentual", key: "pct", width: 12 },
      { header: "Base do percentual", key: "base", width: 30 },
    ];
    header(terms);
    for (const q of report.questions) {
      if (!q.wordCloud) continue;
      const base = q.wordCloud.denominator.kind === "TERMOS" ? `${q.wordCloud.denominator.value} termos contabilizados` : `${q.wordCloud.denominator.value} respostas aprovadas`;
      for (const t of q.wordCloud.terms) terms.addRow({ position: q.position, title: q.title, label: t.label, count: t.count, pct: `${t.pct.toFixed(1)}%`, base });
    }
  }
  const demo = wb.addWorksheet("Perfil");
  demo.columns = [{ header: "Campo", key: "field", width: 24 }, { header: "Valor", key: "value", width: 40 }, { header: "Participantes", key: "count", width: 14 }];
  header(demo);
  for (const d of report.demographics) for (const v of d.values) demo.addRow({ field: d.label, value: v.value, count: v.count });
  return Buffer.from(await wb.xlsx.writeBuffer());
}


