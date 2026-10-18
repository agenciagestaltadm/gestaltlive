/**
 * Modo apresentador: navegação pela linha do tempo e orquestração da engine ao vivo.
 *
 * Princípios:
 * - Item no telão ≠ pergunta aberta. Mudar de item NÃO encerra pergunta aberta, exceto se o item
 *   estiver configurado com "fechar ao sair".
 * - Comandos são idempotentes: "próximo/anterior" só têm efeito se o item atual for o informado em
 *   `fromItemId` (duplo clique do passador ou duas janelas de controle não avançam duas vezes).
 * - Ações irreversíveis respeitam a configuração do item (abrir automático × manual).
 * - Tudo roda em withLive (trava da sessão + eventos após o commit), reaproveitando live.ts.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import { eventSessions, presentationItems, presentationSessionStates, presentationStateHistory, sessionEvents, sessionQuestions } from "../db/schema";
import type { Actor } from "../auth/auth";
import { badRequest, conflict } from "../lib/errors";
import { RT } from "@shared/types";
import { itemSettingsSchema, OPENS_QUESTION, screenForItem, stepIndex, firstVisible, type PresentationItemType } from "@shared/presentations";
import { closeInternal, log, onQuestionClosed, openInternal, setPresentation, withLive, type LiveCtx } from "./live";
import { syncSessionQuestions, type SessionQuestionRow } from "./sessions";
import { publishPendingScores } from "./scoring";
import { createSnapshot } from "./leaderboard";
import { presenterRow, presenterStateDTO } from "./presenter-view";

type ItemRow = typeof presentationItems.$inferSelect;

export type PresenterCommand =
  | { action: "start" }
  | { action: "next" | "prev"; fromItemId?: string | null }
  | { action: "goto"; toItemId: string }
  | { action: "override"; override: "NENHUM" | "TELA_PRETA" | "PAUSA" }
  | { action: "finish" };

async function items(l: LiveCtx, presentationId: string) {
  return l.tx.select().from(presentationItems).where(eq(presentationItems.presentationId, presentationId)).orderBy(asc(presentationItems.position));
}

async function sqForQuestion(l: LiveCtx, questionId: string): Promise<SessionQuestionRow | null> {
  const find = async () => {
    const [sq] = await l.tx
      .select()
      .from(sessionQuestions)
      .where(and(eq(sessionQuestions.sessionId, l.session.id), eq(sessionQuestions.questionId, questionId)))
      .for("update");
    return sq ?? null;
  };
  let sq = await find();
  if (!sq) {
    // pergunta adicionada ao evento depois da criação da sessão: sincroniza (só afeta perguntas não abertas)
    await syncSessionQuestions(l.tx, l.session);
    sq = await find();
  }
  return sq;
}

/** Aplica o item no telão usando as ações existentes da engine. */
async function applyItem(l: LiveCtx, item: ItemRow, ctx: AppContext) {
  const s = itemSettingsSchema.parse(item.settings ?? {});
  const type = item.type as PresentationItemType;
  const screen = screenForItem(type);
  switch (type) {
    case "IMAGE_SLIDE":
    case "CUSTOM_SCREEN":
    case "QR_CODE":
    case "SATISFACTION":
      await setPresentation(l, { screen, sessionQuestionId: null });
      return;
    case "LEADERBOARD": {
      const published = await publishPendingScores(l.tx, l.session.id, l.now);
      if (published.length) {
        await createSnapshot(l.tx, l.session, "PUBLICACAO", { sessionQuestionId: published[published.length - 1] });
        l.scoresChanged = true;
      }
      await setPresentation(l, { screen, sessionQuestionId: null });
      return;
    }
    case "AWARDS": {
      const already = await l.tx
        .select({ id: sessionEvents.id })
        .from(sessionEvents)
        .where(and(eq(sessionEvents.sessionId, l.session.id), eq(sessionEvents.type, "prizes.revealed")))
        .limit(1);
      if (!already.length) {
        await log(l, "prizes.revealed");
        l.effects.push(() => ctx.rt.prizesRevealed(l.session.id));
      }
      await setPresentation(l, { screen, sessionQuestionId: null });
      return;
    }
    case "QUESTION":
    case "POLL":
    case "QUIZ":
    case "CHART": {
      const sq = item.questionId ? await sqForQuestion(l, item.questionId) : null;
      if (!sq) {
        // pergunta em rascunho/removida: telão mostra "aguardando" sem quebrar a apresentação
        await setPresentation(l, { screen, sessionQuestionId: null });
        return;
      }
      if (OPENS_QUESTION.includes(type)) {
        if (s.autoCloseOnTimer !== null && sq.autoClose !== s.autoCloseOnTimer) {
          await l.tx.update(sessionQuestions).set({ autoClose: s.autoCloseOnTimer }).where(eq(sessionQuestions.id, sq.id));
        }
        await setPresentation(l, { screen, sessionQuestionId: sq.id });
        // ação irreversível apenas se configurada (e com a sessão ao vivo)
        if (s.openMode === "AUTOMATICO" && sq.state === "PRONTA" && l.session.status === "AO_VIVO") await openInternal(l, sq.id, ctx);
        return;
      }
      // CHART: exibe resultados da pergunta, se já liberada
      if (sq.state !== "PRONTA" && !sq.resultsShownAt) {
        await l.tx
          .update(sessionQuestions)
          .set({ resultsShownAt: l.now, state: sq.state === "FECHADA" ? "RESULTADO_EXIBIDO" : sq.state, updatedAt: l.now })
          .where(eq(sessionQuestions.id, sq.id));
        l.resultsChanged.add(sq.id);
        l.effects.push(() => ctx.rt.broadcast(l.session.id, RT.resync, { reason: "results_visibility" }, ["participants"]));
      }
      await setPresentation(l, { screen, sessionQuestionId: sq.id });
      return;
    }
  }
}

