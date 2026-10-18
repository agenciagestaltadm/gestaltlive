/**
 * Gerenciador de Apresentações: apresentações, linha do tempo de itens, notas e reutilização.
 *
 * Os itens REFERENCIAM recursos existentes (perguntas do evento, slides da biblioteca). Perguntas
 * de itens precisam pertencer ao evento vinculado — é por meio das session_questions desse evento
 * que a engine ao vivo (live.ts) libera, fecha, pontua e exibe resultados.
 */
import { and, asc, count, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import type { Tx } from "../db/client";
import {
  eventSessions,
  events,
  presentationAssets,
  presentationItems,
  presentations,
  presentationSpeakerNotes,
  questions,
} from "../db/schema";
import type { Actor } from "../auth/auth";
import { authorize } from "../auth/permissions";
import { badRequest, conflict, notFound } from "../lib/errors";
import { audit } from "./audit";
import { toAssetDTO } from "./assets";
import { copyQuestionToEvent } from "./questions";
import {
  isQuestionItem,
  itemSettingsSchema,
  itemsInputSchema,
  naturalSort,
  presentationInputSchema,
  presentationSettingsSchema,
  type ItemInput,
  type PresentationDTO,
  type PresentationItemDTO,
  type Transition,
} from "@shared/presentations";
import { isScoredType, type QuestionType } from "@shared/schemas";

type PresentationRow = typeof presentations.$inferSelect;
type ItemRow = typeof presentationItems.$inferSelect;

export async function loadPresentation(ctx: { db: Tx }, actor: Actor, id: string, perm: "event.read" | "event.write" | "session.control") {
  const [p] = await ctx.db.select().from(presentations).where(eq(presentations.id, id));
  if (!p) throw notFound("Apresentação não encontrada.");
  authorize(actor, p.orgId, perm);
  return p;
}

async function assertEvent(tx: Tx, orgId: string, eventId: string | null) {
  if (!eventId) return null;
  const [ev] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!ev || ev.orgId !== orgId) throw badRequest("Evento inválido para esta organização.");
  return ev;
}

/* ------------------------------------------------------------------ leitura */
export async function itemsDTO(tx: Tx, presentationId: string, withNotes: boolean): Promise<PresentationItemDTO[]> {
  const rows = await tx.select().from(presentationItems).where(eq(presentationItems.presentationId, presentationId)).orderBy(asc(presentationItems.position));
  const assetIds = [...new Set(rows.map((r) => r.assetId).filter(Boolean) as string[])];
  const qIds = [...new Set(rows.map((r) => r.questionId).filter(Boolean) as string[])];
  const bgIds = [...new Set(rows.map((r) => (r.settings as { backgroundAssetId?: string }).backgroundAssetId).filter(Boolean) as string[])];
  const assets = assetIds.length || bgIds.length ? await tx.select().from(presentationAssets).where(inArray(presentationAssets.id, [...assetIds, ...bgIds])) : [];
  const qs = qIds.length ? await tx.select({ id: questions.id, title: questions.title, type: questions.type }).from(questions).where(inArray(questions.id, qIds)) : [];
  const notes = withNotes && rows.length
    ? await tx.select().from(presentationSpeakerNotes).where(inArray(presentationSpeakerNotes.itemId, rows.map((r) => r.id)))
    : [];
  return rows.map((r) => {
    const a = assets.find((x) => x.id === r.assetId);
    const q = qs.find((x) => x.id === r.questionId);
    return {
      id: r.id,
      position: r.position,
      type: r.type,
      title: r.title,
      hidden: r.hidden,
      transition: (r.transition as Transition | null) ?? null,
      settings: itemSettingsSchema.parse(r.settings ?? {}),
      assetId: r.assetId,
      questionId: r.questionId,
      asset: a ? toAssetDTO(a) : null,
      backgroundAsset: (() => {
        const bgId = (r.settings as { backgroundAssetId?: string }).backgroundAssetId;
        const bg = bgId ? assets.find((x) => x.id === bgId) : undefined;
        return bg ? toAssetDTO(bg) : null;
      })(),
      question: q ? { id: q.id, title: q.title, type: q.type, scored: isScoredType(q.type as QuestionType) } : null,
      ...(withNotes && { notes: notes.find((n) => n.itemId === r.id)?.notes ?? null }),
    };
  });
}

