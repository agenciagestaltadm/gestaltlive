"use client";
/**
 * Renderização do telão, compartilhada pelo telão real, pelas prévias do modo apresentador e
 * pelo modo ensaio. Usa unidades de contêiner (cqw/cqh): o mesmo layout funciona em tela cheia
 * (projetor/TV) e numa miniatura dentro do painel.
 */
import { useEffect } from "react";
import { Users, CheckCircle2, Lightbulb, Snowflake, EyeOff, Sparkles, ThumbsUp, Mic2, Coffee } from "lucide-react";
import type { LeaderboardDTO, SatisfactionDTO, ScreenStateDTO } from "@shared/types";
import type { ScreenSlideDTO } from "@shared/presentations";
import type { ChartType } from "@shared/charts/catalog";
import { ChartView } from "@/components/charts/chart-view";
import { SatisfactionPie, SatisfactionStats, SatisfactionTimeline } from "@/components/charts/satisfaction-charts";
import { Podium, PrizeCard, PLACE } from "@/components/live/leaderboard";
import { Countdown } from "@/components/live/timer";
import { EventLogo, GestaltLogo, ProductMark } from "@/components/brand";
import { cn, fmtInt, fmtPct } from "@/lib/utils";

export interface ScreenViewProps {
  state: ScreenStateDTO;
  answered: number | null;
  theme?: "dark" | "light";
  /** Miniatura (painel do apresentador/ensaio): sem animações pesadas e sem controles. */
  preview?: boolean;
  /** Controles exibidos no topo (somente no telão real). */
  headerExtras?: React.ReactNode;
  /** URL do QR Code (padrão: QR da sessão; o ensaio usa um QR local demonstrativo). */
  qrUrl?: string;
  /** Faixa sobreposta (ex.: "MODO ENSAIO"). */
  banner?: React.ReactNode;
  className?: string;
}

const FULL_BLEED = new Set(["SLIDE", "TELA_PERSONALIZADA"]);

/** Pré-carrega imagens (próximos slides) sem bloquear a renderização. */
export function usePreload(urls: string[] | undefined) {
  const key = (urls ?? []).join("|");
  useEffect(() => {
    if (!key) return;
    const imgs = key.split("|").map((u) => {
      const img = new Image();
      img.decoding = "async";
      img.src = u;
      return img;
    });
    return () => {
      imgs.length = 0;
    };
  }, [key]);
}

