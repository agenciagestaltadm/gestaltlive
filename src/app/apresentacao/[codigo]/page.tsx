"use client";
/**
 * Telão / modo apresentação. Sem controles administrativos: acesso por token de exibição.
 * O palestrante controla a tela a partir do painel (outra janela ou dispositivo).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Maximize, Users, CheckCircle2, Lightbulb, Snowflake, EyeOff, Sparkles, ThumbsUp, Mic2, Volume2, VolumeX } from "lucide-react";
import type { LeaderboardDTO, PodiumDTO, PresentationDTO, ResultsDTO, SatisfactionDTO, ScreenStateDTO } from "@shared/types";
import { RT } from "@shared/types";
import { publicFetch } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { ChartView } from "@/components/charts/chart-view";
import { SatisfactionPie, SatisfactionStats, SatisfactionTimeline } from "@/components/charts/satisfaction-charts";
import { LeaderboardList, Podium, PrizeCard, PLACE } from "@/components/live/leaderboard";
import { Countdown } from "@/components/live/timer";
import { EventLogo, GestaltLogo, ProductMark } from "@/components/brand";
import { playSound } from "@/components/participant/sound";
import { cn, fmtInt, fmtPct } from "@/lib/utils";

export default function ApresentacaoPage() {
  const params = useParams<{ codigo: string }>();
  const code = String(params.codigo ?? "").toUpperCase();
  const [token, setToken] = useState<string | null>(null);
  const [light, setLight] = useState(false);
  const [state, setState] = useState<ScreenStateDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState<number | null>(null);
  const [sound, setSound] = useState(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusId = useRef<string | null>(null);
  focusId.current = state?.question?.sessionQuestionId ?? null;

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setToken(sp.get("t"));
    setLight(sp.get("tema") === "claro");
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const s = await publicFetch<ScreenStateDTO>(`/screen/${code}/state?t=${encodeURIComponent(token)}`);
      setState(s);
      setAnswered(s.counts.answered);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar o telão.");
    }
  }, [code, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const soon = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void load(), 120);
  }, [load]);

  const prevScreen = useRef<string | null>(null);
  useEffect(() => {
    const sc = state?.presentation.screen ?? null;
    if (sound && sc === "PREMIACAO" && prevScreen.current !== "PREMIACAO") playSound("fanfare");
    prevScreen.current = sc;
  }, [state?.presentation.screen, sound]);

  const status = useRealtime({
    auth: token ? { role: "screen", code, token } : null,
    onSync: soon,
    handlers: {
      [RT.presentationChanged]: (p: PresentationDTO) => {
        setState((s) => (s ? { ...s, presentation: p } : s));
        soon();
      },
      [RT.questionOpened]: () => soon(),
      [RT.questionClosed]: () => soon(),
      [RT.questionTimerUpdated]: () => soon(),
      [RT.questionResultRevealed]: () => soon(),
      [RT.resultsUpdated]: (r: ResultsDTO) => setState((s) => (s && s.question?.sessionQuestionId === r.sessionQuestionId ? { ...s, results: r } : s)),
      [RT.answersCount]: (d: { sessionQuestionId: string; answered: number }) => {
        if (focusId.current === d.sessionQuestionId) setAnswered(d.answered);
      },
      [RT.leaderboardUpdated]: (lb: LeaderboardDTO) => setState((s) => (s ? { ...s, leaderboard: lb } : s)),
      [RT.satisfactionUpdated]: (sat: SatisfactionDTO) => setState((s) => (s ? { ...s, satisfaction: sat } : s)),
      [RT.presenceChanged]: (p: { registered: number; connected: number }) => setState((s) => (s ? { ...s, counts: { ...s.counts, ...p } } : s)),
      [RT.participantJoined]: () => undefined,
      [RT.prizesRevealed]: (d: { podium: PodiumDTO }) => setState((s) => (s ? { ...s, podium: d.podium } : s)),
      [RT.sessionStarted]: soon,
      [RT.sessionPaused]: soon,
      [RT.sessionResumed]: soon,
      [RT.sessionEnded]: soon,
      [RT.resync]: soon,
    },
  });

  // tecla F = tela cheia
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "f") void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const theme = light ? "light" : "dark";
  const shell = cn("relative flex h-dvh w-full flex-col overflow-hidden", light ? "bg-[#F4F6FB] text-navy-900" : "dark bg-brand-hero text-white");

  if (!token || error) {
    return (
      <div className={cn(shell, "items-center justify-center p-10 text-center")}>
        <ProductMark className="mb-6 text-4xl" />
        <p className="text-3xl font-black">{error ?? "Link do telão incompleto."}</p>
        <p className="mt-2 text-xl opacity-70">Abra o telão pelo painel do palestrante.</p>
      </div>
    );
  }
  if (!state) {
    return (
      <div className={cn(shell, "items-center justify-center")}>
        <ProductMark className="animate-pulse text-5xl" />
      </div>
    );
  }

  const s = state.session;
  const screen = state.presentation.screen;
  const q = state.question;
  const showCorner = screen !== "BOAS_VINDAS" && s.status !== "ENCERRADA";

  return (
    <div className={shell}>
      {/* topo */}
      <header className="flex shrink-0 items-center justify-between gap-6 px-[3vw] py-[2vh]">
        <div className="flex items-center gap-4">
          <EventLogo src={s.event.logoUrl} className="h-[5vh] min-h-8" />
          <span className="hidden text-[1.6vh] font-bold opacity-70 md:inline">{s.event.title}</span>
        </div>
        <div className="flex items-center gap-4 text-[1.8vh] font-bold">
          <span className="inline-flex items-center gap-2 opacity-80">
            <Users className="size-[2.4vh]" /> {fmtInt(state.counts.registered)} inscritos
          </span>
          {status !== "conectado" && <span className="rounded-full bg-warning px-3 py-1 text-navy-950">reconectando…</span>}
          <button onClick={() => setSound(!sound)} className="rounded-full p-2 opacity-40 hover:opacity-100" aria-label={sound ? "Desativar som" : "Ativar som"}>
            {sound ? <Volume2 className="size-[2.4vh]" /> : <VolumeX className="size-[2.4vh]" />}
          </button>
          <button onClick={() => void document.documentElement.requestFullscreen().catch(() => undefined)} className="rounded-full p-2 opacity-40 hover:opacity-100" aria-label="Tela cheia (F)">
            <Maximize className="size-[2.4vh]" />
          </button>
        </div>
      </header>

      <main key={`${screen}-${q?.sessionQuestionId ?? ""}`} className={cn("relative flex min-h-0 flex-1 animate-rise flex-col px-[4vw]", showCorner ? "pb-[14vh]" : "pb-[3vh]")}>
        {screen === "BOAS_VINDAS" && <Welcome state={state} />}
        {screen === "PERGUNTA" && (q ? <QuestionScreen state={state} answered={answered} theme={theme} /> : <Waiting text="Aguardando a próxima pergunta" />)}
        {screen === "RESULTADO" && (q ? <ResultScreen state={state} theme={theme} /> : <Waiting text="Aguardando resultado" />)}
        {screen === "RANKING" && <RankingScreen lb={state.leaderboard} />}
        {screen === "SATISFACAO" && <SatisfactionScreen data={state.satisfaction} theme={theme} />}
        {screen === "PREMIACAO" && <PrizeScreen state={state} />}
        {screen === "ENCERRAMENTO" && <ClosingScreen state={state} />}
        {state.presentation.showSatisfactionToScreen && screen !== "SATISFACAO" && state.satisfaction && (
          <div className="absolute bottom-[3vh] right-[3vw] w-[22vw] rounded-3xl border border-white/10 bg-navy-900/80 p-4 backdrop-blur">
            <p className="text-center text-[1.6vh] font-black uppercase tracking-widest opacity-70">Satisfação</p>
            <SatisfactionPie data={state.satisfaction} height="18vh" theme={theme} />
          </div>
        )}
      </main>

      {showCorner && (
        <div className={cn("absolute bottom-[2.5vh] left-[2vw] flex items-center gap-3 rounded-2xl p-2 pr-4", light ? "bg-white shadow" : "bg-navy-950/80")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/public/sessions/${s.code}/qr.svg`} alt="QR Code de entrada" className="size-[9vh] rounded-lg bg-white p-1" />
          <div>
            <p className="text-[1.4vh] font-bold opacity-70">Entre com o código</p>
            <p className="text-[3.2vh] font-black tracking-[0.25em] text-brand">{s.code}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <ProductMark className="text-[6vh]" />
      <p className="text-[4vh] font-black opacity-80">{text}</p>
    </div>
  );
}

function Welcome({ state }: { state: ScreenStateDTO }) {
  const s = state.session;
  return (
    <div className="grid flex-1 items-center gap-[4vw] lg:grid-cols-[1.2fr_1fr]">
      <div>
        <p className="text-[2.2vh] font-black uppercase tracking-[0.3em] text-brand">{s.organization.name}</p>
        <h1 className="mt-[2vh] text-[clamp(2.5rem,6.5vh,7rem)] font-black leading-[1.05]">{s.event.title}</h1>
        {s.event.speakerName && (
          <p className="mt-[2.5vh] flex items-center gap-3 text-[3vh] font-bold opacity-85">
            <Mic2 className="size-[3.5vh] text-brand" /> {s.event.speakerName}
          </p>
        )}
        {s.event.welcomeMessage && <p className="mt-[3vh] max-w-[45vw] text-[2.6vh] leading-relaxed opacity-75">{s.event.welcomeMessage}</p>}
        <div className="mt-[5vh] inline-flex items-center gap-4 rounded-3xl bg-white/10 px-6 py-4">
          <Users className="size-[5vh] text-brand" />
          <div>
            <p className="text-[6vh] font-black leading-none tabular">{fmtInt(state.counts.registered)}</p>
            <p className="text-[2vh] font-bold opacity-70">participantes inscritos</p>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center rounded-[3vh] bg-white p-[3vh] text-navy-900 shadow-2xl">
        <p className="text-[2.6vh] font-black">Aponte a câmera e participe</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/public/sessions/${s.code}/qr.svg`} alt={`QR Code para ${s.joinUrl}`} className="my-[2vh] aspect-square w-[min(34vw,46vh)]" />
        <p className="text-[2vh] font-bold text-navy-700">ou acesse</p>
        <p className="text-[2.6vh] font-black">{s.joinUrl.replace(/^https?:\/\//, "").replace(/\/entrar\/.*/, "")}</p>
        <p className="mt-1 text-[2vh] font-bold text-navy-700">e digite o código</p>
        <p className="text-[7vh] font-black tracking-[0.3em] text-brand">{s.code}</p>
      </div>
    </div>
  );
}

function QuestionScreen({ state, answered, theme }: { state: ScreenStateDTO; answered: number | null; theme: "dark" | "light" }) {
  const q = state.question!;
  const total = state.counts.registered;
  const n = answered ?? 0;
  const pct = total ? (n / total) * 100 : 0;
  const showChart = !!state.results;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-[3vw]">
        <div className="min-w-0 flex-1">
          <p className="text-[2.2vh] font-black uppercase tracking-[0.25em] text-brand">
            Pergunta {q.position} de {q.total} {q.scored && "· vale pontos"}
          </p>
          <h1 className="mt-[1.5vh] text-[clamp(2rem,5.5vh,6rem)] font-black leading-[1.1]">{q.title}</h1>
          {q.description && <p className="mt-[1vh] text-[2.6vh] opacity-75">{q.description}</p>}
        </div>
        {q.state === "ABERTA" && q.timer.limitMs !== null && <Countdown timer={q.timer} size="xl" />}
      </div>
      <div className={cn("mt-[3vh] grid min-h-0 flex-1 gap-[3vw]", showChart && "lg:grid-cols-2")}>
        {q.options.length > 0 ? (
          <div className={cn("grid content-start gap-[1.6vh]", q.options.length > 4 && !showChart && "grid-cols-2")}>
            {q.options.map((o, i) => (
              <div key={o.id} className={cn("flex items-center gap-[1.5vw] rounded-[2vh] border-2 px-[1.5vw] py-[1.6vh]", theme === "dark" ? "border-white/10 bg-white/[0.06]" : "border-navy-900/10 bg-white")}>
                <span className="grid size-[6vh] shrink-0 place-items-center rounded-[1.4vh] bg-brand text-[3vh] font-black text-white">{String.fromCharCode(65 + i)}</span>
                <span className="text-[3.2vh] font-bold leading-tight">{o.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-[1vw]">
            {Array.from({ length: (q.scaleMax ?? 10) - (q.scaleMin ?? 0) + 1 }, (_, i) => (q.scaleMin ?? 0) + i).map((v) => (
              <span key={v} className="grid size-[9vh] place-items-center rounded-[2vh] bg-white/10 text-[4vh] font-black">
                {v}
              </span>
            ))}
          </div>
        )}
        {showChart && <ChartView data={state.results} type={q.chart.type} config={q.chart} theme={theme} large height="100%" showToolbar={false} className="min-h-[40vh]" />}
      </div>
      <div className="mt-[2.5vh] pl-[16vw]">
        <div className="flex items-end justify-between text-[2.4vh] font-black">
          <span>
            {q.state === "ABERTA" ? "Respostas recebidas" : "Pergunta encerrada"}: <span className="text-brand tabular">{fmtInt(n)}</span>
            <span className="opacity-60"> de {fmtInt(total)}</span>
          </span>
          <span className="tabular opacity-80">{fmtPct(pct)}</span>
        </div>
        <div className={cn("mt-2 h-[1.6vh] overflow-hidden rounded-full", theme === "dark" ? "bg-white/10" : "bg-navy-900/10")}>
          <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

function ResultScreen({ state, theme }: { state: ScreenStateDTO; theme: "dark" | "light" }) {
  const q = state.question!;
  const correct = q.correctOptionIds ? q.options.filter((o) => q.correctOptionIds!.includes(o.id)) : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="text-[2.2vh] font-black uppercase tracking-[0.25em] text-brand">Resultado · pergunta {q.position}</p>
      <h1 className="mt-[1vh] text-[clamp(1.8rem,4.6vh,5rem)] font-black leading-tight">{q.title}</h1>
      <div className="mt-[2vh] min-h-0 flex-1">
        {state.results ? (
          <ChartView data={state.results} type={q.chart.type} config={q.chart} theme={theme} large height="100%" showToolbar={false} className="h-full" />
        ) : (
          <Waiting text="O resultado será exibido em instantes" />
        )}
      </div>
      {correct.length > 0 && (
        <div className="mt-[2vh] flex items-start gap-[1.5vw] rounded-[2vh] bg-positive/15 p-[2vh]">
          <CheckCircle2 className="size-[5vh] shrink-0 text-positive" />
          <div>
            <p className="text-[3vh] font-black text-positive">Resposta correta: {correct.map((c) => c.label).join(", ")}</p>
            {q.explanation && (
              <p className="mt-1 flex items-start gap-2 text-[2.3vh] opacity-85">
                <Lightbulb className="mt-1 size-[2.6vh] shrink-0 text-gold" /> {q.explanation}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RankingScreen({ lb }: { lb: LeaderboardDTO | null }) {
  if (!lb) return <Waiting text="Ranking" />;
  if (lb.hidden) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <EyeOff className="size-[10vh] text-brand" />
        <p className="text-[5vh] font-black">O ranking está em segredo…</p>
        <p className="text-[2.6vh] opacity-70">Os pontos continuam valendo. Revelação em breve!</p>
      </div>
    );
  }
  const top3 = lb.entries.slice(0, 3);
  const rest = lb.entries.slice(3, 10);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between">
        <h1 className="text-[5vh] font-black">Ranking</h1>
        {lb.frozen && (
          <span className="inline-flex items-center gap-2 rounded-full bg-[#1d3a7a] px-4 py-2 text-[2vh] font-black text-[#a9c4ff]">
            <Snowflake className="size-[2.4vh]" /> congelado
          </span>
        )}
      </div>
      <div className="mt-[2vh] grid min-h-0 flex-1 gap-[2vw] lg:grid-cols-[1fr_1.2fr]">
        <div className="grid content-center gap-[2vh]">
          {top3.map((e) => {
            const p = PLACE[e.position - 1];
            return (
              <div key={e.sessionParticipantId} className={cn("flex items-center gap-[1.5vw] rounded-[2.5vh] border-2 bg-white/[0.07] p-[2vh] transition-all duration-700", e.position === 1 ? "border-gold" : e.position === 2 ? "border-silver" : "border-bronze")}>
                <span className={cn("grid size-[9vh] shrink-0 place-items-center rounded-[2vh] text-[5vh] font-black text-navy-950", p.bg)}>{e.position}</span>
                <span className="min-w-0 flex-1 truncate text-[4vh] font-black">{e.displayName}</span>
                <span className={cn("text-[4.4vh] font-black tabular", p.color)}>{fmtInt(e.score)}</span>
              </div>
            );
          })}
          {top3.length === 0 && <p className="text-[3vh] opacity-60">Ainda sem pontuação.</p>}
        </div>
        <ol className="grid content-center gap-[1.2vh]">
          {rest.map((e) => (
            <li key={e.sessionParticipantId} className="flex items-center gap-[1.2vw] rounded-[1.6vh] bg-white/[0.04] px-[1.2vw] py-[1.2vh] transition-all duration-700">
              <span className="w-[5vh] text-[3vh] font-black opacity-60 tabular">{e.position}º</span>
              <span className="min-w-0 flex-1 truncate text-[3vh] font-bold">{e.displayName}</span>
              {e.movement !== null && e.movement > 0 && <span className="text-[2.2vh] font-black text-positive">▲{e.movement}</span>}
              {e.movement !== null && e.movement < 0 && <span className="text-[2.2vh] font-black text-negative">▼{-e.movement}</span>}
              <span className="text-[3vh] font-black tabular">{fmtInt(e.score)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function SatisfactionScreen({ data, theme }: { data: SatisfactionDTO | null; theme: "dark" | "light" }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="flex items-center gap-3 text-[5vh] font-black">
        <ThumbsUp className="size-[5vh] text-positive" /> Termômetro do treinamento
      </h1>
      <div className="mt-[2vh] grid min-h-0 flex-1 items-center gap-[3vw] lg:grid-cols-2">
        <SatisfactionPie data={data} theme={theme} large height="55vh" />
        <div className="space-y-[3vh]">
          <SatisfactionStats data={data} large dark={theme === "dark"} />
          <SatisfactionTimeline data={data} theme={theme} height={240} />
          <p className="text-[2vh] opacity-60">Percentuais calculados apenas sobre as avaliações registradas.</p>
        </div>
      </div>
    </div>
  );
}

function PrizeScreen({ state }: { state: ScreenStateDTO }) {
  if (state.podium?.revealed && state.podium.winners.length > 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        <h1 className="mb-[3vh] text-center text-[5vh] font-black">
          <Sparkles className="mr-3 inline size-[5vh] text-gold" />
          {state.podium.final ? "Vencedores" : "Pódio parcial"}
        </h1>
        <Podium podium={state.podium} large />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center">
      <h1 className="mb-[3vh] text-center text-[5vh] font-black">Prêmios de hoje</h1>
      <div className="mx-auto grid w-full max-w-[80vw] gap-[2vh] lg:grid-cols-3">
        {state.prizes.map((p) => (
          <PrizeCard key={p.id} rank={p.rank} name={p.name} description={p.description} imageUrl={p.imageUrl} large />
        ))}
      </div>
      {state.prizes.length === 0 && <p className="text-center text-[3vh] opacity-60">Nenhum prêmio cadastrado.</p>}
    </div>
  );
}

function ClosingScreen({ state }: { state: ScreenStateDTO }) {
  const c = state.closing;
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <GestaltLogo kind="logo" className="h-[12vh]" />
      <h1 className="mt-[4vh] text-[7vh] font-black">Obrigado!</h1>
      <p className="mt-[2vh] max-w-[60vw] text-[3vh] opacity-80">{state.session.event.closingMessage ?? "Obrigado pela participação neste treinamento."}</p>
      {c && (
        <div className="mt-[5vh] grid grid-cols-2 gap-[2vw] md:grid-cols-4">
          {[
            ["Participantes", fmtInt(c.participants)],
            ["Interagiram", fmtInt(c.interacted)],
            ["Perguntas", fmtInt(c.questionsDone)],
            ["Valeu a pena", c.satisfactionPct === null ? "—" : fmtPct(c.satisfactionPct)],
          ].map(([l, v]) => (
            <div key={l} className="rounded-[2.5vh] bg-white/[0.07] px-[2.5vw] py-[2.5vh]">
              <p className="text-[6vh] font-black tabular text-brand">{v}</p>
              <p className="text-[2vh] font-bold opacity-70">{l}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
