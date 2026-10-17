/**
 * Motor de compatibilidade de gráficos.
 *
 * Garante que só são oferecidas visualizações estatisticamente corretas para a estrutura de dados
 * da pergunta. Regras principais:
 * - Gráficos parte-do-todo (pizza, rosca, rose, semicírculo, treemap, waffle, funil, 100% empilhada,
 *   áreas empilhadas) exigem escolha ÚNICA: em múltipla seleção a soma das seleções excede o
 *   número de respondentes e a "fatia" perderia significado.
 * - Gráficos temporais exigem dimensão temporal real (horário de recebimento das respostas).
 * - Gráficos com duas dimensões categóricas (agrupadas, empilhadas, Sankey, heatmap por segmento)
 *   exigem cruzamento real com outra pergunta de escolha única respondida pelos mesmos participantes.
 * - Dispersão exige duas variáveis numéricas (nota × tempo de resposta) — apenas escala e NPS.
 * - Hierarquias (sunburst, pizza multinível) apenas quando a hierarquia existe de fato:
 *   NPS (grupo → nota), conhecimento (certa/errada → alternativa) ou segmento → resposta.
 */
import { CHART_TYPES, type ChartType } from "./catalog";
import type { QuestionType } from "../schemas";

export interface ChartContext {
  questionType: QuestionType;
  /** Quantidade de categorias (alternativas, ou valores possíveis da escala). */
  categoryCount: number;
  /** Permite selecionar mais de uma alternativa. */
  multiSelect: boolean;
  /** Existe pergunta de escolha única selecionada para cruzamento. */
  hasCross: boolean;
  /** Existe dimensão temporal (respostas com horário do servidor). Verdadeiro para dados de sessão. */
  hasTemporal: boolean;
}

export interface ChartCompatibility {
  type: ChartType;
  compatible: boolean;
  reason?: string;
}

const MAX_SLICES = 8;

const isNumeric = (t: QuestionType) => t === "ESCALA" || t === "NPS";
const isKnowledge = (t: QuestionType) => t === "CONHECIMENTO" || t === "MULTIPLA_CORRETA";

