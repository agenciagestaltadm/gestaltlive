"use client";
/**
 * Telão / modo apresentação. Sem controles administrativos: acesso por token de exibição.
 * O palestrante controla a tela a partir do painel (outra janela ou dispositivo).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Maximize, Volume2, VolumeX } from "lucide-react";
import type { LeaderboardDTO, PodiumDTO, PresentationDTO, ResultsDTO, SatisfactionDTO, ScreenStateDTO } from "@shared/types";
import { RT } from "@shared/types";
import { publicFetch } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { ProductMark } from "@/components/brand";
import { ScreenView } from "@/components/screen/screen-view";
import { playSound } from "@/components/participant/sound";
import { cn } from "@/lib/utils";

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
      [RT.presenterChanged]: soon,
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

  return (
    <ScreenView
      state={state}
      answered={answered}
      theme={theme}
      className="h-dvh"
      headerExtras={
        <>
          {status !== "conectado" && <span className="rounded-full bg-warning px-3 py-1 text-navy-950">reconectando…</span>}
          <button onClick={() => setSound(!sound)} className="rounded-full p-2 opacity-40 hover:opacity-100" aria-label={sound ? "Desativar som" : "Ativar som"}>
            {sound ? <Volume2 className="size-[2.4cqh]" /> : <VolumeX className="size-[2.4cqh]" />}
          </button>
          <button onClick={() => void document.documentElement.requestFullscreen().catch(() => undefined)} className="rounded-full p-2 opacity-40 hover:opacity-100" aria-label="Tela cheia (F)">
            <Maximize className="size-[2.4cqh]" />
          </button>
        </>
      }
      banner={
        status !== "conectado" && state.presenter?.slide ? (
          <span className="absolute right-3 top-3 z-30 rounded-full bg-warning px-3 py-1 text-xs font-bold text-navy-950">reconectando…</span>
        ) : null
      }
    />
  );
}
