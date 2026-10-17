/**
 * Controle ao vivo (palestrante): máquina de estados da sessão e das perguntas, cronômetro
 * autoritativo, exibição de resultados, revelação de gabarito, ranking, telão e premiação.
 *
 * Sessão:   RASCUNHO/AGENDADA → AGUARDANDO → AO_VIVO ⇄ PAUSADA → ENCERRADA  (ou CANCELADA)
 * Pergunta: PRONTA → ABERTA → FECHADA → RESULTADO_EXIBIDO
 *
 * Toda ação roda numa transação que trava a linha da sessão (FOR UPDATE), serializando comandos
 * concorrentes de várias janelas de controle. Os eventos em tempo real são emitidos após o commit.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import type { Tx } from "../db/client";
import { eventSessions, presentationStates, sessionEvents, sessionQuestions } from "../db/schema";
import type { Actor } from "../auth/auth";
import { AppError, badRequest, conflict, notFound } from "../lib/errors";
import { elapsedMs } from "@shared/scoring";
import { RT } from "@shared/types";
import type { PresentationScreen } from "@shared/schemas";
import { audit, logSessionEvent } from "./audit";
import { loadSession, syncSessionQuestions, sessionQuestionList, type SessionQuestionRow, type SessionRow } from "./sessions";
import { scoreQuestion, publishPendingScores, publishScores } from "./scoring";
import { createSnapshot, finalizeLeaderboard, invalidateRanking } from "./leaderboard";
import { getSnapshot } from "./snapshots";
import { presentationOf, publicQuestion, timerDTO, presentationDTO, type PresentationRow } from "./views";

type Effect = () => void | Promise<void>;

interface LiveCtx {
  tx: Tx;
  session: SessionRow;
  now: Date;
  actor: Actor | null;
  effects: Effect[];
  scoresChanged: boolean;
  resultsChanged: Set<string>;
  presentationChanged: boolean;
}

const notLive = () => new AppError(409, "SESSAO_NAO_AO_VIVO", "Inicie a sessão para liberar perguntas.");

async function withLive<T>(ctx: AppContext, actor: Actor | null, sessionId: string, fn: (l: LiveCtx) => Promise<T>): Promise<T> {
  if (actor) await loadSession(ctx, actor, sessionId, "session.control");
  const lc: LiveCtx = {
    tx: null as unknown as Tx,
    session: null as unknown as SessionRow,
    now: ctx.now(),
    actor,
    effects: [],
    scoresChanged: false,
    resultsChanged: new Set(),
    presentationChanged: false,
  };
  const result = await ctx.db.transaction(async (tx) => {
    const [s] = await tx.select().from(eventSessions).where(eq(eventSessions.id, sessionId)).for("update");
    if (!s) throw notFound("Sessão não encontrada.");
    lc.tx = tx;
    lc.session = s;
    return fn(lc);
  });
  // efeitos após o commit
  if (lc.scoresChanged) {
    invalidateRanking(sessionId);
    ctx.rt.leaderboardDirty(sessionId, true);
  }
  for (const sqId of lc.resultsChanged) ctx.rt.resultsDirty(sessionId, sqId);
  for (const e of lc.effects) await e();
  if (lc.presentationChanged) await ctx.rt.presentationChanged(sessionId);
  ctx.rt.controlResync(sessionId);
  return result;
}

async function log(l: LiveCtx, type: string, payload: Record<string, unknown> = {}) {
  await logSessionEvent(l.tx, l.session.orgId, l.session.id, type, payload, l.actor?.user.id ?? null);
}

async function setPresentation(l: LiveCtx, patch: Partial<Pick<PresentationRow, "screen" | "sessionQuestionId" | "leaderboardHidden" | "leaderboardFrozenSnapshotId" | "showSatisfactionToScreen">>) {
  const cur = await presentationOf(l.tx, l.session.id);
  const next = { ...cur, ...patch };
  const same =
    next.screen === cur.screen &&
    next.sessionQuestionId === cur.sessionQuestionId &&
    next.leaderboardHidden === cur.leaderboardHidden &&
    next.leaderboardFrozenSnapshotId === cur.leaderboardFrozenSnapshotId &&
    next.showSatisfactionToScreen === cur.showSatisfactionToScreen;
  if (same) return cur;
  const [updated] = await l.tx
    .update(presentationStates)
    .set({ ...patch, version: cur.version + 1, updatedAt: l.now })
    .where(eq(presentationStates.sessionId, l.session.id))
    .returning();
  if (patch.screen !== undefined || patch.sessionQuestionId !== undefined) {
    await log(l, "presentation.changed", {
      screen: updated.screen,
      from: { screen: cur.screen, sessionQuestionId: cur.sessionQuestionId },
      to: { screen: updated.screen, sessionQuestionId: updated.sessionQuestionId },
    });
  }
  l.presentationChanged = true;
  return updated;
}

async function lockQuestion(l: LiveCtx, sqId: string) {
  const [sq] = await l.tx.select().from(sessionQuestions).where(eq(sessionQuestions.id, sqId)).for("update");
  if (!sq || sq.sessionId !== l.session.id) throw notFound("Pergunta não encontrada nesta sessão.");
  return sq;
}

async function openQuestionRow(l: LiveCtx) {
  const [sq] = await l.tx
    .select()
    .from(sessionQuestions)
    .where(and(eq(sessionQuestions.sessionId, l.session.id), eq(sessionQuestions.state, "ABERTA")))
    .for("update");
  return sq ?? null;
}

async function total(l: LiveCtx) {
  return (await sessionQuestionList(l.tx, l.session.id)).length;
}

/* ================================================================== sessão */
export async function sessionAction(
  ctx: AppContext,
  actor: Actor,
  sessionId: string,
  action: "lobby" | "start" | "pause" | "resume" | "end" | "cancel",
) {
  return withLive(ctx, actor, sessionId, async (l) => {
    const s = l.session;
    const set = async (values: Partial<SessionRow>) => {
      const [u] = await l.tx.update(eventSessions).set({ ...values, updatedAt: l.now }).where(eq(eventSessions.id, s.id)).returning();
      l.session = u;
    };
    switch (action) {
      case "lobby":
        if (!["RASCUNHO", "AGENDADA"].includes(s.status)) throw conflict("A sala de espera só pode ser aberta antes do início.");
        await syncSessionQuestions(l.tx, s);
        await set({ status: "AGUARDANDO" });
        await log(l, "session.lobby");
        l.effects.push(() => ctx.rt.broadcast(s.id, RT.resync, { reason: "status" }));
        break;
      case "start":
        if (!["RASCUNHO", "AGENDADA", "AGUARDANDO"].includes(s.status)) throw conflict("A sessão já foi iniciada ou encerrada.");
        await syncSessionQuestions(l.tx, s);
        await set({ status: "AO_VIVO", startedAt: s.startedAt ?? l.now });
        await log(l, "session.started");
        l.effects.push(() => ctx.rt.broadcast(s.id, RT.sessionStarted, { status: "AO_VIVO" }));
        break;
      case "pause": {
        if (s.status !== "AO_VIVO") throw conflict("Apenas sessões ao vivo podem ser pausadas.");
        const open = await openQuestionRow(l);
        let timerWasRunning = false;
        if (open?.timerRunningSince) {
          timerWasRunning = true;
          await stopTimer(l, open);
        }
        await set({ status: "PAUSADA", pausedAt: l.now });
        await log(l, "session.paused", { timerWasRunning, sessionQuestionId: open?.id ?? null });
        l.effects.push(() => ctx.rt.broadcast(s.id, RT.sessionPaused, { status: "PAUSADA" }));
        break;
      }
      case "resume": {
        if (s.status !== "PAUSADA") throw conflict("A sessão não está pausada.");
        await set({ status: "AO_VIVO", pausedAt: null });
        const [lastPause] = await l.tx
          .select()
          .from(sessionEvents)
          .where(and(eq(sessionEvents.sessionId, s.id), eq(sessionEvents.type, "session.paused")))
          .orderBy(desc(sessionEvents.createdAt))
          .limit(1);
        const p = (lastPause?.payload ?? {}) as { timerWasRunning?: boolean; sessionQuestionId?: string };
        const open = await openQuestionRow(l);
        if (open && p.timerWasRunning && p.sessionQuestionId === open.id) await startTimer(l, open, ctx);
        await log(l, "session.resumed");
        l.effects.push(() => ctx.rt.broadcast(s.id, RT.sessionResumed, { status: "AO_VIVO" }));
        break;
      }
      case "end": {
        if (!["AO_VIVO", "PAUSADA", "AGUARDANDO"].includes(s.status)) throw conflict("A sessão não está em andamento.");
        const open = await openQuestionRow(l);
        if (open) await closeInternal(l, open, ctx);
        const published = await publishPendingScores(l.tx, s.id, l.now);
        if (published.length) {
          await createSnapshot(l.tx, s, "PUBLICACAO", { sessionQuestionId: published[published.length - 1] });
          l.scoresChanged = true;
        }
        await set({ status: "ENCERRADA", endedAt: l.now, pausedAt: null });
        invalidateRanking(s.id);
        await finalizeLeaderboard(l.tx, l.session, l.now, l.actor);
        const [fresh] = await l.tx.select().from(eventSessions).where(eq(eventSessions.id, s.id));
        l.session = fresh;
        await log(l, "session.ended");
        await log(l, "prizes.revealed");
        await setPresentation(l, { screen: "PREMIACAO", leaderboardFrozenSnapshotId: null, leaderboardHidden: false });
        if (l.actor) await audit(l.tx, l.actor, s.orgId, "session.end", "session", s.id, {});
        l.scoresChanged = true;
        l.effects.push(async () => {
          ctx.rt.broadcast(s.id, RT.sessionEnded, { status: "ENCERRADA" });
          await ctx.rt.prizesRevealed(s.id);
        });
        break;
      }
      case "cancel":
        if (["ENCERRADA", "CANCELADA"].includes(s.status)) throw conflict("A sessão já foi finalizada.");
        {
          const open = await openQuestionRow(l);
          if (open) await closeInternal(l, open, ctx);
        }
        await set({ status: "CANCELADA", endedAt: l.now });
        await log(l, "session.cancelled");
        if (l.actor) await audit(l.tx, l.actor, s.orgId, "session.cancel", "session", s.id, {});
        l.effects.push(() => ctx.rt.broadcast(s.id, RT.sessionEnded, { status: "CANCELADA" }));
        break;
    }
    return { status: l.session.status };
  });
}

