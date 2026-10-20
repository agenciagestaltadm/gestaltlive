"use client";
/**
 * Nuvem de Palavras — layout (d3-cloud), paletas dos estilos e desenho em canvas (exportação PNG/PDF).
 *
 * - O layout roda numa tela virtual de largura fixa (1600) com a proporção do container: a mesma nuvem
 *   aparece no telão, no painel, no apresentador e no celular, apenas escalada.
 * - Semente fixa + ordem estável (frequência desc, chave) → posições previsíveis entre atualizações.
 * - Palavras que não cabem fazem o layout ser refeito com fontes menores (até caberem as mais citadas).
 * - d3-cloud mede o texto com canvas: só roda no navegador e é importado sob demanda.
 */
import type { WordCloudTerm, WordCloudDisplay, WordCloudStyle } from "@shared/wordcloud";

export const VIRTUAL_WIDTH = 1600;

export interface PlacedWord {
  key: string;
  label: string;
  count: number;
  pct: number;
  /** Centro (x) e linha de base (y) na tela virtual. */
  x: number;
  y: number;
  size: number;
  color: string;
  rank: number;
}

export interface CloudLayout {
  width: number;
  height: number;
  words: PlacedWord[];
  /** Termos que não couberam nem com fontes reduzidas. */
  dropped: number;
}

/* ------------------------------------------------------------------ estilos */
export const NAVY = "#0B1736";
export const FUCSIA = "#FF0068";

interface Palette {
  background: string;
  /** Cor do termo mais citado e dos destaques. */
  accent: string;
  colors: string[];
  muted: string;
}

export function paletteFor(style: WordCloudStyle, background: WordCloudDisplay["background"]): Palette {
  const dark = background === "ESCURO";
  if (style === "GESTALT") {
    return dark
      ? { background: NAVY, accent: FUCSIA, colors: ["#FFFFFF", "#FF5C9A", "#FFC2D9", "#8EC5FF", "#FF0068", "#C9D6FF"], muted: "rgba(255,255,255,.55)" }
      : { background: "#FFFFFF", accent: FUCSIA, colors: [NAVY, "#C2004F", "#1E3A8A", "#E0005B", "#334155", "#3B4A7A"], muted: "rgba(11,23,54,.55)" };
  }
  if (style === "COLORIDO") {
    return dark
      ? { background: NAVY, accent: FUCSIA, colors: ["#22D3EE", "#FACC15", "#A78BFA", "#34D399", "#FB923C", "#60A5FA", "#F472B6", "#FFFFFF"], muted: "rgba(255,255,255,.55)" }
      : { background: "#FFFFFF", accent: "#E0005B", colors: ["#0E7490", "#B45309", "#6D28D9", "#047857", "#C2410C", "#1D4ED8", "#BE185D", NAVY], muted: "rgba(11,23,54,.55)" };
  }
  // minimalista: tons neutros com destaques em fúcsia
  return dark
    ? { background: "#111A2E", accent: FUCSIA, colors: ["#FFFFFF", "#CBD5E1", "#94A3B8", "#E2E8F0"], muted: "rgba(255,255,255,.5)" }
    : { background: "#FFFFFF", accent: FUCSIA, colors: [NAVY, "#334155", "#475569", "#1F2A44"], muted: "rgba(11,23,54,.5)" };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Cor estável por termo (não "pisca" entre atualizações); os dois mais citados usam a cor de destaque. */
export function colorFor(key: string, rank: number, p: Palette) {
  if (rank === 0) return p.accent;
  if (rank === 2 && p.colors.length > 3) return p.accent;
  return p.colors[hash(key) % p.colors.length];
}

/** Gerador pseudoaleatório com semente (posições reprodutíveis). */
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function fontFamily() {
  if (typeof document === "undefined") return "sans-serif";
  return getComputedStyle(document.body).fontFamily || "sans-serif";
}

const label = (w: { label: string; count: number }, showFrequency: boolean) => (showFrequency ? `${w.label} ${w.count}` : w.label);

type CloudWord = { text: string; size: number; key: string; x?: number; y?: number; x0?: number; x1?: number; y0?: number; y1?: number };

/**
 * Calcula o layout. `aspect` = altura/largura do container. Os termos já chegam ordenados
 * (frequência desc) e limitados ao máximo configurado.
 */
export async function layoutCloud(terms: WordCloudTerm[], display: WordCloudDisplay, aspect: number): Promise<CloudLayout> {
  const width = VIRTUAL_WIDTH;
  const height = Math.round(width * Math.min(1.4, Math.max(0.35, aspect)));
  if (terms.length === 0) return { width, height, words: [], dropped: 0 };
  const { default: cloud } = await import("d3-cloud");
  if (typeof document !== "undefined" && document.fonts?.ready) await document.fonts.ready;
  const family = fontFamily();
  const p = paletteFor(display.style, display.background);
  const counts = terms.map((t) => t.count);
  const cmax = Math.max(...counts);
  const cmin = Math.min(...counts);
  // tamanho máximo cai com a quantidade de termos; a raiz quadrada evita que um termo esmague os demais
  const maxFont = Math.min(height * 0.36, width * 0.15, 240 - Math.min(120, terms.length * 1.4));
  const minFont = Math.max(28, Math.min(46, height * 0.055));

  let scale = 1;
  let best: CloudLayout = { width, height, words: [], dropped: terms.length };
  for (let attempt = 0; attempt < 4; attempt++) {
    const sizeOf = (c: number) => {
      const t = cmax === cmin ? 0.6 : Math.sqrt((c - cmin) / (cmax - cmin));
      return Math.round((minFont + (maxFont - minFont) * t) * scale);
    };
    const input: CloudWord[] = terms.map((t) => ({ text: label(t, display.showFrequency), size: sizeOf(t.count), key: t.key }));
    const placed = await new Promise<CloudWord[]>((resolve) => {
      cloud<CloudWord>()
        .size([width, height])
        .words(input.map((w) => ({ ...w })))
        // respiro proporcional ao tamanho: palavras grandes não encostam umas nas outras
        .padding((d) => Math.max(5, Math.round(d.size * 0.09)))
        .rotate(0)
        .font(family)
        .fontWeight(800)
        .fontSize((d) => d.size)
        .spiral("archimedean")
        .random(seeded(7))
        .timeInterval(12)
        .on("end", (out) => resolve(out as CloudWord[]))
        .start();
    });
    const byKey = new Map(placed.map((w) => [w.key, w]));
    // centraliza o conjunto (o espiral começa num ponto aleatório: com poucas palavras a nuvem ficaria deslocada)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const w of placed) {
      if (w.x === undefined || w.y === undefined) continue;
      minX = Math.min(minX, w.x + (w.x0 ?? -w.size));
      maxX = Math.max(maxX, w.x + (w.x1 ?? w.size));
      minY = Math.min(minY, w.y + (w.y0 ?? -w.size / 2));
      maxY = Math.max(maxY, w.y + (w.y1 ?? w.size / 2));
    }
    const dx = Number.isFinite(minX) ? -(minX + maxX) / 2 : 0;
    const dy = Number.isFinite(minY) ? -(minY + maxY) / 2 : 0;
    const words: PlacedWord[] = [];
    terms.forEach((t, rank) => {
      const w = byKey.get(t.key);
      if (!w || w.x === undefined || w.y === undefined) return;
      words.push({ key: t.key, label: t.label, count: t.count, pct: t.pct, x: w.x + dx + width / 2, y: w.y + dy + height / 2, size: w.size, color: colorFor(t.key, rank, p), rank });
    });
    const layout = { width, height, words, dropped: terms.length - words.length };
    if (layout.words.length > best.words.length) best = layout;
    // os 15 mais citados sempre precisam caber; demais podem ficar de fora em nuvens muito cheias
    const topMissing = terms.slice(0, 15).some((t) => !byKey.has(t.key));
    if (!topMissing && layout.dropped <= Math.max(0, terms.length * 0.08)) return layout;
    scale *= 0.82;
  }
  return best;
}