/** Ao sair de um item de pergunta configurado para "fechar ao sair". */
async function leaveItem(l: LiveCtx, item: ItemRow | undefined, ctx: AppContext) {
  if (!item || !OPENS_QUESTION.includes(item.type as PresentationItemType) || !item.questionId) return;
  const s = itemSettingsSchema.parse(item.settings ?? {});
  if (!s.closeOnLeave) return;
  const [sq] = await l.tx
    .select()
    .from(sessionQuestions)
    .where(and(eq(sessionQuestions.sessionId, l.session.id), eq(sessionQuestions.questionId, item.questionId)))
    .for("update");
  if (sq?.state === "ABERTA") await closeInternal(l, sq, ctx, "substituida");
}

async function moveTo(l: LiveCtx, st: typeof presentationSessionStates.$inferSelect, list: ItemRow[], index: number, action: string, ctx: AppContext) {
  const prev = list.find((i) => i.id === st.currentItemId);
  const target = list[index];
  if (prev && prev.id !== target.id) await leaveItem(l, prev, ctx);
  const [u] = await l.tx
    .update(presentationSessionStates)
    .set({ currentItemId: target.id, currentIndex: index, itemEnteredAt: l.now, override: "NENHUM", status: "APRESENTANDO", version: st.version + 1, updatedAt: l.now })
    .where(eq(presentationSessionStates.sessionId, l.session.id))
    .returning();
  await l.tx.insert(presentationStateHistory).values({
    orgId: l.session.orgId,
    sessionId: l.session.id,
    action,
    itemId: target.id,
    index,
    version: u.version,
    actorUserId: l.actor?.user.id ?? null,
  });
  await applyItem(l, target, ctx);
  emitPresenter(l, ctx, u);
  return u;
}

function emitPresenter(l: LiveCtx, ctx: AppContext, st: typeof presentationSessionStates.$inferSelect) {
  const payload = { currentItemId: st.currentItemId, currentIndex: st.currentIndex, override: st.override, status: st.status, version: st.version };
  l.effects.push(() => ctx.rt.broadcast(l.session.id, RT.presenterChanged, payload, ["screen", "control"]));
}

async function ensureState(l: LiveCtx) {
  const presentationId = l.session.presentationId;
  if (!presentationId) throw conflict("Esta sessão não tem uma apresentação vinculada. Escolha uma apresentação na sessão.", "SEM_APRESENTACAO");
  let st = await presenterRow(l.tx, l.session.id);
  if (st && st.presentationId !== presentationId) {
    // apresentação da sessão foi trocada: reinicia o estado
    await l.tx.delete(presentationSessionStates).where(eq(presentationSessionStates.sessionId, l.session.id));
    st = null;
  }
  if (!st) {
    [st] = await l.tx
      .insert(presentationSessionStates)
      .values({ sessionId: l.session.id, orgId: l.session.orgId, presentationId })
      .returning();
  }
  return st;
}

