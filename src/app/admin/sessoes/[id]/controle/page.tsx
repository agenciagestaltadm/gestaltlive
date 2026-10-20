"use client";
/**
 * Painel de controle ao vivo do palestrante.
 * Todas as ações vão para a API (o servidor é a fonte da verdade); o painel recebe o estado
 * atualizado na resposta e atualizações em tempo real (respostas, presença, satisfação, ranking).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Play,
  Pause,
  Square,
  SkipForward,
  Eye,
  EyeOff,
  CheckCircle2,
  Lock,
  Timer,
  Plus,
  Monitor,
  Copy,
  QrCode,
  Trophy,
  ThumbsUp,
  Gift,
  Hand,
  Flag,
  Undo2,
  Snowflake,
  Users,
  Wifi,
  WifiOff,
  Keyboard,
  KeyRound,
  Search,
  BarChart3,
  Radio,
  DoorOpen,
  XCircle,
  ExternalLink,
  Presentation,
  Cloud,
} from "lucide-react";
import type { ControlQuestionDTO, ControlStateDTO, LeaderboardDTO, ResultsDTO, SatisfactionDTO, ActivityItemDTO } from "@shared/types";
import { RT } from "@shared/types";
import { QUESTION_TYPE_LABELS, RESULTS_MODE_LABELS, SCREEN_LABELS, SESSION_STATUS_LABELS, SQ_STATE_LABELS, type PresentationScreen } from "@shared/schemas";
import { CHART_META, type ChartType } from "@shared/charts/catalog";
import { chartContextForQuestion, compatibleCharts } from "@shared/charts/compat";
import { admin, ApiError } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { useAction } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Badge, Dialog, Input, NativeSelect, Progress, Spinner, Tip } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { ChartView } from "@/components/charts/chart-view";
import { SatisfactionPie, SatisfactionStats, SatisfactionTimeline } from "@/components/charts/satisfaction-charts";
import { LeaderboardList } from "@/components/live/leaderboard";
import { WordCloudLive, WordCloudPendingBadge } from "@/components/live/word-cloud-moderation";
import { setWordCloudPending } from "@/components/live/word-cloud-pending";
import { Countdown } from "@/components/live/timer";
import { ProductMark } from "@/components/brand";
import { cn, fmtInt, fmtPct, fmtDateTime } from "@/lib/utils";

const STATE_TONE: Record<string, "muted" | "brand" | "warning" | "positive"> = {
  PRONTA: "muted",
  ABERTA: "brand",
  FECHADA: "warning",
  RESULTADO_EXIBIDO: "positive",
};

const SCREENS: { screen: PresentationScreen; icon: React.ComponentType<{ className?: string }>; key: string }[] = [
  { screen: "BOAS_VINDAS", icon: Hand, key: "1" },
  { screen: "PERGUNTA", icon: Radio, key: "2" },
  { screen: "RESULTADO", icon: BarChart3, key: "3" },
  { screen: "RANKING", icon: Trophy, key: "4" },
  { screen: "SATISFACAO", icon: ThumbsUp, key: "5" },
  { screen: "PREMIACAO", icon: Gift, key: "6" },
  { screen: "ENCERRAMENTO", icon: Flag, key: "7" },
];

export default function ControlPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [state, setState] = useState<ControlStateDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ResultsDTO>>({});
  const [viewChart, setViewChart] = useState<ChartType | null>(null);
  const [crossQ, setCrossQ] = useState<string>("");
  const [qrOpen, setQrOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const { pending, run } = useAction();
  const resyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastActive = useRef<string | null | undefined>(undefined);
  const apply = useCallback((s: ControlStateDTO) => {
    setState(s);
    if (s.results) setResults((r) => ({ ...r, [s.results!.sessionQuestionId]: s.results! }));
    // quando a pergunta em foco muda (ex.: "próxima"), o painel acompanha; senão mantém a seleção do palestrante
    const focusChanged = lastActive.current !== s.activeQuestionId;
    lastActive.current = s.activeQuestionId;
    setSelected((cur) => {
      const exists = cur && s.questions.some((q) => q.sessionQuestionId === cur);
      if (focusChanged && s.activeQuestionId) return s.activeQuestionId;
      if (exists) return cur;
      return s.activeQuestionId ?? s.questions.find((q) => q.state === "PRONTA")?.sessionQuestionId ?? s.questions[0]?.sessionQuestionId ?? null;
    });
  }, []);
  const [panel, setPanel] = useState<string | null>(null);
  useEffect(() => {
    setPanel(new URLSearchParams(window.location.search).get("painel"));
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await admin.get<ControlStateDTO>(`/sessions/${id}/control`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível carregar a sessão.");
    }
  }, [id, apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (key: string, path: string, body: unknown = {}, success?: string) => {
      const s = await run(key, () => admin.post<ControlStateDTO>(`/sessions/${id}${path}`, body), success);
      if (s) apply(s);
    },
    [id, run, apply],
  );

  const status = useRealtime({
    auth: state ? { role: "control", sessionId: id } : null,
    onSync: () => void load(),
    handlers: {
      [RT.resultsUpdated]: (r: ResultsDTO) => setResults((m) => ({ ...m, [r.sessionQuestionId]: r })),
      [RT.leaderboardUpdated]: (lb: LeaderboardDTO) => setState((s) => (s ? { ...s, leaderboard: lb } : s)),
      [RT.satisfactionUpdated]: (sat: SatisfactionDTO) => setState((s) => (s ? { ...s, satisfaction: sat } : s)),
      [RT.presenceChanged]: (p: { registered: number; connected: number }) => setState((s) => (s ? { ...s, counts: { ...s.counts, ...p } } : s)),
      [RT.participantJoined]: (d: { participants?: { id: string; displayName: string }[]; count: number }) =>
        setState((s) => {
          if (!s || !d.participants) return s;
          const items: ActivityItemDTO[] = d.participants.slice(-5).map((p) => ({ id: `j-${p.id}`, type: "participant.joined", label: `Novo participante: ${p.displayName}`, at: new Date().toISOString() }));
          return { ...s, activity: [...items.reverse(), ...s.activity].slice(0, 40) };
        }),
      [RT.wordCloudPending]: (d: { sessionQuestionId: string; pending: number }) => setWordCloudPending(d.sessionQuestionId, d.pending),
      [RT.resync]: () => {
        if (resyncTimer.current) clearTimeout(resyncTimer.current);
        resyncTimer.current = setTimeout(() => void load(), 250);
      },
    },
  });

  const q = useMemo(() => state?.questions.find((x) => x.sessionQuestionId === selected) ?? null, [state, selected]);
  const crossQuestionId = useMemo(() => state?.questions.find((x) => x.sessionQuestionId === crossQ)?.questionId ?? null, [state, crossQ]);

  // resultados da pergunta selecionada (com cruzamento opcional)
  useEffect(() => {
    if (!q || q.state === "PRONTA") return;
    // nuvem de palavras não tem cruzamento por perfil
    const cross = q.type === "NUVEM_PALAVRAS" ? "" : crossQ;
    const qs = cross ? `?cross=${crossQuestionId}` : "";
    if (!cross && results[q.sessionQuestionId]) return;
    void admin.get<ResultsDTO>(`/sessions/${id}/results/${q.sessionQuestionId}${qs}`).then((r) => setResults((m) => ({ ...m, [q.sessionQuestionId]: r })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q?.sessionQuestionId, q?.state, crossQ]);

  useEffect(() => {
    setViewChart(null);
  }, [selected]);

  // atalhos de teclado
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!state) return;
      const active = state.questions.find((x) => x.sessionQuestionId === state.activeQuestionId);
      const k = e.key.toLowerCase();
      if (k === "n") void act("next", "/next");
      else if (k === " " && active?.state === "ABERTA") {
        e.preventDefault();
        void act("timer", `/questions/${active.sessionQuestionId}/${active.timer.running ? "timer-pause" : "timer-start"}`);
      } else if (k === "f" && active?.state === "ABERTA") void act("close", `/questions/${active.sessionQuestionId}/close`);
      else if (k === "r" && q && q.state !== "PRONTA") void act("show", `/questions/${q.sessionQuestionId}/show-results`);
      else if (k === "c" && q && q.scored && q.type !== "NUVEM_PALAVRAS" && (q.state === "FECHADA" || q.state === "RESULTADO_EXIBIDO")) void act("reveal", `/questions/${q.sessionQuestionId}/reveal`);
      else if (k === "b") void act("back", "/presentation", { back: true });
      else if (k === "?") setHelpOpen(true);
      else {
        const sc = SCREENS.find((s) => s.key === k);
        if (sc) void act(`screen-${sc.screen}`, "/presentation", { screen: sc.screen });
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [state, q, act]);

  if (error) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <p className="text-lg font-black">{error}</p>
          <Button className="mt-4" onClick={() => void load()}>
            Tentar novamente
          </Button>
          <Link href="/admin/sessoes" className="mt-3 block text-sm font-bold text-brand">
            Voltar às sessões
          </Link>
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  const s = state.session;
  const pres = state.presentation;
  const active = state.questions.find((x) => x.sessionQuestionId === state.activeQuestionId) ?? null;
  const live = s.status === "AO_VIVO";
  const ended = s.status === "ENCERRADA" || s.status === "CANCELADA";
  const progress = state.questions.length ? (state.counts.questionsDone / state.questions.length) * 100 : 0;
  const answeredActive = active ? (results[active.sessionQuestionId]?.totals.respondents ?? active.answeredCount) : 0;
  const rate = state.counts.registered ? (answeredActive / state.counts.registered) * 100 : 0;
  const r = q ? results[q.sessionQuestionId] ?? null : null;
  const compat = q
    ? compatibleCharts(chartContextForQuestion({ type: q.type, optionCount: q.options.length, maxSelections: q.maxSelections, scaleMin: q.scaleMin, scaleMax: q.scaleMax, hasCross: !!crossQ }))
    : [];
  const chartType: ChartType = viewChart ?? q?.chart.type ?? "bar_horizontal";
  const copy = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(msg);
    } catch {
      toast.info(text);
    }
  };
  const openWindow = (url: string, name: string) => window.open(url, name, "noopener=yes,width=1280,height=720");

  // janelas destacadas (abertas a partir do painel): somente satisfação ou somente ranking
  if (panel === "satisfacao" || panel === "ranking") {
    return (
      <div className="dark min-h-dvh bg-navy-950 p-6 text-white">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-black">{panel === "satisfacao" ? "Termômetro do treinamento" : "Ranking oficial"}</h1>
          <span className="text-sm text-white/60">
            {s.event.title} · {s.code}
          </span>
        </div>
        {panel === "satisfacao" ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <SatisfactionPie data={state.satisfaction} height={420} large />
            <div className="space-y-6">
              <SatisfactionStats data={state.satisfaction} large />
              <SatisfactionTimeline data={state.satisfaction} height={260} />
            </div>
          </div>
        ) : (
          <LeaderboardList lb={state.leaderboard} large />
        )}
      </div>
    );
  }

  return (
    <div className="dark min-h-dvh bg-navy-950 text-white">
      {/* barra superior */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-navy-950/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Link href={`/admin/eventos/${s.eventId}/sessoes`} className="rounded-lg p-2 text-white/70 hover:bg-white/10" aria-label="Voltar">
            <ArrowLeft className="size-5" />
          </Link>
          <ProductMark className="hidden text-lg xl:inline-flex" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black">{s.event.title}</p>
            <p className="truncate text-xs text-white/60">
              {s.name} · código <span className="font-black tracking-widest text-brand">{s.code}</span>
            </p>
          </div>
          <Badge tone={live ? "brand" : s.status === "PAUSADA" ? "warning" : ended ? "muted" : "outline"} className="text-sm">
            {live && <span className="size-2 animate-pulse rounded-full bg-brand" />}
            {SESSION_STATUS_LABELS[s.status]}
          </Badge>
          <Tip content={status === "conectado" ? "Tempo real conectado" : "Reconectando ao tempo real…"}>
            <span className={cn("rounded-lg p-2", status === "conectado" ? "text-positive" : "text-warning")}>{status === "conectado" ? <Wifi className="size-5" /> : <WifiOff className="size-5" />}</span>
          </Tip>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/admin/sessoes/${id}/apresentador`}>
                <Presentation /> Modo apresentador
              </Link>
            </Button>
            {s.screenUrl && (
              <Button variant="secondary" size="sm" onClick={() => openWindow(s.screenUrl!, "telao")}>
                <Monitor /> Abrir telão
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setQrOpen(true)}>
              <QrCode /> QR / link
            </Button>
            <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10" onClick={() => setHelpOpen(true)} aria-label="Atalhos de teclado">
              <Keyboard />
            </Button>
            {(s.status === "RASCUNHO" || s.status === "AGENDADA") && (
              <Button size="sm" variant="secondary" onClick={() => act("lobby", "/lobby", {}, "Inscrições abertas.")} loading={pending === "lobby"}>
                <DoorOpen /> Abrir inscrições
              </Button>
            )}
            {(s.status === "RASCUNHO" || s.status === "AGENDADA" || s.status === "AGUARDANDO") && (
              <Button size="sm" onClick={() => act("start", "/start", {}, "Sessão iniciada!")} loading={pending === "start"}>
                <Play /> Iniciar sessão
              </Button>
            )}
            {live && (
              <Button size="sm" variant="secondary" onClick={() => act("pause", "/pause")} loading={pending === "pause"}>
                <Pause /> Pausar
              </Button>
            )}
            {s.status === "PAUSADA" && (
              <Button size="sm" onClick={() => act("resume", "/resume")} loading={pending === "resume"}>
                <Play /> Retomar
              </Button>
            )}
            {!ended && s.status !== "RASCUNHO" && s.status !== "AGENDADA" && (
              <Button size="sm" variant="negative" onClick={() => setConfirmEnd(true)}>
                <Square /> Encerrar
              </Button>
            )}
            {ended && (
              <Button size="sm" variant="secondary" asChild>
                <Link href={`/admin/sessoes/${id}/resultados`}>
                  <BarChart3 /> Resultados
                </Link>
              </Button>
            )}
          </div>
        </div>
        {/* indicadores */}
        <div className="grid grid-cols-2 gap-px border-t border-white/10 bg-white/10 sm:grid-cols-4 xl:grid-cols-7">
          {[
            { l: "Inscritos", v: fmtInt(state.counts.registered) },
            { l: "Conectados", v: fmtInt(state.counts.connected), accent: "text-positive" },
            { l: "Respostas (atual)", v: active ? fmtInt(answeredActive) : "—", accent: "text-brand" },
            { l: "Participação", v: active ? fmtPct(rate) : "—" },
            { l: "Perguntas", v: `${state.counts.questionsDone}/${state.questions.length}` },
            { l: "Satisfação", v: state.satisfaction.summary.total ? fmtPct(state.satisfaction.summary.positivePct) : "Sem avaliações", accent: "text-positive" },
          ].map((k) => (
            <div key={k.l} className="bg-navy-950 px-4 py-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">{k.l}</p>
              <p className={cn("text-xl font-black tabular", k.accent)}>{k.v}</p>
            </div>
          ))}
          <div className="col-span-2 bg-navy-950 px-4 py-2.5 sm:col-span-4 xl:col-span-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">Progresso</p>
            <Progress value={progress} className="mt-2 bg-white/10" />
          </div>
        </div>
      </header>

      <div className="grid gap-4 p-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        {/* sequência de perguntas */}
        <aside className="space-y-2 xl:sticky xl:top-[150px] xl:max-h-[calc(100dvh-170px)] xl:overflow-y-auto" aria-label="Sequência de perguntas">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-wider text-white/70">Perguntas</h2>
            <Button size="sm" onClick={() => act("next", "/next")} loading={pending === "next"} disabled={!live}>
              <SkipForward /> Próxima
            </Button>
          </div>
          {state.questions.length === 0 && <p className="rounded-xl bg-white/5 p-4 text-sm text-white/60">Nenhuma pergunta pronta. Cadastre perguntas no evento.</p>}
          {state.questions.map((x) => (
            <button
              key={x.sessionQuestionId}
              onClick={() => setSelected(x.sessionQuestionId)}
              className={cn(
                "w-full rounded-xl border p-3 text-left transition",
                selected === x.sessionQuestionId ? "border-brand bg-brand/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                x.sessionQuestionId === state.activeQuestionId && "ring-2 ring-brand/50",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-white/50">#{x.position}</span>
                <Badge tone={STATE_TONE[x.state]}>{SQ_STATE_LABELS[x.state]}</Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-sm font-bold">{x.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-white/50">
                <span className="inline-flex items-center gap-1">
                  {x.type === "NUVEM_PALAVRAS" && <Cloud className="size-3" aria-hidden />}
                  {QUESTION_TYPE_LABELS[x.type]}
                </span>
                {x.timer.limitMs && <span>{Math.round(x.timer.limitMs / 1000)}s</span>}
                {x.answeredCount > 0 && <span>{x.answeredCount} resp.</span>}
                {x.correctRevealedAt && <span className="text-positive">gabarito revelado</span>}
                {x.type === "NUVEM_PALAVRAS" && <WordCloudPendingBadge sqId={x.sessionQuestionId} className="px-1.5 py-0 text-[10px]" />}
              </div>
            </button>
          ))}
        </aside>

        {/* pergunta e gráfico */}
        <main className="min-w-0 space-y-4">
          {q ? (
            <QuestionPanel
              q={q}
              sessionId={id}
              sessionCode={s.code}
              connected={state.counts.connected}
              isActive={q.sessionQuestionId === state.activeQuestionId}
              live={live}
              pending={pending}
              results={r}
              chartType={chartType}
              compat={compat}
              onChart={setViewChart}
              crossQ={crossQ}
              setCrossQ={setCrossQ}
              profileQuestions={state.profileQuestions.filter((p) => p.sessionQuestionId !== q.sessionQuestionId)}
              act={act}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center text-white/60">Selecione uma pergunta na lista.</div>
          )}
        </main>

        {/* telão, ranking, satisfação e atividade */}
        <aside className="space-y-4">
          <section className="rounded-2xl border border-white/10 bg-navy-900 p-4" aria-label="Controle do telão">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-wider text-white/70">Telão</h2>
              <Button variant="ghost" size="sm" className="text-white/70 hover:bg-white/10" onClick={() => act("back", "/presentation", { back: true })}>
                <Undo2 /> Voltar
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SCREENS.map((sc) => (
                <button
                  key={sc.screen}
                  onClick={() => act(`screen-${sc.screen}`, "/presentation", { screen: sc.screen, sessionQuestionId: sc.screen === "PERGUNTA" || sc.screen === "RESULTADO" ? (q && q.state !== "PRONTA" ? q.sessionQuestionId : undefined) : undefined })}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-bold transition",
                    pres.screen === sc.screen ? "border-brand bg-brand text-white" : "border-white/10 bg-white/5 hover:bg-white/10",
                  )}
                  aria-pressed={pres.screen === sc.screen}
                >
                  <sc.icon className="size-4" />
                  <span className="flex-1">{SCREEN_LABELS[sc.screen]}</span>
                  <kbd className="text-[10px] opacity-60">{sc.key}</kbd>
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant={pres.leaderboardFrozen ? "default" : "secondary"} onClick={() => act("freeze", "/leaderboard", { frozen: !pres.leaderboardFrozen })} loading={pending === "freeze"}>
                <Snowflake /> {pres.leaderboardFrozen ? "Descongelar ranking" : "Congelar ranking"}
              </Button>
              <Button size="sm" variant={pres.leaderboardHidden ? "default" : "secondary"} onClick={() => act("hide", "/leaderboard", { hidden: !pres.leaderboardHidden })} loading={pending === "hide"}>
                {pres.leaderboardHidden ? <Eye /> : <EyeOff />} {pres.leaderboardHidden ? "Mostrar ranking" : "Ocultar ranking"}
              </Button>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-white/80">
              <input type="checkbox" className="size-4 accent-[#FF0068]" checked={pres.showSatisfactionToScreen} onChange={(e) => act("satscreen", "/presentation", { showSatisfactionToScreen: e.target.checked })} />
              Exibir satisfação no telão junto à tela atual
            </label>
          </section>

          <section className="rounded-2xl border border-white/10 bg-navy-900 p-4" aria-label="Satisfação">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-wider text-white/70">Termômetro do treinamento</h2>
              <Button variant="ghost" size="icon-sm" className="text-white/70 hover:bg-white/10" onClick={() => openWindow(`/admin/sessoes/${id}/controle?painel=satisfacao`, "satisfacao")} aria-label="Abrir em outra janela">
                <ExternalLink />
              </Button>
            </div>
            <SatisfactionPie data={state.satisfaction} height={200} />
            <SatisfactionStats data={state.satisfaction} />
            <div className="mt-3">
              <p className="mb-1 text-xs font-bold text-white/50">Evolução no tempo</p>
              <SatisfactionTimeline data={state.satisfaction} height={140} />
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-navy-900 p-4" aria-label="Ranking ao vivo">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-wider text-white/70">Ranking oficial</h2>
              <span className="flex items-center gap-1 text-xs text-white/50">
                {fmtInt(state.leaderboard.totalRanked)} pontuados
                <Button variant="ghost" size="icon-sm" className="text-white/70 hover:bg-white/10" onClick={() => openWindow(`/admin/sessoes/${id}/controle?painel=ranking`, "ranking")} aria-label="Abrir ranking em outra janela">
                  <ExternalLink />
                </Button>
              </span>
            </div>
            <LeaderboardList lb={state.leaderboard} />
            {(pres.leaderboardFrozen || pres.leaderboardHidden) && <p className="mt-2 text-xs text-white/50">O público vê o ranking {pres.leaderboardHidden ? "oculto" : "congelado"}; o cálculo oficial continua acima.</p>}
          </section>

          <section className="rounded-2xl border border-white/10 bg-navy-900 p-4" aria-label="Participantes e atividade">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-wider text-white/70">Atividade</h2>
              <Button variant="ghost" size="sm" className="text-white/70 hover:bg-white/10" onClick={() => setParticipantsOpen(true)}>
                <Users /> Participantes
              </Button>
            </div>
            <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
              {state.activity.length === 0 && <li className="text-white/50">Sem atividade ainda.</li>}
              {state.activity.map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span className="shrink-0 text-xs tabular text-white/40">{new Date(a.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="text-white/80">{a.label}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <Dialog open={qrOpen} onOpenChange={setQrOpen} title="Entrada dos participantes" className="dark bg-navy-900 text-white">
        {s.status === "RASCUNHO" ? (
          <p className="text-sm text-white/70">Abra as inscrições ou inicie a sessão para ativar o link e o QR Code.</p>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/public/sessions/${s.code}/qr.svg`} alt={`QR Code para ${s.joinUrl}`} className="size-64 rounded-xl bg-white p-2" />
            <p className="text-3xl font-black tracking-[0.3em] text-brand">{s.code}</p>
            <p className="break-all text-sm text-white/70">{s.joinUrl}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => copy(s.joinUrl, "Link de entrada copiado.")}>
                <Copy /> Copiar link
              </Button>
              {s.screenUrl && (
                <Button size="sm" variant="secondary" onClick={() => copy(s.screenUrl!, "Link do telão copiado.")}>
                  <Monitor /> Copiar link do telão
                </Button>
              )}
            </div>
            <p className="text-xs text-white/50">O link do telão dá acesso somente à exibição — não compartilhe com o público.</p>
          </div>
        )}
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen} title="Atalhos de teclado" className="dark bg-navy-900 text-white">
        <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {[
            ["N", "Liberar próxima pergunta"],
            ["Espaço", "Pausar/retomar cronômetro"],
            ["F", "Fechar pergunta aberta"],
            ["R", "Exibir resultado"],
            ["C", "Revelar resposta correta"],
            ["B", "Voltar visualização do telão"],
            ["1–7", "Telas do telão"],
            ["?", "Esta ajuda"],
          ].map(([k, d]) => (
            <li key={k} className="flex items-center gap-3">
              <kbd className="min-w-14 rounded-lg bg-white/10 px-2 py-1 text-center font-black">{k}</kbd>
              {d}
            </li>
          ))}
        </ul>
      </Dialog>

      <Dialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="Encerrar a sessão?"
        description="A pergunta aberta será fechada, a pontuação publicada e a classificação congelada oficialmente. O telão exibirá o pódio com os prêmios."
        className="dark bg-navy-900 text-white"
        footer={
          <>
            <Button variant="ghost" className="text-white hover:bg-white/10" onClick={() => setConfirmEnd(false)}>
              Cancelar
            </Button>
            <Button
              variant="negative"
              loading={pending === "end"}
              onClick={async () => {
                await act("end", "/end", {}, "Sessão encerrada. Pódio no telão!");
                setConfirmEnd(false);
              }}
            >
              <Square /> Encerrar e mostrar pódio
            </Button>
          </>
        }
      />

      <ParticipantsDialog open={participantsOpen} onOpenChange={setParticipantsOpen} sessionId={id} />
    </div>
  );
}