export function ScreenView({ state, answered, theme = "dark", preview, headerExtras, banner, className, qrUrl }: ScreenViewProps) {
  const light = theme === "light";
  const s = state.session;
  const screen = state.presentation.screen;
  const q = state.question;
  const presenter = state.presenter;
  const override = presenter?.override ?? "NENHUM";
  const fullBleed = FULL_BLEED.has(screen) && !!presenter?.slide;
  const showCorner = (fullBleed ? !!presenter?.showJoinBadge : screen !== "BOAS_VINDAS") && s.status !== "ENCERRADA" && override === "NENHUM";
  usePreload(preview ? undefined : presenter?.preload);
  const chartType = presenter?.chartType ?? null;
  const qr = qrUrl ?? `/api/public/sessions/${s.code}/qr.svg`;

  return (
    <div
      className={cn(
        "relative flex w-full flex-col overflow-hidden [container-type:size]",
        light ? "bg-[#F4F6FB] text-navy-900" : "dark bg-brand-hero text-white",
        className,
      )}
    >
      {!fullBleed && (
        <header className="flex shrink-0 items-center justify-between gap-[2cqw] px-[3cqw] py-[2cqh]">
          <div className="flex items-center gap-[1cqw]">
            <EventLogo src={s.event.logoUrl} className="h-[5cqh]" />
            <span className="text-[1.6cqh] font-bold opacity-70">{s.event.title}</span>
          </div>
          <div className="flex items-center gap-[1cqw] text-[1.8cqh] font-bold">
            <span className="inline-flex items-center gap-[0.5cqw] opacity-80">
              <Users className="size-[2.4cqh]" /> {fmtInt(state.counts.registered)} inscritos
            </span>
            {headerExtras}
          </div>
        </header>
      )}

      {fullBleed && presenter?.slide ? (
        <SlideScreen key={presenter.slide.itemId} slide={presenter.slide} preview={preview} />
      ) : (
        <main
          key={`${screen}-${q?.sessionQuestionId ?? ""}`}
          className={cn("relative flex min-h-0 flex-1 flex-col px-[4cqw]", !preview && "animate-rise", showCorner ? "pb-[14cqh]" : "pb-[3cqh]")}
        >
          {screen === "BOAS_VINDAS" && <Welcome state={state} qrUrl={qr} />}
          {screen === "PERGUNTA" && (q ? <QuestionScreen state={state} answered={answered} theme={theme} /> : <Waiting text="Aguardando a próxima pergunta" />)}
          {screen === "RESULTADO" && (q ? <ResultScreen state={state} theme={theme} chartType={chartType} /> : <Waiting text="Aguardando resultado" />)}
          {screen === "RANKING" && <RankingScreen lb={state.leaderboard} />}
          {screen === "SATISFACAO" && <SatisfactionScreen data={state.satisfaction} theme={theme} />}
          {screen === "PREMIACAO" && <PrizeScreen state={state} />}
          {screen === "ENCERRAMENTO" && <ClosingScreen state={state} />}
          {FULL_BLEED.has(screen) && !presenter?.slide && <Waiting text="Acompanhe a apresentação" />}
          {state.presentation.showSatisfactionToScreen && screen !== "SATISFACAO" && state.satisfaction && (
            <div className="absolute bottom-[3cqh] right-[3cqw] w-[22cqw] rounded-[2cqh] border border-white/10 bg-navy-900/80 p-[1cqh] backdrop-blur">
              <p className="text-center text-[1.6cqh] font-black uppercase tracking-widest opacity-70">Satisfação</p>
              <SatisfactionPie data={state.satisfaction} height="18cqh" theme={theme} />
            </div>
          )}
        </main>
      )}

      {showCorner && (
        <div className={cn("absolute bottom-[2.5cqh] left-[2cqw] flex items-center gap-[0.8cqw] rounded-[1.5cqh] p-[0.8cqh] pr-[1.2cqw]", light ? "bg-white shadow" : "bg-navy-950/80")}>
          <img src={qr} alt="QR Code de entrada" className="size-[9cqh] rounded-[0.8cqh] bg-white p-[0.4cqh]" />
          <div>
            <p className="text-[1.4cqh] font-bold opacity-70">Entre com o código</p>
            <p className="text-[3.2cqh] font-black tracking-[0.25em] text-brand">{s.code}</p>
          </div>
        </div>
      )}

      {override === "TELA_PRETA" && <div className="absolute inset-0 z-20 bg-black" aria-label="Tela preta" />}
      {override === "PAUSA" && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-[3cqh] bg-navy-950 text-center text-white">
          <Coffee className="size-[12cqh] text-brand" />
          <p className="text-[7cqh] font-black">Pausa</p>
          <p className="text-[3cqh] opacity-70">Voltamos em instantes</p>
          <ProductMark className="mt-[3cqh] text-[3cqh]" />
        </div>
      )}
      {banner}
    </div>
  );
}

/** Slide de imagem ou tela personalizada, com transição configurável. */
export function SlideScreen({ slide, preview }: { slide: ScreenSlideDTO; preview?: boolean }) {
  const anim = preview || slide.transition === "NENHUMA" ? "" : `slide-in-${slide.transition.toLowerCase()}`;
  const fit = slide.fit === "COVER" ? "object-cover" : slide.fit === "FILL" ? "object-fill" : "object-contain";
  if (slide.type === "IMAGE_SLIDE") {
    return (
      <div className={cn("absolute inset-0 flex items-center justify-center", anim)} style={{ background: slide.background }}>
        {slide.imageUrl ? (
          <img src={slide.imageUrl} alt="" className={cn("h-full w-full select-none", fit)} draggable={false} decoding="async" />
        ) : (
          <p className="text-[3cqh] opacity-60">Imagem indisponível</p>
        )}
      </div>
    );
  }
  return (
    <div className={cn("absolute inset-0 flex flex-col items-center justify-center px-[8cqw] text-center", anim)} style={{ background: slide.background, color: slide.textColor ?? "#FFFFFF" }}>
      {slide.imageUrl && <img src={slide.imageUrl} alt="" className={cn("absolute inset-0 h-full w-full opacity-40", fit)} draggable={false} />}
      <div className="relative">
        {slide.heading && <h1 className="text-[8cqh] font-black leading-tight">{slide.heading}</h1>}
        {slide.subheading && <p className="mt-[2cqh] text-[4cqh] font-bold opacity-85">{slide.subheading}</p>}
        {slide.message && <p className="mx-auto mt-[3cqh] max-w-[70cqw] whitespace-pre-line text-[3cqh] leading-relaxed opacity-80">{slide.message}</p>}
      </div>
    </div>
  );
}


