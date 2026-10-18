/**
 * Gerenciador de Apresentações — contratos compartilhados (servidor e interface).
 * Os itens orquestram recursos existentes (perguntas, ranking, satisfação, prêmios); nada é duplicado.
 */
import { z } from "zod";
import type { PresentationScreen } from "./schemas";
import { CHART_TYPES } from "./charts/catalog";

export const ITEM_TYPES = ["IMAGE_SLIDE", "QUESTION", "POLL", "QUIZ", "CHART", "LEADERBOARD", "SATISFACTION", "QR_CODE", "AWARDS", "CUSTOM_SCREEN"] as const;
export type PresentationItemType = (typeof ITEM_TYPES)[number];

export const ITEM_TYPE_LABELS: Record<PresentationItemType, string> = {
  IMAGE_SLIDE: "Slide",
  QUESTION: "Pergunta",
  POLL: "Enquete",
  QUIZ: "Quiz",
  CHART: "Gráfico",
  LEADERBOARD: "Ranking",
  SATISFACTION: "Satisfação",
  QR_CODE: "QR Code",
  AWARDS: "Premiação",
  CUSTOM_SCREEN: "Tela personalizada",
};

/** Itens que referenciam uma pergunta existente. */
export const QUESTION_ITEM_TYPES: PresentationItemType[] = ["QUESTION", "POLL", "QUIZ", "CHART"];
export const isQuestionItem = (t: PresentationItemType) => QUESTION_ITEM_TYPES.includes(t);
/** Itens que liberam a pergunta (CHART apenas exibe resultados). */
export const OPENS_QUESTION: PresentationItemType[] = ["QUESTION", "POLL", "QUIZ"];

export const TRANSITIONS = ["NENHUMA", "FADE", "DESLIZAR", "ZOOM"] as const;
export type Transition = (typeof TRANSITIONS)[number];
export const TRANSITION_LABELS: Record<Transition, string> = { NENHUMA: "Instantânea", FADE: "Fade", DESLIZAR: "Deslizamento lateral", ZOOM: "Zoom suave" };

export const FITS = ["CONTAIN", "COVER", "FILL"] as const;
export type Fit = (typeof FITS)[number];
export const FIT_LABELS: Record<Fit, string> = { CONTAIN: "Ajustar sem cortes", COVER: "Preencher (pode cortar)", FILL: "Esticar" };

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida (use #RRGGBB)");
const optUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => v === "" || v.startsWith("/api/") || /^https:\/\//.test(v), "Use uma URL https ou faça upload")
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));

export const presentationSettingsSchema = z.object({
  defaultTransition: z.enum(TRANSITIONS).default("FADE"),
  background: hex.default("#000000"),
  fit: z.enum(FITS).default("CONTAIN"),
  /** Mostra o QR Code no canto do telão durante os slides. */
  showJoinBadgeOnSlides: z.boolean().default(false),
});
export type PresentationSettings = z.infer<typeof presentationSettingsSchema>;

export const OPEN_MODES = ["MANUAL", "AUTOMATICO"] as const;
export const OPEN_MODE_LABELS: Record<(typeof OPEN_MODES)[number], string> = {
  MANUAL: "Aguardar comando manual para liberar",
  AUTOMATICO: "Abrir automaticamente ao chegar à pergunta",
};

export const itemSettingsSchema = z.object({
  /** Slides: enquadramento e fundo (nulos = padrão da apresentação). */
  fit: z.enum(FITS).nullable().optional().transform((v) => v ?? null),
  background: hex.nullable().optional().transform((v) => v ?? null),
  /** Tempo de permanência (s) — avança sozinho ao fim (0/nulo = manual). */
  durationSec: z.number().int().min(0).max(3600).nullable().optional().transform((v) => v || null),
  /** Perguntas */
  openMode: z.enum(OPEN_MODES).default("MANUAL"),
  autoCloseOnTimer: z.boolean().nullable().optional().transform((v) => v ?? null),
  advanceAfterClose: z.boolean().default(false),
  closeOnLeave: z.boolean().default(false),
  /** Gráfico (CHART): tipo de visualização (nulo = o configurado na pergunta). */
  chartType: z.enum(CHART_TYPES).nullable().optional().transform((v) => v ?? null),
  /** Tela personalizada */
  heading: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
  subheading: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  message: z.string().trim().max(2000).nullable().optional().transform((v) => v || null),
  backgroundImageUrl: optUrl,
  backgroundAssetId: z.uuid().nullable().optional().transform((v) => v ?? null),
  textColor: hex.nullable().optional().transform((v) => v ?? null),
});
export type ItemSettings = z.infer<typeof itemSettingsSchema>;

export const presentationInputSchema = z.object({
  title: z.string().trim().min(1, "Informe o título").max(160),
  description: z.string().trim().max(2000).nullable().optional().transform((v) => v || null),
  eventId: z.uuid().nullable().optional().transform((v) => v ?? null),
  settings: presentationSettingsSchema.default(presentationSettingsSchema.parse({})),
});
export type PresentationInput = z.infer<typeof presentationInputSchema>;

