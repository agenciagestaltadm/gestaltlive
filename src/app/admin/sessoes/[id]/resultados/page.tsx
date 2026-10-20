"use client";
/** Relatório visual da sessão: KPIs, segmentação, resultados por pergunta, ranking, satisfação, perfil e exportações. */
import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart3, ChevronDown, Cloud, Download, FileSpreadsheet, FileText, GitCompare, RefreshCw, ShieldCheck, ThumbsUp, Users } from "lucide-react";
import { admin } from "@/lib/api";
import { useAction, useApi } from "@/lib/hooks";
import { useAdmin } from "@/components/admin/admin-context";
import { PageHeader } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton, Stat } from "@/components/ui/primitives";
import { SatisfactionPie, SatisfactionStats, SatisfactionTimeline } from "@/components/charts/satisfaction-charts";
import { buildQuery, ErrorState, fmtDecimal, NoPermission, SimpleBarChart, StatusBadge, useAdminTheme } from "@/components/reports/report-ui";
import { EMPTY_SEGMENT, ReportFilters, segmentLabel, type SegmentFilter } from "@/components/reports/report-filters";
import { HardestList, QuestionResultCard, RankingTable, SectionTitle, TopList } from "@/components/reports/report-sections";
import type { SessionReport } from "@/components/reports/types";
import { fmtDateTime, fmtInt, fmtPct } from "@/lib/utils";

const NAV = [
  { id: "perguntas", label: "Perguntas" },
  { id: "dificuldade", label: "Dificuldade" },
  { id: "pontuacao", label: "Pontuação" },
  { id: "classificacao", label: "Classificação" },
  { id: "satisfacao", label: "Satisfação" },
  { id: "perfil", label: "Perfil" },
];

function LoadingReport() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-16 w-2/3" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-40" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

