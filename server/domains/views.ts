/**
 * Montagem dos snapshots de estado (DTOs) para participante, telão e painel do palestrante.
 * São usados tanto na carga inicial/reconexão (API) quanto nos eventos em tempo real.
 */
import { and, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import type { Tx } from "../db/client";
import { eventSessions, participantAnswers, presentationStates, questions, sessionEvents, sessionParticipants, sessionQuestions } from "../db/schema";
import type {
  ActivityItemDTO,
  ControlQuestionDTO,
  ControlStateDTO,
  ParticipantStateDTO,
  PresentationDTO,
  PublicQuestionDTO,
  ScreenStateDTO,
  TimerDTO,
} from "@shared/types";
import type { ChartConfig } from "@shared/schemas";
import { elapsedMs } from "@shared/scoring";
import { getSnapshot } from "./snapshots";
import { publicSessionDTO, screenUrl, sessionQuestionList, type SessionQuestionRow, type SessionRow } from "./sessions";
import { answeredCount, computeResults, resultsPublic } from "./results";
import { controlLeaderboard, myStanding, podium, publicLeaderboard, sessionPrizes } from "./leaderboard";
import { myVote, satisfactionData } from "./satisfaction";
import { myAnswerFor } from "./answers";
import type { ParticipantAuth } from "./participants";

export type PresentationRow = typeof presentationStates.$inferSelect;

export async function presentationOf(tx: Tx, sessionId: string): Promise<PresentationRow> {
  const [p] = await tx.select().from(presentationStates).where(eq(presentationStates.sessionId, sessionId));
  return p;
}

export function presentationDTO(p: PresentationRow): PresentationDTO {
  return {
    screen: p.screen,
    sessionQuestionId: p.sessionQuestionId,
    leaderboardHidden: p.leaderboardHidden,
    leaderboardFrozen: !!p.leaderboardFrozenSnapshotId,
    showSatisfactionToScreen: p.showSatisfactionToScreen,
    version: p.version,
  };
}

export function timerDTO(sq: SessionQuestionRow, now: Date): TimerDTO {
  return {
    limitMs: sq.timeLimitMs,
    elapsedMs: Math.min(
      sq.timeLimitMs ?? Number.MAX_SAFE_INTEGER,
      elapsedMs({ limitMs: sq.timeLimitMs, accumulatedMs: sq.timerAccumulatedMs, runningSince: sq.timerRunningSince }, now),
    ),
    running: !!sq.timerRunningSince && sq.state === "ABERTA",
    serverNow: now.getTime(),
  };
}

export async function publicQuestion(tx: Tx, sq: SessionQuestionRow, total: number, now: Date): Promise<PublicQuestionDTO> {
  const snap = await getSnapshot(tx, sq.versionId);
  const [qRow] = await tx.select({ chart: questions.chart }).from(questions).where(eq(questions.id, sq.questionId));
  const revealed = !!sq.correctRevealedAt;
  return {
    sessionQuestionId: sq.id,
    position: sq.position + 1,
    total,
    type: snap.type,
    title: snap.title,
    description: snap.description,
    imageUrl: snap.imageUrl,
    options: snap.options.map((o) => ({ id: o.id, label: o.label, imageUrl: o.imageUrl, color: o.color })),
    minSelections: snap.minSelections,
    maxSelections: snap.maxSelections,
    scaleMin: snap.scaleMin,
    scaleMax: snap.scaleMax,
    scaleMinLabel: snap.scaleMinLabel,
    scaleMaxLabel: snap.scaleMaxLabel,
    scored: !!snap.scoring,
    allowEdit: snap.allowEdit,
    state: sq.state,
    timer: timerDTO(sq, now),
    resultsMode: sq.resultsMode,
    chart: (qRow?.chart ?? snap.chart) as ChartConfig,
    // gabarito nunca sai do servidor antes da revelação
    correctOptionIds: revealed && snap.scoring ? snap.options.filter((o) => o.isCorrect).map((o) => o.id) : null,
    explanation: revealed ? snap.explanation : null,
  };
}

/** Pergunta em foco: a aberta; senão a que está no telão. */
export async function focusQuestion(tx: Tx, sessionId: string, pres: PresentationRow) {
  const [open] = await tx
    .select()
    .from(sessionQuestions)
    .where(and(eq(sessionQuestions.sessionId, sessionId), eq(sessionQuestions.state, "ABERTA")))
    .limit(1);
  if (open) return open;
  if (pres.sessionQuestionId) {
    const [sq] = await tx.select().from(sessionQuestions).where(eq(sessionQuestions.id, pres.sessionQuestionId));
    if (sq && sq.state !== "PRONTA") return sq;
  }
  return null;
}

async function questionTotal(tx: Tx, sessionId: string) {
  const [r] = await tx.select({ n: count() }).from(sessionQuestions).where(eq(sessionQuestions.sessionId, sessionId));
  return Number(r.n);
}

export async function questionsDone(tx: Tx, sessionId: string) {
  const [r] = await tx
    .select({ n: count() })
    .from(sessionQuestions)
    .where(and(eq(sessionQuestions.sessionId, sessionId), isNotNull(sessionQuestions.closedAt)));
  return Number(r.n);
}

export async function registeredCount(tx: Tx, sessionId: string) {
  const [r] = await tx.select({ n: count() }).from(sessionParticipants).where(eq(sessionParticipants.sessionId, sessionId));
  return Number(r.n);
}

/* ------------------------------------------------------------------ participante */
export async function participantState(ctx: AppContext, auth: ParticipantAuth, origin?: string | null): Promise<ParticipantStateDTO> {
  const tx = ctx.db;
  // recarrega a sessão: o objeto de autenticação pode estar desatualizado
  const [session] = await tx.select().from(eventSessions).where(eq(eventSessions.id, auth.session.id));
  const pres = await presentationOf(tx, session.id);
  const now = ctx.now();
  const sq = await focusQuestion(tx, session.id, pres);
  const total = await questionTotal(tx, session.id);
  const activeQuestion = sq ? await publicQuestion(tx, sq, total, now) : null;
  let myAnswer: ParticipantStateDTO["myAnswer"] = null;
  if (sq) {
    const a = await myAnswerFor(tx, auth.sp.id, sq.id);
    if (a) {
      const visible = !!(sq.correctRevealedAt || sq.scoresPublishedAt);
      myAnswer = {
        optionIds: a.optionIds,
        value: a.answer.numericValue,
        revision: a.answer.revision,
        isCorrect: visible ? a.answer.isCorrect : null,
        points: visible ? a.answer.points : null,
      };
    }
  }
  const pub = await publicSessionDTO(tx, ctx, session, origin);
  const lb = pub.settings.showLeaderboardToParticipants ? await publicLeaderboard(tx, session, pres) : null;
  return {
    session: pub,
    me: await myStanding(tx, session, pres, auth.sp.id),
    satisfaction: await myVote(tx, auth.sp.id),
    activeQuestion,
    myAnswer,
    results: sq && resultsPublic(sq) ? await computeResults(tx, sq, { includeCorrect: false }) : null,
    leaderboard: lb,
    prizes: pub.settings.showPrizesToParticipants ? await sessionPrizes(tx, session) : [],
    podium: await podium(tx, session),
    presentation: presentationDTO(pres),
    serverNow: now.getTime(),
    v: ctx.rt.version(session.id),
  };
}

/* ------------------------------------------------------------------ telão */
export async function screenState(ctx: AppContext, session: SessionRow, origin?: string | null): Promise<ScreenStateDTO> {
  const tx = ctx.db;
  const pres = await presentationOf(tx, session.id);
  const now = ctx.now();
  const sq = await focusQuestion(tx, session.id, pres);
  const total = await questionTotal(tx, session.id);
  const registered = await registeredCount(tx, session.id);
  const sat = pres.screen === "SATISFACAO" || pres.showSatisfactionToScreen ? await satisfactionData(tx, session.id) : null;
  let closing: ScreenStateDTO["closing"] = null;
  if (pres.screen === "ENCERRAMENTO") {
    const s = await satisfactionData(tx, session.id);
    const [inter] = await tx
      .select({ n: sql<number>`count(distinct ${participantAnswers.sessionParticipantId})::int` })
      .from(participantAnswers)
      .where(eq(participantAnswers.sessionId, session.id));
    closing = {
      participants: registered,
      interacted: Number(inter.n),
      questionsDone: await questionsDone(tx, session.id),
      satisfactionPct: s.summary.positivePct,
    };
  }
  return {
    session: await publicSessionDTO(tx, ctx, session, origin),
    presentation: presentationDTO(pres),
    question: sq ? await publicQuestion(tx, sq, total, now) : null,
    results: sq && resultsPublic(sq) ? await computeResults(tx, sq, { includeCorrect: false }) : null,
    leaderboard: await publicLeaderboard(tx, session, pres),
    satisfaction: sat,
    podium: await podium(tx, session),
    prizes: await sessionPrizes(tx, session),
    counts: { registered, connected: ctx.rt.connectedCount(session.id), answered: sq ? await answeredCount(tx, sq.id) : 0 },
    closing,
    serverNow: now.getTime(),
    v: ctx.rt.version(session.id),
  };
}

/* ------------------------------------------------------------------ painel do palestrante */
const ACTIVITY_LABELS: Record<string, string> = {
  "session.lobby": "Inscrições abertas",
  "session.started": "Sessão iniciada",
  "session.paused": "Sessão pausada",
  "session.resumed": "Sessão retomada",
  "session.ended": "Sessão encerrada",
  "session.cancelled": "Sessão cancelada",
  "question.opened": "Pergunta liberada",
  "question.closed": "Pergunta encerrada",
  "question.results_shown": "Resultado exibido",
  "question.results_hidden": "Resultado ocultado",
  "question.correct_revealed": "Resposta correta revelada",
  "question.timer_paused": "Cronômetro pausado",
  "question.timer_started": "Cronômetro iniciado",
  "question.timer_extended": "Tempo adicionado",
  "presentation.changed": "Telão alterado",
  "leaderboard.frozen": "Ranking congelado",
  "leaderboard.unfrozen": "Ranking descongelado",
  "leaderboard.hidden": "Ranking ocultado",
  "leaderboard.shown": "Ranking visível",
  "prizes.revealed": "Premiação revelada",
  "participant.joined": "Novo participante",
};

export async function activityFeed(tx: Tx, sessionId: string, limit = 30): Promise<ActivityItemDTO[]> {
  const rows = await tx
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
    .orderBy(desc(sessionEvents.createdAt))
    .limit(limit);
  return rows.map((r) => {
    const p = r.payload as Record<string, unknown>;
    let label = ACTIVITY_LABELS[r.type] ?? r.type;
    if (typeof p.title === "string") label += `: ${p.title}`;
    if (typeof p.screen === "string") label += ` (${p.screen})`;
    return { id: r.id, type: r.type, label, at: r.createdAt.toISOString() };
  });
}

export async function controlState(ctx: AppContext, session: SessionRow, origin?: string | null): Promise<ControlStateDTO> {
  const tx = ctx.db;
  const pres = await presentationOf(tx, session.id);
  const now = ctx.now();
  const list = await sessionQuestionList(tx, session.id);
  const counts = new Map<string, number>();
  if (list.length) {
    const rows = await tx
      .select({ sq: participantAnswers.sessionQuestionId, n: count() })
      .from(participantAnswers)
      .where(and(eq(participantAnswers.sessionId, session.id), eq(participantAnswers.status, "ACCEPTED")))
      .groupBy(participantAnswers.sessionQuestionId);
    for (const r of rows) counts.set(r.sq, Number(r.n));
  }
  const qs: ControlQuestionDTO[] = [];
  const profileQuestions: ControlStateDTO["profileQuestions"] = [];
  for (const sq of list) {
    const pub = await publicQuestion(tx, sq, list.length, now);
    const snap = await getSnapshot(tx, sq.versionId);
    if (snap.maxSelections === 1 && ["PERFIL", "OPINIAO", "SIM_NAO"].includes(snap.type)) {
      profileQuestions.push({ sessionQuestionId: sq.id, title: snap.title });
    }
    qs.push({
      ...pub,
      questionId: sq.questionId,
      correctOptionIdsAdmin: snap.options.filter((o) => o.isCorrect).map((o) => o.id),
      answeredCount: counts.get(sq.id) ?? 0,
      scoredAt: sq.scoredAt?.toISOString() ?? null,
      scoresPublishedAt: sq.scoresPublishedAt?.toISOString() ?? null,
      correctRevealedAt: sq.correctRevealedAt?.toISOString() ?? null,
      resultsShownAt: sq.resultsShownAt?.toISOString() ?? null,
    });
  }
  const focus = await focusQuestion(tx, session.id, pres);
  const pub = await publicSessionDTO(tx, ctx, session, origin);
  return {
    session: { ...pub, eventId: session.eventId, finalizedAt: session.finalizedAt?.toISOString() ?? null, screenUrl: screenUrl(ctx, session, origin) },
    presentation: presentationDTO(pres),
    questions: qs,
    activeQuestionId: focus?.id ?? null,
    results: focus ? await computeResults(tx, focus, { includeCorrect: true }) : null,
    leaderboard: await controlLeaderboard(tx, session.id, 10),
    satisfaction: await satisfactionData(tx, session.id),
    podium: await podium(tx, session, true),
    prizes: await sessionPrizes(tx, session),
    counts: {
      registered: await registeredCount(tx, session.id),
      connected: ctx.rt.connectedCount(session.id),
      answeredCurrent: focus ? counts.get(focus.id) ?? 0 : 0,
      questionsDone: await questionsDone(tx, session.id),
    },
    activity: await activityFeed(tx, session.id),
    profileQuestions,
    serverNow: now.getTime(),
    v: ctx.rt.version(session.id),
  };
}
