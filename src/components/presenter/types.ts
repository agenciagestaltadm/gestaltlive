/** Tipos e utilitários do modo apresentador (painel do palestrante). */
import type { ControlQuestionDTO, ControlStateDTO } from "@shared/types";
import {
  ITEM_TYPE_LABELS,
  isQuestionItem,
  stepIndex,
  type PresentationItemDTO,
  type PresentationSettings,
  type PresenterStateDTO,
  type ScreenSlideDTO,
  type Transition,
} from "@shared/presentations";

/** GET/POST /api/admin/sessions/:id/presenter */
export interface PresenterResponse {
  control: ControlStateDTO;
  presenter: PresenterStateDTO | null;
  result?: { moved: boolean; stale?: boolean; edge?: boolean };
}

export type PresenterCommand =
  | { action: "start" }
  | { action: "next" | "prev" }
  | { action: "goto"; toItemId: string }
  | { action: "override"; override: "NENHUM" | "TELA_PRETA" | "PAUSA" }
  | { action: "finish" };

/** GET /api/admin/presentations?orgId= (linha da listagem) */
export interface PresentationListRow {
  id: string;
  title: string;
  description: string | null;
  eventId: string | null;
  eventTitle: string | null;
  itemCount: number;
  slideCount: number;
  coverUrl: string | null;
  updatedAt: string;
}

/** GET /api/admin/sessions/:id (campos usados aqui; a linha completa da sessão vem junto). */
export interface SessionDetailLite {
  id: string;
  name: string;
  scheduledAt: string | null;
  presentationId?: string | null;
  eventId?: string;
}

export const DEFAULT_PRESENTATION_SETTINGS: PresentationSettings = {
  defaultTransition: "FADE",
  background: "#000000",
  fit: "CONTAIN",
  showJoinBadgeOnSlides: false,
};

/** Título amigável do item (título próprio → pergunta → nome do arquivo → tipo). */
export function itemLabel(it: PresentationItemDTO): string {
  return it.title ?? it.question?.title ?? it.settings.heading ?? it.asset?.originalName ?? ITEM_TYPE_LABELS[it.type];
}

/** Monta o bloco de slide (igual ao do telão) a partir do item — usado na prévia do próximo item. */
export function slideFromItem(it: PresentationItemDTO, ps: PresentationSettings = DEFAULT_PRESENTATION_SETTINGS): ScreenSlideDTO | null {
  if (it.type !== "IMAGE_SLIDE" && it.type !== "CUSTOM_SCREEN") return null;
  const s = it.settings;
  return {
    itemId: it.id,
    type: it.type,
    imageUrl: it.type === "IMAGE_SLIDE" ? (it.asset?.urls.tela ?? null) : (s.backgroundImageUrl ?? null),
    fit: s.fit ?? ps.fit,
    background: s.background ?? ps.background,
    transition: (it.transition ?? ps.defaultTransition) as Transition,
    heading: s.heading,
    subheading: s.subheading,
    message: s.message,
    textColor: s.textColor,
  };
}

export function nextVisibleIndex(items: PresentationItemDTO[], from: number, dir: 1 | -1): number | null {
  return stepIndex(
    items.map((i) => i.hidden),
    from,
    dir,
  );
}

/** Pergunta da sessão referenciada pelo item (se for um item de pergunta). */
export function questionForItem(item: PresentationItemDTO | null | undefined, presenter: PresenterStateDTO | null, control: ControlStateDTO | null): ControlQuestionDTO | null {
  if (!item || !presenter || !control || !isQuestionItem(item.type) || !item.questionId) return null;
  const sqId = presenter.sessionQuestionIds[item.questionId];
  if (!sqId) return null;
  return control.questions.find((q) => q.sessionQuestionId === sqId) ?? null;
}

/** Extrai código e token do link do telão (/apresentacao/CODIGO?t=TOKEN). */
export function parseScreenUrl(url: string | null | undefined): { code: string; token: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const m = u.pathname.match(/\/apresentacao\/([^/?#]+)/);
    const token = u.searchParams.get("t");
    if (!m || !token) return null;
    return { code: decodeURIComponent(m[1]), token };
  } catch {
    return null;
  }
}

/** Formata milissegundos como h:mm:ss ou mm:ss. */
export function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
