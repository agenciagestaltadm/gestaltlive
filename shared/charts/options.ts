/**
 * Geração das opções do ECharts a partir dos resultados agregados (função pura, sem dependências
 * de DOM). Cada tipo usa apenas dados reais presentes em ResultsDTO — nenhuma relação é inventada.
 */
import type { ResultsDTO } from "../types";
import type { ChartType } from "./catalog";
import { DEMO_WORD_CLOUD, type WordCloudDisplay, type WordCloudMode } from "../wordcloud";

export interface ChartRenderConfig {
  showPercent: boolean;
  showValues: boolean;
  showLegend: boolean;
  sortDesc: boolean;
  colors: string[] | null;
  /** Aparência da Nuvem de Palavras (somente nesse tipo). */
  wordCloud?: Partial<WordCloudDisplay> | null;
}

export interface BuildOptions {
  theme: "dark" | "light";
  config: ChartRenderConfig;
  /** Telão: fontes maiores. */
  large?: boolean;
  reducedMotion?: boolean;
}

/** Paleta categórica acessível, iniciada pela cor da marca. Distinguível em fundo claro e escuro. */
export const PALETTE = ["#FF0068", "#3B82F6", "#F5B700", "#10B981", "#8B5CF6", "#F97316", "#06B6D4", "#EC4899", "#84CC16", "#94A3B8", "#14B8A6", "#EAB308"];
export const CORRECT_COLOR = "#22C55E";
const POSITIVE = "#22C55E";
const NEGATIVE = "#EF4444";
const NEUTRAL = "#F5B700";

type Opt = Record<string, unknown>;

function tokens(theme: "dark" | "light") {
  return theme === "dark"
    ? { text: "#E8ECF7", muted: "#9AA3C0", grid: "rgba(255,255,255,0.08)", axis: "rgba(255,255,255,0.18)", surface: "#111F45", tooltipBg: "#0B1736" }
    : { text: "#0B1736", muted: "#5B6480", grid: "rgba(11,23,54,0.08)", axis: "rgba(11,23,54,0.2)", surface: "#FFFFFF", tooltipBg: "#FFFFFF" };
}