/* ================================================================== cronômetro */
async function stopTimer(l: LiveCtx, sq: SessionQuestionRow) {
  if (!sq.timerRunningSince) return sq;
  const acc = elapsedMs({ limitMs: sq.timeLimitMs, accumulatedMs: sq.timerAccumulatedMs, runningSince: sq.timerRunningSince }, l.now);
  const capped = sq.timeLimitMs !== null ? Math.min(acc, sq.timeLimitMs) : acc;
  const [u] = await l.tx
    .update(sessionQuestions)
    .set({ timerAccumulatedMs: Math.round(capped), timerRunningSince: null, updatedAt: l.now })
    .where(eq(sessionQuestions.id, sq.id))
    .returning();
  return u;
}

async function startTimer(l: LiveCtx, sq: SessionQuestionRow, ctx: AppContext) {
  if (sq.timerRunningSince) return sq;
  if (sq.timeLimitMs !== null && sq.timerAccumulatedMs >= sq.timeLimitMs) throw conflict("O tempo já se esgotou. Adicione mais tempo ou encerre a pergunta.");
  const [u] = await l.tx.update(sessionQuestions).set({ timerRunningSince: l.now, updatedAt: l.now }).where(eq(sessionQuestions.id, sq.id)).returning();
  emitTimer(l, u, ctx);
  return u;
}