function ResultsReport() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { can } = useAdmin();
  const theme = useAdminTheme();
  const { pending, run } = useAction();
  const allowed = can("reports.read");

  const segment = useMemo<SegmentFilter>(
    () => ({
      fieldKey: params.get("fieldKey") ?? "",
      fieldValue: params.get("fieldValue") ?? "",
      profileSqId: params.get("profileSqId") ?? "",
      profileOptionId: params.get("profileOptionId") ?? "",
    }),
    [params],
  );
  const qs = buildQuery({ ...segment });
  const filtered = qs !== "";

  const report = useApi<SessionReport>(allowed ? () => admin.get<SessionReport>(`/sessions/${id}/report${qs}`) : null, [id, qs, allowed]);
  // relatório sem filtro: fonte das opções de segmentação (só é buscado quando há filtro ativo)
  const base = useApi<SessionReport>(allowed && filtered ? () => admin.get<SessionReport>(`/sessions/${id}/report`) : null, [id, allowed, filtered]);
  const source = filtered ? (base.data ?? report.data) : report.data;

  if (!allowed) {
    return (
      <>
        <PageHeader title="Resultados da sessão" back={{ href: "/admin/relatorios", label: "Relatórios" }} />
        <NoPermission description="Seu perfil não tem a permissão “Relatórios”. Peça acesso a um administrador da organização." />
      </>
    );
  }
  if (report.error && !report.data) {
    return (
      <>
        <PageHeader title="Resultados da sessão" back={{ href: "/admin/relatorios", label: "Relatórios" }} />
        <ErrorState error={report.error} onRetry={() => void report.reload()} />
      </>
    );
  }
  const data = report.data;
  if (!data) return <LoadingReport />;

  const t = data.totals;
  const sat = data.satisfaction.summary;
  const label = segmentLabel(segment, source ?? data);
  const fileBase = `relatorio-${data.session.code}`.toLowerCase();

  const applySegment = (f: SegmentFilter) => {
    router.replace(`${pathname}${buildQuery({ ...f })}`, { scroll: false });
  };

  const hasWordCloud = data.questions.some((q) => q.type === "NUVEM_PALAVRAS");
  const download = (kind: "ranking" | "respostas" | "participantes" | "nuvem") =>
    run(`csv-${kind}`, () => admin.download(`/sessions/${id}/export.csv?kind=${kind}`, `${fileBase}-${kind}.csv`), "Exportação concluída.");
  const downloadXlsx = () => run("xlsx", () => admin.download(`/sessions/${id}/export.xlsx`, `${fileBase}.xlsx`), "Planilha exportada.");
  const downloadPdf = () =>
    run(
      "pdf",
      async () => {
        const { exportSessionReportPdf } = await import("@/components/reports/report-pdf");
        await exportSessionReportPdf(data, { filename: label ? `${fileBase}-segmentado` : fileBase, filterLabel: label });
      },
      "PDF gerado.",
    );

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: "/admin/relatorios", label: "Relatórios" }}
        title={data.session.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-bold text-foreground">{data.event.title}</span>
            {data.event.speakerName && <span>· {data.event.speakerName}</span>}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => void report.reload()} loading={report.loading} aria-label="Atualizar relatório">
              <RefreshCw /> <span className="hidden sm:inline">Atualizar</span>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/admin/relatorios${buildQuery({ eventId: data.event.id })}#comparativo`}>
                <GitCompare /> Comparar turmas
              </Link>
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button loading={!!pending}>
                  <Download /> Exportar <ChevronDown />
                </Button>
              </MenuTrigger>
              <MenuContent className="w-72">
                <MenuItem onSelect={() => void downloadPdf()}>
                  <FileText /> Relatório visual (PDF)
                </MenuItem>
                <MenuItem onSelect={() => void downloadXlsx()}>
                  <FileSpreadsheet /> Planilha completa (XLSX)
                </MenuItem>
                <MenuItem onSelect={() => void download("ranking")}>
                  <FileSpreadsheet /> Ranking (CSV)
                </MenuItem>
                <MenuItem onSelect={() => void download("respostas")}>
                  <FileSpreadsheet /> Respostas (CSV)
                </MenuItem>
                <MenuItem onSelect={() => void download("participantes")}>
                  <FileSpreadsheet /> Participantes (CSV)
                </MenuItem>
                {hasWordCloud && (
                  <MenuItem onSelect={() => void download("nuvem")}>
                    <Cloud /> Nuvem de palavras (respostas)
                  </MenuItem>
                )}
                <p className="flex gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <ShieldCheck className="size-4 shrink-0 text-positive" />
                  E-mail e WhatsApp só saem para quem consentiu receber comunicações de marketing.
                </p>
              </MenuContent>
            </Menu>
          </>
        }
      />

      {/* identificação */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-5 text-sm">
          <span>
            <span className="text-muted-foreground">Código </span>
            <span className="font-black tracking-wider tabular">{data.session.code}</span>
          </span>
          <StatusBadge status={data.session.status} />
          <span>
            <span className="text-muted-foreground">Início </span>
            <span className="font-bold">{fmtDateTime(data.session.startedAt)}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Encerramento </span>
            <span className="font-bold">{fmtDateTime(data.session.endedAt)}</span>
          </span>
          {data.session.finalizedAt && <Badge tone="positive">Resultado oficial em {fmtDateTime(data.session.finalizedAt)}</Badge>}
        </CardContent>
      </Card>

      <ReportFilters value={segment} source={source} onApply={applySegment} loading={report.loading && filtered} />

      {label && (
        <p className="rounded-xl bg-brand/10 px-4 py-2.5 text-sm font-bold text-brand" role="status">
          Exibindo apenas o segmento: {label}
        </p>
      )}

      {/* KPIs */}
      <section aria-label="Indicadores" className={report.loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Inscritos" value={fmtInt(t.registered)} icon={<Users />} />
          <Stat label="Interagiram" value={fmtInt(t.interacted)} hint="responderam ao menos uma pergunta" />
          <Stat label="Taxa de participação" value={fmtPct(t.participationPct)} accent="text-brand" />
          <Stat label="Perguntas realizadas" value={`${fmtInt(t.questionsDone)} de ${fmtInt(t.questions)}`} hint={`${fmtInt(t.scoredQuestions)} pontuadas`} />
          <Stat label="Média de acertos" value={fmtDecimal(t.avgCorrect, 2)} hint="por inscrito" />
          <Stat label="Acerto médio" value={fmtPct(t.avgAccuracyPct)} accent="text-positive" hint="nas questões pontuadas" />
          <Stat
            className="col-span-2"
            label="Satisfação final"
            icon={<ThumbsUp />}
            value={
              sat.total ? (
                <span className="flex flex-wrap items-baseline gap-x-4">
                  <span className="text-positive">{fmtPct(sat.positivePct)} valeu a pena</span>
                  <span className="text-base text-negative">{fmtPct(sat.negativePct)} insatisfeito</span>
                </span>
              ) : (
                <span className="text-muted-foreground">Sem avaliações</span>
              )
            }
            hint={sat.total ? `${fmtInt(sat.total)} avaliações registradas` : "Nenhum participante avaliou a sessão"}
          />
        </div>
      </section>

      <nav aria-label="Seções do relatório" className="flex flex-wrap gap-1.5">
        {NAV.map((n) => (
          <a key={n.id} href={`#${n.id}`} className="rounded-full border border-border px-3 py-1 text-sm font-bold text-muted-foreground hover:border-brand hover:text-brand">
            {n.label}
          </a>
        ))}
      </nav>

      {/* perguntas */}
      <section className="space-y-4" aria-label="Resultados por pergunta">
        <SectionTitle id="perguntas" title="Resultados por pergunta" description="Distribuição das respostas, taxa de resposta, acerto e tempo médio." />
        {data.questions.length === 0 ? (
          <EmptyState icon={<BarChart3 />} title="Nenhuma pergunta nesta sessão" />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {data.questions.map((q) => (
              <QuestionResultCard key={q.sessionQuestionId} q={q} registered={t.registered} theme={theme} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Questões com maior dificuldade">
          <Card className="h-full">
            <CardHeader>
              <SectionTitle id="dificuldade" title="Questões com maior dificuldade" description="Menor percentual de acerto entre as questões pontuadas." />
            </CardHeader>
            <CardContent>
              <HardestList items={data.hardest} />
            </CardContent>
          </Card>
        </section>
        <section aria-label="Distribuição de pontuações">
          <Card className="h-full">
            <CardHeader>
              <SectionTitle id="pontuacao" title="Distribuição de pontuações" description="Quantidade de participantes por faixa de pontos." />
            </CardHeader>
            <CardContent>
              {data.ranking.length === 0 ? (
                <EmptyState title="Sem pontuações" className="p-6" />
              ) : (
                <SimpleBarChart
                  theme={theme}
                  categories={data.scoreHistogram.map((h) => `${h.range} pts`)}
                  series={[{ name: "Participantes", data: data.scoreHistogram.map((h) => h.count) }]}
                  ariaLabel="Gráfico de colunas: participantes por faixa de pontuação"
                  height={280}
                />
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      {/* classificação */}
      <section className="space-y-4" aria-label="Classificação">
        <SectionTitle id="classificacao" title="Classificação" description="Participantes desclassificados não aparecem no ranking." />
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Top 10</CardTitle>
            </CardHeader>
            <CardContent>
              <TopList rows={data.top10} />
            </CardContent>
          </Card>
          <Card className="min-w-0 lg:col-span-2">
            <CardHeader>
              <CardTitle>Classificação completa</CardTitle>
              <CardDescription>{fmtInt(data.ranking.length)} participantes classificados</CardDescription>
            </CardHeader>
            <CardContent>
              <RankingTable rows={data.ranking} />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* satisfação */}
      <section className="space-y-4" aria-label="Satisfação">
        <SectionTitle id="satisfacao" title="Satisfação" description="Percentuais calculados apenas sobre as avaliações registradas (a sessão inteira, sem segmentação)." />
        <Card>
          <CardContent className="space-y-4 p-5">
            <SatisfactionStats data={data.satisfaction} dark={theme === "dark"} />
            {sat.total === 0 ? (
              <EmptyState icon={<ThumbsUp />} title="Sem avaliações" description="Nenhum participante registrou avaliação de satisfação." className="p-6" />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-bold text-muted-foreground">Distribuição</h3>
                  <SatisfactionPie data={data.satisfaction} theme={theme} height={280} />
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-bold text-muted-foreground">Evolução ao longo da sessão</h3>
                  <SatisfactionTimeline data={data.satisfaction} theme={theme} height={280} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* perfil */}
      <section className="space-y-4" aria-label="Dados de perfil">
        <SectionTitle id="perfil" title="Dados de perfil" description="Campos personalizados informados no cadastro (autodeclarados)." />
        {data.demographics.length === 0 ? (
          <EmptyState title="Sem campos personalizados" description="O cadastro deste evento não possui campos adicionais." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {data.demographics.map((d) => (
              <Card key={d.key} className="min-w-0">
                <CardHeader>
                  <CardTitle>{d.label}</CardTitle>
                  <CardDescription>{fmtInt(d.values.reduce((a, v) => a + v.count, 0))} respostas</CardDescription>
                </CardHeader>
                <CardContent>
                  {d.values.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sem valores registrados.</p>
                  ) : (
                    <SimpleBarChart
                      theme={theme}
                      horizontal
                      categories={d.values.map((v) => v.value)}
                      series={[{ name: "Participantes", data: d.values.map((v) => v.count) }]}
                      ariaLabel={`Gráfico de barras: ${d.label}`}
                      height={Math.max(160, Math.min(560, 34 * d.values.length + 30))}
                    />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-positive" />
        As exportações CSV/XLSX trazem a sessão completa (sem segmentação); o PDF reflete o recorte exibido. Dados de contato só são incluídos para participantes com
        consentimento de marketing vigente.
      </p>
    </div>
  );
}

export default function SessionResultsPage() {
  return (
    <Suspense fallback={<LoadingReport />}>
      <ResultsReport />
    </Suspense>
  );
}
