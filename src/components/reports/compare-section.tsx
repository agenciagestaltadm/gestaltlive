"use client";
/** Comparativo entre turmas (sessões) do mesmo evento — cada sessão é calculada isoladamente. */
import { useEffect } from "react";
import Link from "next/link";
import { GitCompare } from "lucide-react";
import { admin } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Skeleton } from "@/components/ui/primitives";
import { cn, fmtInt, fmtPct } from "@/lib/utils";
import { ErrorState, fmtDecimal, SimpleBarChart, StatusBadge, TableWrap, td, th } from "./report-ui";
import type { CompareResult } from "./types";

export function CompareSection({ eventId, theme }: { eventId: string; theme: "dark" | "light" }) {
  const { data, error, loading, reload } = useApi<CompareResult>(() => admin.get<CompareResult>(`/reports/compare?eventId=${encodeURIComponent(eventId)}`), [eventId]);
  const ready = !!data && !loading;
  // link "Comparar turmas" (relatório da sessão) chega com #comparativo: rola até a seção quando os dados carregam
  useEffect(() => {
    if (ready && window.location.hash === "#comparativo") document.getElementById("comparativo")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [ready]);

  return (
    <section id="comparativo" className="scroll-mt-20 space-y-4" aria-label="Comparativo entre turmas">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-black tracking-tight">
          <GitCompare className="size-5 text-brand" /> Comparativo entre turmas
        </h2>
        <p className="text-sm text-muted-foreground">
          {data ? `${data.event.title} · ` : ""}cada turma é calculada separadamente — nenhum dado é somado entre sessões.
        </p>
      </div>
      {error && !data ? (
        <ErrorState error={error} onRetry={() => void reload()} />
      ) : !data || loading ? (
        <div className="grid gap-4">
          <Skeleton className="h-72" />
          <Skeleton className="h-48" />
        </div>
      ) : data.sessions.length === 0 ? (
        <EmptyState title="Este evento ainda não tem sessões" />
      ) : (
        <>
          {data.sessions.length === 1 && (
            <p className="rounded-xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">Este evento tem apenas uma turma. Crie outras sessões para comparar resultados.</p>
          )}
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Participação, acerto e satisfação por turma</CardTitle>
              <CardDescription>Percentuais de cada sessão. Satisfação considera apenas avaliações registradas; turmas sem avaliação ficam sem barra.</CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleBarChart
                theme={theme}
                percent
                categories={data.sessions.map((s) => `${s.name} (${s.code})`)}
                series={[
                  { name: "Participação", data: data.sessions.map((s) => s.participationPct) },
                  { name: "Acerto médio", data: data.sessions.map((s) => s.avgAccuracyPct) },
                  { name: "Satisfação (valeu a pena)", data: data.sessions.map((s) => s.satisfactionPct) },
                ]}
                ariaLabel="Gráfico de colunas agrupadas comparando participação, acerto médio e satisfação por turma"
                height={340}
              />
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Indicadores por turma</CardTitle>
            </CardHeader>
            <CardContent>
              <TableWrap>
                <table className="w-full min-w-[820px] text-sm">
                  <caption className="sr-only">Indicadores de cada turma do evento</caption>
                  <thead className="bg-muted/60">
                    <tr>
                      <th scope="col" className={th}>Turma</th>
                      <th scope="col" className={th}>Status</th>
                      <th scope="col" className={cn(th, "text-right")}>Inscritos</th>
                      <th scope="col" className={cn(th, "text-right")}>Interagiram</th>
                      <th scope="col" className={cn(th, "text-right")}>Participação</th>
                      <th scope="col" className={cn(th, "text-right")}>Perguntas</th>
                      <th scope="col" className={cn(th, "text-right")}>Acerto médio</th>
                      <th scope="col" className={cn(th, "text-right")}>Média de acertos</th>
                      <th scope="col" className={cn(th, "text-right")}>Satisfação</th>
                      <th scope="col" className={cn(th, "text-right")}>Maior pontuação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.sessions.map((s) => (
                      <tr key={s.id} className="hover:bg-muted/40">
                        <td className={td}>
                          <Link href={`/admin/sessoes/${s.id}/resultados`} className="font-bold hover:text-brand hover:underline">
                            {s.name}
                          </Link>
                          <div className="text-xs tracking-wider text-muted-foreground tabular">{s.code}</div>
                        </td>
                        <td className={td}>
                          <StatusBadge status={s.status} />
                        </td>
                        <td className={cn(td, "text-right tabular")}>{fmtInt(s.registered)}</td>
                        <td className={cn(td, "text-right tabular")}>{fmtInt(s.interacted)}</td>
                        <td className={cn(td, "text-right tabular")}>{fmtPct(s.participationPct)}</td>
                        <td className={cn(td, "text-right tabular")}>
                          {fmtInt(s.questionsDone)}/{fmtInt(s.questions)}
                        </td>
                        <td className={cn(td, "text-right tabular")}>{fmtPct(s.avgAccuracyPct)}</td>
                        <td className={cn(td, "text-right tabular")}>{fmtDecimal(s.avgCorrect, 2)}</td>
                        <td className={cn(td, "text-right tabular")}>
                          {s.satisfactionVotes ? (
                            <>
                              <span className="font-bold text-positive">{fmtPct(s.satisfactionPct)}</span>
                              <div className="text-xs text-muted-foreground">{fmtInt(s.satisfactionVotes)} avaliações</div>
                            </>
                          ) : (
                            <span className="text-muted-foreground">Sem avaliações</span>
                          )}
                        </td>
                        <td className={cn(td, "text-right tabular")}>{fmtInt(s.topScore)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Comparativo por pergunta</CardTitle>
              <CardDescription>Taxa de resposta e acerto (ou média, nas escalas) de cada pergunta em cada turma. “Não aplicada” indica que a pergunta não fez parte da turma.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.byQuestion.length === 0 ? (
                <EmptyState title="Sem perguntas para comparar" className="p-6" />
              ) : (
                <TableWrap>
                  <table className="w-full text-sm" style={{ minWidth: 320 + data.sessions.length * 150 }}>
                    <caption className="sr-only">Indicadores de cada pergunta por turma</caption>
                    <thead className="bg-muted/60">
                      <tr>
                        <th scope="col" className={cn(th, "sticky left-0 bg-muted")}>Pergunta</th>
                        {data.sessions.map((s) => (
                          <th key={s.id} scope="col" className={cn(th, "text-right")}>
                            {s.name}
                            <span className="block font-normal normal-case tracking-normal">{s.code}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.byQuestion.map((q) => (
                        <tr key={q.questionId}>
                          <th scope="row" className={cn(td, "sticky left-0 max-w-xs bg-card text-left font-bold")}>
                            {q.title}
                            {q.scored && <span className="ml-1 text-xs font-normal text-brand">(pontuada)</span>}
                          </th>
                          {q.perSession.map((p) => (
                            <td key={p.sessionId} className={cn(td, "text-right tabular")}>
                              {p.responseRatePct === null ? (
                                <span className="text-muted-foreground">Não aplicada</span>
                              ) : (
                                <>
                                  <div>
                                    <span className="text-xs text-muted-foreground">resposta </span>
                                    {fmtPct(p.responseRatePct)}
                                  </div>
                                  {q.scored ? (
                                    <div className="font-bold text-positive">
                                      <span className="text-xs font-normal text-muted-foreground">acerto </span>
                                      {fmtPct(p.accuracyPct)}
                                    </div>
                                  ) : p.mean !== null ? (
                                    <div className="font-bold">
                                      <span className="text-xs font-normal text-muted-foreground">média </span>
                                      {fmtDecimal(p.mean)}
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
