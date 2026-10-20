"use client";
/**
 * Nuvem de Palavras em SVG com transições suaves.
 *
 * - Cada termo é um nó com chave estável: ao chegar uma nova contagem, posição e tamanho transitam
 *   (CSS), e termos novos entram com a animação escolhida (surgir/zoom). Respeita "reduzir movimento".
 * - O layout é refeito no máximo a cada ~1,2 s (rajadas de respostas viram uma única reorganização).
 * - Texto do participante só entra como nó de texto (nunca HTML).
 * - Exporta PNG/SVG/PDF com a mesma interface do gráfico ECharts (EChartHandle).
 */
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WordCloudDisplay, WordCloudTerm } from "@shared/wordcloud";
import { DEFAULT_WORD_CLOUD_DISPLAY } from "@shared/wordcloud";
import { downloadBlob, cn } from "@/lib/utils";
import type { EChartHandle } from "./echart";
import { drawCloud, layoutCloud, paletteFor, type CloudLayout } from "./word-cloud-layout";

const RELAYOUT_MS = 1200;

export interface WordCloudViewProps {
  terms: WordCloudTerm[];
  display?: Partial<WordCloudDisplay> | null;
  className?: string;
  reducedMotion?: boolean;
  ariaLabel?: string;
  /** Texto exibido enquanto não há termos. */
  emptyText?: string;
  /** Rodapé gravado nas exportações (ex.: "Gestalt Live · 120 respostas"). */
  exportFooter?: string;
  /** Mostra os termos sem animação (miniaturas e prévias). */
  still?: boolean;
}

export const WordCloudView = forwardRef<EChartHandle, WordCloudViewProps>(function WordCloudView(
  { terms, display: displayIn, className, reducedMotion, ariaLabel, emptyText = "Aguardando palavras…", exportFooter, still },
  ref,
) {
  const display: WordCloudDisplay = { ...DEFAULT_WORD_CLOUD_DISPLAY, ...(displayIn ?? {}) };
  const palette = paletteFor(display.style, display.background);
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  // proporção real do container: o primeiro layout só roda depois de medida (evita "pulo" ao abrir)
  const [aspect, setAspect] = useState<number | null>(null);
  const [layout, setLayout] = useState<CloudLayout | null>(null);
  const seen = useRef(new Set<string>());
  const last = useRef(0);
  /** Layout refeito por mudança de tamanho: reposiciona sem transição (as posições antigas não valem mais). */
  const [instant, setInstant] = useState(false);
  const animate = !reducedMotion && !still && display.animation !== "NENHUMA";
  const moving = animate && !instant;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return;
      const next = r.height / r.width;
      setAspect((cur) => {
        if (cur === null) return next;
        if (Math.abs(cur - next) / cur <= 0.12) return cur;
        setInstant(true);
        return next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const signature = useMemo(
    () => JSON.stringify([terms.map((t) => [t.key, t.label, t.count]), display.style, display.background, display.showFrequency, display.maxTerms, aspect === null ? null : Math.round(aspect * 20)]),
    [terms, display.style, display.background, display.showFrequency, display.maxTerms, aspect],
  );

  useEffect(() => {
    if (aspect === null) return;
    let cancelled = false;
    const wait = still || instant ? 0 : Math.max(0, RELAYOUT_MS - (Date.now() - last.current));
    const timer = setTimeout(() => {
      last.current = Date.now();
      void layoutCloud(terms.slice(0, display.maxTerms), display, aspect).then((l) => {
        if (cancelled) return;
        setLayout(l);
        // volta a animar nas próximas atualizações de contagem
        if (instant) requestAnimationFrame(() => setInstant(false));
      });
    }, wait);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // a assinatura resume termos, aparência e proporção
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // termos já exibidos não repetem a animação de entrada (o primeiro layout também não "entra" palavra por palavra quando a página abre com a nuvem pronta)
  useEffect(() => {
    if (layout) for (const w of layout.words) seen.current.add(w.key);
  }, [layout]);

  useImperativeHandle(ref, () => ({
    instance: () => null,
    exportPng(filename) {
      if (!layout) return;
      drawCloud(layout, display, { footer: exportFooter }).toBlob((b) => b && downloadBlob(b, `${filename}.png`), "image/png");
    },
    async exportSvg(filename) {
      if (!svg.current) return;
      const clone = svg.current.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.querySelectorAll("[style]").forEach((n) => (n as SVGElement).style.removeProperty("transition"));
      const xml = new XMLSerializer().serializeToString(clone);
      downloadBlob(new Blob([xml], { type: "image/svg+xml" }), `${filename}.svg`);
    },
    async exportPdf(filename, title) {
      if (!layout) return;
      const { jsPDF } = await import("jspdf");
      const url = drawCloud(layout, display, { footer: exportFooter }).toDataURL("image/png");
      const pdf = new jsPDF({ orientation: layout.width >= layout.height ? "landscape" : "portrait", unit: "pt", format: "a4" });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const margin = 36;
      let top = margin;
      if (title) {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(16);
        pdf.text(pdf.splitTextToSize(title, pw - margin * 2), margin, top + 12);
        top += 36;
      }
      const w = pw - margin * 2;
      const h = Math.min(ph - top - margin, (w * layout.height) / layout.width);
      pdf.addImage(url, "PNG", margin, top, (h * layout.width) / layout.height, h);
      pdf.save(`${filename}.pdf`);
    },
  }));

  const words = layout?.words ?? [];
  return (
    <div
      ref={box}
      className={cn("relative h-full w-full overflow-hidden rounded-xl", className)}
      style={{ background: palette.background }}
      role="img"
      aria-label={ariaLabel ?? `Nuvem de palavras com ${terms.length} termos`}
    >
      {terms.length === 0 ? (
        <div className="absolute inset-0 grid place-items-center text-center font-bold" style={{ color: palette.muted, fontSize: "clamp(14px, 3.2cqh, 34px)" }}>
          <span className={cn(animate && "animate-pulse")}>{emptyText}</span>
        </div>
      ) : (
        layout && (
          <svg ref={svg} viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <rect width={layout.width} height={layout.height} fill={palette.background} />
            {words.map((w) => {
              const fresh = animate && !seen.current.has(w.key);
              return (
                <g
                  key={w.key}
                  style={{
                    transform: `translate(${w.x}px, ${w.y}px)`,
                    transition: moving ? "transform 900ms cubic-bezier(.22,.8,.26,1)" : undefined,
                  }}
                >
                  <text
                    textAnchor="middle"
                    fill={w.color}
                    className={cn(fresh && (display.animation === "ZOOM" ? "wc-enter-zoom" : "wc-enter-surgir"))}
                    style={{
                      fontSize: `${w.size}px`,
                      fontWeight: 800,
                      fontFamily: "var(--font-sans)",
                      transition: moving ? "font-size 900ms cubic-bezier(.22,.8,.26,1), fill 600ms" : undefined,
                      transformBox: "fill-box",
                      transformOrigin: "center",
                    }}
                  >
                    <title>{`${w.label}: ${w.count} (${w.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`}</title>
                    {w.label}
                    {display.showFrequency && (
                      <tspan opacity={0.6} dx={w.size * 0.25}>
                        {w.count}
                      </tspan>
                    )}
                  </text>
                </g>
              );
            })}
          </svg>
        )
      )}
    </div>
  );
});
