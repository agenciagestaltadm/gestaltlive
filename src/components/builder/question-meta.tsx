"use client";
/** Metadados compactos de uma pergunta (gráfico, tempo, pontos, estado) usados nas listagens. */
import { BarChart3, Clock, ImageIcon, Lock, Trophy } from "lucide-react";
import { CHART_META } from "@shared/charts/catalog";
import { isNumericType } from "@shared/schemas";
import { Badge } from "@/components/ui/primitives";
import { cn, fmtInt } from "@/lib/utils";
import type { QuestionRow } from "./types";

export function pointsLabel(q: Pick<QuestionRow, "scoring">) {
  const s = q.scoring;
  if (!s) return "Sem pontos";
  let out = `${fmtInt(s.basePoints)} pts`;
  if (s.weight !== 1) out += ` × ${String(s.weight).replace(".", ",")}`;
  if (s.speedBonusEnabled) out += ` + até ${fmtInt(s.speedBonusMax)} de bônus`;
  return out;
}

export function QuestionMeta({ q, className }: { q: QuestionRow; className?: string }) {
  const numeric = isNumericType(q.type);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      <span className="inline-flex items-center gap-1">
        <BarChart3 className="size-3.5" aria-hidden="true" />
        <span className="sr-only">Gráfico:</span> {CHART_META[q.chart.type]?.label ?? q.chart.type}
        {q.chart.crossQuestionId && <span className="font-bold">(com cruzamento)</span>}
      </span>
      <span className="inline-flex items-center gap-1">
        <Clock className="size-3.5" aria-hidden="true" />
        <span className="sr-only">Tempo:</span> {q.timeLimitSec ? `${fmtInt(q.timeLimitSec)} s` : "Sem tempo limite"}
      </span>
      <span className={cn("inline-flex items-center gap-1", q.scoring && "font-bold text-foreground")}>
        <Trophy className="size-3.5" aria-hidden="true" />
        <span className="sr-only">Pontuação:</span> {pointsLabel(q)}
      </span>
      <span>
        {numeric
          ? `Escala ${q.scaleMin ?? 0}–${q.scaleMax ?? 10}`
          : `${q.options.length} ${q.options.length === 1 ? "alternativa" : "alternativas"}${q.maxSelections > 1 ? ` · até ${q.maxSelections} seleções` : ""}`}
      </span>
      {q.imageUrl && (
        <span className="inline-flex items-center gap-1">
          <ImageIcon className="size-3.5" aria-hidden="true" /> Com imagem
        </span>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: QuestionRow["status"] }) {
  return status === "PRONTA" ? <Badge tone="positive">Pronta</Badge> : <Badge tone="warning">Rascunho</Badge>;
}

export function LockedBadge({ q }: { q: Pick<QuestionRow, "locked" | "answersCount"> }) {
  if (!q.locked) return null;
  return (
    <Badge tone="outline" title="Campos estruturais bloqueados porque a pergunta já recebeu respostas.">
      <Lock className="size-3" aria-hidden="true" /> Bloqueada · {fmtInt(q.answersCount)} {q.answersCount === 1 ? "resposta" : "respostas"}
    </Badge>
  );
}
