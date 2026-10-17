"use client";
/**
 * Galeria visual de gráficos do construtor de perguntas.
 *
 * Mostra os 30 tipos do catálogo agrupados. Os compatíveis com a estrutura da pergunta (motor de
 * compatibilidade em @shared/charts/compat) são selecionáveis e exibem uma miniatura real gerada
 * com dados ilustrativos; os incompatíveis aparecem esmaecidos com o motivo e nunca podem ser
 * escolhidos. Abaixo, uma prévia grande do gráfico selecionado (tema claro/escuro).
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Ban, Check, Moon, Sun } from "lucide-react";
import type { ResultsDTO } from "@shared/types";
import type { QuestionType } from "@shared/schemas";
import { CHART_GROUP_LABELS, CHART_META, type ChartGroup, type ChartType } from "@shared/charts/catalog";
import { chartCompatibilityList, chartContextForQuestion, type ChartCompatibility } from "@shared/charts/compat";
import { buildChartOption, previewResults, type ChartRenderConfig } from "@shared/charts/options";
import { EChart } from "./echart";
import { ChartView } from "./chart-view";
import { Skeleton, Tip } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export interface GalleryQuestion {
  type: QuestionType;
  options: { label: string; color?: string | null; isCorrect?: boolean }[];
  maxSelections: number;
  scaleMin?: number | null;
  scaleMax?: number | null;
  title: string;
}

export interface ChartGalleryProps {
  question: GalleryQuestion;
  value: ChartType;
  onChange: (type: ChartType) => void;
  /** Existe pergunta de cruzamento selecionada. */
  hasCross: boolean;
  /** Opções visuais aplicadas à prévia grande (cores, %/valores, legenda, ordenação). */
  config?: Partial<ChartRenderConfig>;
  /** Exibe a prévia grande do gráfico selecionado (padrão: sim). */
  showPreview?: boolean;
  className?: string;
}

type Opt = Record<string, unknown>;

const GROUPS = Object.keys(CHART_GROUP_LABELS) as ChartGroup[];

const THUMB_CONFIG: ChartRenderConfig = { showPercent: false, showValues: false, showLegend: false, sortDesc: false, colors: null };

const LIGHT_VARS = { "--fg": "#0b1736", "--muted-fg": "#5b6480", "--card": "#ffffff", "--border": "#dde2ee", "--muted": "#eef1f8" } as React.CSSProperties;
const DARK_VARS = { "--fg": "#e8ecf7", "--muted-fg": "#9aa3c0", "--card": "#0e1b40", "--border": "#1f2f63", "--muted": "#111f45" } as React.CSSProperties;

/* ------------------------------------------------------------------ utilidades */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms]);
  return v;
}

/** Acompanha o tema do admin (classe .dark no <html>). */
function useDocumentDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setDark(el.classList.contains("dark"));
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

/** Normaliza a pergunta para gerar dados ilustrativos coerentes mesmo durante a edição. */
function sanitize(q: GalleryQuestion): GalleryQuestion {
  const numeric = q.type === "ESCALA" || q.type === "NPS";
  if (numeric) {
    let min = q.type === "NPS" ? 0 : q.scaleMin ?? 1;
    let max = q.type === "NPS" ? 10 : q.scaleMax ?? 5;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      min = 1;
      max = 5;
    }
    return { ...q, options: [], maxSelections: 1, scaleMin: min, scaleMax: max };
  }
  const options = q.options.map((o, i) => ({ ...o, label: o.label.trim() || `Alternativa ${String.fromCharCode(65 + (i % 26))}` }));
  return { ...q, options, maxSelections: Math.max(1, q.maxSelections || 1), title: q.title.trim() || "Sua pergunta" };
}

/**
 * Reduz uma opção completa do ECharts para miniatura: sem rótulos, legenda, tooltip nem eixos
 * nomeados; fontes e símbolos menores; animação desligada.
 */
