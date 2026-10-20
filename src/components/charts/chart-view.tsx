"use client";
/**
 * Visualização de resultados: escolhe o gráfico configurado, mostra totais (participantes,
 * respondentes, seleções), estado "Aguardando respostas", tela cheia e exportação.
 */
import { useMemo, useRef, useState, useEffect } from "react";
import { Download, Maximize2, Minimize2, Users, MousePointerClick, UserCheck, Tags } from "lucide-react";
import type { ResultsDTO } from "@shared/types";
import type { ChartType } from "@shared/charts/catalog";
import { CHART_META } from "@shared/charts/catalog";
import { buildChartOption, type ChartRenderConfig } from "@shared/charts/options";
import { checkChart, chartContextForQuestion, defaultChartFor } from "@shared/charts/compat";
import { EChart, type EChartHandle } from "./echart";
import { WordCloudView } from "./word-cloud-view";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn, fmtInt, fmtPct } from "@/lib/utils";

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const h = () => setReduced(m.matches);
    m.addEventListener("change", h);
    return () => m.removeEventListener("change", h);
  }, []);
  return reduced;
}

/** Garante um gráfico compatível com os dados reais; caso contrário usa o padrão (com aviso). */
export function resolveChartType(data: ResultsDTO, requested: ChartType): { type: ChartType; fallbackReason: string | null } {
  const numeric = data.questionType === "ESCALA" || data.questionType === "NPS";
  const ctx = chartContextForQuestion({
    type: data.questionType,
    optionCount: data.categories.length,
    maxSelections: data.multiSelect ? 2 : 1,
    scaleMin: data.numeric?.min ?? null,
    scaleMax: data.numeric?.max ?? null,
    hasCross: !!data.cross,
    hasTemporal: data.timeline.points.length > 0 || data.totals.respondents === 0,
  });
  if (numeric) ctx.categoryCount = data.categories.length;
  const check = checkChart(requested, ctx);
  if (check.compatible) return { type: requested, fallbackReason: null };
  return { type: defaultChartFor(ctx), fallbackReason: check.reason ?? "Dados insuficientes para este gráfico." };
}

export interface ChartViewProps {
  data: ResultsDTO | null;
  type: ChartType;
  config?: Partial<ChartRenderConfig>;
  theme?: "dark" | "light";
  large?: boolean;
  className?: string;
  height?: number | string;
  showTotals?: boolean;
  showToolbar?: boolean;
  exportName?: string;
  preview?: boolean;
}

