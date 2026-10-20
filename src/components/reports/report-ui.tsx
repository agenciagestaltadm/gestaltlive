"use client";
/** Utilitários visuais compartilhados pelas telas de relatórios e CRM. */
import { forwardRef, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Lock, RotateCcw } from "lucide-react";
import type { ResultsDTO } from "@shared/types";
import { SESSION_STATUS_LABELS, type SessionStatus } from "@shared/schemas";
import { PALETTE } from "@shared/charts/options";
import { ApiError } from "@/lib/api";
import { EChart, type EChartHandle } from "@/components/charts/echart";
import { useReducedMotion } from "@/components/charts/chart-view";
import { Badge, EmptyState } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReportQuestion } from "./types";

/* ------------------------------------------------------------------ tema do admin */
/** Acompanha a classe `.dark` do <html> (o admin alterna o tema em tempo real). */
export function useAdminTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">("light");
  useEffect(() => {
    const read = () => setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

/* ------------------------------------------------------------------ querystring */
export function buildQuery(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/* ------------------------------------------------------------------ formatação */
export const fmtSeconds = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? "—" : `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;

export const fmtDecimal = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: digits });

export function isForbidden(e: unknown) {
  return e instanceof ApiError && e.status === 403;
}

/* ------------------------------------------------------------------ estados */
export function NoPermission({ title = "Acesso restrito", description }: { title?: string; description?: React.ReactNode }) {
  return (
    <EmptyState
      icon={<Lock />}
      title={title}
      description={description ?? "Seu perfil não tem permissão para ver esta área. Peça acesso a um administrador da organização."}
    />
  );
}

export function ErrorState({ error, onRetry, className }: { error: Error; onRetry?: () => void; className?: string }) {
  if (isForbidden(error)) return <NoPermission />;
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <EmptyState
      className={className}
      icon={<AlertTriangle />}
      title={notFound ? "Não encontrado" : "Não foi possível carregar os dados"}
      description={error.message}
      action={
        onRetry && !notFound ? (
          <Button variant="outline" onClick={onRetry}>
            <RotateCcw /> Tentar novamente
          </Button>
        ) : undefined
      }
    />
  );
}

export function TableWrap({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("overflow-x-auto rounded-xl border border-border", className)}>{children}</div>;
}

export const th = "whitespace-nowrap px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground";
export const td = "px-3 py-2.5 align-top";

const STATUS_TONE: Record<SessionStatus, "default" | "brand" | "positive" | "negative" | "warning" | "muted" | "outline"> = {
  RASCUNHO: "muted",
  AGENDADA: "outline",
  AGUARDANDO: "warning",
  AO_VIVO: "brand",
  PAUSADA: "warning",
  ENCERRADA: "positive",
  CANCELADA: "negative",
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  return <Badge tone={STATUS_TONE[status] ?? "muted"}>{SESSION_STATUS_LABELS[status] ?? status}</Badge>;
}

/* ------------------------------------------------------------------ conversão para ResultsDTO */
/** Converte uma pergunta do relatório para o formato mínimo aceito por `ChartView`. */
export function toResultsDTO(q: ReportQuestion, registered: number): ResultsDTO {
  const numeric = q.type === "ESCALA" || q.type === "NPS";
  const nums = numeric ? q.categories.map((c) => Number(c.label)).filter((n) => Number.isFinite(n)) : [];
  return {
    sessionQuestionId: q.sessionQuestionId,
    questionType: q.type,
    title: q.title,
    multiSelect: !numeric && !q.selectable,
    totals: { participants: registered, respondents: q.respondents, selections: q.categories.reduce((a, c) => a + c.count, 0) },
    categories: q.categories.map((c, i) => ({
      id: q.options[i]?.id ?? q.wordCloud?.terms[i]?.key ?? `${q.sessionQuestionId}-${i}`,
      label: c.label,
      color: null,
      count: c.count,
      pct: c.pct,
      isCorrect: c.isCorrect,
      avgResponseMs: null,
    })),
    numeric: numeric ? { min: nums.length ? Math.min(...nums) : 0, max: nums.length ? Math.max(...nums) : 10, mean: q.mean, median: null, nps: q.nps } : null,
    correctRevealed: true,
    accuracyPct: q.accuracyPct,
    timeline: { bucketMs: 0, points: [] },
    scatter: null,
    cross: null,
    wordCloud: q.wordCloud ?? null,
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ gráfico de barras simples */
function tokens(theme: "dark" | "light") {
  return theme === "dark"
    ? { text: "#E8ECF7", muted: "#9AA3C0", grid: "rgba(255,255,255,0.08)", axis: "rgba(255,255,255,0.18)", tooltipBg: "#0B1736" }
    : { text: "#0B1736", muted: "#5B6480", grid: "rgba(11,23,54,0.08)", axis: "rgba(11,23,54,0.2)", tooltipBg: "#FFFFFF" };
}

export interface SimpleBarSeries {
  name: string;
  data: (number | null)[];
  color?: string;
}

export interface SimpleBarInput {
  categories: string[];
  series: SimpleBarSeries[];
  theme: "dark" | "light";
  horizontal?: boolean;
  /** Valores em percentual (eixo 0–100 e rótulo com %). */
  percent?: boolean;
  reducedMotion?: boolean;
}

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Opções do ECharts para barras/colunas com uma ou mais séries (sem dados inventados: nulo = sem barra). */
export function buildSimpleBarOption({ categories, series, theme, horizontal, percent, reducedMotion }: SimpleBarInput): Record<string, unknown> {
  const t = tokens(theme);
  const fmt = (v: number) => (percent ? `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
  const ax = {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 12 },
    splitLine: { lineStyle: { color: t.grid } },
  };
  const valueAxis = { type: "value", minInterval: percent ? undefined : 1, max: percent ? 100 : undefined, ...ax, axisLabel: { ...ax.axisLabel, formatter: percent ? "{value}%" : undefined } };
  const catAxis = {
    type: "category",
    data: categories.map((c) => trunc(c, horizontal ? 36 : 20)),
    inverse: horizontal ? true : undefined,
    ...ax,
    axisLabel: { ...ax.axisLabel, interval: 0, width: horizontal ? undefined : 90, overflow: horizontal ? undefined : "break" },
    splitLine: { show: false },
  };
  const multi = series.length > 1;
  return {
    backgroundColor: "transparent",
    animation: !reducedMotion,
    animationDuration: 600,
    textStyle: { fontFamily: "Lato, 'Segoe UI', system-ui, sans-serif", color: t.text },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: t.tooltipBg,
      borderColor: t.axis,
      textStyle: { color: t.text },
      confine: true,
      valueFormatter: (v: number | null) => (v === null || v === undefined || Number.isNaN(v) ? "—" : fmt(v)),
    },
    legend: multi ? { bottom: 0, type: "scroll", textStyle: { color: t.muted }, icon: "roundRect", itemWidth: 12, itemHeight: 12 } : { show: false },
    grid: { left: 8, right: horizontal ? 64 : 16, top: horizontal ? 8 : 28, bottom: multi ? 36 : 8, containLabel: true },
    xAxis: horizontal ? valueAxis : catAxis,
    yAxis: horizontal ? catAxis : valueAxis,
    series: series.map((s, i) => ({
      type: "bar",
      name: s.name,
      data: s.data.map((v) => (v === null ? "-" : Number(v.toFixed(2)))),
      barMaxWidth: horizontal ? 32 : 56,
      itemStyle: { color: s.color ?? PALETTE[i % PALETTE.length], borderRadius: 6 },
      label: {
        show: true,
        position: horizontal ? "right" : "top",
        color: t.text,
        fontWeight: 700,
        fontSize: 11,
        formatter: (p: { value: number | string }) => (typeof p.value === "number" ? fmt(p.value) : ""),
      },
    })),
  };
}

export const SimpleBarChart = forwardRef<EChartHandle, Omit<SimpleBarInput, "reducedMotion"> & { height?: number; ariaLabel: string }>(function SimpleBarChart(
  { height = 260, ariaLabel, ...input },
  ref,
) {
  const reduced = useReducedMotion();
  const option = useMemo(
    () => buildSimpleBarOption({ ...input, reducedMotion: reduced }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(input.categories), JSON.stringify(input.series), input.theme, input.horizontal, input.percent, reduced],
  );
  return (
    <div style={{ height }} className="w-full">
      <EChart ref={ref} option={option} ariaLabel={ariaLabel} background={input.theme === "dark" ? "#0B1736" : "#FFFFFF"} />
    </div>
  );
});
