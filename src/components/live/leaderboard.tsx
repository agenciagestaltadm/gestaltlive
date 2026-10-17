"use client";
/** Ranking (Top 10) e pódio animado — usados pelo participante, pelo palestrante e pelo telão. */
import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, Crown, Medal, Snowflake, EyeOff, Gift } from "lucide-react";
import type { LeaderboardDTO, PodiumDTO } from "@shared/types";
import { cn, fmtInt, fmtMoney } from "@/lib/utils";
import { useReducedMotion } from "@/components/charts/chart-view";

export const PLACE = [
  { color: "text-gold", bg: "bg-gold", ring: "ring-gold/60", label: "Ouro", hex: "#F5B700" },
  { color: "text-silver", bg: "bg-silver", ring: "ring-silver/60", label: "Prata", hex: "#C3CAD8" },
  { color: "text-bronze", bg: "bg-bronze", ring: "ring-bronze/60", label: "Bronze", hex: "#CD7F32" },
];

export function LeaderboardList({ lb, meId, large, className }: { lb: LeaderboardDTO | null; meId?: string; large?: boolean; className?: string }) {
  if (!lb) return null;
  if (lb.hidden) {
    return (
      <div className={cn("flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-8 text-center", className)}>
        <EyeOff className="size-8 text-white/50" />
        <p className="font-black">Ranking oculto pelo palestrante</p>
        <p className="text-sm text-white/60">Os pontos continuam sendo calculados normalmente.</p>
      </div>
    );
  }
  if (lb.entries.length === 0) {
    return <div className={cn("rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white/60", className)}>Ainda não há participantes pontuados.</div>;
  }
  return (
    <div className={cn("space-y-2", className)}>
      {lb.frozen && (
        <p className="flex items-center justify-center gap-2 rounded-xl bg-[#1d3a7a]/60 py-2 text-sm font-bold text-[#a9c4ff]">
          <Snowflake className="size-4" /> Ranking congelado — aguarde a revelação!
        </p>
      )}
      <ol className="space-y-2" aria-label="Top 10">
        {lb.entries.map((e) => {
          const top = e.position <= 3 ? PLACE[e.position - 1] : null;
          const me = e.sessionParticipantId === meId;
          return (
            <li
              key={e.sessionParticipantId}
              className={cn(
                "flex items-center gap-3 rounded-2xl border px-3 transition-all duration-500",
                large ? "py-3.5" : "py-2.5",
                me ? "border-brand bg-brand/15" : top ? "border-white/10 bg-white/[0.07]" : "border-white/5 bg-white/[0.03]",
              )}
            >
              <span className={cn("grid shrink-0 place-items-center rounded-xl font-black tabular", large ? "size-14 text-2xl" : "size-9 text-base", top ? `${top.bg} text-navy-950` : "bg-white/10")}>
                {e.position === 1 ? <Crown className={large ? "size-7" : "size-5"} /> : e.position}
              </span>
              <span className={cn("min-w-0 flex-1 truncate font-bold", large ? "text-3xl" : "text-[15px]")}>
                {e.displayName}
                {me && <span className="ml-2 rounded-md bg-brand px-1.5 py-0.5 align-middle text-[10px] font-black uppercase text-white">você</span>}
              </span>
              {e.movement !== null && e.movement !== 0 && (
                <span className={cn("inline-flex items-center text-xs font-black", e.movement > 0 ? "text-positive" : "text-negative", large && "text-lg")} aria-label={e.movement > 0 ? `subiu ${e.movement}` : `caiu ${-e.movement}`}>
                  {e.movement > 0 ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}
                  {Math.abs(e.movement)}
                </span>
              )}
              <span className={cn("shrink-0 text-right font-black tabular", large ? "text-3xl" : "text-base", top ? top.color : "")}>
                {fmtInt(e.score)}
                <span className={cn("ml-1 font-bold text-white/50", large ? "text-lg" : "text-xs")}>pts</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function Podium({ podium, large, celebrate = true }: { podium: PodiumDTO | null; large?: boolean; celebrate?: boolean }) {
  const reduced = useReducedMotion();
  const fired = useRef(false);
  useEffect(() => {
    if (!podium?.revealed || !celebrate || reduced || fired.current || podium.winners.length === 0) return;
    fired.current = true;
    void import("canvas-confetti").then(({ default: confetti }) => {
      const end = Date.now() + 2500;
      const colors = ["#FF0068", "#F5B700", "#FFFFFF", "#3B82F6"];
      (function frame() {
        confetti({ particleCount: 4, angle: 60, spread: 70, origin: { x: 0 }, colors, disableForReducedMotion: true });
        confetti({ particleCount: 4, angle: 120, spread: 70, origin: { x: 1 }, colors, disableForReducedMotion: true });
        if (Date.now() < end) requestAnimationFrame(frame);
      })();
    });
  }, [podium?.revealed, podium?.winners.length, celebrate, reduced]);

  if (!podium || !podium.revealed) return null;
  const byRank = (r: number) => podium.winners.find((w) => w.rank === r);
  const order = [2, 1, 3];
  const heights = large ? { 1: "h-72", 2: "h-52", 3: "h-40" } : { 1: "h-36", 2: "h-28", 3: "h-20" };
  return (
    <div className="w-full">
      <div className="flex items-end justify-center gap-2 sm:gap-4">
        {order.map((r, idx) => {
          const w = byRank(r);
          const place = PLACE[r - 1];
          return (
            <div key={r} className="flex w-1/3 max-w-72 flex-col items-center" style={{ animation: reduced ? undefined : `rise 700ms ${idx * 250 + 200}ms both cubic-bezier(.2,.8,.2,1)` }}>
              {w ? (
                <>
                  <Medal className={cn(place.color, large ? "size-14" : "size-8")} />
                  <p className={cn("mt-1 w-full truncate text-center font-black", large ? "text-3xl" : "text-sm")}>{w.displayName}</p>
                  <p className={cn("font-black tabular", place.color, large ? "text-2xl" : "text-sm")}>{fmtInt(w.score)} pts</p>
                </>
              ) : (
                <p className="text-sm text-white/40">—</p>
              )}
              <div
                className={cn("mt-2 flex w-full items-start justify-center rounded-t-2xl pt-3 font-black text-navy-950 shadow-2xl", place.bg, heights[r as 1 | 2 | 3])}
                style={{ animation: reduced ? undefined : `podium-up 900ms ${idx * 250}ms both cubic-bezier(.2,.8,.2,1)` }}
              >
                <span className={large ? "text-6xl" : "text-3xl"}>{r}º</span>
              </div>
            </div>
          );
        })}
      </div>
      {podium.winners.some((w) => w.prize) && (
        <div className={cn("mt-6 grid gap-3", large ? "grid-cols-3" : "grid-cols-1")}>
          {[1, 2, 3].map((r) => {
            const w = byRank(r);
            if (!w?.prize) return null;
            return <PrizeCard key={r} rank={r} name={w.prize.name} description={w.prize.description} imageUrl={w.prize.imageUrl} winner={w.displayName} large={large} />;
          })}
        </div>
      )}
    </div>
  );
}

export function PrizeCard({
  rank,
  name,
  description,
  imageUrl,
  winner,
  value,
  pickup,
  eligibility,
  large,
}: {
  rank: number;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  winner?: string;
  value?: number | null;
  pickup?: string | null;
  eligibility?: string | null;
  large?: boolean;
}) {
  const place = PLACE[rank - 1] ?? PLACE[2];
  return (
    <div className={cn("flex gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-3 ring-1", place.ring, large && "p-5")}>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className={cn("shrink-0 rounded-xl object-cover", large ? "size-24" : "size-16")} />
      ) : (
        <div className={cn("grid shrink-0 place-items-center rounded-xl bg-white/10", large ? "size-24" : "size-16")}>
          <Gift className={cn(place.color, large ? "size-10" : "size-7")} />
        </div>
      )}
      <div className="min-w-0">
        <p className={cn("text-xs font-black uppercase tracking-wider", place.color, large && "text-base")}>
          {rank}º lugar · {place.label}
        </p>
        <p className={cn("font-black", large ? "text-2xl" : "text-base")}>{name}</p>
        {winner && <p className={cn("font-bold text-brand", large ? "text-xl" : "text-sm")}>🏆 {winner}</p>}
        {description && <p className={cn("text-white/70", large ? "text-base" : "text-sm")}>{description}</p>}
        {value ? <p className="text-xs text-white/50">Valor estimado: {fmtMoney(value)}</p> : null}
        {eligibility && <p className="mt-1 text-xs text-white/60">Regras: {eligibility}</p>}
        {pickup && <p className="text-xs text-white/60">Retirada: {pickup}</p>}
      </div>
    </div>
  );
}
