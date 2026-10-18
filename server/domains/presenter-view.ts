/**
 * Visões do modo apresentador (sem dependência da engine ao vivo — evita ciclos de importação).
 * - screenPresenterBlock: o que o TELÃO precisa (slide atual, tela personalizada, sobreposição,
 *   pré-carregamento). NUNCA inclui notas do palestrante.
 * - presenterStateDTO: estado completo para o painel autenticado (inclui notas).
 */
import { asc, eq } from "drizzle-orm";
import type { Tx } from "../db/client";
import { presentationAssets, presentationItems, presentationSessionStates, presentations, sessionQuestions } from "../db/schema";
import { assetUrls } from "./assets";
import { itemsDTO } from "./presentations";
import {
  itemSettingsSchema,
  presentationSettingsSchema,
  type PresenterStateDTO,
  type ScreenSlideDTO,
  type ScreenPresenterDTO,
  type Transition,
} from "@shared/presentations";
import type { ChartType } from "@shared/charts/catalog";

export type PresenterStateRow = typeof presentationSessionStates.$inferSelect;

export async function presenterRow(tx: Tx, sessionId: string): Promise<PresenterStateRow | null> {
  const [r] = await tx.select().from(presentationSessionStates).where(eq(presentationSessionStates.sessionId, sessionId));
  return r ?? null;
}

export type ScreenPresenterBlock = ScreenPresenterDTO;

export async function screenPresenterBlock(tx: Tx, sessionId: string): Promise<ScreenPresenterBlock | null> {
  const st = await presenterRow(tx, sessionId);
  // antes de iniciar, só a sobreposição (tela preta/pausa) é aplicada ao telão
  if (!st || (st.status === "PRONTA" && st.override === "NENHUM")) return null;
  const [p] = await tx.select().from(presentations).where(eq(presentations.id, st.presentationId));
  if (!p) return null;
  const pset = presentationSettingsSchema.parse(p.settings ?? {});
  const items = await tx
    .select({ item: presentationItems, asset: presentationAssets })
    .from(presentationItems)
    .leftJoin(presentationAssets, eq(presentationAssets.id, presentationItems.assetId))
    .where(eq(presentationItems.presentationId, p.id))
    .orderBy(asc(presentationItems.position));
  const idx = items.findIndex((x) => x.item.id === st.currentItemId);
  const cur = idx >= 0 ? items[idx] : null;
  let slide: ScreenSlideDTO | null = null;
  let chartType: ChartType | null = null;
  if (cur) {
    const s = itemSettingsSchema.parse(cur.item.settings ?? {});
    const transition = ((cur.item.transition as Transition | null) ?? pset.defaultTransition) as Transition;
    if (cur.item.type === "IMAGE_SLIDE" || cur.item.type === "CUSTOM_SCREEN") {
      let bgUrl: string | null = null;
      if (cur.item.type === "CUSTOM_SCREEN") {
        if (s.backgroundAssetId) {
          const [a] = await tx.select().from(presentationAssets).where(eq(presentationAssets.id, s.backgroundAssetId));
          if (a) bgUrl = assetUrls(a).tela;
        } else bgUrl = s.backgroundImageUrl;
      }
      slide = {
        itemId: cur.item.id,
        type: cur.item.type,
        imageUrl: cur.item.type === "IMAGE_SLIDE" ? (cur.asset ? assetUrls(cur.asset).tela : null) : bgUrl,
        fit: s.fit ?? pset.fit,
        background: s.background ?? pset.background,
        transition,
        heading: s.heading,
        subheading: s.subheading,
        message: s.message,
        textColor: s.textColor,
      };
    }
    if (cur.item.type === "CHART") chartType = s.chartType;
  }
  // pré-carrega as próximas 2 imagens visíveis
  const preload: string[] = [];
  for (let i = Math.max(idx, -1) + 1; i < items.length && preload.length < 2; i++) {
    const it = items[i];
    if (it.item.hidden || it.item.type !== "IMAGE_SLIDE" || !it.asset) continue;
    preload.push(assetUrls(it.asset).tela);
  }
  return {
    active: st.status === "APRESENTANDO",
    itemId: st.currentItemId,
    slide,
    override: st.override,
    preload,
    chartType,
    showJoinBadge: pset.showJoinBadgeOnSlides,
    version: st.version,
  };
}

/** Estado completo para o painel do apresentador (inclui notas — rota autenticada). */
export async function presenterStateDTO(tx: Tx, sessionId: string, presentationId: string | null): Promise<PresenterStateDTO | null> {
  let st = await presenterRow(tx, sessionId);
  // a apresentação vinculada à sessão prevalece; se foi trocada, o estado antigo é ignorado até o próximo "start"
  const pid = presentationId ?? st?.presentationId ?? null;
  if (!pid) return null;
  if (st && st.presentationId !== pid) st = null;
  const [p] = await tx.select().from(presentations).where(eq(presentations.id, pid));
  if (!p) return null;
  const items = await itemsDTO(tx, p.id, true);
  const sqs = await tx.select({ id: sessionQuestions.id, questionId: sessionQuestions.questionId }).from(sessionQuestions).where(eq(sessionQuestions.sessionId, sessionId));
  return {
    presentationId: p.id,
    presentationTitle: p.title,
    status: st?.status ?? "PRONTA",
    override: st?.override ?? "NENHUM",
    currentIndex: st?.currentIndex ?? 0,
    currentItemId: st?.currentItemId ?? null,
    itemEnteredAt: st?.itemEnteredAt?.toISOString() ?? null,
    startedAt: st?.startedAt?.toISOString() ?? null,
    version: st?.version ?? 0,
    settings: presentationSettingsSchema.parse(p.settings ?? {}),
    items,
    sessionQuestionIds: Object.fromEntries(sqs.map((s) => [s.questionId, s.id])),
  };
}
