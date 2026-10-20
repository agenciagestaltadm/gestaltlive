/**
 * Modelo do formulário do editor de perguntas: valores padrão, conversão de/para a API e
 * resolvedor do React Hook Form que espelha a validação do servidor (`questionInputSchema`
 * + normalizações de `normalizeInput` em server/domains/questions.ts).
 */
import type { FieldError, Resolver } from "react-hook-form";
import { toNestErrors } from "@hookform/resolvers";
import type { z } from "zod";
import {
  DEFAULT_SCORING,
  isNumericType,
  isScoredType,
  isTextType,
  questionInputSchema,
  type QuestionType,
  type ResultsMode,
  type ScoringConfig,
} from "@shared/schemas";
import { DEFAULT_WORD_CLOUD_DISPLAY, DEFAULT_WORD_CLOUD_RULES, type WordCloudDisplay, type WordCloudRules } from "@shared/wordcloud";
import type { ChartType } from "@shared/charts/catalog";
import { chartContextForQuestion, checkChart, compatibleCharts, defaultChartFor, type ChartContext } from "@shared/charts/compat";
import type { QuestionRow } from "./types";

export interface OptionForm {
  id?: string;
  label: string;
  imageUrl: string | null;
  isCorrect: boolean;
  color: string | null;
}

export interface ChartForm {
  type: ChartType;
  colors: string[] | null;
  showPercent: boolean;
  showValues: boolean;
  showLegend: boolean;
  sortDesc: boolean;
  crossQuestionId: string | null;
  /** Aparência da Nuvem de Palavras (enviada somente nesse tipo). */
  wordCloud: WordCloudDisplay;
}

export interface FormValues {
  type: QuestionType;
  status: "RASCUNHO" | "PRONTA";
  title: string;
  description: string;
  imageUrl: string | null;
  category: string;
  tags: string[];
  required: boolean;
  minSelections: number;
  maxSelections: number;
  scaleMin: number;
  scaleMax: number;
  scaleMinLabel: string;
  scaleMaxLabel: string;
  timeLimitSec: number | null;
  allowEdit: boolean;
  scoring: ScoringConfig;
  chart: ChartForm;
  resultsMode: ResultsMode;
  explanation: string;
  options: OptionForm[];
  /** Regras de coleta da Nuvem de Palavras (enviadas somente nesse tipo). */
  wordCloud: WordCloudRules;
}

export const defaultWordCloudRules = (): WordCloudRules => ({ ...DEFAULT_WORD_CLOUD_RULES, blockedWords: [], synonyms: [] });
export const defaultWordCloudDisplay = (): WordCloudDisplay => ({ ...DEFAULT_WORD_CLOUD_DISPLAY });

export type QuestionPayload = z.input<typeof questionInputSchema>;

export const MAX_OPTIONS = 20;

export const blankOption = (label = ""): OptionForm => ({ label, imageUrl: null, isCorrect: false, color: null });

/** Quantidade mínima de alternativas exigida pelo servidor. */
export function minOptionsFor(t: QuestionType) {
  if (isNumericType(t) || isTextType(t)) return 0;
  if (t === "MULTIPLA_CORRETA") return 3;
  return 2;
}

/** Tipos em que a resposta é sempre única (o servidor força 1/1). */
export const isForcedSingle = (t: QuestionType) => t === "CONHECIMENTO" || t === "SIM_NAO" || isNumericType(t) || isTextType(t);

export function chartContextFor(v: Pick<FormValues, "type" | "options" | "maxSelections" | "scaleMin" | "scaleMax">, hasCross: boolean): ChartContext {
  const numeric = isNumericType(v.type);
  return chartContextForQuestion({
    type: v.type,
    optionCount: numeric ? 0 : v.options.length,
    maxSelections: isForcedSingle(v.type) ? 1 : v.maxSelections,
    scaleMin: v.type === "NPS" ? 0 : numeric ? v.scaleMin : null,
    scaleMax: v.type === "NPS" ? 10 : numeric ? v.scaleMax : null,
    hasCross,
    hasTemporal: true,
  });
}

