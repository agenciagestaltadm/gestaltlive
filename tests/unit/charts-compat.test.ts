import { describe, expect, it } from "vitest";
import { chartContextForQuestion, checkChart, compatibleCharts, defaultChartFor } from "@shared/charts/compat";
import { buildChartOption } from "@shared/charts/options";
import { CHART_TYPES } from "@shared/charts/catalog";
import type { ResultsDTO } from "@shared/types";

const single4 = chartContextForQuestion({ type: "OPINIAO", optionCount: 4, maxSelections: 1 });
const multi5 = chartContextForQuestion({ type: "OPINIAO", optionCount: 5, maxSelections: 3 });

describe("compatibilidade de gráficos", () => {
  it("escolha única com 4 alternativas aceita barras, pizza, rosca e treemap", () => {
    const list = compatibleCharts(single4);
    for (const t of ["bar_vertical", "bar_horizontal", "pie", "donut", "treemap", "waffle", "funnel", "pareto"] as const) expect(list).toContain(t);
  });
  it("múltipla seleção não aceita gráficos parte-do-todo", () => {
    for (const t of ["pie", "donut", "rose", "semicircle", "treemap", "waffle", "funnel", "bar_stacked_100", "area_stacked"] as const) {
      expect(checkChart(t, multi5).compatible).toBe(false);
    }
    expect(checkChart("bar_horizontal", multi5).compatible).toBe(true);
  });
  it("linha só com dimensão temporal", () => {
    expect(checkChart("line", { ...single4, hasTemporal: false }).compatible).toBe(false);
    expect(checkChart("line", single4).compatible).toBe(true);
  });
  it("Sankey e barras agrupadas exigem cruzamento real", () => {
    expect(checkChart("sankey", single4).compatible).toBe(false);
    expect(checkChart("bar_grouped", single4).compatible).toBe(false);
    expect(checkChart("sankey", { ...single4, hasCross: true }).compatible).toBe(true);
    expect(checkChart("sankey", { ...multi5, hasCross: true }).compatible).toBe(false);
  });
  it("dispersão só para escalas e NPS", () => {
    expect(checkChart("scatter", single4).compatible).toBe(false);
    expect(checkChart("scatter", chartContextForQuestion({ type: "NPS", optionCount: 0, maxSelections: 1, scaleMin: 0, scaleMax: 10 })).compatible).toBe(true);
  });
  it("NPS (11 categorias) não aceita pizza; aceita gauge e sunburst", () => {
    const nps = chartContextForQuestion({ type: "NPS", optionCount: 0, maxSelections: 1, scaleMin: 0, scaleMax: 10 });
    expect(nps.categoryCount).toBe(11);
    expect(checkChart("pie", nps).compatible).toBe(false);
    expect(checkChart("gauge", nps).compatible).toBe(true);
    expect(checkChart("sunburst", nps).compatible).toBe(true);
  });
  it("gráfico padrão é sempre compatível", () => {
    for (const type of ["PERFIL", "OPINIAO", "CONHECIMENTO", "MULTIPLA_CORRETA", "SIM_NAO", "ESCALA", "NPS"] as const) {
      const ctx = chartContextForQuestion({ type, optionCount: type === "SIM_NAO" ? 2 : 4, maxSelections: type === "MULTIPLA_CORRETA" ? 3 : 1, scaleMin: type === "ESCALA" ? 1 : 0, scaleMax: type === "ESCALA" ? 5 : 10 });
      expect(checkChart(defaultChartFor(ctx), ctx).compatible).toBe(true);
    }
  });
});

describe("geração das opções ECharts", () => {
  const data: ResultsDTO = {
    sessionQuestionId: "x",
    questionType: "OPINIAO",
    title: "Teste",
    multiSelect: false,
    totals: { participants: 10, respondents: 6, selections: 6 },
    categories: ["A", "B", "C", "D"].map((l, i) => ({ id: l, label: l, color: null, count: i + 1, pct: ((i + 1) / 6) * 100, isCorrect: null, avgResponseMs: 1000 * (i + 1) })),
    numeric: null,
    correctRevealed: false,
    accuracyPct: null,
    timeline: { bucketMs: 5000, points: [1, 2, 3].map((k) => ({ t: k * 5000, respondents: k * 2, byCategory: [k, k, 0, 0] })) },
    scatter: null,
    cross: { questionTitle: "Segmento", segments: ["X", "Y"], matrix: [[1, 1, 1, 1], [0, 1, 2, 3]] },
    generatedAt: new Date().toISOString(),
  };
  it("todos os tipos compatíveis geram uma opção válida sem erro", () => {
    const ctx = { ...single4, hasCross: true };
    for (const t of CHART_TYPES) {
      if (!checkChart(t, ctx).compatible) continue;
      const opt = buildChartOption(t, data, { theme: "dark", config: { showPercent: true, showValues: true, showLegend: true, sortDesc: false, colors: null } });
      expect(opt, t).toBeTruthy();
      expect(JSON.stringify(opt).length, t).toBeGreaterThan(20);
    }
  });
});