export async function presentationDTO(tx: Tx, p: PresentationRow, withNotes: boolean): Promise<PresentationDTO> {
  let eventTitle: string | null = null;
  if (p.eventId) {
    const [ev] = await tx.select({ title: events.title }).from(events).where(eq(events.id, p.eventId));
    eventTitle = ev?.title ?? null;
  }
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    eventId: p.eventId,
    eventTitle,
    settings: presentationSettingsSchema.parse(p.settings ?? {}),
    items: await itemsDTO(tx, p.id, withNotes),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function listPresentations(ctx: AppContext, actor: Actor, orgId: string, f: { eventId?: string } = {}) {
  authorize(actor, orgId, "event.read");
  const where = f.eventId ? and(eq(presentations.orgId, orgId), eq(presentations.eventId, f.eventId)) : eq(presentations.orgId, orgId);
  const rows = await ctx.db
    .select({
      id: presentations.id,
      title: presentations.title,
      description: presentations.description,
      eventId: presentations.eventId,
      eventTitle: events.title,
      updatedAt: presentations.updatedAt,
      createdAt: presentations.createdAt,
    })
    .from(presentations)
    .leftJoin(events, eq(events.id, presentations.eventId))
    .where(where)
    .orderBy(desc(presentations.updatedAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const counts = await ctx.db
    .select({
      id: presentationItems.presentationId,
      items: count(),
      slides: sql<number>`count(*) filter (where ${presentationItems.type} = 'IMAGE_SLIDE')::int`,
    })
    .from(presentationItems)
    .where(inArray(presentationItems.presentationId, ids))
    .groupBy(presentationItems.presentationId);
  // capa: primeiro slide de imagem de cada apresentação (uma linha por apresentação)
  const covers = await ctx.db
    .selectDistinctOn([presentationItems.presentationId], { presentationId: presentationItems.presentationId, asset: presentationAssets })
    .from(presentationItems)
    .innerJoin(presentationAssets, eq(presentationAssets.id, presentationItems.assetId))
    .where(and(inArray(presentationItems.presentationId, ids), eq(presentationItems.type, "IMAGE_SLIDE")))
    .orderBy(presentationItems.presentationId, asc(presentationItems.position));
  return rows.map((r) => {
    const c = counts.find((x) => x.id === r.id);
    const cover = covers.find((x) => x.presentationId === r.id);
    return { ...r, itemCount: Number(c?.items ?? 0), slideCount: Number(c?.slides ?? 0), coverUrl: cover ? toAssetDTO(cover.asset).urls.mini : null };
  });
}

export async function getPresentation(ctx: AppContext, actor: Actor, id: string) {
  const p = await loadPresentation(ctx, actor, id, "event.read");
  return presentationDTO(ctx.db, p, true);
}

/* ------------------------------------------------------------------ escrita */
export async function createPresentation(ctx: AppContext, actor: Actor, orgId: string, raw: unknown) {
  authorize(actor, orgId, "event.write");
  const input = presentationInputSchema.parse(raw);
  return ctx.db.transaction(async (tx) => {
    await assertEvent(tx, orgId, input.eventId);
    const [p] = await tx
      .insert(presentations)
      .values({ orgId, eventId: input.eventId, title: input.title, description: input.description, settings: input.settings, createdByUserId: actor.user.id })
      .returning();
    await audit(tx, actor, orgId, "presentation.create", "presentation", p.id, { title: p.title });
    return presentationDTO(tx, p, true);
  });
}

export async function updatePresentation(ctx: AppContext, actor: Actor, id: string, raw: unknown) {
  const p = await loadPresentation(ctx, actor, id, "event.write");
  const input = presentationInputSchema.parse(raw);
  return ctx.db.transaction(async (tx) => {
    await assertEvent(tx, p.orgId, input.eventId);
    if (input.eventId !== p.eventId) {
      const [{ n }] = await tx
        .select({ n: count() })
        .from(presentationItems)
        .where(and(eq(presentationItems.presentationId, id), sql`${presentationItems.questionId} is not null`));
      if (Number(n) > 0) {
        throw conflict("A apresentação tem perguntas do evento atual. Para usar em outro evento, duplique a apresentação para o novo evento.", "EVENTO_COM_PERGUNTAS");
      }
    }
    const [u] = await tx
      .update(presentations)
      .set({ title: input.title, description: input.description, eventId: input.eventId, settings: input.settings, updatedAt: ctx.now() })
      .where(eq(presentations.id, id))
      .returning();
    return presentationDTO(tx, u, true);
  });
}

export async function deletePresentation(ctx: AppContext, actor: Actor, id: string) {
  const p = await loadPresentation(ctx, actor, id, "event.write");
  const [live] = await ctx.db
    .select({ n: count() })
    .from(eventSessions)
    .where(and(eq(eventSessions.presentationId, id), inArray(eventSessions.status, ["AO_VIVO", "PAUSADA", "AGUARDANDO"])));
  if (Number(live.n) > 0) throw conflict("A apresentação está em uso numa sessão em andamento.", "APRESENTACAO_EM_USO");
  await ctx.db.transaction(async (tx) => {
    await tx.delete(presentations).where(eq(presentations.id, id));
    await audit(tx, actor, p.orgId, "presentation.delete", "presentation", id, { title: p.title });
  });
}

/** Valida referências: slides da mesma organização e perguntas do evento vinculado. */
async function validateRefs(tx: Tx, p: PresentationRow, items: ItemInput[]) {
  const assetIds = [
    ...new Set(items.flatMap((i) => [i.assetId, i.settings.backgroundAssetId]).filter(Boolean) as string[]),
  ];
  if (assetIds.length) {
    const found = await tx.select({ id: presentationAssets.id }).from(presentationAssets).where(and(inArray(presentationAssets.id, assetIds), eq(presentationAssets.orgId, p.orgId)));
    if (found.length !== assetIds.length) throw badRequest("Há slides que não pertencem a esta organização.");
  }
  const qIds = [...new Set(items.filter((i) => isQuestionItem(i.type)).map((i) => i.questionId!))];
  if (qIds.length) {
    if (!p.eventId) throw badRequest("Vincule a apresentação a um evento para inserir perguntas.", undefined, "SEM_EVENTO");
    const found = await tx
      .select({ id: questions.id, type: questions.type })
      .from(questions)
      .where(and(inArray(questions.id, qIds), eq(questions.eventId, p.eventId)));
    if (found.length !== qIds.length) throw badRequest("As perguntas precisam pertencer ao evento vinculado.", undefined, "PERGUNTA_DE_OUTRO_EVENTO");
    for (const it of items) {
      if (it.type === "QUIZ") {
        const q = found.find((x) => x.id === it.questionId)!;
        if (!isScoredType(q.type as QuestionType)) throw badRequest("Itens de quiz precisam de uma pergunta pontuada.", undefined, "QUIZ_SEM_PONTUACAO");
      }
    }
  }
}

/**
 * Salva a linha do tempo inteira (salvamento automático do editor) numa transação:
 * mantém ids existentes, cria os novos e remove os ausentes. Remover um item NÃO apaga o arquivo
 * da biblioteca (os slides continuam disponíveis para outras apresentações).
 */
export async function replaceItems(ctx: AppContext, actor: Actor, id: string, raw: unknown) {
  const p = await loadPresentation(ctx, actor, id, "event.write");
  const items = itemsInputSchema.parse(raw);
  return ctx.db.transaction(async (tx) => {
    await tx.select({ id: presentations.id }).from(presentations).where(eq(presentations.id, id)).for("update");
    await validateRefs(tx, p, items);
    const current = await tx.select({ id: presentationItems.id }).from(presentationItems).where(eq(presentationItems.presentationId, id));
    const currentIds = new Set(current.map((c) => c.id));
    // ids novos gerados pelo cliente não podem colidir com itens de outra apresentação
    const foreign = items.filter((i) => i.id && !currentIds.has(i.id)).map((i) => i.id!);
    if (foreign.length) {
      const taken = await tx.select({ id: presentationItems.id }).from(presentationItems).where(inArray(presentationItems.id, foreign));
      if (taken.length) throw badRequest("Identificador de item inválido.");
    }
    const keep = items.filter((i) => i.id && currentIds.has(i.id)).map((i) => i.id!);
    if (keep.length) await tx.delete(presentationItems).where(and(eq(presentationItems.presentationId, id), notInArray(presentationItems.id, keep)));
    else await tx.delete(presentationItems).where(eq(presentationItems.presentationId, id));
    const now = ctx.now();
    for (const [position, it] of items.entries()) {
      const values = {
        position,
        type: it.type,
        title: it.title,
        hidden: it.hidden,
        transition: it.transition,
        settings: it.settings,
        assetId: it.type === "IMAGE_SLIDE" ? it.assetId : null,
        questionId: isQuestionItem(it.type) ? it.questionId : null,
        updatedAt: now,
      };
      let itemId: string;
      if (it.id && currentIds.has(it.id)) {
        await tx.update(presentationItems).set(values).where(eq(presentationItems.id, it.id));
        itemId = it.id;
      } else {
        const [ins] = await tx
          .insert(presentationItems)
          .values({ ...values, orgId: p.orgId, presentationId: id, ...(it.id && { id: it.id }) })
          .returning({ id: presentationItems.id });
        itemId = ins.id;
      }
      if (it.notes !== null && it.notes !== undefined && it.notes.trim()) {
        await tx
          .insert(presentationSpeakerNotes)
          .values({ itemId, orgId: p.orgId, notes: it.notes })
          .onConflictDoUpdate({ target: presentationSpeakerNotes.itemId, set: { notes: it.notes, updatedAt: now } });
      } else {
        await tx.delete(presentationSpeakerNotes).where(eq(presentationSpeakerNotes.itemId, itemId));
      }
    }
    const [u] = await tx.update(presentations).set({ updatedAt: now }).where(eq(presentations.id, id)).returning();
    return presentationDTO(tx, u, true);
  });
}

/**
 * Insere slides a partir de arquivos da biblioteca. Por padrão, em ordem natural do nome (slide-2 antes de
 * slide-10), que é o caso do upload em lote; com `order: "pedida"`, na ordem dos ids recebidos (seleção manual).
 */
export async function addSlides(ctx: AppContext, actor: Actor, id: string, assetIds: string[], insertAt?: number | null, order: "natural" | "pedida" = "natural") {
  const p = await loadPresentation(ctx, actor, id, "event.write");
  if (!assetIds.length) throw badRequest("Nenhum slide informado.");
  return ctx.db.transaction(async (tx) => {
    await tx.select({ id: presentations.id }).from(presentations).where(eq(presentations.id, id)).for("update");
    const assets = await tx.select().from(presentationAssets).where(and(inArray(presentationAssets.id, assetIds), eq(presentationAssets.orgId, p.orgId)));
    if (assets.length !== new Set(assetIds).size) throw badRequest("Há slides que não pertencem a esta organização.");
    const requested = [...new Set(assetIds)];
    const ordered = order === "pedida" ? requested.map((aid) => assets.find((a) => a.id === aid)!) : naturalSort(assets, (a) => a.originalName);
    const existing = await tx.select().from(presentationItems).where(eq(presentationItems.presentationId, id)).orderBy(asc(presentationItems.position));
    const at = insertAt === null || insertAt === undefined ? existing.length : Math.max(0, Math.min(existing.length, insertAt));
    // abre espaço
    for (const it of existing.slice(at).reverse()) {
      await tx.update(presentationItems).set({ position: it.position + ordered.length }).where(eq(presentationItems.id, it.id));
    }
    const now = ctx.now();
    await tx.insert(presentationItems).values(
      ordered.map((a, i) => ({
        orgId: p.orgId,
        presentationId: id,
        position: at + i,
        type: "IMAGE_SLIDE" as const,
        title: a.originalName.replace(/\.(png|jpe?g)$/i, ""),
        assetId: a.id,
        settings: itemSettingsSchema.parse({}),
        updatedAt: now,
      })),
    );
    // normaliza posições
    const all = await tx.select({ id: presentationItems.id }).from(presentationItems).where(eq(presentationItems.presentationId, id)).orderBy(asc(presentationItems.position), asc(presentationItems.createdAt));
    for (const [i, it] of all.entries()) await tx.update(presentationItems).set({ position: i }).where(eq(presentationItems.id, it.id));
    const [u] = await tx.update(presentations).set({ updatedAt: now }).where(eq(presentations.id, id)).returning();
    return presentationDTO(tx, u, true);
  });
}

/* ------------------------------------------------------------------ duplicação e reutilização */
async function copyItems(tx: Tx, from: PresentationRow, toId: string, orgId: string, questionMap: Map<string, string> | null) {
  const items = await tx.select().from(presentationItems).where(eq(presentationItems.presentationId, from.id)).orderBy(asc(presentationItems.position));
  const notes = items.length ? await tx.select().from(presentationSpeakerNotes).where(inArray(presentationSpeakerNotes.itemId, items.map((i) => i.id))) : [];
  for (const it of items) {
    let questionId = it.questionId;
    if (questionId && questionMap) questionId = questionMap.get(questionId) ?? null;
    const [ins] = await tx
      .insert(presentationItems)
      .values({
        orgId,
        presentationId: toId,
        position: it.position,
        type: it.type,
        title: it.title,
        hidden: it.hidden,
        transition: it.transition,
        settings: it.settings,
        assetId: it.assetId, // mesmo arquivo físico (sem novo upload)
        questionId,
      })
      .returning({ id: presentationItems.id });
    const n = notes.find((x) => x.itemId === it.id);
    if (n) await tx.insert(presentationSpeakerNotes).values({ itemId: ins.id, orgId, notes: n.notes });
  }
}

/**
 * Duplica a apresentação. Sem evento de destino (ou o mesmo evento), mantém as referências às
 * perguntas. Para outro evento, copia as perguntas usadas para o evento de destino e remapeia.
 */
export async function duplicatePresentation(ctx: AppContext, actor: Actor, id: string, opts: { targetEventId?: string | null; title?: string | null } = {}) {
  const p = await loadPresentation(ctx, actor, id, "event.write");
  return ctx.db.transaction(async (tx) => {
    const target = opts.targetEventId === undefined ? p.eventId : opts.targetEventId;
    await assertEvent(tx, p.orgId, target ?? null);
    let questionMap: Map<string, string> | null = null;
    if (target !== p.eventId) {
      const used = await tx
        .selectDistinct({ id: presentationItems.questionId })
        .from(presentationItems)
        .where(and(eq(presentationItems.presentationId, id), sql`${presentationItems.questionId} is not null`));
      if (used.length && !target) throw badRequest("Escolha o evento de destino para copiar as perguntas da apresentação.");
      questionMap = new Map();
      for (const u of used) questionMap.set(u.id!, await copyQuestionToEvent(tx, u.id!, target!, p.orgId));
    }
    const [copy] = await tx
      .insert(presentations)
      .values({
        orgId: p.orgId,
        eventId: target ?? null,
        title: (opts.title?.trim() || `${p.title} (cópia)`).slice(0, 160),
        description: p.description,
        settings: p.settings,
        createdByUserId: actor.user.id,
      })
      .returning();
    await copyItems(tx, p, copy.id, p.orgId, questionMap);
    await audit(tx, actor, p.orgId, "presentation.duplicate", "presentation", copy.id, { from: id, targetEventId: target ?? null });
    return presentationDTO(tx, copy, true);
  });
}

/** Na duplicação de evento: copia as apresentações vinculadas, usando o mapa de perguntas já copiadas. */
export async function copyPresentationsForEvent(tx: Tx, fromEventId: string, toEventId: string, orgId: string, questionMap: Map<string, string>, actorId: string | null) {
  const list = await tx.select().from(presentations).where(eq(presentations.eventId, fromEventId));
  for (const p of list) {
    const [copy] = await tx
      .insert(presentations)
      .values({ orgId, eventId: toEventId, title: p.title, description: p.description, settings: p.settings, createdByUserId: actorId })
      .returning();
    await copyItems(tx, p, copy.id, orgId, questionMap);
  }
  return list.length;
}

/** Apresentações elegíveis para uma sessão: do mesmo evento ou sem evento (somente conteúdo estático). */
export async function assertPresentationForSession(tx: Tx, presentationId: string | null, session: { orgId: string; eventId: string }) {
  if (!presentationId) return;
  const [p] = await tx.select().from(presentations).where(eq(presentations.id, presentationId));
  if (!p || p.orgId !== session.orgId) throw badRequest("Apresentação inválida.");
  if (p.eventId && p.eventId !== session.eventId) throw badRequest("A apresentação pertence a outro evento. Duplique-a para este evento.", undefined, "APRESENTACAO_DE_OUTRO_EVENTO");
}