function emitTimer(l: LiveCtx, sq: SessionQuestionRow, ctx: AppContext) {
  const dto = { sessionQuestionId: sq.id, state: sq.state, timer: timerDTO(sq, l.now) };
  l.effects.push(() => ctx.rt.broadcast(l.session.id, RT.questionTimerUpdated, dto));
}

export async function timerAction(ctx: AppContext, actor: Actor, sessionId: string, sqId: string, action: "pause" | "start" | "add", seconds = 15) {
  return withLive(ctx, actor, sessionId, async (l) => {
    let sq = await lockQuestion(l, sqId);
    if (sq.state !== "ABERTA") throw conflict("O cronômetro só pode ser controlado com a pergunta aberta.");
    if (action === "pause") {
      sq = await stopTimer(l, sq);
      await log(l, "question.timer_paused");
      emitTimer(l, sq, ctx);
    } else if (action === "start") {
      if (l.session.status !== "AO_VIVO") throw notLive();
      sq = await startTimer(l, sq, ctx);
      await log(l, "question.timer_started");
    } else {
      if (!Number.isInteger(seconds) || seconds < 5 || seconds > 600) throw badRequest("Informe entre 5 e 600 segundos.");
      const elapsed = elapsedMs({ limitMs: sq.timeLimitMs, accumulatedMs: sq.timerAccumulatedMs, runningSince: sq.timerRunningSince }, l.now);
      const base = sq.timeLimitMs === null ? elapsed : Math.max(sq.timeLimitMs, elapsed);
      [sq] = await l.tx
        .update(sessionQuestions)
        .set({ timeLimitMs: Math.round(base + seconds * 1000), updatedAt: l.now })
        .where(eq(sessionQuestions.id, sq.id))
        .returning();
      await log(l, "question.timer_extended", { seconds });
      emitTimer(l, sq, ctx);
    }
    return { timer: timerDTO(sq, l.now) };
  });
}