function thumbify(option: Opt): Opt {
  const shrink = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(shrink);
    if (!v || typeof v !== "object") return v;
    const out: Opt = {};
    for (const [k, val] of Object.entries(v as Opt)) {
      if (typeof val === "number") {
        if (k === "fontSize") out[k] = Math.max(7, Math.round(val * 0.55));
        else if (k === "symbolSize") out[k] = Math.max(3, val * 0.45);
        else if (k === "width" || k === "barWidth" || k === "barMaxWidth") out[k] = Math.max(1, val * 0.5);
        else if (k === "top" || k === "left" || k === "right" || k === "bottom") out[k] = Math.round(val * 0.5);
        else out[k] = val;
      } else if (k === "symbolSize" && Array.isArray(val)) {
        out[k] = val.map((n) => (typeof n === "number" ? Math.max(3, n * 0.45) : n));
      } else if (k === "label" || k === "axisLabel" || k === "labelLine" || k === "axisName") {
        out[k] = { ...(val && typeof val === "object" ? (val as Opt) : {}), show: false };
      } else if (k === "markLine") {
        continue;
      } else {
        out[k] = shrink(val);
      }
    }
    return out;
  };
  const o = shrink(option) as Opt;
  o.animation = false;
  o.tooltip = { show: false };
  o.legend = { show: false };
  if (o.grid && typeof o.grid === "object") {
    const g = o.grid as Opt;
    o.grid = { ...g, top: 6, bottom: 6, left: typeof g.left === "number" ? 6 : g.left, right: typeof g.right === "number" ? 6 : g.right, containLabel: false };
  }
  const fixAxis = (a: unknown): unknown => (Array.isArray(a) ? a.map(fixAxis) : a && typeof a === "object" ? { ...(a as Opt), name: undefined, splitLine: { show: false } } : a);
  if (o.xAxis) o.xAxis = fixAxis(o.xAxis);
  if (o.yAxis) o.yAxis = fixAxis(o.yAxis);
  if (o.visualMap) o.visualMap = { ...(o.visualMap as Opt), show: false };
  if (o.radar) o.radar = { ...(o.radar as Opt), radius: "78%" };
  if (Array.isArray(o.series)) {
    o.series = (o.series as Opt[]).map((s) => {
      if (s.type === "sankey") return { ...s, left: 4, right: 4, top: 4, bottom: 4, nodeGap: 4 };
      if (s.type === "gauge") return { ...s, title: { show: false }, radius: "100%", center: ["50%", "62%"] };
      return s;
    });
  }
  return o;
}

