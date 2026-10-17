"use client";
import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, XCircle, Lock, Send, Clock3, PartyPopper, Lightbulb, Users } from "lucide-react";
import type { ParticipantStateDTO, PublicQuestionDTO } from "@shared/types";
import { QUESTION_TYPE_LABELS } from "@shared/schemas";
import { useParticipant } from "./participant-context";
import { Countdown, useRemaining } from "@/components/live/timer";
import { Button } from "@/components/ui/button";
import { ChartView } from "@/components/charts/chart-view";
import { cn, fmtInt } from "@/lib/utils";

type MyAnswer = ParticipantStateDTO["myAnswer"];

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
}

export function QuestionCard({ q, myAnswer }: { q: PublicQuestionDTO; myAnswer: MyAnswer }) {
  const { submitAnswer, submitting, answeredCount, state } = useParticipant();
  const [selected, setSelected] = useState<string[]>([]);
  const [value, setValue] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const remaining = useRemaining(q.timer);
  const numeric = q.type === "ESCALA" || q.type === "NPS";
  const open = q.state === "ABERTA" && state?.session.status === "AO_VIVO" && (remaining === null || remaining > 0);
  const revealed = !!q.correctOptionIds;
  const multi = q.maxSelections > 1;
  const answered = !!myAnswer && !editing;

  useEffect(() => {
    setSelected(myAnswer?.optionIds ?? []);
    setValue(myAnswer?.value ?? null);
    setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.sessionQuestionId]);
  useEffect(() => {
    if (myAnswer && !editing) {
      setSelected(myAnswer.optionIds);
      setValue(myAnswer.value);
    }
  }, [myAnswer, editing]);

  const toggle = (id: string) => {
    if (!open || answered) return;
    if (!multi) return setSelected([id]);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= q.maxSelections ? s : [...s, id]));
  };

  const canSubmit = open && !answered && (numeric ? value !== null : selected.length >= q.minSelections && selected.length <= q.maxSelections);
  const unchanged = !!myAnswer && (numeric ? myAnswer.value === value : sameSet(myAnswer.optionIds, selected));

  const send = async () => {
    const ok = await submitAnswer(q, numeric ? [] : selected, numeric ? value : null);
    if (ok) setEditing(false);
  };

  const scaleValues = useMemo(() => (numeric ? Array.from({ length: (q.scaleMax ?? 10) - (q.scaleMin ?? 0) + 1 }, (_, i) => (q.scaleMin ?? 0) + i) : []), [numeric, q.scaleMin, q.scaleMax]);

  return (
    <div className="animate-rise space-y-4">
      <div className="rounded-2xl border border-white/10 bg-navy-900/80 p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span className="rounded-full bg-white/10 px-2.5 py-1">
              Pergunta {q.position} de {q.total}
            </span>
            <span className="rounded-full bg-brand/15 px-2.5 py-1 text-brand">{q.scored ? "Vale pontos" : QUESTION_TYPE_LABELS[q.type]}</span>
          </div>
          {q.state === "ABERTA" && q.timer.limitMs !== null ? <Countdown timer={q.timer} /> : null}
        </div>
        <h2 className="text-xl font-black leading-snug">{q.title}</h2>
        {q.description && <p className="mt-1.5 text-white/75">{q.description}</p>}
        {q.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={q.imageUrl} alt="" className="mt-3 max-h-56 w-full rounded-xl object-cover" />
        )}
        {!numeric && multi && open && !answered && (
          <p className="mt-2 text-sm font-bold text-white/60">
            Selecione {q.minSelections === q.maxSelections ? q.minSelections : `de ${q.minSelections} a ${q.maxSelections}`} alternativas · {selected.length} selecionada(s)
          </p>
        )}

        {/* alternativas */}
        {!numeric && (
          <div className={cn("mt-4 grid gap-2.5", q.type === "SIM_NAO" && "grid-cols-2")} role={multi ? "group" : "radiogroup"} aria-label="Alternativas">
            {q.options.map((o, i) => {
              const isSel = selected.includes(o.id);
              const isRight = revealed && q.correctOptionIds!.includes(o.id);
              const isWrongPick = revealed && isSel && !isRight;
              return (
                <button
                  key={o.id}
                  onClick={() => toggle(o.id)}
                  disabled={!open || answered}
                  role={multi ? "checkbox" : "radio"}
                  aria-checked={isSel}
                  className={cn(
                    "relative flex min-h-14 items-center gap-3 rounded-xl border-2 px-4 py-3 text-left font-bold transition active:scale-[0.99]",
                    q.type === "SIM_NAO" && "min-h-20 justify-center text-center text-lg",
                    isRight ? "border-positive bg-positive/15" : isWrongPick ? "border-negative bg-negative/15" : isSel ? "border-brand bg-brand/15" : "border-white/10 bg-white/5 hover:border-white/30",
                    (!open || answered) && !isSel && !isRight && "opacity-60",
                  )}
                >
                  {q.type !== "SIM_NAO" && (
                    <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg text-sm font-black", isSel ? "bg-brand text-white" : "bg-white/10 text-white/70", isRight && "bg-positive", isWrongPick && "bg-negative")}>
                      {isRight ? <Check className="size-4" /> : isWrongPick ? <XCircle className="size-4" /> : String.fromCharCode(65 + i)}
                    </span>
                  )}
                  {o.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.imageUrl} alt="" className="size-12 rounded-lg object-cover" />
                  )}
                  <span className="flex-1">{o.label}</span>
                  {isSel && !revealed && <CheckCircle2 className="size-5 shrink-0 text-brand" aria-hidden />}
                </button>
              );
            })}
          </div>
        )}

        {/* escalas */}
        {numeric && (
          <div className="mt-4">
            <div className={cn("grid gap-1.5", scaleValues.length > 6 ? "grid-cols-6 sm:grid-cols-11" : "grid-cols-5")} role="radiogroup" aria-label="Escala">
              {scaleValues.map((v) => {
                const isSel = value === v;
                const npsColor = q.type === "NPS" ? (v <= 6 ? "data-[sel=true]:bg-negative" : v <= 8 ? "data-[sel=true]:bg-warning" : "data-[sel=true]:bg-positive") : "data-[sel=true]:bg-brand";
                return (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={isSel}
                    data-sel={isSel}
                    disabled={!open || answered}
                    onClick={() => setValue(v)}
                    className={cn("aspect-square rounded-xl border-2 border-white/10 bg-white/5 text-lg font-black transition data-[sel=true]:border-transparent data-[sel=true]:text-white", npsColor, (!open || answered) && !isSel && "opacity-50")}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
            {(q.scaleMinLabel || q.scaleMaxLabel) && (
              <div className="mt-2 flex justify-between text-xs font-bold text-white/60">
                <span>{q.scaleMinLabel}</span>
                <span>{q.scaleMaxLabel}</span>
              </div>
            )}
          </div>
        )}

        {/* ações e estados */}
        <div className="mt-5">
          {open && !answered && (
            <Button size="xl" className="w-full" onClick={send} disabled={!canSubmit || (editing && unchanged)} loading={submitting}>
              <Send /> {editing ? "Atualizar resposta" : "Confirmar resposta"}
            </Button>
          )}
          {answered && !revealed && (
            <div className="flex items-center gap-3 rounded-xl bg-positive/15 p-3 text-sm font-bold text-[#8ff0b3]" role="status">
              <CheckCircle2 className="size-5 shrink-0" />
              <span className="flex-1">{q.state === "ABERTA" ? "Resposta enviada! Aguarde o encerramento." : "Resposta registrada. Aguarde o resultado."}</span>
              {open && q.allowEdit && (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="border-white/20 bg-transparent text-white hover:bg-white/10">
                  Alterar
                </Button>
              )}
            </div>
          )}
          {!open && !myAnswer && !revealed && (
            <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3 text-sm font-bold text-white/70" role="status">
              {state?.session.status === "PAUSADA" ? <Clock3 className="size-5" /> : <Lock className="size-5" />}
              {state?.session.status === "PAUSADA" ? "Sessão pausada pelo palestrante." : q.state === "ABERTA" ? "O tempo para responder terminou." : "Pergunta encerrada."}
            </div>
          )}
          {revealed && q.scored && (
            <Feedback correct={myAnswer?.isCorrect ?? null} points={myAnswer?.points ?? null} answered={!!myAnswer} />
          )}
          {answeredCount !== null && q.state === "ABERTA" && (
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs font-bold text-white/50">
              <Users className="size-3.5" /> {fmtInt(answeredCount)} {answeredCount === 1 ? "pessoa respondeu" : "pessoas responderam"}
            </p>
          )}
        </div>

        {revealed && q.explanation && (
          <div className="mt-4 flex gap-3 rounded-xl border border-gold/30 bg-gold/10 p-3 text-sm">
            <Lightbulb className="size-5 shrink-0 text-gold" />
            <p>{q.explanation}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Feedback({ correct, points, answered }: { correct: boolean | null; points: number | null; answered: boolean }) {
  if (!answered) return <div className="rounded-xl bg-white/5 p-3 text-center text-sm font-bold text-white/70">Você não respondeu esta pergunta.</div>;
  if (correct === null) return null;
  return correct ? (
    <div className="flex animate-pop items-center gap-3 rounded-xl bg-positive p-4 text-white shadow-lg shadow-positive/30" role="status">
      <PartyPopper className="size-7 shrink-0" />
      <div>
        <p className="text-lg font-black">Você acertou!</p>
        {points !== null && <p className="text-sm font-bold opacity-90">+{fmtInt(points)} pontos</p>}
      </div>
    </div>
  ) : (
    <div className="flex animate-pop items-center gap-3 rounded-xl bg-negative/90 p-4 text-white" role="status">
      <XCircle className="size-7 shrink-0" />
      <div>
        <p className="text-lg font-black">Não foi desta vez</p>
        <p className="text-sm font-bold opacity-90">{points && points < 0 ? `${points} pontos` : "Continue participando!"}</p>
      </div>
    </div>
  );
}

export function PublicResults({ results, q }: { results: ParticipantStateDTO["results"]; q: PublicQuestionDTO }) {
  if (!results) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-navy-900/80 p-4">
      <p className="mb-2 text-sm font-black">Resultado</p>
      <ChartView data={results} type={q.chart.type} config={q.chart} theme="dark" height={260} showToolbar={false} />
    </div>
  );
}