export function ChartView({ data, type, config, theme = "dark", large, className, height = 360, showTotals = true, showToolbar = true, exportName = "grafico", preview }: ChartViewProps) {
  const ref = useRef<EChartHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const reduced = useReducedMotion();
  const cfg: ChartRenderConfig = { showPercent: true, showValues: true, showLegend: true, sortDesc: false, colors: null, ...config };
  const resolved = data ? resolveChartType(data, type) : { type, fallbackReason: null };
  // nuvem de palavras: desenhada pelo WordCloudView (texto livre não passa pelo ECharts)
  const cloud = resolved.type === "wordcloud" || data?.questionType === "NUVEM_PALAVRAS";
  const option = useMemo(
    () => (data && !cloud ? buildChartOption(resolved.type, data, { theme, config: cfg, large: large || full, reducedMotion: reduced }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, resolved.type, cloud, theme, JSON.stringify(cfg), large, full, reduced],
  );

  useEffect(() => {
    const h = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  const toggleFull = async () => {
    if (!box.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await box.current.requestFullscreen().catch(() => undefined);
  };

  const empty = !data || data.totals.respondents === 0;
  const bg = theme === "dark" ? "#0B1736" : "#FFFFFF";

  return (
    <div ref={box} className={cn("relative flex flex-col", full && (theme === "dark" ? "bg-navy-900 p-10" : "bg-white p-10"), className)}>
      {(showToolbar || showTotals) && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          {showTotals && data ? (
            <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-bold", theme === "dark" ? "text-white/80" : "text-muted-foreground", (large || full) && "text-lg")}>
              <span className="inline-flex items-center gap-1.5">
                <UserCheck className="size-4 text-brand" /> {fmtInt(data.totals.respondents)} {data.totals.respondents === 1 ? "respondente" : "respondentes"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-4" /> {fmtInt(data.totals.participants)} inscritos
                {data.totals.participants > 0 && <span className="opacity-70">({fmtPct((data.totals.respondents / data.totals.participants) * 100)})</span>}
              </span>
              {data.multiSelect && (
                <span className="inline-flex items-center gap-1.5">
                  <MousePointerClick className="size-4" /> {fmtInt(data.totals.selections)} seleções
                </span>
              )}
              {data.wordCloud && (
                <span className="inline-flex items-center gap-1.5">
                  <Tags className="size-4" /> {fmtInt(data.wordCloud.totals.termOccurrences)} {data.wordCloud.totals.termOccurrences === 1 ? "termo" : "termos"} · {fmtInt(data.wordCloud.totals.uniqueTerms)} {data.wordCloud.totals.uniqueTerms === 1 ? "diferente" : "diferentes"}
                </span>
              )}
              {data.accuracyPct !== null && <span className="text-positive">Acerto: {fmtPct(data.accuracyPct)}</span>}
              {preview && <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs text-warning">Prévia com dados ilustrativos</span>}
            </div>
          ) : (
            <span />
          )}
          {showToolbar && (
            <div className="flex items-center gap-1">
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Exportar gráfico" className={theme === "dark" ? "text-white hover:bg-white/10" : ""} disabled={empty}>
                    <Download />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem onSelect={() => ref.current?.exportPng(exportName)}>Exportar PNG</MenuItem>
                  <MenuItem onSelect={() => void ref.current?.exportSvg(exportName)}>Exportar SVG</MenuItem>
                  <MenuItem onSelect={() => void ref.current?.exportPdf(exportName, data?.title)}>Exportar PDF</MenuItem>
                </MenuContent>
              </Menu>
              <Button variant="ghost" size="icon-sm" onClick={toggleFull} aria-label={full ? "Sair da tela cheia" : "Tela cheia"} className={theme === "dark" ? "text-white hover:bg-white/10" : ""}>
                {full ? <Minimize2 /> : <Maximize2 />}
              </Button>
            </div>
          )}
        </div>
      )}
      {resolved.fallbackReason && !empty && !cloud && (
        <p className="mb-1 text-xs font-bold text-warning">
          Exibindo {CHART_META[resolved.type].label}: {resolved.fallbackReason}
        </p>
      )}
      <div className="relative min-h-0 flex-1" style={{ height: full ? "calc(100dvh - 140px)" : height, minHeight: !full && typeof height === "number" ? height : undefined }}>
        {option && <EChart ref={ref} option={option} background={bg} ariaLabel={`${CHART_META[resolved.type].label}: ${data?.title ?? ""}`} />}
        {data && cloud && (
          <WordCloudView
            ref={ref}
            // posição absoluta: altura percentual não resolve dentro de item flex com base 0 (mesmo motivo do EChart)
            className="absolute inset-0"
            terms={data.wordCloud?.terms ?? []}
            display={cfg.wordCloud}
            reducedMotion={reduced}
            still={preview}
            ariaLabel={`Nuvem de palavras: ${data.title}`}
            exportFooter={`Gestalt Live · ${fmtInt(data.totals.respondents)} ${data.totals.respondents === 1 ? "pessoa respondeu" : "pessoas responderam"}`}
          />
        )}
        {!data && (
          <div className={cn("absolute inset-0 grid place-items-center text-lg font-bold", theme === "dark" ? "text-white/60" : "text-muted-foreground")}>Aguardando respostas</div>
        )}
      </div>
      {/* tabela acessível com os mesmos dados do gráfico */}
      {data && (
        <table className="sr-only">
          <caption>{data.title}</caption>
          <thead>
            {data.wordCloud ? (
              <tr>
                <th>Palavra</th>
                <th>Frequência</th>
                <th>{data.wordCloud.denominator.kind === "TERMOS" ? "Percentual dos termos contabilizados" : "Percentual das respostas aprovadas"}</th>
              </tr>
            ) : (
              <tr>
                <th>Alternativa</th>
                <th>Respostas</th>
                <th>Percentual dos respondentes</th>
              </tr>
            )}
          </thead>
          <tbody>
            {data.categories.map((c) => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td>{c.count}</td>
                <td>{fmtPct(c.pct, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
