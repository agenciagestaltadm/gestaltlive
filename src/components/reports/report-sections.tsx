"use client";
/** Blocos do relatório visual da sessão. */
import { useMemo, useState } from "react";
import { Search, Trophy, Medal } from "lucide-react";
import { QUESTION_TYPE_LABELS } from "@shared/schemas";
import { ChartView } from "@/components/charts/chart-view";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Progress } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn, fmtInt, fmtPct } from "@/lib/utils";
import { fmtDecimal, fmtSeconds, TableWrap, td, th, toResultsDTO } from "./report-ui";
import type { RankedRow, ReportQuestion } from "./types";

/* ------------------------------------------------------------------ pergunta */
function Metric({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted px-3 py-2">
      <div className="truncate text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-black tabular", className)}>{value}</div>
    </div>
  );
}

export function QuestionResultCard({ q, registered, theme }: { q: ReportQuestion; registered: number; theme: "dark" | "light" }) {
  const numeric = q.type === "ESCALA" || q.type === "NPS";
  const dto = useMemo(() => toResultsDTO(q, registered), [q, registered]);
  const height = numeric ? 280 : Math.min(460, Math.max(180, 46 * q.categories.length + 40));
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="outline">P{q.position}</Badge>
          <Badge tone="muted">{QUESTION_TYPE_LABELS[q.type] ?? q.type}</Badge>
          {q.scored && <Badge tone="brand">Pontuada</Badge>}
          {q.category && <Badge tone="outline">{q.category}</Badge>}
        </div>
        <CardTitle className="mt-1 leading-snug">{q.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Taxa de resposta" value={fmtPct(q.responseRatePct)} />
          <Metric label="Respondentes" value={fmtInt(q.respondents)} />
          <Metric label="Tempo médio" value={fmtSeconds(q.avgResponseMs)} />
          {q.type === "NPS" ? (
            <Metric
              label="NPS"
              value={q.nps?.score ?? "—"}
              className={q.nps?.score === null || q.nps?.score === undefined ? "" : q.nps.score >= 0 ? "text-positive" : "text-negative"}
            />
          ) : numeric ? (
            <Metric label="Média" value={fmtDecimal(q.mean)} />
          ) : (
            <Metric label="Acerto" value={q.scored ? fmtPct(q.accuracyPct) : "—"} className={q.scored ? "text-positive" : ""} />
          )}
        </div>
        {q.type === "NPS" && q.nps && q.nps.total > 0 && (
          <p className="text-sm text-muted-foreground">
            <span className="font-bold text-positive">{fmtInt(q.nps.promoters)} promotores</span> · {fmtInt(q.nps.passives)} neutros ·{" "}
            <span className="font-bold text-negative">{fmtInt(q.nps.detractors)} detratores</span>
          </p>
        )}
        {q.respondents === 0 ? (
          <EmptyState title="Sem respostas" description="Nenhuma resposta registrada para esta pergunta neste recorte." className="p-6" />
        ) : (
          <ChartView data={dto} type={numeric ? "column" : "bar_horizontal"} theme={theme} height={height} showTotals={false} exportName={`pergunta-${q.position}`} />
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ dificuldade */
export function HardestList({ items }: { items: ReportQuestion[] }) {
  if (!items.length) return <EmptyState title="Sem questões pontuadas respondidas" description="As questões de conhecimento aparecem aqui após receberem respostas." className="p-6" />;
  return (
    <ol className="space-y-3">
      {items.map((q) => (
        <li key={q.sessionQuestionId} className="rounded-xl border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-sm font-bold">
              <span className="text-muted-foreground">P{q.position}.</span> {q.title}
            </p>
            <span className="shrink-0 text-lg font-black tabular text-negative">{fmtPct(q.accuracyPct)}</span>
          </div>
          <Progress value={q.accuracyPct ?? 0} tone="positive" className="mt-2" />
          <p className="mt-1 text-xs text-muted-foreground">
            {fmtInt(q.respondents)} respondentes · acerto de {fmtPct(q.accuracyPct)}
          </p>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ ranking */
const MEDAL = ["text-gold", "text-silver", "text-bronze"];

export function TopList({ rows }: { rows: RankedRow[] }) {
  if (!rows.length) return <EmptyState icon={<Trophy />} title="Ranking vazio" description="Nenhum participante pontuou neste recorte." className="p-6" />;
  return (
    <ol className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-3 py-2.5">
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-muted text-sm font-black tabular", MEDAL[r.position - 1])}>
            {r.position <= 3 ? <Medal className="size-4" aria-hidden /> : r.position}
            <span className="sr-only">{r.position}º lugar</span>
          </span>
          <span className="min-w-0 flex-1 truncate font-bold">{r.displayName}</span>
          <span className="text-right">
            <span className="block font-black tabular">{fmtInt(r.score)} pts</span>
            <span className="block text-xs text-muted-foreground">{fmtInt(r.correctCount)} acertos</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function RankingTable({ rows }: { rows: RankedRow[] }) {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(50);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => r.displayName.toLowerCase().includes(s)) : rows;
  }, [rows, q]);
  const visible = filtered.slice(0, limit);
  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimit(50);
          }}
          placeholder="Buscar participante"
          aria-label="Buscar participante na classificação"
          className="pl-9"
        />
      </div>
      {filtered.length === 0 ? (
        <EmptyState title={rows.length ? "Nenhum participante encontrado" : "Classificação vazia"} description={rows.length ? "Revise o termo buscado." : undefined} className="p-6" />
      ) : (
        <>
          <TableWrap>
            <table className="w-full min-w-[560px] text-sm">
              <caption className="sr-only">Classificação completa da sessão</caption>
              <thead className="bg-muted/60">
                <tr>
                  <th scope="col" className={th}>Posição</th>
                  <th scope="col" className={th}>Participante</th>
                  <th scope="col" className={cn(th, "text-right")}>Pontos</th>
                  <th scope="col" className={cn(th, "text-right")}>Acertos</th>
                  <th scope="col" className={cn(th, "text-right")}>Pontuadas respondidas</th>
                  <th scope="col" className={cn(th, "text-right")}>Tempo em acertos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className={cn(td, "font-black tabular", MEDAL[r.position - 1])}>{r.position}º</td>
                    <td className={cn(td, "font-bold")}>{r.displayName}</td>
                    <td className={cn(td, "text-right tabular")}>{fmtInt(r.score)}</td>
                    <td className={cn(td, "text-right tabular")}>{fmtInt(r.correctCount)}</td>
                    <td className={cn(td, "text-right tabular")}>{fmtInt(r.answeredCount)}</td>
                    <td className={cn(td, "text-right tabular")}>{fmtSeconds(r.correctTimeMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              Exibindo {fmtInt(visible.length)} de {fmtInt(filtered.length)}
            </span>
            {visible.length < filtered.length && (
              <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + 100)}>
                Mostrar mais
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function SectionTitle({ id, title, description, children }: { id: string; title: string; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div id={id} className="flex scroll-mt-20 flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-xl font-black tracking-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}