/* ================================================================== perguntas */
async function closeInternal(l: LiveCtx, sq: SessionQuestionRow, ctx: AppContext) {
  sq = await stopTimer(l, sq);
  const autoShow = sq.resultsMode === "APOS_ENCERRAMENTO" && !sq.resultsShownAt;
  const [closed] = await l.tx
    .update(sessionQuestions)
    .set({ state: "FECHADA", closedAt: l.now, updatedAt: l.now, ...(autoShow && { resultsShownAt: l.now }) })
    .where(eq(sessionQuestions.id, sq.id))
    .returning();
  await scoreQuestion(l.tx, closed, l.now);
  const snap = await getSnapshot(l.tx, closed.versionId);
  await log(l, "question.closed", { title: snap.title, sessionQuestionId: closed.id });
  if (autoShow) await setPresentation(l, { screen: "RESULTADO", sessionQuestionId: closed.id });
  l.resultsChanged.add(closed.id);
  const dto = { sessionQuestionId: closed.id, state: "FECHADA", timer: timerDTO(closed, l.now) };
  l.effects.push(() => ctx.rt.broadcast(l.session.id, RT.questionClosed, dto));
  return closed;
}

export async function openQuestion(ctx: AppContext, actor: Actor, sessionId: string, sqId: string) {
  return withLive(ctx, actor, sessionId, (l) => openInternal(l, sqId, ctx));
}