/** Desenha a nuvem num canvas (exportação PNG e PDF — usa fillText, então as fontes da página são mantidas). */
export function drawCloud(layout: CloudLayout, display: WordCloudDisplay, opts: { pixelRatio?: number; footer?: string } = {}) {
  const ratio = opts.pixelRatio ?? 2;
  const p = paletteFor(display.style, display.background);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width * ratio;
  canvas.height = layout.height * ratio;
  const g = canvas.getContext("2d")!;
  g.scale(ratio, ratio);
  g.fillStyle = p.background;
  g.fillRect(0, 0, layout.width, layout.height);
  const family = fontFamily();
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  for (const w of layout.words) {
    g.font = `800 ${w.size}px ${family}`;
    g.fillStyle = w.color;
    if (display.showFrequency) {
      const lw = g.measureText(`${w.label} `).width;
      const cw = g.measureText(String(w.count)).width;
      const start = w.x - (lw + cw) / 2;
      g.textAlign = "left";
      g.fillText(`${w.label} `, start, w.y);
      g.globalAlpha = 0.6;
      g.fillText(String(w.count), start + lw, w.y);
      g.globalAlpha = 1;
      g.textAlign = "center";
    } else {
      g.fillText(w.label, w.x, w.y);
    }
  }
  if (opts.footer) {
    g.font = `700 22px ${family}`;
    g.fillStyle = p.muted;
    g.textAlign = "right";
    g.fillText(opts.footer, layout.width - 28, layout.height - 22);
  }
  return canvas;
}

/** Imagem PNG (data URL) da nuvem — usada no PDF do relatório. */
export async function renderWordCloudImage(terms: WordCloudTerm[], display: WordCloudDisplay, opts: { aspect?: number; footer?: string } = {}) {
  const layout = await layoutCloud(terms, display, opts.aspect ?? 9 / 16);
  return { dataUrl: drawCloud(layout, display, { pixelRatio: 1.5, footer: opts.footer }).toDataURL("image/png"), width: layout.width, height: layout.height };
}