/** Gráfico padrão compatível com a estrutura atual. */
export function pickChart(ctx: ChartContext): ChartType {
  const d = defaultChartFor(ctx);
  if (checkChart(d, ctx).compatible) return d;
  return compatibleCharts(ctx)[0] ?? "bar_horizontal";
}

function defaultOptions(t: QuestionType): OptionForm[] {
  if (t === "SIM_NAO") return [blankOption("Sim"), blankOption("Não")];
  if (isNumericType(t) || isTextType(t)) return [];
  const n = t === "CONHECIMENTO" || t === "MULTIPLA_CORRETA" ? 4 : 3;
  return Array.from({ length: n }, () => blankOption());
}

export function emptyForm(type: QuestionType, resultsMode: ResultsMode = "MANUAL"): FormValues {
  const options = defaultOptions(type);
  const base: FormValues = {
    type,
    status: "PRONTA",
    title: "",
    description: "",
    imageUrl: null,
    category: "",
    tags: [],
    required: false,
    minSelections: type === "MULTIPLA_CORRETA" ? 2 : 1,
    maxSelections: type === "MULTIPLA_CORRETA" ? options.length : 1,
    scaleMin: type === "NPS" ? 0 : 1,
    scaleMax: type === "NPS" ? 10 : 5,
    scaleMinLabel: type === "NPS" ? "Nada provável" : "",
    scaleMaxLabel: type === "NPS" ? "Extremamente provável" : "",
    timeLimitSec: isScoredType(type) ? 30 : null,
    allowEdit: false,
    scoring: { ...DEFAULT_SCORING },
    chart: { type: "bar_horizontal", colors: null, showPercent: true, showValues: true, showLegend: true, sortDesc: false, crossQuestionId: null, wordCloud: defaultWordCloudDisplay() },
    // nuvem de palavras: a graça é ver a nuvem se formando — resultados ao vivo por padrão
    resultsMode: isTextType(type) ? "AO_VIVO" : resultsMode,
    explanation: "",
    options,
    wordCloud: defaultWordCloudRules(),
  };
  base.chart.type = pickChart(chartContextFor(base, false));
  return base;
}

export function fromRow(q: QuestionRow): FormValues {
  return {
    type: q.type,
    status: q.status,
    title: q.title,
    description: q.description ?? "",
    imageUrl: q.imageUrl,
    category: q.category ?? "",
    tags: [...(q.tags ?? [])],
    required: q.required,
    minSelections: q.minSelections,
    maxSelections: q.maxSelections,
    scaleMin: q.scaleMin ?? (q.type === "NPS" ? 0 : 1),
    scaleMax: q.scaleMax ?? (q.type === "NPS" ? 10 : 5),
    scaleMinLabel: q.scaleMinLabel ?? "",
    scaleMaxLabel: q.scaleMaxLabel ?? "",
    timeLimitSec: q.timeLimitSec,
    allowEdit: q.allowEdit,
    scoring: { ...DEFAULT_SCORING, ...(q.scoring ?? {}) },
    chart: {
      type: q.chart.type,
      colors: q.chart.colors ?? null,
      showPercent: q.chart.showPercent ?? true,
      showValues: q.chart.showValues ?? true,
      showLegend: q.chart.showLegend ?? true,
      sortDesc: q.chart.sortDesc ?? false,
      crossQuestionId: q.chart.crossQuestionId ?? null,
      wordCloud: { ...DEFAULT_WORD_CLOUD_DISPLAY, ...(q.chart.wordCloud ?? {}) },
    },
    resultsMode: q.resultsMode,
    explanation: q.explanation ?? "",
    options: q.options.map((o) => ({ id: o.id, label: o.label, imageUrl: o.imageUrl, isCorrect: o.isCorrect, color: o.color })),
    wordCloud: {
      ...DEFAULT_WORD_CLOUD_RULES,
      ...(q.wordCloud ?? {}),
      blockedWords: [...(q.wordCloud?.blockedWords ?? [])],
      synonyms: (q.wordCloud?.synonyms ?? []).map((g) => ({ canonical: g.canonical, variants: [...g.variants] })),
    },
  };
}

