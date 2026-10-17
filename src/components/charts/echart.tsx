"use client";
/**
 * Wrapper do ECharts: inicialização preguiçosa, redimensionamento automático, atualização com
 * transições suaves (merge de opções) e exportação PNG/SVG/PDF.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ECharts } from "echarts";
import { downloadBlob } from "@/lib/utils";

export interface EChartHandle {
  exportPng: (filename: string) => void;
  exportSvg: (filename: string) => Promise<void>;
  exportPdf: (filename: string, title?: string) => Promise<void>;
  instance: () => ECharts | null;
}

type Opt = Record<string, unknown>;

let echartsPromise: Promise<typeof import("echarts")> | null = null;
const loadEcharts = () => (echartsPromise ??= import("echarts"));

export const EChart = forwardRef<EChartHandle, { option: Opt; className?: string; style?: React.CSSProperties; ariaLabel?: string; background?: string }>(
  function EChart({ option, className, style, ariaLabel, background }, ref) {
    const el = useRef<HTMLDivElement>(null);
    const chart = useRef<ECharts | null>(null);
    const lastType = useRef<string>("");
    const optionRef = useRef(option);
    optionRef.current = option;

    useEffect(() => {
      let disposed = false;
      let ro: ResizeObserver | null = null;
      loadEcharts().then((echarts) => {
        if (disposed || !el.current) return;
        chart.current = echarts.init(el.current, undefined, { renderer: "canvas" });
        chart.current.setOption(optionRef.current, { notMerge: true });
        lastType.current = signature(optionRef.current);
        ro = new ResizeObserver(() => chart.current?.resize({ animation: { duration: 200 } }));
        ro.observe(el.current);
      });
      return () => {
        disposed = true;
        ro?.disconnect();
        chart.current?.dispose();
        chart.current = null;
      };
    }, []);

    useEffect(() => {
      if (!chart.current) return;
      const sig = signature(option);
      // mesma estrutura → merge (anima a transição dos valores); estrutura diferente → substitui
      chart.current.setOption(option, { notMerge: sig !== lastType.current, lazyUpdate: true });
      lastType.current = sig;
    }, [option]);

    useImperativeHandle(ref, () => ({
      instance: () => chart.current,
      exportPng(filename) {
        if (!chart.current) return;
        const url = chart.current.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: background ?? "#0B1736" });
        fetch(url)
          .then((r) => r.blob())
          .then((b) => downloadBlob(b, `${filename}.png`));
      },
      async exportSvg(filename) {
        const echarts = await loadEcharts();
        const w = el.current?.clientWidth ?? 960;
        const h = el.current?.clientHeight ?? 540;
        const ssr = echarts.init(null as unknown as HTMLElement, undefined, { renderer: "svg", ssr: true, width: w, height: h });
        ssr.setOption({ ...optionRef.current, animation: false, backgroundColor: background ?? "#0B1736" });
        const svg = ssr.renderToSVGString();
        ssr.dispose();
        downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${filename}.svg`);
      },
      async exportPdf(filename, title) {
        if (!chart.current) return;
        const { jsPDF } = await import("jspdf");
        const url = chart.current.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: background ?? "#0B1736" });
        const w = el.current?.clientWidth ?? 960;
        const h = el.current?.clientHeight ?? 540;
        const pdf = new jsPDF({ orientation: w >= h ? "landscape" : "portrait", unit: "pt", format: "a4" });
        const pw = pdf.internal.pageSize.getWidth();
        const ph = pdf.internal.pageSize.getHeight();
        const margin = 36;
        let top = margin;
        if (title) {
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(14);
          pdf.text(title, margin, top + 6, { maxWidth: pw - margin * 2 });
          top += 28;
        }
        const scale = Math.min((pw - margin * 2) / w, (ph - top - margin) / h);
        pdf.addImage(url, "PNG", margin, top, w * scale, h * scale);
        pdf.setFontSize(8);
        pdf.setTextColor(120);
        pdf.text(`Gestalt Live · ${new Date().toLocaleString("pt-BR")}`, margin, ph - 16);
        pdf.save(`${filename}.pdf`);
      },
    }));

    return <div ref={el} className={className} style={{ width: "100%", height: "100%", ...style }} role="img" aria-label={ariaLabel} />;
  },
);

function signature(o: Opt): string {
  const series = (o.series as { type?: string }[] | undefined) ?? [];
  return `${series.map((s) => s.type).join(",")}|${series.length}|${o.graphic ? "g" : ""}|${o.radar ? "r" : ""}|${o.visualMap ? "v" : ""}`;
}
