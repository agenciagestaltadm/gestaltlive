"use client";
import { useMemo } from "react";
import { ThumbsDown, ThumbsUp, Users } from "lucide-react";
import type { SatisfactionDTO } from "@shared/types";
import { buildSatisfactionPie, buildSatisfactionTimeline } from "@shared/charts/options";
import { EChart } from "./echart";
import { useReducedMotion } from "./chart-view";
import { cn, fmtInt, fmtPct } from "@/lib/utils";

export function SatisfactionPie({ data, theme = "dark", large, height = 260 }: { data: SatisfactionDTO | null; theme?: "dark" | "light"; large?: boolean; height?: number | string }) {
  const reduced = useReducedMotion();
  const option = useMemo(
    () => buildSatisfactionPie(data?.summary.positive ?? 0, data?.summary.negative ?? 0, { theme, large, reducedMotion: reduced }),
    [data?.summary.positive, data?.summary.negative, theme, large, reduced],
  );
  return (
    <div style={{ height }} className="w-full">
      <EChart option={option} ariaLabel="Gráfico de pizza da satisfação" background={theme === "dark" ? "#0B1736" : "#FFFFFF"} />
    </div>
  );
}

export function SatisfactionTimeline({ data, theme = "dark", height = 200 }: { data: SatisfactionDTO | null; theme?: "dark" | "light"; height?: number }) {
  const reduced = useReducedMotion();
  const option = useMemo(() => buildSatisfactionTimeline(data?.timeline ?? [], { theme, reducedMotion: reduced }), [data?.timeline, theme, reduced]);
  return (
    <div style={{ height }} className="w-full">
      <EChart option={option} ariaLabel="Evolução da satisfação no tempo" background={theme === "dark" ? "#0B1736" : "#FFFFFF"} />
    </div>
  );
}

export function SatisfactionStats({ data, dark = true, large }: { data: SatisfactionDTO | null; dark?: boolean; large?: boolean }) {
  const s = data?.summary;
  const box = cn("rounded-xl p-3", dark ? "bg-white/5" : "bg-muted");
  const v = cn("font-black tabular", large ? "text-4xl" : "text-xl");
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className={box}>
        <div className="flex items-center gap-1.5 text-xs font-bold text-positive">
          <ThumbsUp className="size-3.5" /> Valeu a pena
        </div>
        <div className={cn(v, "text-positive")}>{s?.total ? fmtPct(s.positivePct) : "—"}</div>
        <div className="text-xs opacity-70">{fmtInt(s?.positive ?? 0)} avaliações</div>
      </div>
      <div className={box}>
        <div className="flex items-center gap-1.5 text-xs font-bold text-negative">
          <ThumbsDown className="size-3.5" /> Insatisfeito
        </div>
        <div className={cn(v, "text-negative")}>{s?.total ? fmtPct(s.negativePct) : "—"}</div>
        <div className="text-xs opacity-70">{fmtInt(s?.negative ?? 0)} avaliações</div>
      </div>
      <div className={box}>
        <div className="text-xs font-bold opacity-80">Avaliações registradas</div>
        <div className={v}>{fmtInt(s?.total ?? 0)}</div>
        <div className="text-xs opacity-70">participação {fmtPct(data?.participationPct ?? null)}</div>
      </div>
      <div className={box}>
        <div className="flex items-center gap-1.5 text-xs font-bold opacity-80">
          <Users className="size-3.5" /> Sem avaliação
        </div>
        <div className={v}>{fmtInt(data?.notVoted ?? 0)}</div>
        <div className="text-xs opacity-70">de {fmtInt(data?.registered ?? 0)} inscritos</div>
      </div>
    </div>
  );
}