async function openInternal(l: LiveCtx, sqId: string, ctx: AppContext) {
  if (l.session.status !== "AO_VIVO") throw notLive();
  const sq = await lockQuestion(l, sqId);
  if (sq.state !== "PRONTA") throw conflict("Esta pergunta já foi liberada nesta sessão.");
  const open = await openQuestionRow(l);
  if (open) await closeInternal(l, open, ctx);
  // pontuações pendentes das perguntas anteriores são publicadas ao avançar
  const published = await publishPendingScores(l.tx, l.session.id, l.now);
  if (published.length) {
    await createSnapshot(l.tx, l.session, "PUBLICACAO", { sessionQuestionId: published[published.length - 1] });
    l.scoresChanged = true;
  }
  const [opened] = await l.tx
    .update(sessionQuestions)
    .set({
      state: "ABERTA",
      openedAt: l.now,
      openCount: sq.openCount + 1,
      timerAccumulatedMs: 0,
      timerRunningSince: l.now,
      resultsShownAt: sq.resultsMode === "AO_VIVO" ? l.now : null,
      updatedAt: l.now,
    })
    .where(eq(sessionQuestions.id, sq.id))
    .returning();
  const snap = await getSnapshot(l.tx, opened.versionId);
  await log(l, "question.opened", { title: snap.title, sessionQuestionId: opened.id });
  await setPresentation(l, { screen: "PERGUNTA", sessionQuestionId: opened.id });
  const dto = await publicQuestion(l.tx, opened, await total(l), l.now);
  l.effects.push(() => ctx.rt.broadcast(l.session.id, RT.questionOpened, dto));
  l.resultsChanged.add(opened.id);
  return { sessionQuestionId: opened.id };
}

export async function closeQuestion(ctx: AppContext, actor: Actor | null, sessionId: string, sqId: string) {
  return withLive(ctx, actor, sessionId, async (l) => {
    const sq = await lockQuestion(l, sqId);
    if (sq.state !== "ABERTA") {
      if (!actor) return { closed: false }; // fechamento automático concorrente: ignora
      throw conflict("Esta pergunta não está aberta.");
    }
    await closeInternal(l, sq, ctx);
    return { closed: true };
  });
}

export async function nextQuestion(ctx: AppContext, actor: Actor, sessionId: string) {
  return withLive(ctx, actor, sessionId, async (l) => {
    const list = await sessionQuestionList(l.tx, l.session.id);
    const pres = await presentationOf(l.tx, l.session.id);
    const currentPos = list.find((q) => q.id === pres.sessionQuestionId)?.position ?? -1;
    const next = list.find((q) => q.state === "PRONTA" && q.position > currentPos) ?? list.find((q) => q.state === "PRONTA");
    if (!next) throw conflict("Não há mais perguntas para liberar.", "SEM_PERGUNTAS");
    return openInternal(l, next.id, ctx);
  });
}

export async function resultsAction(ctx: AppContext, actor: Actor, sessionId: string, sqId: string, action: "show" | "hide") {
  return withLive(ctx, actor, sessionId, async (l) => {
    const sq = await lockQuestion(l, sqId);
    if (sq.state === "PRONTA") throw conflict("A pergunta ainda não foi liberada.");
    if (action === "show") {
      await l.tx
        .update(sessionQuestions)
        .set({ resultsShownAt: l.now, state: sq.state === "FECHADA" ? "RESULTADO_EXIBIDO" : sq.state, updatedAt: l.now })
        .where(eq(sessionQuestions.id, sq.id));
      await log(l, "question.results_shown");
      await setPresentation(l, { screen: "RESULTADO", sessionQuestionId: sq.id });
    } else {
      await l.tx.update(sessionQuestions).set({ resultsShownAt: null, updatedAt: l.now }).where(eq(sessionQuestions.id, sq.id));
      await log(l, "question.results_hidden");
      await setPresentation(l, { screen: "PERGUNTA", sessionQuestionId: sq.id });
    }
    l.resultsChanged.add(sq.id);
    l.effects.push(() => ctx.rt.broadcast(l.session.id, RT.resync, { reason: "results_visibility" }, ["participants"]));
    return { ok: true };
  });
}

