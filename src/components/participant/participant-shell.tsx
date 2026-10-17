"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Radio, Trophy, Gift, UserRound, ThumbsUp, ThumbsDown, WifiOff, Loader2, Volume2, VolumeX } from "lucide-react";
import { useParticipant } from "./participant-context";
import { EventLogo } from "@/components/brand";
import { cn, fmtInt, ordinal } from "@/lib/utils";

/** Esconde a barra fixa quando o teclado virtual está aberto (evita cobrir campos). */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const h = () => setOpen(window.innerHeight - vv.height > 150);
    vv.addEventListener("resize", h);
    return () => vv.removeEventListener("resize", h);
  }, []);
  return open;
}

function SatisfactionBar() {
  const { state, vote, voting } = useParticipant();
  const status = state?.session.status;
  const active = status === "AO_VIVO" || status === "PAUSADA" || status === "AGUARDANDO";
  if (!state || !active) return null;
  const current = state.satisfaction;
  return (
    <div className="px-3 pt-2">
      <p className="mb-1.5 text-center text-[11px] font-bold uppercase tracking-wider text-white/60" id="sat-label">
        Como está sendo sua experiência até agora?
      </p>
      <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="sat-label">
        <button
          onClick={() => vote("NEGATIVO")}
          disabled={voting}
          aria-pressed={current === "NEGATIVO"}
          className={cn(
            "flex h-11 items-center justify-center gap-2 rounded-xl border-2 text-sm font-black transition active:scale-[0.97]",
            current === "NEGATIVO" ? "border-negative bg-negative text-white shadow-lg shadow-negative/30" : "border-negative/50 bg-negative/10 text-[#ff8a8a]",
          )}
        >
          <ThumbsDown className="size-4" /> Insatisfeito
        </button>
        <button
          onClick={() => vote("POSITIVO")}
          disabled={voting}
          aria-pressed={current === "POSITIVO"}
          className={cn(
            "flex h-11 items-center justify-center gap-2 rounded-xl border-2 text-sm font-black transition active:scale-[0.97]",
            current === "POSITIVO" ? "border-positive bg-positive text-white shadow-lg shadow-positive/30" : "border-positive/50 bg-positive/10 text-[#7ee2a4]",
          )}
        >
          <ThumbsUp className="size-4" /> Valeu a pena
        </button>
      </div>
    </div>
  );
}

const TABS = [
  { seg: "ao-vivo", label: "Ao vivo", icon: Radio },
  { seg: "ranking", label: "Ranking", icon: Trophy },
  { seg: "premios", label: "Prêmios", icon: Gift },
  { seg: "perfil", label: "Meu perfil", icon: UserRound },
];

export function ParticipantShell({ children }: { children: React.ReactNode }) {
  const { state, status, code, soundOn, setSoundOn } = useParticipant();
  const path = usePathname();
  const keyboard = useKeyboardOpen();
  const showLb = state?.session.settings.showLeaderboardToParticipants ?? true;
  const showPrizes = state?.session.settings.showPrizesToParticipants ?? true;
  const tabs = TABS.filter((t) => (t.seg === "ranking" ? showLb : t.seg === "premios" ? showPrizes : true));

  return (
    <div className="dark bg-brand-hero flex min-h-dvh flex-col text-white">
      <header className="safe-top sticky top-0 z-30 border-b border-white/10 bg-navy-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-2.5">
          <EventLogo src={state?.session.event.logoUrl} className="h-7 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black leading-tight">{state?.session.event.title ?? "Carregando…"}</p>
            <p className="truncate text-xs text-white/60">{state?.me.displayName}</p>
          </div>
          {state && (
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="rounded-lg bg-brand/20 px-2 py-1 text-xs font-black tabular text-brand" aria-label={`${state.me.score} pontos`}>
                {fmtInt(state.me.score)} pts
              </span>
              {showLb && state.me.position && (
                <span className="rounded-lg bg-white/10 px-2 py-1 text-xs font-black tabular" aria-label={`Posição ${state.me.position}`}>
                  {ordinal(state.me.position)}
                </span>
              )}
              {state.session.settings.soundEffects && (
                <button onClick={() => setSoundOn(!soundOn)} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10" aria-label={soundOn ? "Desativar sons" : "Ativar sons"}>
                  {soundOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                </button>
              )}
            </div>
          )}
        </div>
        {status !== "conectado" && state && (
          <div className={cn("flex items-center justify-center gap-2 py-1 text-xs font-bold", status === "negado" ? "bg-negative" : "bg-warning text-navy-950")} role="status">
            {status === "reconectando" || status === "conectando" ? <Loader2 className="size-3.5 animate-spin" /> : <WifiOff className="size-3.5" />}
            {status === "reconectando" ? "Conexão instável — reconectando…" : status === "conectando" ? "Conectando…" : status === "negado" ? "Acesso negado — entre novamente" : "Sem conexão"}
          </div>
        )}
      </header>

      <main className={cn("mx-auto w-full max-w-xl flex-1 px-4 pt-4", keyboard ? "pb-6" : "pb-44")}>
        {!state ? (
          <div className="grid place-items-center py-24">
            <Loader2 className="size-8 animate-spin text-brand" aria-label="Carregando" />
          </div>
        ) : (
          children
        )}
      </main>

      {!keyboard && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-navy-950/95 backdrop-blur">
          <div className="mx-auto max-w-xl">
            <SatisfactionBar />
            <nav className="mt-1.5 grid px-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} aria-label="Navegação do participante">
              {tabs.map((t) => {
                const href = `/s/${code}/${t.seg}`;
                const active = path === href;
                return (
                  <Link key={t.seg} href={href} className={cn("flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-bold transition", active ? "text-brand" : "text-white/60 hover:text-white")} aria-current={active ? "page" : undefined}>
                    <t.icon className="size-5" />
                    {t.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