export function Waiting({ text }: { text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <ProductMark className="text-[6cqh]" />
      <p className="text-[4cqh] font-black opacity-80">{text}</p>
    </div>
  );
}

export function Welcome({ state, qrUrl }: { state: ScreenStateDTO; qrUrl?: string }) {
  const s = state.session;
  return (
    <div className="grid flex-1 items-center gap-[4cqw] lg:grid-cols-[1.2fr_1fr]">
      <div>
        <p className="text-[2.2cqh] font-black uppercase tracking-[0.3em] text-brand">{s.organization.name}</p>
        <h1 className="mt-[2cqh] text-[6.5cqh] font-black leading-[1.05]">{s.event.title}</h1>
        {s.event.speakerName && (
          <p className="mt-[2.5cqh] flex items-center gap-3 text-[3cqh] font-bold opacity-85">
            <Mic2 className="size-[3.5cqh] text-brand" /> {s.event.speakerName}
          </p>
        )}
        {s.event.welcomeMessage && <p className="mt-[3cqh] max-w-[45cqw] text-[2.6cqh] leading-relaxed opacity-75">{s.event.welcomeMessage}</p>}
        <div className="mt-[5cqh] inline-flex items-center gap-4 rounded-3xl bg-white/10 px-6 py-4">
          <Users className="size-[5cqh] text-brand" />
          <div>
            <p className="text-[6cqh] font-black leading-none tabular">{fmtInt(state.counts.registered)}</p>
            <p className="text-[2cqh] font-bold opacity-70">participantes inscritos</p>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center rounded-[3cqh] bg-white p-[3cqh] text-navy-900 shadow-2xl">
        <p className="text-[2.6cqh] font-black">Aponte a câmera e participe</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrUrl ?? `/api/public/sessions/${s.code}/qr.svg`} alt={`QR Code para ${s.joinUrl}`} className="my-[2cqh] aspect-square w-[min(34cqw,46cqh)]" />
        <p className="text-[2cqh] font-bold text-navy-700">ou acesse</p>
        <p className="text-[2.6cqh] font-black">{s.joinUrl.replace(/^https?:\/\//, "").replace(/\/entrar\/.*/, "")}</p>
        <p className="mt-1 text-[2cqh] font-bold text-navy-700">e digite o código</p>
        <p className="text-[7cqh] font-black tracking-[0.3em] text-brand">{s.code}</p>
      </div>
    </div>
  );
}

export function QuestionScreen({ state, answered, theme }: { state: ScreenStateDTO; answered: number | null; theme: "dark" | "light" }) {
  const q = state.question!;
  const total = state.counts.registered;
  const n = answered ?? 0;
  const pct = total ? (n / total) * 100 : 0;
  const showChart = !!state.results;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-[3cqw]">
        <div className="min-w-0 flex-1">
          <p className="text-[2.2cqh] font-black uppercase tracking-[0.25em] text-brand">
            Pergunta {q.position} de {q.total} {q.scored && "· vale pontos"}
          </p>
          <h1 className="mt-[1.5cqh] text-[5.5cqh] font-black leading-[1.1]">{q.title}</h1>
          {q.description && <p className="mt-[1cqh] text-[2.6cqh] opacity-75">{q.description}</p>}
        </div>
        {q.state === "ABERTA" && q.timer.limitMs !== null && <Countdown timer={q.timer} size="xl" />}
      </div>
      <div className={cn("mt-[3cqh] grid min-h-0 flex-1 gap-[3cqw]", showChart && "lg:grid-cols-2")}>
        {q.options.length > 0 ? (
          <div className={cn("grid content-start gap-[1.6cqh]", q.options.length > 4 && !showChart && "grid-cols-2")}>
            {q.options.map((o, i) => (
              <div key={o.id} className={cn("flex items-center gap-[1.5cqw] rounded-[2cqh] border-2 px-[1.5cqw] py-[1.6cqh]", theme === "dark" ? "border-white/10 bg-white/[0.06]" : "border-navy-900/10 bg-white")}>
                <span className="grid size-[6cqh] shrink-0 place-items-center rounded-[1.4cqh] bg-brand text-[3cqh] font-black text-white">{String.fromCharCode(65 + i)}</span>
                <span className="text-[3.2cqh] font-bold leading-tight">{o.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-[1cqw]">
            {Array.from({ length: (q.scaleMax ?? 10) - (q.scaleMin ?? 0) + 1 }, (_, i) => (q.scaleMin ?? 0) + i).map((v) => (
              <span key={v} className="grid size-[9cqh] place-items-center rounded-[2cqh] bg-white/10 text-[4cqh] font-black">
                {v}
              </span>
            ))}
          </div>
        )}
        {showChart && <ChartView data={state.results} type={q.chart.type} config={q.chart} theme={theme} large height="100%" showToolbar={false} className="min-h-[40cqh]" />}
      </div>
      <div className="mt-[2.5cqh] pl-[16cqw]">
        <div className="flex items-end justify-between text-[2.4cqh] font-black">
          <span>
            {q.state === "ABERTA" ? "Respostas recebidas" : q.state === "PRONTA" ? "Aguardando liberação" : "Pergunta encerrada"}: <span className="text-brand tabular">{fmtInt(n)}</span>
            <span className="opacity-60"> de {fmtInt(total)}</span>
          </span>
          <span className="tabular opacity-80">{fmtPct(pct)}</span>
        </div>
        <div className={cn("mt-2 h-[1.6cqh] overflow-hidden rounded-full", theme === "dark" ? "bg-white/10" : "bg-navy-900/10")}>
          <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

export function ResultScreen({ state, theme, chartType }: { state: ScreenStateDTO; theme: "dark" | "light"; chartType?: ChartType | null }) {
  const q = state.question!;
  const correct = q.correctOptionIds ? q.options.filter((o) => q.correctOptionIds!.includes(o.id)) : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="text-[2.2cqh] font-black uppercase tracking-[0.25em] text-brand">Resultado · pergunta {q.position}</p>
      <h1 className="mt-[1cqh] text-[4.6cqh] font-black leading-tight">{q.title}</h1>
      <div className="mt-[2cqh] min-h-0 flex-1">
        {state.results ? (
          <ChartView data={state.results} type={chartType ?? q.chart.type} config={q.chart} theme={theme} large height="100%" showToolbar={false} className="h-full" />
        ) : (
          <Waiting text="O resultado será exibido em instantes" />
        )}
      </div>
      {correct.length > 0 && (
        <div className="mt-[2cqh] flex items-start gap-[1.5cqw] rounded-[2cqh] bg-positive/15 p-[2cqh]">
          <CheckCircle2 className="size-[5cqh] shrink-0 text-positive" />
          <div>
            <p className="text-[3cqh] font-black text-positive">Resposta correta: {correct.map((c) => c.label).join(", ")}</p>
            {q.explanation && (
              <p className="mt-1 flex items-start gap-2 text-[2.3cqh] opacity-85">
                <Lightbulb className="mt-1 size-[2.6cqh] shrink-0 text-gold" /> {q.explanation}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function RankingScreen({ lb }: { lb: LeaderboardDTO | null }) {
  if (!lb) return <Waiting text="Ranking" />;
  if (lb.hidden) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <EyeOff className="size-[10cqh] text-brand" />
        <p className="text-[5cqh] font-black">O ranking está em segredo…</p>
        <p className="text-[2.6cqh] opacity-70">Os pontos continuam valendo. Revelação em breve!</p>
      </div>
    );
  }
  const top3 = lb.entries.slice(0, 3);
  const rest = lb.entries.slice(3, 10);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between">
        <h1 className="text-[5cqh] font-black">Ranking</h1>
        {lb.frozen && (
          <span className="inline-flex items-center gap-2 rounded-full bg-[#1d3a7a] px-4 py-2 text-[2cqh] font-black text-[#a9c4ff]">
            <Snowflake className="size-[2.4cqh]" /> congelado
          </span>
        )}
      </div>
      <div className="mt-[2cqh] grid min-h-0 flex-1 gap-[2cqw] lg:grid-cols-[1fr_1.2fr]">
        <div className="grid content-center gap-[2cqh]">
          {top3.map((e) => {
            const p = PLACE[e.position - 1];
            return (
              <div key={e.sessionParticipantId} className={cn("flex items-center gap-[1.5cqw] rounded-[2.5cqh] border-2 bg-white/[0.07] p-[2cqh] transition-all duration-700", e.position === 1 ? "border-gold" : e.position === 2 ? "border-silver" : "border-bronze")}>
                <span className={cn("grid size-[9cqh] shrink-0 place-items-center rounded-[2cqh] text-[5cqh] font-black text-navy-950", p.bg)}>{e.position}</span>
                <span className="min-w-0 flex-1 truncate text-[4cqh] font-black">{e.displayName}</span>
                <span className={cn("text-[4.4cqh] font-black tabular", p.color)}>{fmtInt(e.score)}</span>
              </div>
            );
          })}
          {top3.length === 0 && <p className="text-[3cqh] opacity-60">Ainda sem pontuação.</p>}
        </div>
        <ol className="grid content-center gap-[1.2cqh]">
          {rest.map((e) => (
            <li key={e.sessionParticipantId} className="flex items-center gap-[1.2cqw] rounded-[1.6cqh] bg-white/[0.04] px-[1.2cqw] py-[1.2cqh] transition-all duration-700">
              <span className="w-[5cqh] text-[3cqh] font-black opacity-60 tabular">{e.position}º</span>
              <span className="min-w-0 flex-1 truncate text-[3cqh] font-bold">{e.displayName}</span>
              {e.movement !== null && e.movement > 0 && <span className="text-[2.2cqh] font-black text-positive">▲{e.movement}</span>}
              {e.movement !== null && e.movement < 0 && <span className="text-[2.2cqh] font-black text-negative">▼{-e.movement}</span>}
              <span className="text-[3cqh] font-black tabular">{fmtInt(e.score)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function SatisfactionScreen({ data, theme }: { data: SatisfactionDTO | null; theme: "dark" | "light" }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="flex items-center gap-3 text-[5cqh] font-black">
        <ThumbsUp className="size-[5cqh] text-positive" /> Termômetro do treinamento
      </h1>
      <div className="mt-[2cqh] grid min-h-0 flex-1 items-center gap-[3cqw] lg:grid-cols-2">
        <SatisfactionPie data={data} theme={theme} large height="55cqh" />
        <div className="space-y-[3cqh]">
          <SatisfactionStats data={data} large dark={theme === "dark"} />
          <SatisfactionTimeline data={data} theme={theme} height={240} />
          <p className="text-[2cqh] opacity-60">Percentuais calculados apenas sobre as avaliações registradas.</p>
        </div>
      </div>
    </div>
  );
}

export function PrizeScreen({ state }: { state: ScreenStateDTO }) {
  if (state.podium?.revealed && state.podium.winners.length > 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        <h1 className="mb-[3cqh] text-center text-[5cqh] font-black">
          <Sparkles className="mr-3 inline size-[5cqh] text-gold" />
          {state.podium.final ? "Vencedores" : "Pódio parcial"}
        </h1>
        <Podium podium={state.podium} large />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center">
      <h1 className="mb-[3cqh] text-center text-[5cqh] font-black">Prêmios de hoje</h1>
      <div className="mx-auto grid w-full max-w-[80cqw] gap-[2cqh] lg:grid-cols-3">
        {state.prizes.map((p) => (
          <PrizeCard key={p.id} rank={p.rank} name={p.name} description={p.description} imageUrl={p.imageUrl} large />
        ))}
      </div>
      {state.prizes.length === 0 && <p className="text-center text-[3cqh] opacity-60">Nenhum prêmio cadastrado.</p>}
    </div>
  );
}

export function ClosingScreen({ state }: { state: ScreenStateDTO }) {
  const c = state.closing;
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <GestaltLogo kind="logo" className="h-[12cqh]" />
      <h1 className="mt-[4cqh] text-[7cqh] font-black">Obrigado!</h1>
      <p className="mt-[2cqh] max-w-[60cqw] text-[3cqh] opacity-80">{state.session.event.closingMessage ?? "Obrigado pela participação neste treinamento."}</p>
      {c && (
        <div className="mt-[5cqh] grid grid-cols-2 gap-[2cqw] md:grid-cols-4">
          {[
            ["Participantes", fmtInt(c.participants)],
            ["Interagiram", fmtInt(c.interacted)],
            ["Perguntas", fmtInt(c.questionsDone)],
            ["Valeu a pena", c.satisfactionPct === null ? "—" : fmtPct(c.satisfactionPct)],
          ].map(([l, v]) => (
            <div key={l} className="rounded-[2.5cqh] bg-white/[0.07] px-[2.5cqw] py-[2.5cqh]">
              <p className="text-[6cqh] font-black tabular text-brand">{v}</p>
              <p className="text-[2cqh] font-bold opacity-70">{l}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