/* ------------------------------------------------------------------ miniatura */
const Thumb = memo(function Thumb({ type, data, theme }: { type: ChartType; data: ResultsDTO; theme: "dark" | "light" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const option = useMemo(() => {
    if (!visible) return null;
    try {
      return thumbify(buildChartOption(type, data, { theme, config: THUMB_CONFIG, reducedMotion: true }));
    } catch {
      return null;
    }
  }, [visible, type, data, theme]);

  return (
    <div ref={ref} className="h-[90px] w-full overflow-hidden rounded-lg" aria-hidden="true">
      {option ? <EChart option={option} /> : visible ? <div className="grid h-full place-items-center text-xs text-muted-foreground">Sem prévia</div> : <Skeleton className="size-full" />}
    </div>
  );
});

/* ------------------------------------------------------------------ cartões */
function ChartCard({
  compat,
  selected,
  onSelect,
  data,
  theme,
}: {
  compat: ChartCompatibility;
  selected: boolean;
  onSelect: () => void;
  data: ResultsDTO;
  theme: "dark" | "light";
}) {
  const meta = CHART_META[compat.type];
  if (!compat.compatible) {
    return (
      <Tip content={compat.reason ?? "Incompatível com esta pergunta."}>
        <div
          tabIndex={0}
          aria-disabled="true"
          aria-label={`${meta.label} — indisponível: ${compat.reason ?? "incompatível com esta pergunta"}`}
          className="flex cursor-not-allowed flex-col rounded-xl border border-dashed border-border bg-muted/40 p-2 opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <div className="grid h-[90px] place-items-center rounded-lg bg-muted/60 text-muted-foreground" aria-hidden="true">
            <Ban className="size-6" />
          </div>
          <span className="mt-1.5 text-xs font-bold text-muted-foreground line-through decoration-muted-foreground/40">{meta.label}</span>
          <span className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-muted-foreground">{compat.reason}</span>
        </div>
      </Tip>
    );
  }
  return (
    <Tip content={meta.description}>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${meta.label}: ${meta.description}`}
        onClick={onSelect}
        className={cn(
          "relative flex flex-col rounded-xl border bg-card p-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          selected ? "border-brand ring-2 ring-brand/40" : "border-border hover:border-brand/50 hover:shadow-sm",
        )}
      >
        {selected && (
          <span className="absolute right-1.5 top-1.5 z-10 grid size-5 place-items-center rounded-full bg-brand text-white shadow" aria-hidden="true">
            <Check className="size-3" />
          </span>
        )}
        <Thumb type={compat.type} data={data} theme={theme} />
        <span className={cn("mt-1.5 text-xs font-bold", selected && "text-brand")}>{meta.label}</span>
      </button>
    </Tip>
  );
}

/* ------------------------------------------------------------------ galeria */
export function ChartGallery({ question, value, onChange, hasCross, config, showPreview = true, className }: ChartGalleryProps) {
  const docDark = useDocumentDark();
  const thumbTheme: "dark" | "light" = docDark ? "dark" : "light";
  const [previewTheme, setPreviewTheme] = useState<"dark" | "light">("dark");

  const q = useDebounced(sanitize(question), 250);

  const compat = useMemo(
    () =>
      chartCompatibilityList(
        chartContextForQuestion({
          type: q.type,
          optionCount: q.options.length,
          maxSelections: q.maxSelections,
          scaleMin: q.scaleMin,
          scaleMax: q.scaleMax,
          hasCross,
          hasTemporal: true,
        }),
      ),
    [q, hasCross],
  );

  const data = useMemo(
    () =>
      previewResults({
        type: q.type,
        title: q.title,
        options: q.options,
        maxSelections: q.maxSelections,
        scaleMin: q.scaleMin,
        scaleMax: q.scaleMax,
        withCross: hasCross,
      }),
    [q, hasCross],
  );

  const byType = useMemo(() => new Map(compat.map((c) => [c.type, c])), [compat]);
  const compatibleCount = compat.filter((c) => c.compatible).length;
  const selectedCompat = byType.get(value);

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <p className="text-sm text-muted-foreground">
        <span className="font-bold text-foreground">{compatibleCount}</span> de {compat.length} visualizações são compatíveis com esta pergunta. As demais ficam indisponíveis para
        garantir resultados estatisticamente corretos — passe o mouse para ver o motivo.
      </p>

      {GROUPS.map((g) => {
        const items = compat.filter((c) => CHART_META[c.type].group === g);
        if (items.length === 0) return null;
        return (
          <section key={g} aria-label={CHART_GROUP_LABELS[g]}>
            <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-muted-foreground">
              {CHART_GROUP_LABELS[g]} <span className="font-bold normal-case tracking-normal">· {items.filter((i) => i.compatible).length}/{items.length}</span>
            </h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {items.map((c) => (
                <ChartCard key={c.type} compat={c} selected={c.type === value} onSelect={() => onChange(c.type)} data={data} theme={thumbTheme} />
              ))}
            </div>
          </section>
        );
      })}

      {showPreview && (
        <section aria-label="Prévia do gráfico selecionado">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-black">Prévia: {CHART_META[value].label}</h4>
              <p className="text-xs text-muted-foreground">Dados ilustrativos — os resultados reais aparecem durante a sessão.</p>
            </div>
            <div className="inline-flex rounded-xl bg-muted p-1" role="group" aria-label="Tema da prévia">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={previewTheme === t}
                  onClick={() => setPreviewTheme(t)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-muted-foreground transition",
                    previewTheme === t && "bg-card text-foreground shadow-sm",
                  )}
                >
                  {t === "light" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                  {t === "light" ? "Claro" : "Escuro"}
                </button>
              ))}
            </div>
          </div>
          {selectedCompat && !selectedCompat.compatible && (
            <p className="mb-2 text-xs font-bold text-warning" role="status">
              O gráfico selecionado não é compatível: {selectedCompat.reason} Escolha outro na galeria.
            </p>
          )}
          <div
            className={cn("rounded-2xl border p-4", previewTheme === "dark" ? "border-navy-700 bg-navy-900" : "border-[#dde2ee] bg-white")}
            style={previewTheme === "dark" ? DARK_VARS : LIGHT_VARS}
          >
            <ChartView data={data} type={value} config={config} theme={previewTheme} preview height={300} showToolbar={false} />
          </div>
        </section>
      )}
    </div>
  );
}