/** Revela a alternativa correta (somente após o encerramento) e publica a pontuação. */
export async function revealCorrect(ctx: AppContext, actor: Actor, sessionId: string, sqId: string) {
  return withLive(ctx, actor, sessionId, async (l) => {
    let sq = await lockQuestion(l, sqId);
    const snap = await getSnapshot(l.tx, sq.versionId);
    if (!snap.scoring) throw badRequest("Esta pergunta não possui resposta correta.");
    if (sq.state === "PRONTA" || sq.state === "ABERTA") throw conflict("Encerre a pergunta antes de revelar a resposta correta.");
    if (!sq.correctRevealedAt) {
      [sq] = await l.tx
        .update(sessionQuestions)
        .set({ correctRevealedAt: l.now, resultsShownAt: sq.resultsShownAt ?? l.now, state: "RESULTADO_EXIBIDO", updatedAt: l.now })
        .where(eq(sessionQuestions.id, sq.id))
        .returning();
      if (!sq.scoredAt) await scoreQuestion(l.tx, sq, l.now);
      const [fresh] = await l.tx.select().from(sessionQuestions).where(eq(sessionQuestions.id, sq.id));
      if (await publishScores(l.tx, fresh, l.now)) {
        await createSnapshot(l.tx, l.session, "PUBLICACAO", { sessionQuestionId: sq.id });
        l.scoresChanged = true;
      }
      await log(l, "question.correct_revealed", { title: snap.title });
    }
    await setPresentation(l, { screen: "RESULTADO", sessionQuestionId: sq.id });
    l.resultsChanged.add(sq.id);
    const payload = {
      sessionQuestionId: sq.id,
      correctOptionIds: snap.options.filter((o) => o.isCorrect).map((o) => o.id),
      explanation: snap.explanation,
    };
    l.effects.push(() => ctx.rt.broadcast(l.session.id, RT.questionResultRevealed, payload));
    return payload;
  });
}

/* ================================================================== telão / apresentação */
export async function presentationAction(
  ctx: AppContext,
  actor: Actor,
  sessionId: string,
  input: { screen?: PresentationScreen; sessionQuestionId?: string | null; back?: boolean; showSatisfactionToScreen?: boolean },
) {
  return withLive(ctx, actor, sessionId, async (l) => {
    if (input.back) {
      const [last] = await l.tx
        .select()
        .from(sessionEvents)
        .where(and(eq(sessionEvents.sessionId, l.session.id), eq(sessionEvents.type, "presentation.changed")))
        .orderBy(desc(sessionEvents.createdAt))
        .limit(1);
      const from = (last?.payload as { from?: { screen: PresentationScreen; sessionQuestionId: string | null } })?.from;
      if (!from) throw conflict("Não há visualização anterior.");
      await setPresentation(l, { screen: from.screen, sessionQuestionId: from.sessionQuestionId });
      return presentationDTO(await presentationOf(l.tx, l.session.id));
    }
    if (input.showSatisfactionToScreen !== undefined) {
      await setPresentation(l, { showSatisfactionToScreen: input.showSatisfactionToScreen });
    }
    if (input.screen) {
      const patch: Parameters<typeof setPresentation>[1] = { screen: input.screen };
      if (input.screen === "PERGUNTA" || input.screen === "RESULTADO") {
        const pres = await presentationOf(l.tx, l.session.id);
        const target = input.sessionQuestionId ?? pres.sessionQuestionId;
        if (!target) throw badRequest("Selecione uma pergunta.");
        const sq = await lockQuestion(l, target);
        if (sq.state === "PRONTA") throw conflict("Libere a pergunta antes de exibi-la no telão.");
        patch.sessionQuestionId = sq.id;
      }
      if (input.screen === "RANKING") {
        const published = await publishPendingScores(l.tx, l.session.id, l.now);
        if (published.length) {
          await createSnapshot(l.tx, l.session, "PUBLICACAO", { sessionQuestionId: published[published.length - 1] });
          l.scoresChanged = true;
        }
      }
      if (input.screen === "PREMIACAO") {
        const already = await l.tx
          .select({ id: sessionEvents.id })
          .from(sessionEvents)
          .where(and(eq(sessionEvents.sessionId, l.session.id), eq(sessionEvents.type, "prizes.revealed")))
          .limit(1);
        if (!already.length) {
          await log(l, "prizes.revealed");
          l.effects.push(() => ctx.rt.prizesRevealed(l.session.id));
        }
      }
      await setPresentation(l, patch);
    }
    return presentationDTO(await presentationOf(l.tx, l.session.id));
  });
}