export interface PayloadContext {
  /** Cruzamento permitido (somente perguntas de evento). */
  allowCross: boolean;
  /** Pergunta original (edição); se bloqueada, os campos estruturais são preservados. */
  original?: QuestionRow | null;
}

/** Converte os valores do formulário no corpo aceito pela API, aplicando as mesmas normalizações do servidor. */
export function toPayload(v: FormValues, ctx: PayloadContext): QuestionPayload {
  const locked = !!ctx.original?.locked;
  const o = ctx.original;
  const type = locked && o ? o.type : v.type;
  const numeric = isNumericType(type);
  const scored = isScoredType(type);
  const text = isTextType(type);

  let options = numeric || text
    ? []
    : v.options.map((op) => ({
        ...(op.id ? { id: op.id } : {}),
        label: op.label,
        imageUrl: op.imageUrl || null,
        isCorrect: scored ? !!op.isCorrect : false,
        color: op.color || null,
      }));
  let minSelections = v.minSelections;
  let maxSelections = v.maxSelections;
  if (isForcedSingle(type)) minSelections = maxSelections = 1;
  let scaleMin: number | null = numeric ? (type === "NPS" ? 0 : v.scaleMin) : null;
  let scaleMax: number | null = numeric ? (type === "NPS" ? 10 : v.scaleMax) : null;
  let scoring: ScoringConfig | null = scored ? { ...v.scoring } : null;
  let wordCloud: WordCloudRules | null = text ? cleanWordCloudRules(v.wordCloud) : null;

  if (locked && o) {
    // campos estruturais não podem mudar: envia exatamente o que está gravado
    minSelections = o.minSelections;
    maxSelections = o.maxSelections;
    scaleMin = o.scaleMin;
    scaleMax = o.scaleMax;
    scoring = o.scoring;
    // nuvem: regras de coleta ficam como gravadas; sinônimos, bloqueios e agrupamento seguem editáveis
    if (wordCloud && o.wordCloud) {
      const w = o.wordCloud;
      wordCloud = { ...wordCloud, mode: w.mode, maxWords: w.maxWords, maxEntries: w.maxEntries, maxChars: w.maxChars, allowRepeat: w.allowRepeat, requireApproval: w.requireApproval };
    }
    const byId = new Map(o.options.map((x) => [x.id, x]));
    options = options.map((op) => ("id" in op && op.id && byId.has(op.id) ? { ...op, isCorrect: byId.get(op.id)!.isCorrect } : op));
  }

  return {
    type,
    title: v.title,
    description: v.description || null,
    imageUrl: v.imageUrl || null,
    category: v.category || null,
    tags: v.tags,
    required: v.required,
    minSelections,
    maxSelections,
    scaleMin,
    scaleMax,
    scaleMinLabel: numeric ? v.scaleMinLabel || null : null,
    scaleMaxLabel: numeric ? v.scaleMaxLabel || null : null,
    timeLimitSec: v.timeLimitSec ?? null,
    allowEdit: text ? false : v.allowEdit,
    scoring,
    chart: {
      type: text ? "wordcloud" : v.chart.type,
      colors: numeric && v.chart.colors && v.chart.colors.length ? v.chart.colors : null,
      showPercent: v.chart.showPercent,
      showValues: v.chart.showValues,
      showLegend: v.chart.showLegend,
      sortDesc: v.chart.sortDesc,
      crossQuestionId: ctx.allowCross && !text ? v.chart.crossQuestionId || null : null,
      wordCloud: text ? { ...DEFAULT_WORD_CLOUD_DISPLAY, ...v.chart.wordCloud } : null,
    },
    resultsMode: v.resultsMode,
    explanation: v.explanation || null,
    options,
    wordCloud,
  };
}