export const itemInputSchema = z
  .object({
    id: z.uuid().optional(),
    type: z.enum(ITEM_TYPES),
    title: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
    hidden: z.boolean().default(false),
    transition: z.enum(TRANSITIONS).nullable().optional().transform((v) => v ?? null),
    settings: itemSettingsSchema.default(itemSettingsSchema.parse({})),
    assetId: z.uuid().nullable().optional().transform((v) => v ?? null),
    questionId: z.uuid().nullable().optional().transform((v) => v ?? null),
    notes: z.string().max(10_000).nullable().optional().transform((v) => v ?? null),
  })
  .superRefine((it, ctx) => {
    if (it.type === "IMAGE_SLIDE" && !it.assetId) ctx.addIssue({ code: "custom", message: "Slide sem imagem.", path: ["assetId"] });
    if (isQuestionItem(it.type) && !it.questionId) ctx.addIssue({ code: "custom", message: "Selecione a pergunta.", path: ["questionId"] });
    if (it.type === "CUSTOM_SCREEN" && !it.settings.heading && !it.settings.message) {
      ctx.addIssue({ code: "custom", message: "Informe o título ou a mensagem da tela.", path: ["settings", "heading"] });
    }
  });
export type ItemInput = z.infer<typeof itemInputSchema>;

export const itemsInputSchema = z.array(itemInputSchema).max(2000);

/* ------------------------------------------------------------------ ordenação natural */
const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
/** "slide-2.png" < "slide-10.png" (números comparados pelo valor, não alfabeticamente). */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}
export function naturalSort<T>(items: T[], key: (t: T) => string): T[] {
  return [...items].sort((x, y) => naturalCompare(key(x), key(y)));
}

/* ------------------------------------------------------------------ mapeamento item → telão */
export function screenForItem(type: PresentationItemType): PresentationScreen {
  switch (type) {
    case "IMAGE_SLIDE":
      return "SLIDE";
    case "CUSTOM_SCREEN":
      return "TELA_PERSONALIZADA";
    case "QR_CODE":
      return "BOAS_VINDAS";
    case "QUESTION":
    case "POLL":
    case "QUIZ":
      return "PERGUNTA";
    case "CHART":
      return "RESULTADO";
    case "LEADERBOARD":
      return "RANKING";
    case "SATISFACTION":
      return "SATISFACAO";
    case "AWARDS":
      return "PREMIACAO";
  }
}

/** Próximo/anterior índice visível (itens ocultos são pulados). Retorna null nos limites. */
export function stepIndex(hidden: boolean[], from: number, dir: 1 | -1): number | null {
  for (let i = from + dir; i >= 0 && i < hidden.length; i += dir) if (!hidden[i]) return i;
  return null;
}
export function firstVisible(hidden: boolean[]): number | null {
  const i = hidden.findIndex((h) => !h);
  return i < 0 ? null : i;
}

/* ------------------------------------------------------------------ DTOs */
export interface AssetDTO {
  id: string;
  originalName: string;
  width: number;
  height: number;
  bytes: number;
  folder: string | null;
  createdAt: string;
  urls: { mini: string; tela: string; original: string };
  usage?: number;
}

export interface PresentationItemDTO {
  id: string;
  position: number;
  type: PresentationItemType;
  title: string | null;
  hidden: boolean;
  transition: Transition | null;
  settings: ItemSettings;
  assetId: string | null;
  questionId: string | null;
  asset: AssetDTO | null;
  question: { id: string; title: string; type: string; scored: boolean } | null;
  /** Imagem de fundo da tela personalizada (quando vem da biblioteca). */
  backgroundAsset?: AssetDTO | null;
  /** Somente nas rotas de edição/apresentador (nunca no telão ou no participante). */
  notes?: string | null;
}

export interface PresentationDTO {
  id: string;
  title: string;
  description: string | null;
  eventId: string | null;
  eventTitle: string | null;
  settings: PresentationSettings;
  items: PresentationItemDTO[];
  createdAt: string;
  updatedAt: string;
}

/** Bloco exibido no telão para slides e telas personalizadas (sem notas). */
export interface ScreenSlideDTO {
  itemId: string;
  type: "IMAGE_SLIDE" | "CUSTOM_SCREEN";
  imageUrl: string | null;
  fit: Fit;
  background: string;
  transition: Transition;
  heading: string | null;
  subheading: string | null;
  message: string | null;
  textColor: string | null;
}

export interface PresenterStateDTO {
  presentationId: string;
  presentationTitle: string;
  status: "PRONTA" | "APRESENTANDO" | "ENCERRADA";
  override: "NENHUM" | "TELA_PRETA" | "PAUSA";
  currentIndex: number;
  currentItemId: string | null;
  itemEnteredAt: string | null;
  startedAt: string | null;
  version: number;
  settings: PresentationSettings;
  items: PresentationItemDTO[];
  /** sessionQuestionId de cada pergunta referenciada nesta sessão (questionId → sqId). */
  sessionQuestionIds: Record<string, string>;
}

/** Bloco do modo apresentador enviado ao telão (sem notas). */
export interface ScreenPresenterDTO {
  active: boolean;
  itemId: string | null;
  slide: ScreenSlideDTO | null;
  override: "NENHUM" | "TELA_PRETA" | "PAUSA";
  preload: string[];
  chartType: import("./charts/catalog").ChartType | null;
  showJoinBadge: boolean;
  version: number;
}
