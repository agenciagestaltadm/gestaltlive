"use client";
import { Gift } from "lucide-react";
import { useParticipant } from "@/components/participant/participant-context";
import { Podium, PrizeCard } from "@/components/live/leaderboard";

export default function PremiosPage() {
  const { state } = useParticipant();
  if (!state) return null;
  return (
    <div className="space-y-4 animate-rise">
      <div className="text-center">
        <Gift className="mx-auto size-10 text-brand" />
        <h2 className="mt-2 text-2xl font-black">Prêmios de hoje</h2>
        <p className="text-white/70">Os três primeiros colocados do ranking ganham:</p>
      </div>
      {state.podium?.revealed && (
        <div className="rounded-2xl border border-white/10 bg-navy-900/80 p-5">
          <h3 className="mb-4 text-center font-black">Vencedores</h3>
          <Podium podium={state.podium} celebrate={false} />
        </div>
      )}
      {state.prizes.length === 0 ? (
        <p className="rounded-2xl bg-white/5 p-6 text-center text-white/70">Nenhum prêmio cadastrado para este treinamento.</p>
      ) : (
        <div className="space-y-3">
          {state.prizes.map((p) => (
            <PrizeCard key={p.id} rank={p.rank} name={p.name} description={p.description} imageUrl={p.imageUrl} value={p.estimatedValueCents} pickup={p.pickupInfo} eligibility={p.eligibility} />
          ))}
        </div>
      )}
      <p className="text-center text-xs text-white/50">Desempate: mais pontos → mais acertos → menor tempo total nos acertos → inscrição mais antiga.</p>
    </div>
  );
}
