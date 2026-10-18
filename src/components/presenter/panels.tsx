"use client";
/** Painéis auxiliares do modo apresentador: indicadores, top 3, notas, cronômetro e escolha da apresentação. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Crown, Eye, EyeOff, Minus, Plus, Presentation, Snowflake, StickyNote, Trophy } from "lucide-react";
import type { ControlStateDTO } from "@shared/types";
import { admin } from "@/lib/api";
import { PLACE } from "@/components/live/leaderboard";
import { Button } from "@/components/ui/button";
import { NativeSelect, Spinner } from "@/components/ui/primitives";
import { cn, fmtInt, fmtPct } from "@/lib/utils";
import { fmtElapsed, type PresentationListRow } from "./types";

/* ------------------------------------------------------------------ indicadores */
export function Indicators({ control, answered, hasQuestion }: { control: ControlStateDTO; answered: number | null; hasQuestion: boolean }) {
  const sat = control.satisfaction.summary;
  const items = [
    { l: "Inscritos", v: fmtInt(control.counts.registered) },
    { l: "Conectados", v: fmtInt(control.counts.connected), accent: "text-positive" },
    { l: "Respostas", v: hasQuestion && answered !== null ? fmtInt(answered) : "—", accent: "text-brand", hint: hasQuestion ? "pergunta atual" : "sem pergunta" },
    { l: "Valeu a pena", v: sat.total ? fmtPct(sat.positivePct) : "—", accent: "text-positive", hint: sat.total ? `${fmtInt(sat.total)} avaliações` : "sem avaliações" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-4">
      {items.map((k) => (
        <div key={k.l} className="bg-navy-900 px-3 py-2">
          <dt className="text-[10px] font-bold uppercase tracking-wider text-white/50">{k.l}</dt>
          <dd className={cn("text-xl font-black tabular", k.accent)}>{k.v}</dd>
          {k.hint && <dd className="truncate text-[10px] text-white/40">{k.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ ranking */
type Act = (key: string, path: string, body?: unknown, success?: string) => Promise<unknown>;

export function TopThree({ control, pending, act }: { control: ControlStateDTO; pending: string | null; act: Act }) {
  const lb = control.leaderboard;
  const pres = control.presentation;
  const top = lb.entries.slice(0, 3);
  return (
    <section className="rounded-2xl border border-white/10 bg-navy-900 p-4" aria-label="Top 3 do ranking">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-white/70">
          <Trophy className="size-3.5 text-gold" /> Top 3 do ranking
        </h2>
        <span className="text-[11px] text-white/40">{fmtInt(lb.totalRanked)} pontuados</span>
      </div>
      {top.length === 0 ? (
        <p className="rounded-xl bg-white/5 px-3 py-3 text-sm text-white/50">Ainda não há participantes pontuados.</p>
      ) : (
        <ol className="space-y-1.5">
          {top.map((e) => {
            const p = PLACE[e.position - 1];
            return (
              <li key={e.sessionParticipantId} className="flex items-center gap-2 rounded-xl bg-white/[0.05] px-2 py-1.5">
                <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg text-sm font-black text-navy-950", p?.bg ?? "bg-white/20")} aria-label={`${e.position}º lugar`}>
                  {e.position === 1 ? <Crown className="size-4" /> : e.position}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{e.displayName}</span>
                <span className={cn("text-sm font-black tabular", p?.color)}>{fmtInt(e.score)}</span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant={pres.screen === "RANKING" ? "default" : "secondary"} onClick={() => act("rank-screen", "/presentation", { screen: "RANKING" }, "Ranking no telão.")} loading={pending === "rank-screen"} disabled={pres.screen === "RANKING"}>
          <Trophy /> Exibir no telão
        </Button>
        <Button size="sm" variant={pres.leaderboardFrozen ? "default" : "secondary"} onClick={() => act("freeze", "/leaderboard", { frozen: !pres.leaderboardFrozen })} loading={pending === "freeze"}>
          <Snowflake /> {pres.leaderboardFrozen ? "Descongelar (atualizar)" : "Congelar"}
        </Button>
        <Button size="sm" variant={pres.leaderboardHidden ? "default" : "secondary"} onClick={() => act("hide", "/leaderboard", { hidden: !pres.leaderboardHidden })} loading={pending === "hide"}>
          {pres.leaderboardHidden ? <Eye /> : <EyeOff />} {pres.leaderboardHidden ? "Mostrar ao público" : "Ocultar do público"}
        </Button>
      </div>
      {(pres.leaderboardFrozen || pres.leaderboardHidden) && (
        <p className="mt-2 text-[11px] text-white/45">O público vê o ranking {pres.leaderboardHidden ? "oculto" : "congelado"}; aqui você vê a classificação oficial atualizada.</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ notas do palestrante */
export function SpeakerNotes({ notes, open, onToggle, className }: { notes: string | null | undefined; open: boolean; onToggle: () => void; className?: string }) {
  const [size, setSize] = useState(16);
  const text = notes?.trim() ?? "";
  return (
    <section className={cn("rounded-2xl border border-white/10 bg-navy-900", className)} aria-label="Notas do palestrante">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="notas-palestrante"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left text-xs font-black uppercase tracking-wider text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <StickyNote className="size-4 shrink-0 text-gold" />
          <span className="truncate">Notas do palestrante</span>
          {!text && <span className="font-bold normal-case tracking-normal text-white/40">· sem notas</span>}
          {open ? <ChevronUp className="ml-auto size-4" /> : <ChevronDown className="ml-auto size-4" />}
        </button>
        {open && text && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" className="text-white/70 hover:bg-white/10" onClick={() => setSize((s) => Math.max(12, s - 2))} aria-label="Diminuir fonte das notas">
              <Minus />
            </Button>
            <Button variant="ghost" size="icon-sm" className="text-white/70 hover:bg-white/10" onClick={() => setSize((s) => Math.min(32, s + 2))} aria-label="Aumentar fonte das notas">
              <Plus />
            </Button>
          </div>
        )}
      </div>
      {open && (
        <div id="notas-palestrante" className="max-h-[40dvh] overflow-y-auto border-t border-white/10 px-4 py-3">
          {text ? (
            <p className="whitespace-pre-wrap leading-relaxed text-white/90" style={{ fontSize: size }}>
              {text}
            </p>
          ) : (
            <p className="text-sm text-white/50">Este item não tem notas. Adicione notas no editor da apresentação — elas aparecem somente aqui, nunca no telão.</p>
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ cronômetro da apresentação */
export function ElapsedClock({ since, offsetMs, label, className }: { since: string | null; offsetMs: number; label: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);
  const ms = since ? now + offsetMs - new Date(since).getTime() : 0;
  return (
    <div className={cn("leading-tight", className)} role="timer" aria-label={`${label}: ${since ? fmtElapsed(ms) : "não iniciado"}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-white/50">{label}</p>
      <p className="text-lg font-black tabular">{since ? fmtElapsed(ms) : "--:--"}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ escolha da apresentação */
export function PresentationPicker({
  orgId,
  eventId,
  currentId,
  saving,
  onSave,
  canEdit,
}: {
  orgId: string;
  eventId: string;
  currentId: string | null;
  saving: boolean;
  onSave: (id: string | null) => void;
  canEdit: boolean;
}) {
  const [list, setList] = useState<PresentationListRow[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // o componente é remontado (key) quando a apresentação vinculada muda
  const [value, setValue] = useState(currentId ?? "");
  useEffect(() => {
    let alive = true;
    admin
      .get<PresentationListRow[]>(`/presentations?orgId=${orgId}`)
      .then((r) => alive && setList(r))
      .catch((e: Error) => alive && setFailed(e.message || "Não foi possível carregar as apresentações."));
    return () => {
      alive = false;
    };
  }, [orgId]);
  const options = useMemo(() => (list ?? []).filter((p) => p.eventId === eventId || p.eventId === null), [list, eventId]);
  const ofEvent = options.filter((p) => p.eventId === eventId);
  const loose = options.filter((p) => p.eventId === null);

  if (failed) return <p className="text-sm text-negative">{failed}</p>;
  if (!list) return <Spinner />;
  if (options.length === 0) {
    return (
      <div className="space-y-3 text-sm text-white/70">
        <p>Nenhuma apresentação disponível para este evento.</p>
        <Button asChild variant="secondary" size="sm">
          <Link href="/admin/apresentacoes">
            <Presentation /> Criar apresentação
          </Link>
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (value) onSave(value);
      }}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor="pres-picker" className="mb-1.5 block text-sm font-bold">
          Apresentação
        </label>
        <NativeSelect id="pres-picker" value={value} onChange={(e) => setValue(e.target.value)} disabled={!canEdit || saving} className="border-white/15 bg-white/5 text-white">
          <option value="">Selecione…</option>
          {ofEvent.length > 0 && (
            <optgroup label="Deste evento">
              {ofEvent.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.itemCount} itens)
                </option>
              ))}
            </optgroup>
          )}
          {loose.length > 0 && (
            <optgroup label="Sem evento">
              {loose.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.itemCount} itens)
                </option>
              ))}
            </optgroup>
          )}
        </NativeSelect>
      </div>
      <Button type="submit" disabled={!canEdit || !value || value === currentId} loading={saving}>
        Salvar
      </Button>
      {!canEdit && <p className="text-xs text-warning">Você não tem permissão para alterar a sessão.</p>}
    </form>
  );
}