export async function presenterCommand(ctx: AppContext, actor: Actor | null, sessionId: string, cmd: PresenterCommand) {
  const result = await withLive(ctx, actor, sessionId, async (l) => {
    const st = await ensureState(l);
    const list = await items(l, st.presentationId);
    const hidden = list.map((i) => i.hidden);
    const curIdx = list.findIndex((i) => i.id === st.currentItemId);
    switch (cmd.action) {
      case "start": {
        if (list.length === 0) throw badRequest("A apresentação não tem itens.");
        const [{ started }] = await l.tx.select({ started: presentationSessionStates.startedAt }).from(presentationSessionStates).where(eq(presentationSessionStates.sessionId, l.session.id));
        if (!started) await l.tx.update(presentationSessionStates).set({ startedAt: l.now }).where(eq(presentationSessionStates.sessionId, l.session.id));
        // retoma da posição atual (ex.: recarregou a página) ou começa do primeiro item visível
        const at = curIdx >= 0 ? curIdx : firstVisible(hidden);
        if (at === null) throw badRequest("Todos os itens estão ocultos.");
        const fresh = (await presenterRow(l.tx, l.session.id))!;
        await moveTo(l, fresh, list, at, "iniciar", ctx);
        return { moved: true };
      }
      case "next":
      case "prev": {
        if (cmd.fromItemId !== undefined && cmd.fromItemId !== null && cmd.fromItemId !== st.currentItemId) {
          return { moved: false, stale: true }; // comando antigo/duplicado: ignora
        }
        const from = curIdx >= 0 ? curIdx : -1;
        const to = curIdx < 0 && cmd.action === "next" ? firstVisible(hidden) : stepIndex(hidden, from, cmd.action === "next" ? 1 : -1);
        if (to === null) return { moved: false, edge: true };
        await moveTo(l, st, list, to, cmd.action === "next" ? "proximo" : "anterior", ctx);
        return { moved: true };
      }
      case "goto": {
        const to = list.findIndex((i) => i.id === cmd.toItemId);
        if (to < 0) throw badRequest("Item não encontrado nesta apresentação.");
        if (to === curIdx) return { moved: false };
        await moveTo(l, st, list, to, "ir", ctx);
        return { moved: true };
      }
      case "override": {
        if (st.override === cmd.override) return { moved: false };
        const [u] = await l.tx
          .update(presentationSessionStates)
          .set({ override: cmd.override, version: st.version + 1, updatedAt: l.now })
          .where(eq(presentationSessionStates.sessionId, l.session.id))
          .returning();
        await l.tx.insert(presentationStateHistory).values({
          orgId: l.session.orgId,
          sessionId: l.session.id,
          action: `override:${cmd.override}`,
          itemId: st.currentItemId,
          index: st.currentIndex,
          version: u.version,
          actorUserId: l.actor?.user.id ?? null,
        });
        emitPresenter(l, ctx, u);
        return { moved: false };
      }
      case "finish": {
        const [u] = await l.tx
          .update(presentationSessionStates)
          .set({ status: "ENCERRADA", version: st.version + 1, updatedAt: l.now })
          .where(eq(presentationSessionStates.sessionId, l.session.id))
          .returning();
        await l.tx.insert(presentationStateHistory).values({ orgId: l.session.orgId, sessionId: l.session.id, action: "encerrar", itemId: st.currentItemId, index: st.currentIndex, version: u.version, actorUserId: l.actor?.user.id ?? null });
        emitPresenter(l, ctx, u);
        return { moved: false };
      }
    }
  });
  return result;
}

export async function presenterSnapshot(ctx: AppContext, sessionId: string) {
  const [s] = await ctx.db.select({ presentationId: eventSessions.presentationId }).from(eventSessions).where(eq(eventSessions.id, sessionId));
  return presenterStateDTO(ctx.db, sessionId, s?.presentationId ?? null);
}

/* ------------------------------------------------------------------ automações */
/** Avançar automaticamente após o encerramento da pergunta atual (se configurado no item). */
onQuestionClosed(async (l, closed, ctx) => {
  const st = await presenterRow(l.tx, l.session.id);
  if (!st || st.status !== "APRESENTANDO" || !st.currentItemId) return;
  const list = await items(l, st.presentationId);
  const idx = list.findIndex((i) => i.id === st.currentItemId);
  const cur = list[idx];
  if (!cur || !OPENS_QUESTION.includes(cur.type as PresentationItemType) || cur.questionId !== closed.questionId) return;
  if (!itemSettingsSchema.parse(cur.settings ?? {}).advanceAfterClose) return;
  const to = stepIndex(list.map((i) => i.hidden), idx, 1);
  if (to !== null) await moveTo(l, st, list, to, "auto:apos-encerrar", ctx);
});

/** Slides com tempo de permanência configurado avançam sozinhos (executado pelo agendador). */
export async function advanceTimedItems(ctx: AppContext) {
  const rows = await ctx.db
    .select({ sessionId: presentationSessionStates.sessionId, itemId: presentationSessionStates.currentItemId, enteredAt: presentationSessionStates.itemEnteredAt, settings: presentationItems.settings })
    .from(presentationSessionStates)
    .innerJoin(presentationItems, eq(presentationItems.id, presentationSessionStates.currentItemId))
    .where(and(eq(presentationSessionStates.status, "APRESENTANDO"), eq(presentationSessionStates.override, "NENHUM"), sql`(${presentationItems.settings}->>'durationSec') is not null`));
  const now = ctx.now().getTime();
  let moved = 0;
  for (const r of rows) {
    const d = itemSettingsSchema.parse(r.settings ?? {}).durationSec;
    if (!d || !r.enteredAt || now - r.enteredAt.getTime() < d * 1000) continue;
    try {
      const res = await presenterCommand(ctx, null, r.sessionId, { action: "next", fromItemId: r.itemId });
      if (res.moved) moved++;
    } catch {
      /* concorrência com comando manual: próxima varredura */
    }
  }
  return moved;
}


