"use client";
/** Celular: resposta em texto para a Nuvem de Palavras (campo, contador, envios restantes e confirmação). */
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock3, Cloud, Lock, Send, Users } from "lucide-react";
import type { PublicQuestionDTO } from "@shared/types";
import { DEFAULT_WORD_CLOUD_RULES, prepareEntry } from "@shared/wordcloud";
import { useParticipant } from "./participant-context";
import { Countdown, useRemaining } from "@/components/live/timer";
import { Button } from "@/components/ui/button";
import { cn, fmtInt } from "@/lib/utils";

export function WordCloudCard({ q }: { q: PublicQuestionDTO }) {
  const { submitWord, submitting, answeredCount, state } = useParticipant();
  const [text, setText] = useState("");
  const [sentNote, setSentNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const remainingTime = useRemaining(q.timer);
  const rules = useMemo(() => ({ ...DEFAULT_WORD_CLOUD_RULES, ...(q.wordCloud ?? {}), profanityFilter: false, blockedWords: [], synonyms: [] }), [q.wordCloud]);
  const mine = state?.myWordCloud ?? { entries: [], remaining: rules.maxEntries };
  const open = q.state === "ABERTA" && state?.session.status === "AO_VIVO" && (remainingTime === null || remainingTime > 0);
  const canSend = open && mine.remaining > 0;

  useEffect(() => {
    setText("");
    setSentNote(null);
  }, [q.sessionQuestionId]);

  // validação local (o servidor valida de novo e aplica o filtro de termos)
  const check = text.trim() ? prepareEntry(text, rules) : null;
  const localError = check && !check.ok ? check.message : null;
  const repeated = !rules.allowRepeat && check?.ok && mine.entries.some((e) => e.text.trim().toLocaleLowerCase("pt-BR") === check.original.toLocaleLowerCase("pt-BR"));

  const send = async () => {
    if (!check?.ok || repeated) return;
    const ok = await submitWord(q, text);
    if (ok) {
      setText("");
      setSentNote(rules.requireApproval ? "Resposta enviada! Ela aparece no telão depois da aprovação do palestrante." : "Resposta enviada! Acompanhe a nuvem no telão.");
      input.current?.blur();
    }
  };

  const hint = rules.mode === "FRASE" ? `Frase curta, até ${rules.maxWords} palavras` : rules.maxWords === 1 ? "Uma palavra" : `Até ${rules.maxWords} palavras`;

  return (
    <div className="animate-rise space-y-4">
      <div className="rounded-2xl border border-white/10 bg-navy-900/80 p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span className="rounded-full bg-white/10 px-2.5 py-1">
              Pergunta {q.position} de {q.total}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-brand/15 px-2.5 py-1 text-brand">
              <Cloud className="size-3.5" /> Nuvem de palavras
            </span>
          </div>
          {q.state === "ABERTA" && q.timer.limitMs !== null ? <Countdown timer={q.timer} /> : null}
        </div>
        <h2 className="text-xl font-black leading-snug">{q.title}</h2>
        {q.description && <p className="mt-1.5 text-white/75">{q.description}</p>}
        {q.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={q.imageUrl} alt="" className="mt-3 max-h-56 w-full rounded-xl object-cover" />
        )}

        {canSend && (
          <form
            className="mt-4 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label htmlFor="wc-text" className="text-sm font-bold text-white/80">
              Sua resposta <span className="font-normal text-white/50">· {hint}</span>
            </label>
            <input
              ref={input}
              id="wc-text"
              value={text}
              onChange={(e) => {
                setText(e.target.value.slice(0, rules.maxChars + 20));
                setSentNote(null);
              }}
              maxLength={rules.maxChars + 20}
              autoComplete="off"
              autoCapitalize="sentences"
              enterKeyHint="send"
              placeholder="Digite aqui…"
              aria-describedby="wc-help"
              aria-invalid={!!localError || !!repeated}
              className={cn(
                "h-14 w-full rounded-xl border-2 bg-white/5 px-4 text-lg font-bold text-white outline-none transition placeholder:text-white/30 focus:border-brand",
                localError || repeated ? "border-negative" : "border-white/15",
              )}
            />
            <div id="wc-help" className="flex items-center justify-between gap-3 text-xs font-bold">
              <span className={cn(localError || repeated ? "text-[#ff9db0]" : "text-white/50")} role={localError || repeated ? "alert" : undefined}>
                {localError ?? (repeated ? "Você já enviou essa resposta." : mine.remaining === 1 ? "Você pode enviar 1 resposta." : `Você pode enviar mais ${mine.remaining} respostas.`)}
              </span>
              <span className={cn("tabular", text.trim().length > rules.maxChars ? "text-[#ff9db0]" : "text-white/50")}>
                {text.trim().length}/{rules.maxChars}
              </span>
            </div>
            <Button type="submit" size="xl" className="w-full" disabled={!check?.ok || !!repeated} loading={submitting}>
              <Send /> Enviar resposta
            </Button>
          </form>
        )}

        {sentNote && (
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-positive/15 p-3 text-sm font-bold text-[#8ff0b3]" role="status">
            <CheckCircle2 className="size-5 shrink-0" /> {sentNote}
          </div>
        )}

        {mine.entries.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-black uppercase tracking-wider text-white/50">Suas respostas</p>
            <ul className="flex flex-wrap gap-2">
              {mine.entries.map((e) => (
                <li key={e.id} className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold", e.status === "PENDENTE" ? "bg-warning/15 text-warning" : "bg-brand/15 text-white")}>
                  {e.status === "PENDENTE" ? <Clock3 className="size-3.5" aria-label="Aguardando aprovação" /> : <CheckCircle2 className="size-3.5 text-brand" aria-hidden />}
                  {e.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        {open && mine.remaining === 0 && (
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-white/5 p-3 text-sm font-bold text-white/75" role="status">
            <CheckCircle2 className="size-5 shrink-0 text-positive" />
            {rules.maxEntries === 1 ? "Você já enviou sua resposta. Acompanhe a nuvem no telão!" : `Você usou os ${rules.maxEntries} envios. Acompanhe a nuvem no telão!`}
          </div>
        )}
        {!open && (
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-white/5 p-3 text-sm font-bold text-white/70" role="status">
            {state?.session.status === "PAUSADA" ? <Clock3 className="size-5" /> : <Lock className="size-5" />}
            {state?.session.status === "PAUSADA" ? "Sessão pausada pelo palestrante." : q.state === "ABERTA" ? "O tempo para responder terminou." : "Envios encerrados."}
          </div>
        )}
        {answeredCount !== null && q.state === "ABERTA" && (
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs font-bold text-white/50">
            <Users className="size-3.5" /> {fmtInt(answeredCount)} {answeredCount === 1 ? "pessoa respondeu" : "pessoas responderam"}
          </p>
        )}
      </div>
    </div>
  );
}
