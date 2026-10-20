"use client";
/**
 * Controles da pergunta no modo apresentador (mesmas rotas do painel de controle ao vivo).
 * Deixa explícita a diferença entre "item no telão" e "pergunta aberta para os participantes".
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BarChart3, CheckCircle2, ChevronDown, ChevronUp, Clock, Cloud, Eye, EyeOff, Lock, Monitor, Pause, Play, Plus, Radio, Timer } from "lucide-react";
import type { ControlQuestionDTO, ResultsDTO } from "@shared/types";
import { QUESTION_TYPE_LABELS, SQ_STATE_LABELS } from "@shared/schemas";
import { ChartView } from "@/components/charts/chart-view";
import { WordCloudTable } from "@/components/charts/word-cloud-table";
import { fetchWordCloudPending, useWordCloudPending } from "@/components/live/word-cloud-pending";
import { Countdown } from "@/components/live/timer";
import { Button } from "@/components/ui/button";
import { Badge, Progress } from "@/components/ui/primitives";
import { cn, fmtInt, fmtPct } from "@/lib/utils";

const STATE_TONE: Record<string, "muted" | "brand" | "warning" | "positive"> = {
  PRONTA: "muted",
  ABERTA: "brand",
  FECHADA: "warning",
  RESULTADO_EXIBIDO: "positive",
};

type Act = (key: string, path: string, body?: unknown, success?: string) => Promise<unknown>;

export function QuestionControls({
  q,
  onScreen,
  registered,
  results,
  live,
  pending,
  act,
  fetchResults,
  className,
}: {
  q: ControlQuestionDTO;
  /** A pergunta é o item atual do telão. */
  onScreen: boolean;
  registered: number;
  results: ResultsDTO | null;
  live: boolean;
  pending: string | null;
  act: Act;
  fetchResults: (sqId: string) => void;
  className?: string;
}) {
  const [showChart, setShowChart] = useState(false);
  const base = `/questions/${q.sessionQuestionId}`;
  const k = (s: string) => `${s}:${q.sessionQuestionId}`;
  const open = q.state === "ABERTA";
  const closed = q.state === "FECHADA" || q.state === "RESULTADO_EXIBIDO";
  const answered = results?.totals.respondents ?? q.answeredCount;
  const rate = registered ? (answered / registered) * 100 : 0;
  const cloud = q.type === "NUVEM_PALAVRAS";
  const wc = cloud ? (results?.wordCloud ?? null) : null;

  // resultado parcial (visível só para o palestrante) sob demanda; na nuvem, também para os totais de termos
  const hasResults = !!results;
  useEffect(() => {
    if ((showChart || cloud) && q.state !== "PRONTA" && !hasResults) fetchResults(q.sessionQuestionId);
  }, [showChart, cloud, q.state, q.sessionQuestionId, hasResults, fetchResults]);

  // nuvem com aprovação prévia: contagem de pendentes (uma busca leve; depois chega por RT.wordCloudPending)
  const sessionId = useParams<{ id: string }>()?.id;
  const needsApproval = cloud && !!q.wordCloud?.requireApproval && q.state !== "PRONTA";
  const wcPending = useWordCloudPending(needsApproval ? q.sessionQuestionId : null);
  useEffect(() => {
    if (needsApproval && sessionId) void fetchWordCloudPending(sessionId, q.sessionQuestionId);
  }, [needsApproval, sessionId, q.sessionQuestionId]);

  return (
    <section className={cn("rounded-2xl border bg-navy-900 p-4", open ? "border-brand/60" : "border-white/10", className)} aria-label={`Pergunta: ${q.title}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {open ? (
          <Badge tone="brand" className="text-[11px] uppercase">
            <Radio className="size-3" /> Aberta para os participantes
          </Badge>
        ) : (
          <Badge tone={STATE_TONE[q.state]} className="text-[11px] uppercase">
            {SQ_STATE_LABELS[q.state]}
          </Badge>
        )}
        {onScreen ? (
          <Badge tone="outline" className="border-white/20 text-[11px] uppercase text-white/80">
            <Monitor className="size-3" /> No telão
          </Badge>
        ) : (
          <Badge tone="warning" className="text-[11px] uppercase">
            Fora do telão
          </Badge>
        )}
        <Badge tone="outline" className="border-white/15 text-[11px] text-white/60">
          {cloud && <Cloud className="size-3" />}
          {QUESTION_TYPE_LABELS[q.type]}
        </Badge>
        {!!wcPending && (
          <Badge tone="warning" className="text-[11px]" title="Envios aguardando aprovação no painel de controle — não aparecem no telão até a aprovação">
            <Clock className="size-3" /> {fmtInt(wcPending)} {wcPending === 1 ? "pendente" : "pendentes"}
          </Badge>
        )}
        {q.scored && (
          <Badge tone="brand" className="text-[11px]">
            Pontuada
          </Badge>
        )}
      </div>

      <div className="mt-2 flex items-start gap-3">
        <h3 className="min-w-0 flex-1 text-base font-black leading-snug">
          {q.position}. {q.title}
        </h3>
        {open && q.timer.limitMs !== null && <Countdown timer={q.timer} size="md" />}
      </div>

      {q.state !== "PRONTA" && (
        <div className="mt-3">
          <div className="flex items-end justify-between text-xs font-bold text-white/70">
            <span>
              {cloud ? "Responderam" : "Respostas"}: <span className="text-sm font-black tabular text-brand">{fmtInt(answered)}</span> de {fmtInt(registered)}
            </span>
            <span className="tabular">{fmtPct(rate)}</span>
          </div>
          <Progress value={rate} className="mt-1 bg-white/10" />
          {wc && (
            <p className="mt-1.5 text-xs font-bold text-white/70">
              <span className="tabular text-white">{fmtInt(wc.totals.termOccurrences)}</span> {wc.totals.termOccurrences === 1 ? "termo" : "termos"} ·{" "}
              <span className="tabular text-white">{fmtInt(wc.totals.uniqueTerms)}</span> {wc.totals.uniqueTerms === 1 ? "único" : "únicos"}
            </p>
          )}
          {!!wcPending && <p className="mt-1 text-[11px] text-warning">Envios pendentes não aparecem no telão até a aprovação (painel de controle).</p>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {q.state === "PRONTA" && (
          <Button size="lg" className="flex-1" onClick={() => act(k("open"), `${base}/open`, {}, "Pergunta liberada!")} loading={pending === k("open")} disabled={!live}>
            <Play /> Liberar pergunta
          </Button>
        )}
        {open && (
          <>
            {q.timer.limitMs !== null &&
              (q.timer.running ? (
                <Button variant="secondary" onClick={() => act(k("timer"), `${base}/timer-pause`)} loading={pending === k("timer")}>
                  <Pause /> Pausar cronômetro
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => act(k("timer"), `${base}/timer-start`)} loading={pending === k("timer")} disabled={!live}>
                  <Timer /> Iniciar cronômetro
                </Button>
              ))}
            <Button variant="secondary" onClick={() => act(k("add"), `${base}/timer-add`, { seconds: 15 })} loading={pending === k("add")} aria-label="Adicionar 15 segundos ao cronômetro">
              <Plus /> 15s
            </Button>
            <Button variant="negative" onClick={() => act(k("close"), `${base}/close`, {}, "Pergunta encerrada.")} loading={pending === k("close")}>
              <Lock /> Fechar pergunta
            </Button>
          </>
        )}
        {q.state !== "PRONTA" &&
          (q.resultsShownAt ? (
            <Button variant="secondary" onClick={() => act(k("hideres"), `${base}/hide-results`)} loading={pending === k("hideres")}>
              <EyeOff /> Ocultar gráfico
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => act(k("show"), `${base}/show-results`)} loading={pending === k("show")}>
              <Eye /> Exibir gráfico
            </Button>
          ))}
        {q.scored && !cloud && closed && !q.correctRevealedAt && (
          <Button variant="positive" onClick={() => act(k("reveal"), `${base}/reveal`, {}, "Resposta correta revelada e pontos publicados.")} loading={pending === k("reveal")}>
            <CheckCircle2 /> Revelar resposta correta
          </Button>
        )}
      </div>
      {!live && q.state === "PRONTA" && <p className="mt-2 text-xs text-warning">Inicie a sessão para liberar perguntas.</p>}
      {q.scored && !cloud && open && <p className="mt-2 text-xs text-white/50">O gabarito pode ser revelado após o encerramento.</p>}
      {q.correctRevealedAt && <p className="mt-2 text-xs text-positive">Resposta correta já revelada.</p>}

      {q.state !== "PRONTA" && (
        <div className="mt-3 border-t border-white/10 pt-2">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-xs font-black uppercase tracking-wider text-white/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            onClick={() => setShowChart((v) => !v)}
            aria-expanded={showChart}
          >
            <span className="inline-flex items-center gap-1.5">
              {cloud ? <Cloud className="size-3.5" /> : <BarChart3 className="size-3.5" />} {cloud ? "Nuvem parcial (só você vê)" : "Resultado parcial (só você vê)"}
            </span>
            {showChart ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          {showChart && (
            <div className="mt-2">
              <ChartView data={results} type={cloud ? "wordcloud" : q.chart.type} config={q.chart} theme="dark" height={220} showToolbar={false} showTotals={!cloud} />
              {wc && <WordCloudTable data={wc} limit={8} theme="dark" className="mt-2" />}
              <p className="mt-1 text-[11px] text-white/40">
                {cloud
                  ? q.resultsShownAt
                    ? "O público está vendo a nuvem."
                    : "O público ainda não vê a nuvem."
                  : q.resultsShownAt
                    ? "O público está vendo o gráfico."
                    : "O público ainda não vê a distribuição das respostas."}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
