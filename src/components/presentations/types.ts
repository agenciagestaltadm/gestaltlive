/** Tipos e utilidades do Gerenciador de Apresentações (interface administrativa). */
import {
  ITEM_TYPE_LABELS,
  itemInputSchema,
  itemSettingsSchema,
  type AssetDTO,
  type ItemInput,
  type ItemSettings,
  type PresentationItemDTO,
  type PresentationItemType,
} from "@shared/presentations";
import { isScoredType } from "@shared/schemas";
import type { QuestionRow } from "@/components/builder/types";

/** GET /presentations?orgId= */
export interface PresentationListRow {
  id: string;
  title: string;
  description: string | null;
  eventId: string | null;
  eventTitle: string | null;
  updatedAt: string;
  createdAt: string;
  itemCount: number;
  slideCount: number;
  coverUrl: string | null;
}

/** GET /assets?orgId= */
export interface AssetListResponse {
  total: number;
  page: number;
  pageSize: number;
  folders: string[];
  rows: AssetDTO[];
}

/** Item da linha do tempo no editor (o id sempre existe: uuid gerado no cliente para itens novos). */
export type EditorItem = PresentationItemDTO;

export const DEFAULT_ITEM_SETTINGS: ItemSettings = itemSettingsSchema.parse({});

/**
 * UUID v4. `crypto.randomUUID` só existe em contexto seguro (HTTPS/localhost); no acesso pela rede
 * local em HTTP usamos `getRandomValues`, que está sempre disponível.
 */
export function uuidv4(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && "randomUUID" in c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      /* contexto inseguro */
    }
  }
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Título exibido de um item (título próprio → pergunta → arquivo → tipo). */
export function itemDisplayTitle(it: Pick<EditorItem, "title" | "question" | "asset" | "type" | "settings">): string {
  if (it.title) return it.title;
  if (it.type === "CUSTOM_SCREEN" && it.settings.heading) return it.settings.heading;
  if (it.question) return it.question.title;
  if (it.asset) return it.asset.originalName.replace(/\.(png|jpe?g)$/i, "");
  return ITEM_TYPE_LABELS[it.type];
}

/** Converte o item do editor no formato aceito por `PUT /presentations/:id/items`. */
export function toItemInput(it: EditorItem) {
  return {
    id: it.id,
    type: it.type,
    title: it.title,
    hidden: it.hidden,
    transition: it.transition,
    settings: it.settings,
    assetId: it.type === "IMAGE_SLIDE" ? it.assetId : null,
    questionId: it.questionId,
    notes: it.notes ?? null,
  };
}

/** Valida um item com o mesmo schema do servidor; devolve a primeira mensagem de erro. */
export function validateItem(it: EditorItem): string | null {
  const r = itemInputSchema.safeParse(toItemInput(it));
  if (r.success) return null;
  return r.error.issues[0]?.message ?? "Item inválido.";
}

export type { ItemInput };

/** Cria um item novo do tipo indicado. */
export function newItem(type: PresentationItemType, patch: Partial<EditorItem> = {}): EditorItem {
  return {
    id: uuidv4(),
    position: 0,
    type,
    title: null,
    hidden: false,
    transition: null,
    settings: { ...DEFAULT_ITEM_SETTINGS, ...(patch.settings ?? {}) },
    assetId: null,
    questionId: null,
    asset: null,
    question: null,
    notes: null,
    ...patch,
  } as EditorItem;
}

export function slideItem(asset: AssetDTO): EditorItem {
  return newItem("IMAGE_SLIDE", { assetId: asset.id, asset, title: asset.originalName.replace(/\.(png|jpe?g)$/i, "") });
}

export function questionRef(q: QuestionRow): NonNullable<EditorItem["question"]> {
  return { id: q.id, title: q.title, type: q.type, scored: isScoredType(q.type) };
}

export function questionItem(type: "QUESTION" | "POLL" | "QUIZ" | "CHART", q: QuestionRow): EditorItem {
  return newItem(type, { questionId: q.id, question: questionRef(q) });
}

/** Tipo de item sugerido para uma pergunta (pontuadas → Quiz; Sim/Não → Enquete). */
export function suggestedQuestionItemType(q: Pick<QuestionRow, "type">): "QUESTION" | "POLL" | "QUIZ" {
  if (isScoredType(q.type)) return "QUIZ";
  if (q.type === "SIM_NAO") return "POLL";
  return "QUESTION";
}

/** Clona um item com novo id (duplicar). */
export function cloneItem(it: EditorItem): EditorItem {
  return { ...it, id: uuidv4(), settings: { ...it.settings } };
}

/** Limite e formatos aceitos no envio de slides (espelha o servidor). */
export const MAX_SLIDE_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_SLIDE_TYPES = ["image/png", "image/jpeg"];

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} KB`;
  return `${(n / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}
