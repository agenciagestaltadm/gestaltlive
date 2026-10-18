"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Hourglass, PauseCircle, Trophy, Gift, Sparkles } from "lucide-react";
import { useParticipant } from "@/components/participant/participant-context";
import { QuestionCard, PublicResults } from "@/components/participant/question-card";
import { Podium, PrizeCard } from "@/components/live/leaderboard";
import { cn, fmtInt, ordinal } from "@/lib/utils";

function StartCountdown({ startsAt }: { startsAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = new Date(startsAt).getTime() - now;
  if (diff <= 0 || diff > 24 * 3600_000) return null;
  const h = Math.floor(diff / 3600_000);
  const m = Math.floor((diff % 3600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return (
    <div className="mt-4 flex justify-center gap-2 tabular" aria-label="Contagem regressiva para o início">
      {[h, m, s].map((v, i) => (
        <div key={i} className="w-16 rounded-xl bg-white/10 py-2 text-center">
          <div className="text-2xl font-black">{String(v).padStart(2, "0")}</div>
          <div className="text-[10px] font-bold uppercase text-white/50">{["horas", "min", "seg"][i]}</div>
        </div>
      ))}
    </div>
  );
}

export default function AoVivoPage() {
  const { state, code } = useParticipant();
  if (!state) return null;
  const s = state.session;
  const q = state.activeQuestion;
  // telão exibindo slides ou tela personalizada do modo apresentador
  const following = state.presentation.screen === "SLIDE" || state.presentation.screen === "TELA_PERSONALIZADA";

  if (s.status === "ENCERRADA" || s.status === "CANCELADA") {
    return (
      <div className="space-y-5 animate-rise">
        <div className="rounded-2xl border border-white/10 bg-navy-900/80 p-6 text-center">
          <Sparkles className="mx-auto size-10 text-brand" />
          <h2 className="mt-2 text-2xl font-black">{s.status === "CANCELADA" ? "Sessão cancelada" : "Treinamento encerrado!"}</h2>
          <p className="mt-2 text-white/75">{s.event.closingMessage ?? "Obrigado pela participação!"}</p>
          {s.status === "ENCERRADA" && state.me.position && (
            <p className="mt-4 text-lg font-black">
              Você terminou em <span className="text-brand">{ordinal(state.me.position)}</span> entre {fmtInt(state.me.totalRanked)} participantes, com {fmtInt(state.me.score)} pontos.
            </p>
          )}
        </div>
        {state.podium?.revealed && (
          <div className="rounded-2xl border border-white/10 bg-navy-900/80 p-5">
            <h3 className="mb-4 text-center text-lg font-black">Pódio final</h3>
            <Podium podium={state.podium} />
          </div>
        )}
        <Link href={`/s/${code}/perfil`} className="block text-center text-sm font-bold text-brand underline">
          Ver meu histórico de respostas
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {s.status === "PAUSADA" && (
        <div className="flex items-center gap-3 rounded-2xl bg-warning/15 p-3 text-sm font-bold text-warning" role="status">
          <PauseCircle className="size-5" /> Sessão pausada. Voltamos em instantes.
        </div>
      )}

      {state.presentation.screen === "PREMIACAO" && state.podium?.revealed ? (
        <div className="rounded-2xl border border-white/10 bg-navy-900/80 p-5">
          <h3 className="mb-4 text-center text-lg font-black">Premiação</h3>
          <Podium podium={state.podium} />
        </div>
      ) : q ? (
        <>
          <QuestionCard q={q} myAnswer={state.myAnswer} />
          <PublicResults results={state.results} q={q} />
        </>
      ) : (
        <div className="animate-rise rounded-2xl border border-white/10 bg-navy-900/80 p-6 text-center">
          <div className="mx-auto grid size-16 animate-pulse-ring place-items-center rounded-full bg-brand/15">
            <Hourglass className="size-8 text-brand" />
          </div>
          <h2 className="mt-4 text-xl font-black">
            {following ? "Acompanhe a apresentação" : s.status === "AGUARDANDO" ? "Você está dentro! O treinamento vai começar." : "Aguardando a próxima pergunta"}
          </h2>
          <p className="mt-2 text-white/70">
            {following
              ? "O conteúdo está no telão. Quando houver uma pergunta, ela aparece aqui automaticamente."
              : "Fique de olho: as perguntas aparecem aqui automaticamente, sem precisar atualizar a página."}
          </p>
          {s.status === "AGUARDANDO" && s.event.startsAt && <StartCountdown startsAt={s.event.startsAt} />}
          {s.event.welcomeMessage && s.status === "AGUARDANDO" && <p className="mt-4 rounded-xl bg-white/5 p-3 text-sm text-white/80">{s.event.welcomeMessage}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href={`/s/${code}/ranking`} className={cn("rounded-2xl border border-white/10 bg-white/5 p-4", !s.settings.showLeaderboardToParticipants && "pointer-events-none opacity-50")}>
          <Trophy className="size-5 text-gold" />
          <p className="mt-2 text-xs font-bold uppercase text-white/60">Sua posição</p>
          <p className="text-2xl font-black tabular">{state.me.position ? ordinal(state.me.position) : "—"}</p>
          <p className="text-xs text-white/60">{state.me.gapToNext ? `${fmtInt(state.me.gapToNext)} pts para subir` : `${fmtInt(state.me.correctCount)} acertos`}</p>
        </Link>
        {state.prizes.length > 0 ? (
          <Link href={`/s/${code}/premios`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <Gift className="size-5 text-brand" />
            <p className="mt-2 text-xs font-bold uppercase text-white/60">Prêmios de hoje</p>
            <p className="truncate text-base font-black">{state.prizes[0].name}</p>
            <p className="text-xs text-white/60">para o 1º lugar</p>
          </Link>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <Sparkles className="size-5 text-brand" />
            <p className="mt-2 text-xs font-bold uppercase text-white/60">Pontuação</p>
            <p className="text-2xl font-black tabular">{fmtInt(state.me.score)}</p>
          </div>
        )}
      </div>
      {!q && state.prizes.length > 0 && s.status === "AGUARDANDO" && (
        <div className="space-y-2">
          <p className="text-sm font-black">Prêmios para o Top 3</p>
          {state.prizes.map((p) => (
            <PrizeCard key={p.id} rank={p.rank} name={p.name} description={p.description} imageUrl={p.imageUrl} />
          ))}
        </div>
      )}
    </div>
  );
}