/**
 * Remove termos vazios dos bloqueios e das variações (o servidor rejeitaria). Os grupos de sinônimos são
 * mantidos na mesma ordem para que os erros (`wordCloud.synonyms.N`) apontem para a linha certa.
 */
function cleanWordCloudRules(w: WordCloudRules): WordCloudRules {
  return {
    ...DEFAULT_WORD_CLOUD_RULES,
    ...w,
    blockedWords: (w.blockedWords ?? []).map((b) => b.trim()).filter(Boolean),
    synonyms: (w.synonyms ?? []).map((g) => ({ canonical: g.canonical.trim(), variants: g.variants.map((x) => x.trim()).filter(Boolean) })),
  };
}

/* ------------------------------------------------------------------ mensagens em português */
type LooseIssue = { code?: string; expected?: string; origin?: string; minimum?: number | bigint; maximum?: number | bigint; input?: unknown };

/** Mensagens padrão (quando o schema não define uma mensagem própria). */
export function ptErrorMap(raw: unknown): string {
  const iss = raw as LooseIssue;
  switch (iss.code) {
    case "invalid_type":
      if (iss.expected === "int") return "Informe um número inteiro";
      if (iss.expected === "number") return iss.input === undefined || iss.input === null ? "Campo obrigatório" : "Informe um número válido";
      return "Campo obrigatório";
    case "too_small":
      if (iss.origin === "string") return Number(iss.minimum) <= 1 ? "Campo obrigatório" : `Mínimo de ${iss.minimum} caracteres`;
      if (iss.origin === "array") return `Mínimo de ${iss.minimum} itens`;
      return `O valor mínimo é ${String(iss.minimum).replace(".", ",")}`;
    case "too_big":
      if (iss.origin === "string") return `Máximo de ${iss.maximum} caracteres`;
      if (iss.origin === "array") return `Máximo de ${iss.maximum} itens`;
      return `O valor máximo é ${String(iss.maximum).replace(".", ",")}`;
    case "invalid_format":
      return "Formato inválido";
    default:
      return "Valor inválido";
  }
}

/** Valida o payload e devolve erros planos (caminho → mensagem). */
export function validatePayload(payload: QuestionPayload): Record<string, string> {
  const r = questionInputSchema.safeParse(payload, { error: (iss) => ptErrorMap(iss) });
  const out: Record<string, string> = {};
  if (!r.success) for (const i of r.error.issues) out[i.path.map(String).join(".") || "root"] ??= i.message;
  // alternativas em branco também contam como "repetidas": mostra só o erro de texto obrigatório
  if (out.options === "Há alternativas repetidas" && Object.keys(out).some((k) => /^options\.\d+\.label$/.test(k))) delete out.options;
  return out;
}

export function questionResolver(getCtx: () => PayloadContext): Resolver<FormValues> {
  return async (values, _context, options) => {
    const flat = validatePayload(toPayload(values, getCtx()));
    const keys = Object.keys(flat);
    if (keys.length === 0) return { values, errors: {} };
    const errors: Record<string, FieldError> = {};
    for (const k of keys) errors[k] = { type: "validation", message: flat[k] };
    return { values: {}, errors: toNestErrors(errors, options) };
  };
}

/* ------------------------------------------------------------------ abas */
export type EditorTab = "pergunta" | "respostas" | "pontuacao" | "grafico" | "comportamento";

export function tabForPath(path: string): EditorTab {
  const head = path.split(".")[0];
  if (["options", "minSelections", "maxSelections", "scaleMin", "scaleMax", "scaleMinLabel", "scaleMaxLabel"].includes(head)) return "respostas";
  if (head === "wordCloud") return "respostas";
  if (head === "scoring") return "pontuacao";
  if (head === "chart") return "grafico";
  if (["required", "timeLimitSec", "allowEdit", "resultsMode", "explanation"].includes(head)) return "comportamento";
  return "pergunta";
}