/** Ocultar/congelar o ranking. Congelar afeta apenas a exibição — o cálculo oficial continua. */
export async function leaderboardAction(ctx: AppContext, actor: Actor, sessionId: string, input: { hidden?: boolean; frozen?: boolean }) {
  return withLive(ctx, actor, sessionId, async (l) => {
    const pres = await presentationOf(l.tx, l.session.id);
    if (input.frozen !== undefined) {
      if (input.frozen && !pres.leaderboardFrozenSnapshotId) {
        const snap = await createSnapshot(l.tx, l.session, "CONGELADO", { actorId: actor.user.id });
        await setPresentation(l, { leaderboardFrozenSnapshotId: snap.id });
        await log(l, "leaderboard.frozen");
      } else if (!input.frozen && pres.leaderboardFrozenSnapshotId) {
        // ao revelar, publica o estado mais recente e consistente
        const published = await publishPendingScores(l.tx, l.session.id, l.now);
        if (published.length) await createSnapshot(l.tx, l.session, "PUBLICACAO", { sessionQuestionId: published[published.length - 1] });
        await setPresentation(l, { leaderboardFrozenSnapshotId: null });
        await log(l, "leaderboard.unfrozen");
      }
    }
    if (input.hidden !== undefined && input.hidden !== pres.leaderboardHidden) {
      await setPresentation(l, { leaderboardHidden: input.hidden });
      await log(l, input.hidden ? "leaderboard.hidden" : "leaderboard.shown");
    }
    l.scoresChanged = true;
    return presentationDTO(await presentationOf(l.tx, l.session.id));
  });
}

/* ================================================================== fechamento automático */
/** Fecha perguntas cujo cronômetro esgotou (executado pelo agendador). */
export async function closeExpiredQuestions(ctx: AppContext) {
  const now = ctx.now();
  const rows = await ctx.db
    .select({
      id: sessionQuestions.id,
      sessionId: sessionQuestions.sessionId,
      limit: sessionQuestions.timeLimitMs,
      acc: sessionQuestions.timerAccumulatedMs,
      since: sessionQuestions.timerRunningSince,
      settings: eventSessions.settings,
    })
    .from(sessionQuestions)
    .innerJoin(eventSessions, eq(eventSessions.id, sessionQuestions.sessionId))
    .where(and(eq(sessionQuestions.state, "ABERTA"), sql`${sessionQuestions.timeLimitMs} is not null`, sql`${sessionQuestions.timerRunningSince} is not null`))
    .orderBy(asc(sessionQuestions.openedAt));
  let closed = 0;
  for (const r of rows) {
    if (elapsedMs({ limitMs: r.limit, accumulatedMs: r.acc, runningSince: r.since }, now) < (r.limit ?? Infinity)) continue;
    const autoClose = (r.settings as { autoCloseOnTimer?: boolean }).autoCloseOnTimer !== false;
    try {
      if (autoClose) {
        const res = await closeQuestion(ctx, null, r.sessionId, r.id);
        if (res.closed) closed++;
      } else {
        // sem fechamento automático: apenas para o cronômetro (novas respostas já são recusadas pelo prazo)
        await withLive(ctx, null, r.sessionId, async (l) => {
          const sq = await lockQuestion(l, r.id);
          if (sq.state === "ABERTA" && sq.timerRunningSince) emitTimer(l, await stopTimer(l, sq), ctx);
        });
      }
    } catch {
      // concorrência com ação manual: a próxima varredura reavalia
    }
  }
  return closed;
}
