"use client";
import { Target, TrendingUp, Award } from "lucide-react";
import { useParticipant } from "@/components/participant/participant-context";
import { LeaderboardList } from "@/components/live/leaderboard";
import { fmtInt, ordinal } from "@/lib/utils";

export default function RankingPage() {
  const { state } = useParticipant();
  if (!state) return null;
  const me = state.me;
  if (!state.session.settings.showLeaderboardToParticipants) {
    return <p className="rounded-2xl bg-white/5 p-6 text-center text-white/70">O ranking não está disponível neste treinamento.</p>;
  }
  const inTop = state.leaderboard?.entries.some((e) => e.sessionParticipantId === me.sessionParticipantId);
  return (
    <div className="space-y-4 animate-rise">
      <div className="rounded-2xl border border-brand/40 bg-gradient-to-br from-brand/25 to-navy-900 p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-white/70">Sua classificação</p>
        {me.disqualified ? (
          <p className="mt-1 text-lg font-black text-negative">Participação em revisão pela organização.</p>
        ) : me.position ? (
          <p className="mt-1 text-2xl font-black">
            Você está na <span className="text-brand">{ordinal(me.position)} posição</span> entre {fmtInt(me.totalRanked)} participantes.
          </p>
        ) : (
          <p className="mt-1 text-lg font-black">{state.leaderboard?.hidden ? "Ranking oculto no momento — surpresa a caminho!" : "Responda às perguntas para pontuar."}</p>
        )}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white/10 p-2">
            <Award className="mx-auto size-4 text-gold" />
            <p className="text-xl font-black tabular">{fmtInt(me.score)}</p>
            <p className="text-[11px] font-bold text-white/60">pontos</p>
          </div>
          <div className="rounded-xl bg-white/10 p-2">
            <Target className="mx-auto size-4 text-positive" />
            <p className="text-xl font-black tabular">
              {fmtInt(me.correctCount)}
              <span className="text-sm text-white/50">/{fmtInt(me.answeredCount)}</span>
            </p>
            <p className="text-[11px] font-bold text-white/60">acertos</p>
          </div>
          <div className="rounded-xl bg-white/10 p-2">
            <TrendingUp className="mx-auto size-4 text-brand" />
            <p className="text-xl font-black tabular">{me.gapToNext !== null ? fmtInt(me.gapToNext) : "—"}</p>
            <p className="text-[11px] font-bold text-white/60">pts p/ subir</p>
          </div>
        </div>
      </div>
      <div>
        <h2 className="mb-2 text-lg font-black">Top 10</h2>
        <LeaderboardList lb={state.leaderboard} meId={me.sessionParticipantId} />
        {!inTop && me.position && !state.leaderboard?.hidden && (
          <p className="mt-3 rounded-xl bg-white/5 p-3 text-center text-sm font-bold">
            {ordinal(me.position)} · {me.displayName} · {fmtInt(me.score)} pts
          </p>
        )}
      </div>
    </div>
  );
}
