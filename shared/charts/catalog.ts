/** Catálogo de visualizações disponíveis (galeria de gráficos). */

export const CHART_TYPES = [
  // categóricos
  "bar_vertical",
  "bar_horizontal",
  "bar_grouped",
  "bar_stacked",
  "bar_stacked_100",
  "column",
  "lollipop",
  "pictogram",
  // circulares
  "pie",
  "donut",
  "pie_multilevel",
  "rose",
  "semicircle",
  // comparação
  "treemap",
  "funnel",
  "radar",
  "pareto",
  "waffle",
  "kpi",
  // temporais
  "line",
  "area",
  "area_stacked",
  "step_line",
  "cumulative",
  // especiais
  "heatmap",
  "scatter",
  "bubble",
  "sankey",
  "gauge",
  "sunburst",
] as const;

export type ChartType = (typeof CHART_TYPES)[number];

export type ChartGroup = "CATEGORICOS" | "CIRCULARES" | "COMPARACAO" | "TEMPORAIS" | "ESPECIAIS";

export const CHART_GROUP_LABELS: Record<ChartGroup, string> = {
  CATEGORICOS: "Categóricos",
  CIRCULARES: "Circulares",
  COMPARACAO: "Comparação",
  TEMPORAIS: "Temporais",
  ESPECIAIS: "Especiais",
};

export interface ChartMeta {
  label: string;
  group: ChartGroup;
  description: string;
}

export const CHART_META: Record<ChartType, ChartMeta> = {
  bar_vertical: { label: "Barras verticais", group: "CATEGORICOS", description: "Compara a quantidade de respostas por alternativa." },
  bar_horizontal: { label: "Barras horizontais", group: "CATEGORICOS", description: "Ideal para alternativas com textos longos." },
  bar_grouped: { label: "Barras agrupadas", group: "CATEGORICOS", description: "Compara alternativas por segmento de perfil." },
  bar_stacked: { label: "Barras empilhadas", group: "CATEGORICOS", description: "Composição das respostas em cada segmento de perfil." },
  bar_stacked_100: { label: "Barras 100% empilhadas", group: "CATEGORICOS", description: "Proporção de cada alternativa (soma 100%)." },
  column: { label: "Colunas", group: "CATEGORICOS", description: "Colunas largas com valores em destaque." },
  lollipop: { label: "Lollipop", group: "CATEGORICOS", description: "Versão leve das barras, com foco no valor." },
  pictogram: { label: "Pictogramas", group: "CATEGORICOS", description: "Cada ícone representa pessoas que escolheram a opção." },
  pie: { label: "Pizza", group: "CIRCULARES", description: "Distribuição parte-do-todo de uma escolha única." },
  donut: { label: "Rosca", group: "CIRCULARES", description: "Pizza com total ao centro." },
  pie_multilevel: { label: "Pizza em múltiplos níveis", group: "CIRCULARES", description: "Dois níveis hierárquicos reais (ex.: certo/errado → alternativa)." },
  rose: { label: "Rose / Nightingale", group: "CIRCULARES", description: "Raio proporcional à quantidade." },
  semicircle: { label: "Semicírculo", group: "CIRCULARES", description: "Meia rosca, ótima para telões." },
  treemap: { label: "Treemap", group: "COMPARACAO", description: "Áreas proporcionais à participação de cada alternativa." },
  funnel: { label: "Funil", group: "COMPARACAO", description: "Alternativas ordenadas da mais à menos escolhida." },
  radar: { label: "Radar", group: "COMPARACAO", description: "Perfil das respostas em 3 ou mais eixos." },
  pareto: { label: "Pareto", group: "COMPARACAO", description: "Barras ordenadas + percentual acumulado." },
  waffle: { label: "Waffle", group: "COMPARACAO", description: "Grade de 100 quadrados (cada um = 1%)." },
  kpi: { label: "Indicadores (KPI)", group: "COMPARACAO", description: "Cartões numéricos com os principais totais." },
  line: { label: "Linhas", group: "TEMPORAIS", description: "Evolução do volume de respostas ao longo do tempo." },
  area: { label: "Áreas", group: "TEMPORAIS", description: "Evolução acumulada das respostas com área preenchida." },
  area_stacked: { label: "Áreas empilhadas", group: "TEMPORAIS", description: "Evolução acumulada por alternativa." },
  step_line: { label: "Step line", group: "TEMPORAIS", description: "Evolução em degraus (mudanças discretas)." },
  cumulative: { label: "Série acumulada", group: "TEMPORAIS", description: "Total acumulado de respondentes no tempo." },
  heatmap: { label: "Mapa de calor", group: "ESPECIAIS", description: "Intensidade por alternativa × tempo ou × segmento." },
  scatter: { label: "Dispersão", group: "ESPECIAIS", description: "Nota × tempo de resposta (escalas e NPS)." },
  bubble: { label: "Bolhas", group: "ESPECIAIS", description: "Tempo médio × percentual, tamanho = respostas." },
  sankey: { label: "Sankey", group: "ESPECIAIS", description: "Fluxo entre segmento de perfil e resposta." },
  gauge: { label: "Gauge", group: "ESPECIAIS", description: "Indicador único (média, NPS ou % de acerto)." },
  sunburst: { label: "Sunburst", group: "ESPECIAIS", description: "Hierarquia real em anéis concêntricos." },
};