function QuestionPanel({
  q,
  sessionId,
  sessionCode,
  connected,
  isActive,
  live,
  pending,
  results,
  chartType,
  compat,
  onChart,
  crossQ,
  setCrossQ,
  profileQuestions,
  act,
}: {
  q: ControlQuestionDTO;
  sessionId: string;
  sessionCode: string;
  connected: number;
  isActive: boolean;
  live: boolean;
  pending: string | null;
  results: ResultsDTO | null;
  chartType: ChartType;
  compat: ChartType[];
  onChart: (t: ChartType | null) => void;
  crossQ: string;
  setCrossQ: (v: string) => void;
  profileQuestions: { sessionQuestionId: string; title: string }[];
  act: (key: string, path: string, body?: unknown, success?: string) => Promise<void>;
}) {
  const base = `/questions/${q.sessionQuestionId}`;
  const closed = q.state === "FECHADA" || q.state === "RESULTADO_EXIBIDO";
  const cloud = q.type === "NUVEM_PALAVRAS";
  return (
    <>
      <section className="rounded-2xl border border-white/10 bg-navy-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATE_TONE[q.state]}>{SQ_STATE_LABELS[q.state]}</Badge>
              <Badge tone="outline">{QUESTION_TYPE_LABELS[q.type]}</Badge>
              <Badge tone="outline">{RESULTS_MODE_LABELS[q.resultsMode]}</Badge>
              {q.scored && <Badge tone="brand">Pontuada</Badge>}
            </div>
            <h1 className="mt-2 text-2xl font-black leading-tight">
              {q.position}. {q.title}
            </h1>
            {q.description && <p className="mt-1 text-white/70">{q.description}</p>}
          </div>
          {q.state === "ABERTA" && q.timer.limitMs !== null && <Countdown timer={q.timer} size="lg" />}
        </div>

        {q.options.length > 0 && (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {q.options.map((o, i) => {
              const correct = q.correctOptionIdsAdmin.includes(o.id);
              return (
                <li key={o.id} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-sm", correct ? "border-positive/50 bg-positive/10" : "border-white/10 bg-white/5")}>
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-white/10 text-xs font-black">{String.fromCharCode(65 + i)}</span>
                  <span className="flex-1">{o.label}</span>
                  {correct && (
                    <Tip content="Resposta correta (visível apenas para você até a revelação)">
                      <CheckCircle2 className="size-4 text-positive" />
                    </Tip>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* controles */}
        <div className="mt-5 flex flex-wrap gap-2">
          {q.state === "PRONTA" && (
            <Button size="lg" onClick={() => act("open", `${base}/open`, {}, "Pergunta liberada!")} loading={pending === "open"} disabled={!live}>
              <Play /> Liberar pergunta
            </Button>
          )}
          {q.state === "ABERTA" && (
            <>
              {q.timer.limitMs !== null &&
                (q.timer.running ? (
                  <Button variant="secondary" onClick={() => act("timer", `${base}/timer-pause`)} loading={pending === "timer"}>
                    <Pause /> Pausar cronômetro
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => act("timer", `${base}/timer-start`)} loading={pending === "timer"} disabled={!live}>
                    <Timer /> Iniciar cronômetro
                  </Button>
                ))}
              <Button variant="secondary" onClick={() => act("add", `${base}/timer-add`, { seconds: 15 })} loading={pending === "add"}>
                <Plus /> 15s
              </Button>
              <Button variant="negative" onClick={() => act("close", `${base}/close`, {}, "Pergunta encerrada.")} loading={pending === "close"}>
                <Lock /> {q.timer.limitMs !== null ? "Encerrar cronômetro e fechar" : "Fechar pergunta"}
              </Button>
            </>
          )}
          {q.state !== "PRONTA" &&
            (q.resultsShownAt ? (
              <Button variant="secondary" onClick={() => act("hideres", `${base}/hide-results`)} loading={pending === "hideres"}>
                <EyeOff /> Ocultar resultado
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => act("show", `${base}/show-results`)} loading={pending === "show"}>
                <Eye /> Exibir resultado
              </Button>
            ))}
          {q.scored && !cloud && closed && !q.correctRevealedAt && (
            <Button variant="positive" onClick={() => act("reveal", `${base}/reveal`, {}, "Resposta correta revelada e pontos publicados.")} loading={pending === "reveal"}>
              <CheckCircle2 /> Revelar resposta correta
            </Button>
          )}
          {q.scored && !cloud && q.state === "ABERTA" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-white/50">
              <XCircle className="size-3.5" /> O gabarito só pode ser revelado após o encerramento.
            </span>
          )}
          {!isActive && q.state !== "PRONTA" && (
            <span className="inline-flex items-center text-xs text-white/50">Pergunta anterior — exibição no telão disponível pelos botões ao lado.</span>
          )}
        </div>
        {q.scored && (q.scoredAt || q.scoresPublishedAt) && (
          <p className="mt-3 text-xs text-white/50">
            Pontuação calculada {q.scoredAt ? `às ${fmtDateTime(q.scoredAt).split(" ")[1]}` : ""}
            {q.scoresPublishedAt ? ` · publicada às ${fmtDateTime(q.scoresPublishedAt).split(" ")[1]}` : " · será publicada na revelação ou ao avançar"}
          </p>
        )}
      </section>

      {cloud ? (
        <WordCloudLive key={q.sessionQuestionId} sessionId={sessionId} sessionCode={sessionCode} q={q} results={results} connected={connected} isActive={isActive} />
      ) : (
      <section className="rounded-2xl border border-white/10 bg-navy-900 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black uppercase tracking-wider text-white/70">Resultado {isActive && q.state === "ABERTA" ? "ao vivo" : ""}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect value={chartType} onChange={(e) => onChart(e.target.value as ChartType)} aria-label="Visualização no painel" className="h-9 w-52 border-white/15 bg-white/5 text-sm text-white">
              {compat.map((t) => (
                <option key={t} value={t}>
                  {CHART_META[t].label}
                  {t === q.chart.type ? " (telão)" : ""}
                </option>
              ))}
            </NativeSelect>
            {profileQuestions.length > 0 && (
              <NativeSelect value={crossQ} onChange={(e) => setCrossQ(e.target.value)} aria-label="Cruzar com pergunta de perfil" className="h-9 w-52 border-white/15 bg-white/5 text-sm text-white">
                <option value="">Sem cruzamento</option>
                {profileQuestions.map((p) => (
                  <option key={p.sessionQuestionId} value={p.sessionQuestionId}>
                    Cruzar: {p.title.slice(0, 40)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>
        </div>
        {q.state === "PRONTA" ? (
          <div className="grid h-72 place-items-center rounded-xl bg-white/[0.03] text-white/50">Libere a pergunta para receber respostas.</div>
        ) : (
          <ChartView data={results} type={chartType} config={q.chart} theme="dark" height={380} exportName={`pergunta-${q.position}`} />
        )}
        <p className="mt-2 text-xs text-white/40">
          {q.resultsShownAt ? "O público está vendo este resultado." : "O público ainda não vê a distribuição das respostas."} Gabarito marcado em verde apenas neste painel até a revelação.
        </p>
      </section>
      )}
    </>
  );
}

interface SP {
  id: string;
  displayName: string;
  fullName: string;
  email: string | null;
  score: number;
  online: boolean;
  disqualifiedAt: string | null;
}

function ParticipantsDialog({ open, onOpenChange, sessionId }: { open: boolean; onOpenChange: (v: boolean) => void; sessionId: string }) {
  const [list, setList] = useState<SP[] | null>(null);
  const [q, setQ] = useState("");
  const [code, setCode] = useState<{ name: string; code: string; expiresAt: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void admin.get<SP[]>(`/sessions/${sessionId}/participants${q ? `?q=${encodeURIComponent(q)}` : ""}`).then(setList), 250);
    return () => clearTimeout(t);
  }, [open, q, sessionId]);
  const issue = async (p: SP) => {
    try {
      const r = await admin.post<{ code: string; expiresAt: string }>(`/sessions/${sessionId}/participants/${p.id}/recovery-code`);
      setCode({ name: p.displayName, ...r });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro.");
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Participantes da sessão" className="dark max-w-2xl bg-navy-900 text-white">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou e-mail" className="border-white/15 bg-white/5 pl-9 text-white" />
      </div>
      {code && (
        <div className="mb-3 rounded-xl border border-brand/40 bg-brand/10 p-3 text-sm">
          Código de recuperação para <b>{code.name}</b>: <span className="text-2xl font-black tracking-[0.3em] text-brand">{code.code}</span>
          <p className="text-xs text-white/60">Válido até {new Date(code.expiresAt).toLocaleTimeString("pt-BR")}. Entregue pessoalmente — confirme a identidade antes.</p>
        </div>
      )}
      <ul className="max-h-[50dvh] space-y-1.5 overflow-y-auto">
        {list === null && <li className="text-white/60">Carregando…</li>}
        {list?.length === 0 && <li className="text-white/60">Nenhum participante encontrado.</li>}
        {list?.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2">
            <span className={cn("size-2 shrink-0 rounded-full", p.online ? "bg-positive" : "bg-white/20")} aria-label={p.online ? "conectado" : "desconectado"} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">
                {p.displayName} <span className="font-normal text-white/50">· {p.fullName}</span>
              </p>
              {p.email && <p className="truncate text-xs text-white/50">{p.email}</p>}
            </div>
            <span className="text-sm font-black tabular">{fmtInt(p.score)}</span>
            {p.disqualifiedAt && <Badge tone="negative">Desclassificado</Badge>}
            <Button size="sm" variant="ghost" className="text-white/80 hover:bg-white/10" onClick={() => issue(p)}>
              <KeyRound /> Recuperação
            </Button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