const fmtPct = (v: number) => `${v.toFixed(v >= 10 || v === 0 ? 0 : 1).replace(".", ",")}%`;
const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
const fmtTime = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min${s % 60 ? ` ${s % 60}s` : ""}`;
};

function hexToRgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

interface Cat {
  id: string;
  label: string;
  count: number;
  pct: number;
  color: string;
  isCorrect: boolean | null;
  avgResponseMs: number | null;
}

function categories(data: ResultsDTO, cfg: ChartRenderConfig): Cat[] {
  const cats = data.categories.map((c, i) => {
    let color = cfg.colors?.[i] ?? c.color ?? PALETTE[i % PALETTE.length];
    if (c.isCorrect === true) color = CORRECT_COLOR;
    else if (c.isCorrect === false && data.categories.some((x) => x.isCorrect === true)) color = hexToRgba(color.startsWith("#") ? color : "#94A3B8", 0.4);
    return { id: c.id, label: c.label, count: c.count, pct: c.pct, color, isCorrect: c.isCorrect, avgResponseMs: c.avgResponseMs };
  });
  return cfg.sortDesc ? [...cats].sort((a, b) => b.count - a.count) : cats;
}

function labelText(cfg: ChartRenderConfig, count: number, pct: number) {
  const parts: string[] = [];
  if (cfg.showValues) parts.push(String(count));
  if (cfg.showPercent) parts.push(cfg.showValues ? `(${fmtPct(pct)})` : fmtPct(pct));
  return parts.join(" ");
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function base(o: BuildOptions, extra: Opt = {}): Opt {
  const t = tokens(o.theme);
  const fs = o.large ? 18 : 12;
  return {
    backgroundColor: "transparent",
    animation: !o.reducedMotion,
    animationDuration: 700,
    animationDurationUpdate: 500,
    animationEasing: "cubicOut",
    animationEasingUpdate: "cubicInOut",
    textStyle: { fontFamily: "Lato, 'Segoe UI', system-ui, sans-serif", color: t.text, fontSize: fs },
    tooltip: {
      trigger: "item",
      backgroundColor: t.tooltipBg,
      borderColor: t.axis,
      textStyle: { color: t.text, fontSize: 13 },
      confine: true,
    },
    legend: o.config.showLegend
      ? { bottom: 0, type: "scroll", textStyle: { color: t.muted, fontSize: o.large ? 16 : 12 }, icon: "roundRect", itemWidth: 12, itemHeight: 12 }
      : { show: false },
    ...extra,
  };
}

function axisCommon(o: BuildOptions) {
  const t = tokens(o.theme);
  const fs = o.large ? 16 : 12;
  return {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: fs },
    splitLine: { lineStyle: { color: t.grid } },
  };
}

function waitingOption(o: BuildOptions, text = "Aguardando respostas"): Opt {
  const t = tokens(o.theme);
  return {
    backgroundColor: "transparent",
    graphic: [
      {
        type: "text",
        left: "center",
        top: "middle",
        style: { text, fill: t.muted, fontSize: o.large ? 32 : 18, fontFamily: "Lato, system-ui, sans-serif", fontWeight: 700 },
      },
    ],
  };
}

/* ------------------------------------------------------------------ hierarquias reais */
interface Node {
  name: string;
  value?: number;
  itemStyle?: { color: string };
  children?: Node[];
}

function hierarchy(data: ResultsDTO, cats: Cat[]): Node[] | null {
  if (data.questionType === "NPS") {
    const groups = [
      { name: "Detratores (0–6)", color: NEGATIVE, test: (v: number) => v <= 6 },
      { name: "Neutros (7–8)", color: NEUTRAL, test: (v: number) => v === 7 || v === 8 },
      { name: "Promotores (9–10)", color: POSITIVE, test: (v: number) => v >= 9 },
    ];
    return groups.map((g) => ({
      name: g.name,
      itemStyle: { color: g.color },
      children: cats.filter((c) => g.test(Number(c.label)) && c.count > 0).map((c) => ({ name: `Nota ${c.label}`, value: c.count, itemStyle: { color: hexToRgba(g.color, 0.75) } })),
    }));
  }
  if (data.questionType === "CONHECIMENTO" && cats.some((c) => c.isCorrect !== null)) {
    return [
      { name: "Corretas", itemStyle: { color: CORRECT_COLOR }, children: cats.filter((c) => c.isCorrect && c.count > 0).map((c) => ({ name: c.label, value: c.count, itemStyle: { color: CORRECT_COLOR } })) },
      { name: "Incorretas", itemStyle: { color: NEGATIVE }, children: cats.filter((c) => !c.isCorrect && c.count > 0).map((c, i) => ({ name: c.label, value: c.count, itemStyle: { color: hexToRgba(PALETTE[(i + 1) % PALETTE.length], 0.85) } })) },
    ];
  }
  if (data.cross && !data.multiSelect) {
    return data.cross.segments.map((seg, si) => ({
      name: seg,
      itemStyle: { color: PALETTE[si % PALETTE.length] },
      children: cats.map((c) => ({ name: c.label, value: data.cross!.matrix[si]?.[data.categories.findIndex((x) => x.id === c.id)] ?? 0, itemStyle: { color: hexToRgba(PALETTE[si % PALETTE.length], 0.6) } })).filter((x) => (x.value ?? 0) > 0),
    }));
  }
  if (data.questionType === "CONHECIMENTO") {
    // gabarito ainda não revelado: um único nível real (respostas)
    return [{ name: "Respostas", itemStyle: { color: PALETTE[1] }, children: cats.map((c) => ({ name: c.label, value: c.count, itemStyle: { color: c.color } })) }];
  }
  return null;
}

/* ------------------------------------------------------------------ waffle (100 células) */
function waffleCells(cats: Cat[], total: number) {
  if (total <= 0) return cats.map(() => 0);
  const raw = cats.map((c) => (c.count / total) * 100);
  const cells = raw.map(Math.floor);
  let rest = 100 - cells.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r);
  for (const { i } of order) {
    if (rest <= 0) break;
    cells[i]++;
    rest--;
  }
  return cells;
}

/* ------------------------------------------------------------------ construtor principal */
export function buildChartOption(type: ChartType, data: ResultsDTO, o: BuildOptions): Opt {
  const t = tokens(o.theme);
  const cfg = o.config;
  const cats = categories(data, cfg);
  const respondents = data.totals.respondents;
  const fs = o.large ? 18 : 12;
  if (respondents === 0 && type !== "kpi") return waitingOption(o);
  const labels = cats.map((c) => c.label);
  const ax = axisCommon(o);
  const tooltipFmt = (p: { name: string; value: number; dataIndex: number }) => {
    const c = cats[p.dataIndex];
    return c ? `<b>${c.label}</b><br/>${c.count} ${c.count === 1 ? "resposta" : "respostas"} · ${fmtPct(c.pct)} dos respondentes` : p.name;
  };
  const barData = cats.map((c) => ({ value: c.count, itemStyle: { color: c.color, borderRadius: 6 } }));
  const barLabel = { show: cfg.showValues || cfg.showPercent, color: t.text, fontSize: fs, fontWeight: 700, formatter: (p: { dataIndex: number }) => labelText(cfg, cats[p.dataIndex].count, cats[p.dataIndex].pct) };

  switch (type) {
    case "bar_vertical":
    case "column":
      return base(o, {
        legend: { show: false },
        tooltip: { ...(base(o).tooltip as Opt), formatter: tooltipFmt },
        grid: { left: 16, right: 16, top: 40, bottom: 8, containLabel: true },
        xAxis: { type: "category", data: labels.map((l) => truncate(l, 22)), ...ax, axisLabel: { ...ax.axisLabel, interval: 0, width: o.large ? 160 : 100, overflow: "break" }, splitLine: { show: false } },
        yAxis: { type: "value", minInterval: 1, ...ax },
        series: [{ type: "bar", data: barData, barMaxWidth: type === "column" ? 120 : 56, barCategoryGap: type === "column" ? "18%" : "40%", label: { ...barLabel, position: "top" } }],
      });
    case "bar_horizontal":
    // nuvem de palavras: barras dos termos mais citados (miniaturas, PDF e telas sem a nuvem desenhada)
    case "wordcloud":
      return base(o, {
        legend: { show: false },
        tooltip: { ...(base(o).tooltip as Opt), formatter: tooltipFmt },
        grid: { left: 8, right: 90, top: 8, bottom: 8, containLabel: true },
        yAxis: { type: "category", inverse: true, data: labels.map((l) => truncate(l, 40)), ...ax, splitLine: { show: false } },
        xAxis: { type: "value", minInterval: 1, ...ax },
        series: [{ type: "bar", data: barData, barMaxWidth: 44, label: { ...barLabel, position: "right" } }],
      });
    case "lollipop":
      return base(o, {
        legend: { show: false },
        tooltip: { ...(base(o).tooltip as Opt), formatter: tooltipFmt },
        grid: { left: 8, right: 90, top: 8, bottom: 8, containLabel: true },
        yAxis: { type: "category", inverse: true, data: labels.map((l) => truncate(l, 40)), ...ax, splitLine: { show: false } },
        xAxis: { type: "value", minInterval: 1, ...ax },
        series: [
          { type: "bar", data: cats.map((c) => ({ value: c.count, itemStyle: { color: c.color } })), barWidth: 4, silent: true },
          { type: "scatter", data: cats.map((c) => ({ value: c.count, itemStyle: { color: c.color } })), symbolSize: o.large ? 28 : 18, label: { ...barLabel, show: true, position: "right" } },
        ],
      });
    case "pictogram": {
      const person =
        "path://M12 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 10c4.4 0 8 2.2 8 5v3H4v-3c0-2.8 3.6-5 8-5z";
      const max = Math.max(...cats.map((c) => c.count), 1);
      const unit = Math.max(1, Math.ceil(max / 20));
      return base(o, {
        legend: { show: false },
        tooltip: { ...(base(o).tooltip as Opt), formatter: tooltipFmt },
        grid: { left: 8, right: 100, top: 8, bottom: 24, containLabel: true },
        yAxis: { type: "category", inverse: true, data: labels.map((l) => truncate(l, 32)), ...ax, splitLine: { show: false } },
        xAxis: { type: "value", show: false, max: Math.ceil(max / unit) * unit },
        graphic: unit > 1 ? [{ type: "text", right: 8, bottom: 0, style: { text: `cada ícone = ${unit} pessoas`, fill: t.muted, fontSize: 12 } }] : [],
        series: [
          {
            type: "pictorialBar",
            data: cats.map((c) => ({ value: c.count, itemStyle: { color: c.color } })),
            symbol: person,
            symbolRepeat: true,
            symbolSize: o.large ? [26, 26] : [18, 18],
            symbolMargin: 3,
            symbolClip: true,
            symbolBoundingData: Math.ceil(max / unit) * unit,
            label: { ...barLabel, show: true, position: "right" },
          },
        ],
      });
    }
    case "bar_stacked_100": {
      if (data.cross) {
        const rows = data.cross.segments;
        return base(o, {
          tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => fmtPct(v) },
          grid: { left: 8, right: 16, top: 8, bottom: 40, containLabel: true },
          yAxis: { type: "category", data: rows, ...ax, splitLine: { show: false } },
          xAxis: { type: "value", max: 100, ...ax, axisLabel: { ...ax.axisLabel, formatter: "{value}%" } },
          series: cats.map((c) => {
            const ci = data.categories.findIndex((x) => x.id === c.id);
            return {
              type: "bar",
              stack: "total",
              name: c.label,
              itemStyle: { color: c.color },
              label: { show: cfg.showPercent, formatter: (p: { value: number }) => (p.value >= 6 ? fmtPct(p.value) : ""), color: "#fff", fontWeight: 700 },
              data: rows.map((_, si) => {
                const rowTotal = data.cross!.matrix[si].reduce((a, b) => a + b, 0);
                return rowTotal ? (data.cross!.matrix[si][ci] / rowTotal) * 100 : 0;
              }),
            };
          }),
        });
      }
      return base(o, {
        tooltip: { trigger: "item", formatter: (p: { seriesName: string; value: number }) => `${p.seriesName}: ${fmtPct(p.value)}` },
        grid: { left: 8, right: 16, top: 30, bottom: 40, containLabel: true },
        yAxis: { type: "category", data: ["Respostas"], show: false },
        xAxis: { type: "value", max: 100, ...ax, axisLabel: { ...ax.axisLabel, formatter: "{value}%" } },
        series: cats.map((c) => ({
          type: "bar",
          stack: "total",
          name: c.label,
          barWidth: o.large ? 110 : 64,
          itemStyle: { color: c.color },
          label: { show: true, formatter: () => (c.pct >= 6 ? fmtPct(c.pct) : ""), color: "#fff", fontWeight: 700, fontSize: fs },
          data: [c.pct],
        })),
      });
    }
    case "bar_grouped":
    case "bar_stacked": {
      if (!data.cross) return waitingOption(o, "Selecione uma pergunta de perfil para cruzar");
      const seg = data.cross.segments;
      return base(o, {
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        grid: { left: 8, right: 16, top: 16, bottom: 40, containLabel: true },
        xAxis: { type: "category", data: seg, ...ax, splitLine: { show: false } },
        yAxis: { type: "value", minInterval: 1, ...ax },
        series: cats.map((c) => {
          const ci = data.categories.findIndex((x) => x.id === c.id);
          return {
            type: "bar",
            name: c.label,
            stack: type === "bar_stacked" ? "s" : undefined,
            itemStyle: { color: c.color, borderRadius: type === "bar_grouped" ? 4 : 0 },
            label: { show: cfg.showValues && type === "bar_grouped", position: "top", color: t.text },
            data: seg.map((_, si) => data.cross!.matrix[si]?.[ci] ?? 0),
          };
        }),
      });
    }
    case "pie":
    case "donut":
    case "rose":
    case "semicircle": {
      const radius = type === "pie" ? [0, "68%"] : type === "rose" ? ["12%", "72%"] : type === "semicircle" ? ["55%", "95%"] : ["48%", "72%"];
      const center = type === "semicircle" ? ["50%", "75%"] : ["50%", cfg.showLegend ? "46%" : "50%"];
      return base(o, {
        tooltip: { trigger: "item", formatter: (p: { dataIndex: number }) => tooltipFmt({ name: "", value: 0, dataIndex: p.dataIndex }) },
        graphic:
          type === "donut" || type === "semicircle"
            ? [
                {
                  type: "group",
                  left: "center",
                  top: type === "semicircle" ? "58%" : cfg.showLegend ? "40%" : "44%",
                  children: [
                    { type: "text", left: "center", style: { text: String(respondents), fill: t.text, fontSize: o.large ? 56 : 30, fontWeight: 900, textAlign: "center" } },
                    { type: "text", left: "center", top: o.large ? 62 : 36, style: { text: respondents === 1 ? "respondente" : "respondentes", fill: t.muted, fontSize: o.large ? 18 : 12, textAlign: "center" } },
                  ],
                },
              ]
            : [],
        series: [
          {
            type: "pie",
            radius,
            center,
            roseType: type === "rose" ? "radius" : undefined,
            startAngle: type === "semicircle" ? 180 : 90,
            endAngle: type === "semicircle" ? 360 : undefined,
            avoidLabelOverlap: true,
            itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: type === "pie" ? 4 : 8 },
            label: {
              show: cfg.showValues || cfg.showPercent,
              color: t.text,
              fontSize: fs,
              formatter: (p: { dataIndex: number }) => `${truncate(cats[p.dataIndex].label, 24)}\n${labelText(cfg, cats[p.dataIndex].count, cats[p.dataIndex].pct)}`,
            },
            labelLine: { lineStyle: { color: t.axis } },
            // fatias zeradas não recebem rótulo (evita sobreposição); continuam na legenda
            data: cats.map((c) => ({ name: c.label, value: c.count, itemStyle: { color: c.color }, label: { show: c.count > 0 }, labelLine: { show: c.count > 0 } })),
          },
        ],
      });
    }
    case "pie_multilevel": {
      const h = hierarchy(data, cats);
      if (!h) return waitingOption(o, "Sem hierarquia disponível");
      const inner = h.map((n) => ({ name: n.name, value: (n.children ?? []).reduce((a, c) => a + (c.value ?? 0), 0), itemStyle: n.itemStyle }));
      const outer = h.flatMap((n) => n.children ?? []);
      return base(o, {
        tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
        series: [
          { type: "pie", radius: [0, "35%"], label: { position: "inner", color: "#fff", fontWeight: 700, fontSize: fs - 1, formatter: "{b}\n{d}%" }, itemStyle: { borderColor: t.surface, borderWidth: 2 }, data: inner },
          { type: "pie", radius: ["45%", "68%"], label: { color: t.text, fontSize: fs, formatter: "{b}: {c}" }, itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 6 }, data: outer },
        ],
      });
    }
    case "sunburst": {
      const h = hierarchy(data, cats);
      if (!h) return waitingOption(o, "Sem hierarquia disponível");
      return base(o, {
        tooltip: { trigger: "item", formatter: (p: { name: string; value: number }) => `${p.name}: ${p.value ?? ""}` },
        series: [
          {
            type: "sunburst",
            radius: ["12%", "88%"],
            sort: undefined,
            data: h,
            itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 },
            label: { color: "#fff", fontSize: fs - 1, minAngle: 12, rotate: "radial" },
            levels: [{}, { r0: "12%", r: "45%", label: { rotate: "tangential", fontWeight: 700 } }, { r0: "45%", r: "88%" }],
          },
        ],
      });
    }
    case "treemap":
      return base(o, {
        legend: { show: false },
        tooltip: { formatter: (p: { name: string; value: number }) => `${p.name}: ${p.value} (${fmtPct((p.value / respondents) * 100)})` },
        series: [
          {
            type: "treemap",
            roam: false,
            nodeClick: false,
            breadcrumb: { show: false },
            width: "100%",
            height: "100%",
            itemStyle: { borderColor: t.surface, borderWidth: 3, gapWidth: 3, borderRadius: 8 },
            label: { show: true, color: "#fff", fontSize: o.large ? 22 : 14, fontWeight: 700, formatter: (p: { name: string; value: number }) => `${p.name}\n${labelText(cfg, p.value, (p.value / respondents) * 100)}` },
            data: cats.filter((c) => c.count > 0).map((c) => ({ name: c.label, value: c.count, itemStyle: { color: c.color } })),
          },
        ],
      });
    case "funnel":
      return base(o, {
        tooltip: { trigger: "item", formatter: (p: { name: string; value: number }) => `${p.name}: ${p.value}` },
        series: [
          {
            type: "funnel",
            left: "10%",
            width: "80%",
            top: 10,
            bottom: cfg.showLegend ? 40 : 10,
            sort: "descending",
            gap: 4,
            label: { show: true, position: "inside", color: "#fff", fontWeight: 700, fontSize: fs, formatter: (p: { name: string; value: number }) => `${truncate(p.name, 26)}  ${labelText(cfg, p.value, (p.value / respondents) * 100)}` },
            itemStyle: { borderColor: t.surface, borderWidth: 1 },
            data: cats.map((c) => ({ name: c.label, value: c.count, itemStyle: { color: c.color } })),
          },
        ],
      });
    case "radar": {
      const max = Math.max(...cats.map((c) => c.count), 1);
      const series = data.cross
        ? data.cross.segments.map((seg, si) => ({
            name: seg,
            value: cats.map((c) => data.cross!.matrix[si]?.[data.categories.findIndex((x) => x.id === c.id)] ?? 0),
            itemStyle: { color: PALETTE[si % PALETTE.length] },
            areaStyle: { opacity: 0.15 },
          }))
        : [{ name: "Respostas", value: cats.map((c) => c.count), itemStyle: { color: PALETTE[0] }, areaStyle: { opacity: 0.25 } }];
      return base(o, {
        tooltip: { trigger: "item" },
        radar: {
          indicator: cats.map((c) => ({ name: truncate(c.label, 18), max })),
          axisName: { color: t.muted, fontSize: fs },
          splitLine: { lineStyle: { color: t.grid } },
          splitArea: { show: false },
          axisLine: { lineStyle: { color: t.axis } },
          radius: "65%",
        },
        series: [{ type: "radar", data: series, symbolSize: 6 }],
      });
    }
    case "pareto": {
      const sorted = [...cats].sort((a, b) => b.count - a.count);
      const total = sorted.reduce((a, c) => a + c.count, 0) || 1;
      let acc = 0;
      const cumulative = sorted.map((c) => ((acc += c.count) / total) * 100);
      return base(o, {
        tooltip: { trigger: "axis" },
        grid: { left: 16, right: 16, top: 30, bottom: 40, containLabel: true },
        xAxis: { type: "category", data: sorted.map((c) => truncate(c.label, 18)), ...ax, axisLabel: { ...ax.axisLabel, interval: 0 }, splitLine: { show: false } },
        yAxis: [
          { type: "value", minInterval: 1, ...ax, name: "Respostas", nameTextStyle: { color: t.muted } },
          { type: "value", max: 100, ...ax, axisLabel: { ...ax.axisLabel, formatter: "{value}%" }, splitLine: { show: false } },
        ],
        series: [
          { type: "bar", name: "Respostas", data: sorted.map((c) => ({ value: c.count, itemStyle: { color: c.color, borderRadius: 6 } })), barMaxWidth: 56, label: { show: cfg.showValues, position: "top", color: t.text } },
          { type: "line", name: "% acumulado", yAxisIndex: 1, data: cumulative.map((v) => Number(v.toFixed(1))), smooth: false, symbolSize: 8, itemStyle: { color: NEUTRAL }, lineStyle: { width: 3 }, label: { show: cfg.showPercent, formatter: (p: { value: number }) => fmtPct(p.value), color: t.text, position: "top" } },
        ],
      });
    }
    case "waffle": {
      const cells = waffleCells(cats, cats.reduce((a, c) => a + c.count, 0));
      const points: { value: [number, number]; itemStyle: { color: string }; name: string }[] = [];
      let k = 0;
      cats.forEach((c, ci) => {
        for (let n = 0; n < cells[ci]; n++, k++) points.push({ value: [k % 10, 9 - Math.floor(k / 10)], itemStyle: { color: c.color }, name: c.label });
      });
      return base(o, {
        tooltip: { trigger: "item", formatter: (p: { name: string }) => { const c = cats.find((x) => x.label === p.name)!; return `${c.label}: ${fmtPct(c.pct)}`; } },
        legend: cfg.showLegend ? { ...(base(o).legend as Opt), data: cats.map((c) => c.label) } : { show: false },
        grid: { left: "center", top: 8, width: "60%", bottom: cfg.showLegend ? 40 : 8, containLabel: false },
        xAxis: { type: "value", min: -0.5, max: 9.5, show: false },
        yAxis: { type: "value", min: -0.5, max: 9.5, show: false },
        series: cats.map((c) => ({
          type: "scatter",
          name: c.label,
          symbol: "roundRect",
          symbolSize: o.large ? 34 : 18,
          itemStyle: { color: c.color },
          data: points.filter((p) => p.name === c.label),
        })),
      });
    }
    case "kpi": {
      const rate = data.totals.participants ? (respondents / data.totals.participants) * 100 : 0;
      const top = [...data.categories].sort((a, b) => b.count - a.count)[0];
      const items: [string, string][] = [
        ["Respondentes", String(respondents)],
        ["Participação", fmtPct(rate)],
      ];
      if (data.numeric?.nps && data.numeric.nps.score !== null) items.push(["NPS", String(data.numeric.nps.score)]);
      else if (data.numeric?.mean !== null && data.numeric?.mean !== undefined) items.push(["Média", data.numeric.mean.toFixed(1).replace(".", ",")]);
      else if (data.accuracyPct !== null) items.push(["Acerto", fmtPct(data.accuracyPct)]);
      else if (top && respondents) items.push(["Mais escolhida", truncate(top.label, 18)]);
      return {
        backgroundColor: "transparent",
        graphic: items.map(([label, value], i) => ({
          type: "group",
          left: `${(100 / items.length) * i + 100 / items.length / 2 - 12}%`,
          top: "middle",
          children: [
            { type: "text", style: { text: value, fill: i === 0 ? "#FF0068" : t.text, fontSize: o.large ? 64 : 34, fontWeight: 900, fontFamily: "Lato, system-ui" } },
            { type: "text", top: o.large ? 76 : 42, style: { text: label, fill: t.muted, fontSize: o.large ? 20 : 13, fontFamily: "Lato, system-ui" } },
          ],
        })),
      };
    }
    case "line":
    case "area":
    case "step_line":
    case "cumulative": {
      const pts = data.timeline.points;
      const x = pts.map((p) => fmtTime(p.t));
      const values =
        type === "line" ? pts.map((p, i) => p.respondents - (i > 0 ? pts[i - 1].respondents : 0)) : pts.map((p) => p.respondents);
      const name = type === "line" ? "Novas respostas" : "Respondentes acumulados";
      return base(o, {
        legend: { show: false },
        tooltip: { trigger: "axis" },
        grid: { left: 16, right: 24, top: 36, bottom: 16, containLabel: true },
        xAxis: { type: "category", boundaryGap: false, data: x, ...ax, name: "tempo desde a abertura", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: t.muted } },
        yAxis: { type: "value", minInterval: 1, ...ax, name, nameTextStyle: { color: t.muted } },
        series: [
          {
            type: "line",
            name,
            data: values,
            smooth: type === "area" || type === "line",
            step: type === "step_line" ? "end" : undefined,
            symbolSize: type === "cumulative" ? 8 : 4,
            showSymbol: type === "cumulative",
            lineStyle: { width: 3, color: PALETTE[0] },
            itemStyle: { color: PALETTE[0] },
            areaStyle:
              type === "area"
                ? { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: hexToRgba(PALETTE[0], 0.45) }, { offset: 1, color: hexToRgba(PALETTE[0], 0) }] } }
                : undefined,
            markLine: type === "cumulative" ? { symbol: "none", lineStyle: { color: t.muted, type: "dashed" }, label: { color: t.muted, formatter: "inscritos: {c}" }, data: [{ yAxis: data.totals.participants }] } : undefined,
          },
        ],
      });
    }
    case "area_stacked": {
      const pts = data.timeline.points;
      return base(o, {
        tooltip: { trigger: "axis" },
        grid: { left: 16, right: 24, top: 16, bottom: 40, containLabel: true },
        xAxis: { type: "category", boundaryGap: false, data: pts.map((p) => fmtTime(p.t)), ...ax },
        yAxis: { type: "value", minInterval: 1, ...ax },
        series: cats.map((c) => {
          const ci = data.categories.findIndex((x) => x.id === c.id);
          return { type: "line", name: c.label, stack: "total", smooth: true, showSymbol: false, lineStyle: { width: 1, color: c.color }, itemStyle: { color: c.color }, areaStyle: { color: hexToRgba(c.color.startsWith("#") ? c.color : "#94A3B8", 0.55) }, data: pts.map((p) => p.byCategory[ci] ?? 0) };
        }),
      });
    }
    case "heatmap": {
      let xs: string[];
      let ys: string[];
      let cells: [number, number, number][];
      if (data.cross) {
        xs = cats.map((c) => truncate(c.label, 16));
        ys = data.cross.segments;
        cells = [];
        data.cross.segments.forEach((_, si) => cats.forEach((c, xi) => cells.push([xi, si, data.cross!.matrix[si]?.[data.categories.findIndex((x) => x.id === c.id)] ?? 0])));
      } else {
        const pts = data.timeline.points;
        xs = pts.map((p) => fmtTime(p.t));
        ys = cats.map((c) => truncate(c.label, 22));
        cells = [];
        cats.forEach((c, yi) => {
          const ci = data.categories.findIndex((x) => x.id === c.id);
          pts.forEach((p, xi) => cells.push([xi, yi, (p.byCategory[ci] ?? 0) - (xi > 0 ? pts[xi - 1].byCategory[ci] ?? 0 : 0)]));
        });
      }
      const max = Math.max(1, ...cells.map((c) => c[2]));
      return base(o, {
        legend: { show: false },
        tooltip: { trigger: "item", formatter: (p: { value: [number, number, number] }) => `${ys[p.value[1]]} · ${xs[p.value[0]]}: ${p.value[2]}` },
        grid: { left: 8, right: 16, top: 8, bottom: 56, containLabel: true },
        xAxis: { type: "category", data: xs, ...ax, splitArea: { show: false } },
        yAxis: { type: "category", data: ys, ...ax },
        visualMap: { min: 0, max, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemHeight: 120, textStyle: { color: t.muted }, inRange: { color: [o.theme === "dark" ? "#16244F" : "#F1F4FA", "#FF0068"] } },
        series: [{ type: "heatmap", data: cells, label: { show: cells.length <= 80, color: t.text }, itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 } }],
      });
    }
    case "scatter": {
      const pts = (data.scatter ?? []).map((p) => [Number((p.rtMs / 1000).toFixed(2)), p.value]);
      return base(o, {
        legend: { show: false },
        tooltip: { trigger: "item", formatter: (p: { value: [number, number] }) => `Nota ${p.value[1]} em ${p.value[0].toString().replace(".", ",")} s` },
        grid: { left: 16, right: 24, top: 24, bottom: 24, containLabel: true },
        xAxis: { type: "value", name: "tempo de resposta (s)", nameLocation: "middle", nameGap: 28, ...ax, nameTextStyle: { color: t.muted } },
        yAxis: { type: "value", name: "nota", min: data.numeric?.min ?? 0, max: data.numeric?.max ?? 10, interval: 1, ...ax, nameTextStyle: { color: t.muted } },
        series: [{ type: "scatter", data: pts, symbolSize: o.large ? 16 : 10, itemStyle: { color: hexToRgba(PALETTE[0], 0.7) } }],
      });
    }
    case "bubble": {
      const maxCount = Math.max(...cats.map((c) => c.count), 1);
      return base(o, {
        tooltip: {
          trigger: "item",
          formatter: (p: { data: { name: string; value: [number, number, number] } }) =>
            `<b>${p.data.name}</b><br/>Tempo médio: ${fmtSec(p.data.value[0] * 1000)}<br/>${p.data.value[2]} respostas (${fmtPct(p.data.value[1])})`,
        },
        grid: { left: 16, right: 32, top: 24, bottom: 40, containLabel: true },
        xAxis: { type: "value", name: "tempo médio (s)", nameLocation: "middle", nameGap: 28, ...ax, nameTextStyle: { color: t.muted }, scale: true },
        yAxis: { type: "value", name: "% respondentes", ...ax, nameTextStyle: { color: t.muted }, axisLabel: { ...ax.axisLabel, formatter: "{value}%" } },
        series: cats
          .filter((c) => c.count > 0)
          .map((c) => ({
            type: "scatter",
            name: c.label,
            symbolSize: 14 + (c.count / maxCount) * (o.large ? 90 : 56),
            itemStyle: { color: hexToRgba(c.color.startsWith("#") ? c.color : "#94A3B8", 0.75), borderColor: c.color },
            label: { show: true, formatter: truncate(c.label, 12), color: t.text, position: "top" },
            data: [{ name: c.label, value: [Number(((c.avgResponseMs ?? 0) / 1000).toFixed(2)), Number(c.pct.toFixed(1)), c.count] }],
          })),
      });
    }
    case "sankey": {
      if (!data.cross) return waitingOption(o, "Selecione uma pergunta de perfil para cruzar");
      const segNodes = data.cross.segments.map((s, i) => ({ name: `◀ ${s}`, itemStyle: { color: PALETTE[(i + 3) % PALETTE.length] } }));
      const catNodes = cats.map((c) => ({ name: `${c.label} ▶`, itemStyle: { color: c.color } }));
      const links: { source: string; target: string; value: number }[] = [];
      data.cross.segments.forEach((s, si) =>
        cats.forEach((c) => {
          const v = data.cross!.matrix[si]?.[data.categories.findIndex((x) => x.id === c.id)] ?? 0;
          if (v > 0) links.push({ source: `◀ ${s}`, target: `${c.label} ▶`, value: v });
        }),
      );
      return base(o, {
        legend: { show: false },
        tooltip: { trigger: "item" },
        series: [{ type: "sankey", left: 8, right: 120, top: 8, bottom: 8, nodeGap: 12, data: [...segNodes, ...catNodes], links, lineStyle: { color: "gradient", opacity: 0.35, curveness: 0.5 }, label: { color: t.text, fontSize: fs }, emphasis: { focus: "adjacency" } }],
      });
    }
    case "gauge": {
      let value = 0;
      let min = 0;
      let max = 100;
      let label = "";
      let suffix = "";
      if (data.numeric?.nps) {
        value = data.numeric.nps.score ?? 0;
        min = -100;
        max = 100;
        label = "NPS";
      } else if (data.numeric) {
        value = Number((data.numeric.mean ?? 0).toFixed(2));
        min = data.numeric.min;
        max = data.numeric.max;
        label = "Média";
      } else if (data.accuracyPct !== null) {
        value = Number(data.accuracyPct.toFixed(1));
        label = "Acerto";
        suffix = "%";
      } else if (data.questionType === "SIM_NAO") {
        value = Number((data.categories[0]?.pct ?? 0).toFixed(1));
        label = `% ${data.categories[0]?.label ?? "Sim"}`;
        suffix = "%";
      } else {
        value = data.totals.participants ? Number(((respondents / data.totals.participants) * 100).toFixed(1)) : 0;
        label = "Participação";
        suffix = "%";
      }

      const stops =
        label === "NPS"
          ? [[0.5, NEGATIVE], [0.75, NEUTRAL], [1, POSITIVE]]
          : [[0.4, NEGATIVE], [0.7, NEUTRAL], [1, POSITIVE]];
      return base(o, {
        legend: { show: false },
        series: [
          {
            type: "gauge",
            min,
            max,
            startAngle: 200,
            endAngle: -20,
            radius: "92%",
            center: ["50%", "60%"],
            splitNumber: label === "NPS" ? 4 : 5,
            progress: { show: true, width: o.large ? 26 : 16, roundCap: true, itemStyle: { color: PALETTE[0] } },
            axisLine: { roundCap: true, lineStyle: { width: o.large ? 26 : 16, color: stops.map(([s, c]) => [s, hexToRgba(c as string, 0.25)]) } },
            pointer: { show: false },
            axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: { color: t.muted, distance: o.large ? 36 : 24, fontSize: o.large ? 16 : 11 },
            anchor: { show: false },
            title: { offsetCenter: [0, "30%"], color: t.muted, fontSize: o.large ? 24 : 14 },
            detail: { valueAnimation: true, offsetCenter: [0, "-5%"], fontSize: o.large ? 72 : 38, fontWeight: 900, color: t.text, formatter: (v: number) => `${String(v).replace(".", ",")}${suffix}` },
            data: [{ value: Math.max(min, Math.min(max, value)), name: label }],
          },
        ],
      });
    }
  }
}

/** Gráfico de pizza da satisfação (apenas votos registrados). */
export function buildSatisfactionPie(positive: number, negative: number, o: Omit<BuildOptions, "config">): Opt {
  const t = tokens(o.theme);
  const total = positive + negative;
  if (total === 0) return waitingOption({ ...o, config: { showLegend: false, showPercent: true, showValues: true, sortDesc: false, colors: null } }, "Sem avaliações");
  return {
    backgroundColor: "transparent",
    animation: !o.reducedMotion,
    animationDurationUpdate: 500,
    textStyle: { fontFamily: "Lato, system-ui, sans-serif" },
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)", backgroundColor: t.tooltipBg, textStyle: { color: t.text } },
    graphic: [
      {
        type: "group",
        left: "center",
        top: "middle",
        children: [
          { type: "text", left: "center", style: { text: `${Math.round((positive / total) * 100)}%`, fill: POSITIVE, fontSize: o.large ? 64 : 32, fontWeight: 900, textAlign: "center" } },
          { type: "text", left: "center", top: o.large ? 72 : 38, style: { text: "valeu a pena", fill: t.muted, fontSize: o.large ? 20 : 12, textAlign: "center" } },
        ],
      },
    ],
    series: [
      {
        type: "pie",
        radius: ["55%", "80%"],
        itemStyle: { borderColor: t.surface, borderWidth: 3, borderRadius: 8 },
        label: { show: true, color: t.text, fontSize: o.large ? 20 : 12, formatter: "{b}\n{c} ({d}%)" },
        data: [
          { name: "Valeu a pena", value: positive, itemStyle: { color: POSITIVE } },
          { name: "Insatisfeito", value: negative, itemStyle: { color: NEGATIVE } },
        ],
      },
    ],
  };
}

/** Evolução temporal da satisfação (% valeu a pena entre avaliações registradas). */
export function buildSatisfactionTimeline(points: { t: string; positive: number; negative: number }[], o: Omit<BuildOptions, "config">): Opt {
  const t = tokens(o.theme);
  if (points.length === 0) return waitingOption({ ...o, config: { showLegend: false, showPercent: true, showValues: true, sortDesc: false, colors: null } }, "Sem avaliações");
  const ax = axisCommon({ ...o, config: { showLegend: false, showPercent: true, showValues: true, sortDesc: false, colors: null } });
  return {
    backgroundColor: "transparent",
    animation: !o.reducedMotion,
    textStyle: { fontFamily: "Lato, system-ui, sans-serif", color: t.text },
    tooltip: { trigger: "axis", backgroundColor: t.tooltipBg, textStyle: { color: t.text } },
    legend: { bottom: 0, textStyle: { color: t.muted } },
    grid: { left: 16, right: 16, top: 16, bottom: 36, containLabel: true },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: points.map((p) => new Date(p.t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })),
      ...ax,
    },
    yAxis: { type: "value", minInterval: 1, ...ax },
    series: [
      { type: "line", name: "Valeu a pena", smooth: true, showSymbol: false, data: points.map((p) => p.positive), itemStyle: { color: POSITIVE }, lineStyle: { width: 3 }, areaStyle: { color: hexToRgba(POSITIVE, 0.15) } },
      { type: "line", name: "Insatisfeito", smooth: true, showSymbol: false, data: points.map((p) => p.negative), itemStyle: { color: NEGATIVE }, lineStyle: { width: 3 }, areaStyle: { color: hexToRgba(NEGATIVE, 0.12) } },
    ],
  };
}

/** Dados fictícios rotulados como prévia, usados apenas no construtor (nunca em sessões). */
export function previewResults(q: {
  type: ResultsDTO["questionType"];
  title: string;
  options: { label: string; color?: string | null; isCorrect?: boolean }[];
  maxSelections: number;
  scaleMin?: number | null;
  scaleMax?: number | null;
  withCross?: boolean;
}): ResultsDTO {
  if (q.type === "NUVEM_PALAVRAS") return previewWordCloud(q.title);
  const numeric = q.type === "ESCALA" || q.type === "NPS";
  const labels = numeric
    ? Array.from({ length: (q.scaleMax ?? 10) - (q.scaleMin ?? 0) + 1 }, (_, i) => String((q.scaleMin ?? 0) + i))
    : q.options.map((o) => o.label || "Alternativa");
  const weights = labels.map((_, i) => (numeric ? 1 + Math.round(6 * Math.exp(-((i - labels.length * 0.7) ** 2) / 6)) : [12, 8, 6, 4, 3, 2, 2, 1][i % 8]));
  const respondents = Math.max(1, numeric ? weights.reduce((a, b) => a + b, 0) : Math.round(weights.reduce((a, b) => a + b, 0) / (q.maxSelections > 1 ? 1.6 : 1)));
  const cats = labels.map((label, i) => ({
    id: `p${i}`,
    label,
    color: numeric ? null : q.options[i]?.color ?? null,
    count: weights[i],
    pct: (weights[i] / respondents) * 100,
    isCorrect: numeric ? null : q.type === "CONHECIMENTO" || q.type === "MULTIPLA_CORRETA" ? !!q.options[i]?.isCorrect : null,
    avgResponseMs: 3000 + i * 1700,
  }));
  const values = numeric ? cats.flatMap((c) => Array(c.count).fill(Number(c.label))) : [];
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const steps = 8;
  return {
    sessionQuestionId: "previa",
    questionType: q.type,
    title: q.title,
    multiSelect: !numeric && q.maxSelections > 1,
    totals: { participants: Math.round(respondents * 1.25), respondents, selections: weights.reduce((a, b) => a + b, 0) },
    categories: cats,
    numeric: numeric
      ? {
          min: q.scaleMin ?? 0,
          max: q.scaleMax ?? 10,
          mean,
          median: mean,
          nps:
            q.type === "NPS"
              ? (() => {
                  const promoters = values.filter((v) => v >= 9).length;
                  const detractors = values.filter((v) => v <= 6).length;
                  return { promoters, passives: values.length - promoters - detractors, detractors, total: values.length, score: Math.round(((promoters - detractors) / values.length) * 100) };
                })()
              : null,
        }
      : null,
    correctRevealed: true,
    accuracyPct: q.type === "CONHECIMENTO" || q.type === "MULTIPLA_CORRETA" ? 58 : null,
    timeline: {
      bucketMs: 5000,
      points: Array.from({ length: steps }, (_, k) => ({
        t: (k + 1) * 5000,
        respondents: Math.round(respondents * Math.min(1, ((k + 1) / steps) ** 0.6)),
        byCategory: cats.map((c) => Math.round(c.count * Math.min(1, ((k + 1) / steps) ** 0.6))),
      })),
    },
    scatter: numeric ? values.map((v, i) => ({ rtMs: 2000 + ((i * 2371) % 15000), value: v })) : null,
    cross: q.withCross
      ? { questionTitle: "Segmento (prévia)", segments: ["Varejo", "Serviços", "Indústria"], matrix: [0, 1, 2].map((s) => cats.map((c, i) => Math.max(0, Math.round(c.count / 3 + ((s - 1) * (i % 3)) / 1.5)))) }
      : null,
    generatedAt: new Date().toISOString(),
  };
}

/** Resultado demonstrativo da Nuvem de Palavras (pré-visualização, galeria e ensaio). */
export function previewWordCloud(title: string, mode: WordCloudMode = "PALAVRA"): ResultsDTO {
  const total = DEMO_WORD_CLOUD.reduce((a, t) => a + t.count, 0);
  const terms = DEMO_WORD_CLOUD.map((t) => ({ key: t.label.toLowerCase(), label: t.label, count: t.count, pct: Math.round((t.count / total) * 1000) / 10 }));
  const respondents = Math.round(total / 1.6);
  return {
    sessionQuestionId: "previa",
    questionType: "NUVEM_PALAVRAS",
    title,
    multiSelect: false,
    totals: { participants: Math.round(respondents * 1.2), respondents, selections: total },
    categories: terms.map((t) => ({ id: t.key, label: t.label, color: null, count: t.count, pct: t.pct, isCorrect: null, avgResponseMs: null })),
    numeric: null,
    correctRevealed: true,
    accuracyPct: null,
    timeline: { bucketMs: 5000, points: [] },
    scatter: null,
    cross: null,
    wordCloud: {
      mode,
      terms,
      denominator: { kind: mode === "FRASE" ? "RESPOSTAS" : "TERMOS", value: total },
      totals: { entries: respondents, termOccurrences: total, uniqueTerms: terms.length, respondents },
    },
    generatedAt: new Date().toISOString(),
  };
}