export function checkChart(type: ChartType, ctx: ChartContext): ChartCompatibility {
  const n = ctx.categoryCount;
  const single = !ctx.multiSelect;
  const no = (reason: string): ChartCompatibility => ({ type, compatible: false, reason });
  const ok: ChartCompatibility = { type, compatible: true };
  const partOfWhole = () => {
    if (!single) return no("Gráfico parte-do-todo não representa múltipla seleção corretamente.");
    if (n < 2) return no("Requer pelo menos 2 categorias.");
    if (n > MAX_SLICES) return no(`Requer no máximo ${MAX_SLICES} categorias para manter a legibilidade.`);
    return ok;
  };

  switch (type) {
    case "kpi":
    case "bar_vertical":
    case "bar_horizontal":
    case "column":
    case "lollipop":
      return n >= 1 ? ok : no("Sem categorias.");
    case "pictogram":
      return n <= MAX_SLICES ? ok : no(`Requer no máximo ${MAX_SLICES} categorias.`);
    case "pie":
    case "donut":
    case "rose":
    case "semicircle":
      return partOfWhole();
    case "waffle":
      return partOfWhole();
    case "treemap":
      if (!single) return no("Treemap é parte-do-todo e não se aplica à múltipla seleção.");
      return n >= 2 ? ok : no("Requer pelo menos 2 categorias.");
    case "funnel":
      if (isNumeric(ctx.questionType)) return no("Escalas têm ordem natural; o funil reordenaria os valores.");
      if (!single) return no("Funil não se aplica à múltipla seleção.");
      return n >= 3 ? ok : no("Requer pelo menos 3 alternativas.");
    case "pareto":
      if (isNumeric(ctx.questionType)) return no("Pareto reordena categorias; escalas têm ordem natural.");
      if (!single) return no("O acumulado de Pareto exige escolha única.");
      return n >= 3 ? ok : no("Requer pelo menos 3 alternativas.");
    case "radar":
      if (n < 3) return no("Radar requer pelo menos 3 eixos (alternativas).");
      if (n > 12) return no("Radar com mais de 12 eixos fica ilegível.");
      return ok;
    case "bar_stacked_100":
      if (ctx.hasCross || single) return n >= 2 ? ok : no("Requer pelo menos 2 categorias.");
      return no("Em múltipla seleção as proporções não somam 100%; selecione um cruzamento.");
    case "bar_grouped":
    case "bar_stacked":
      return ctx.hasCross ? ok : no("Requer cruzamento com uma pergunta de perfil (segunda dimensão).");
    case "sankey":
      if (!ctx.hasCross) return no("Sankey requer relação real: cruze com uma pergunta de perfil.");
      if (!single) return no("Sankey com múltipla seleção duplicaria participantes nos fluxos.");
      return ok;
    case "pie_multilevel":
    case "sunburst":
      if (ctx.questionType === "NPS") return ok;
      if (ctx.questionType === "CONHECIMENTO") return ok;
      if (ctx.hasCross && single) return ok;
      return no("Requer hierarquia real (NPS, certo/errado ou cruzamento com perfil).");
    case "line":
    case "area":
    case "step_line":
    case "cumulative":
      return ctx.hasTemporal ? ok : no("Requer dimensão temporal (horário das respostas).");
    case "area_stacked":
      if (!ctx.hasTemporal) return no("Requer dimensão temporal (horário das respostas).");
      if (!single) return no("Empilhar seleções múltiplas distorceria o total de pessoas.");
      return n >= 2 ? ok : no("Requer pelo menos 2 categorias.");
    case "heatmap":
      if (ctx.hasCross) return ok;
      if (ctx.hasTemporal && n >= 2) return ok;
      return no("Requer duas dimensões (tempo ou segmento de perfil).");
    case "scatter":
      return isNumeric(ctx.questionType) ? ok : no("Dispersão requer duas variáveis numéricas (nota × tempo).");
    case "bubble":
      return n >= 2 ? ok : no("Requer pelo menos 2 categorias.");
    case "gauge":
      if (isNumeric(ctx.questionType) || isKnowledge(ctx.questionType) || ctx.questionType === "SIM_NAO") return ok;
      return no("Gauge exige um indicador único (média, NPS, % de acerto ou % de Sim).");
  }
}

export function chartCompatibilityList(ctx: ChartContext): ChartCompatibility[] {
  return CHART_TYPES.map((t) => checkChart(t, ctx));
}

export function compatibleCharts(ctx: ChartContext): ChartType[] {
  return chartCompatibilityList(ctx)
    .filter((c) => c.compatible)
    .map((c) => c.type);
}

export function isChartCompatible(type: ChartType, ctx: ChartContext): boolean {
  return checkChart(type, ctx).compatible;
}

export function defaultChartFor(ctx: ChartContext): ChartType {
  switch (ctx.questionType) {
    case "SIM_NAO":
      return "donut";
    case "NPS":
      return "gauge";
    case "ESCALA":
      return "column";
    case "CONHECIMENTO":
    case "MULTIPLA_CORRETA":
      return "bar_horizontal";
    default:
      return ctx.multiSelect || ctx.categoryCount > 5 ? "bar_horizontal" : "donut";
  }
}

/** Monta o contexto de compatibilidade a partir da estrutura de uma pergunta. */
export function chartContextForQuestion(q: {
  type: QuestionType;
  optionCount: number;
  maxSelections: number;
  scaleMin?: number | null;
  scaleMax?: number | null;
  hasCross?: boolean;
  hasTemporal?: boolean;
}): ChartContext {
  const numeric = q.type === "ESCALA" || q.type === "NPS";
  const categoryCount = numeric ? Math.max(0, (q.scaleMax ?? 10) - (q.scaleMin ?? 0) + 1) : q.optionCount;
  return {
    questionType: q.type,
    categoryCount,
    multiSelect: !numeric && q.maxSelections > 1,
    hasCross: !!q.hasCross,
    hasTemporal: q.hasTemporal ?? true,
  };
}
