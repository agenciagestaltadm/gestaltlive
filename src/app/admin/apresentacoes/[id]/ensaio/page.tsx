"use client";
/**
 * MODO ENSAIO — 100% no cliente. Apenas LÊ a apresentação (e as perguntas/prêmios do evento
 * vinculado); nenhuma sessão é criada e nenhuma resposta é registrada. O telão é renderizado pelo
 * mesmo `ScreenView` do telão real, com estado fictício (ver rehearsal-state.ts).
 *
 * `?tela=1` abre a janela do "telão de ensaio", sincronizada com o painel via BroadcastChannel.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FlaskConical,
  Lock,
  Maximize,
  Minimize,
  MonitorPlay,
  NotebookPen,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Timer,
  Trophy,
  Unlock,
} from "lucide-react";
import { ITEM_TYPE_LABELS, OPENS_QUESTION, firstVisible, stepIndex, type PresentationDTO } from "@shared/presentations";
import { isScoredType } from "@shared/schemas";
import { admin, ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn, fmtInt } from "@/lib/utils";
import { useAdmin } from "@/components/admin/admin-context";
import type { EventDetail } from "@/components/admin/event-types";
import type { QuestionRow } from "@/components/builder/types";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/primitives";
import { ScreenView } from "@/components/screen/screen-view";
import { useDemoQr } from "@/components/presentations/demo-qr";
import { ItemPreview } from "@/components/presentations/item-preview";
import { ItemThumb } from "@/components/presentations/item-visual";
import { itemDisplayTitle } from "@/components/presentations/types";
import {
  DEMO_REGISTERED,
  buildRehearsalState,
  effectiveAutoClose,
  initialSim,
  questionMap,
  simElapsed,
  type QuestionSim,
  type RehearsalSource,
} from "@/components/presentations/rehearsal-state";

/* ------------------------------------------------------------------ sincronização entre janelas */
interface SyncState {
  index: number;
  sims: Record<string, QuestionSim>;
  answered: Record<string, number>;
  blackout: boolean;
}
type SyncMessage = { type: "state"; state: SyncState } | { type: "hello" } | { type: "nav"; dir: 1 | -1 } | { type: "bye" };
const channelName = (id: string) => `gestalt-live:ensaio:${id}`;

function openChannel(id: string): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(channelName(id)) : null;
  } catch {
    return null;
  }
}

const REHEARSAL_STRIP = "MODO ENSAIO — dados demonstrativos, nada é registrado";

function StageBanner() {
  return (
    <div className="pointer-events-none absolute right-[1.5cqw] top-[1.5cqh] z-30 inline-flex items-center gap-[0.5cqw] rounded-full bg-warning px-[1.2cqw] py-[0.6cqh] text-[1.6cqh] font-black uppercase tracking-wide text-navy-950 shadow">
      <FlaskConical className="size-[2cqh]" aria-hidden /> Ensaio · dados demonstrativos
    </div>
  );
}

/* ------------------------------------------------------------------ página */
export default function RehearsalPage() {
  return (
    <Suspense fallback={<FullScreenMessage>Carregando o ensaio…</FullScreenMessage>}>
      <Rehearsal />
    </Suspense>
  );
}

function FullScreenMessage({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-navy-950 p-6 text-center text-white">
      <Spinner className="size-8" />
      <p className="font-bold">{children}</p>
      {action}
    </div>
  );
}

function Rehearsal() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const screenMode = params.get("tela") === "1";
  const { org } = useAdmin();
  const pres = useApi(() => admin.get<PresentationDTO>(`/presentations/${id}`), [id]);
  const eventId = pres.data?.eventId ?? null;
  const ev = useApi<EventDetail>(eventId ? () => admin.get<EventDetail>(`/events/${eventId}`) : null, [eventId]);
  const qs = useApi<QuestionRow[]>(eventId ? () => admin.get<QuestionRow[]>(`/events/${eventId}/questions`) : null, [eventId]);
  const qMap = useMemo(() => questionMap(qs.data), [qs.data]);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const source = useMemo<RehearsalSource | null>(() => {
    if (!pres.data) return null;
    return {
      presentation: pres.data,
      event: ev.data ?? null,
      questions: qMap,
      org: { name: org.name, logoUrl: org.logoUrl },
      origin,
    };
  }, [pres.data, ev.data, qMap, org.name, org.logoUrl, origin]);

  if (pres.error) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-navy-950 p-6 text-center text-white">
        <p className="text-lg font-black">{pres.error instanceof ApiError && pres.error.status === 404 ? "Apresentação não encontrada." : "Não foi possível carregar a apresentação."}</p>
        <div className="flex gap-2">
          <Button variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10" onClick={() => void pres.reload()}>
            <RotateCcw /> Tentar novamente
          </Button>
          <Button asChild>
            <Link href="/admin/apresentacoes">Voltar</Link>
          </Button>
        </div>
      </div>
    );
  }
  const loadingRefs = !!eventId && ((!ev.data && !ev.error) || (!qs.data && !qs.error));
  if (!source || loadingRefs) return <FullScreenMessage>Preparando o ensaio…</FullScreenMessage>;
  if (screenMode) return <ScreenWindow id={id} source={source} />;
  return <ControlView id={id} source={source} questionsFailed={!!qs.error} />;
}

/* ------------------------------------------------------------------ painel do ensaio */
function ControlView({ id, source, questionsFailed }: { id: string; source: RehearsalSource; questionsFailed: boolean }) {
  const demoQr = useDemoQr();
  const items = source.presentation.items;
  const hidden = useMemo(() => items.map((i) => i.hidden), [items]);
  const [index, setIndex] = useState(() => firstVisible(items.map((i) => i.hidden)) ?? 0);
  const [sims, setSims] = useState<Record<string, QuestionSim>>({});
  const [answered, setAnswered] = useState<Record<string, number>>({});
  const [blackout, setBlackout] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [enteredAt, setEnteredAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const stageRef = useRef<HTMLDivElement>(null);
  const pendingAdvance = useRef<ReturnType<typeof setTimeout> | null>(null);

  const item = items[index] ?? null;
  const q = item?.questionId ? source.questions.get(item.questionId) ?? null : null;
  const sim = item ? sims[item.id] ?? null : null;
  const isOpener = !!item && OPENS_QUESTION.includes(item.type);

  /* ---------------------------------------------------------------- navegação */
  const goTo = useCallback(
    (to: number) => {
      if (to < 0 || to >= items.length) return;
      if (pendingAdvance.current) {
        clearTimeout(pendingAdvance.current);
        pendingAdvance.current = null;
      }
      setSims((prev) => {
        const next = { ...prev };
        const cur = items[index];
        const cs = cur ? prev[cur.id] : undefined;
        // fechar ao sair do item
        if (cur && cs && cs.state === "ABERTA" && cur.settings.closeOnLeave) next[cur.id] = { ...cs, state: "FECHADA", elapsedMs: simElapsed(cs), startedAt: null };
        const target = items[to];
        if (target && !next[target.id]) next[target.id] = initialSim(target);
        return next;
      });
      setIndex(to);
      setEnteredAt(Date.now());
    },
    [index, items],
  );
  const step = useCallback(
    (dir: 1 | -1) => {
      const to = stepIndex(hidden, index, dir);
      if (to !== null) goTo(to);
    },
    [goTo, hidden, index],
  );

  // estado inicial do primeiro item (ex.: liberação automática)
  useEffect(() => {
    const first = items[index];
    if (first) setSims((prev) => (prev[first.id] ? prev : { ...prev, [first.id]: initialSim(first) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------- simulação da pergunta */
  const patchSim = useCallback((itemId: string, fn: (s: QuestionSim) => QuestionSim) => {
    setSims((prev) => {
      const it = items.find((x) => x.id === itemId);
      const base = prev[itemId] ?? (it ? initialSim(it) : null);
      return base ? { ...prev, [itemId]: fn(base) } : prev;
    });
  }, [items]);

  const openQ = () => item && patchSim(item.id, (s) => ({ ...s, state: "ABERTA", startedAt: Date.now() }));
  const pauseQ = () => item && patchSim(item.id, (s) => ({ ...s, elapsedMs: simElapsed(s), startedAt: null }));
  const resumeQ = () => item && patchSim(item.id, (s) => ({ ...s, startedAt: Date.now() }));
  const closeQ = useCallback(
    (itemId: string) => {
      patchSim(itemId, (s) => ({ ...s, state: "FECHADA", elapsedMs: simElapsed(s), startedAt: null }));
      const it = items.find((x) => x.id === itemId);
      if (it?.settings.advanceAfterClose) {
        if (pendingAdvance.current) clearTimeout(pendingAdvance.current);
        pendingAdvance.current = setTimeout(() => {
          pendingAdvance.current = null;
          step(1);
        }, 1500);
      }
    },
    [items, patchSim, step],
  );
  const showResult = () => item && patchSim(item.id, (s) => ({ ...s, state: "RESULTADO_EXIBIDO", elapsedMs: simElapsed(s), startedAt: null }));
  const reveal = (v = true) => item && patchSim(item.id, (s) => ({ ...s, revealed: v }));
  const resetQ = () => {
    if (!item) return;
    setSims((prev) => ({ ...prev, [item.id]: { ...initialSim(item), state: item.type === "CHART" ? "RESULTADO_EXIBIDO" : "PRONTA", startedAt: null } }));
    setAnswered((m) => ({ ...m, [item.id]: 0 }));
  };

  // fechamento automático ao zerar o cronômetro
  useEffect(() => {
    if (!item || !q || !sim || !isOpener || sim.state !== "ABERTA" || sim.startedAt === null || !q.timeLimitSec) return;
    if (!effectiveAutoClose(item, source.event)) return;
    const remaining = q.timeLimitSec * 1000 - simElapsed(sim);
    const t = setTimeout(() => closeQ(item.id), Math.max(0, remaining));
    return () => clearTimeout(t);
  }, [item, q, sim, isOpener, source.event, closeQ]);

  // respostas fictícias chegando enquanto a pergunta está aberta
  useEffect(() => {
    if (!item || !sim || sim.state !== "ABERTA") return;
    const target = Math.round(DEMO_REGISTERED * 0.82);
    const t = setInterval(() => {
      setAnswered((m) => {
        const cur = m[item.id] ?? 0;
        if (cur >= target) return m;
        return { ...m, [item.id]: Math.min(target, cur + 1 + Math.floor(Math.random() * 6)) };
      });
    }, 450);
    return () => clearInterval(t);
  }, [item, sim]);

  // tempo de permanência: avança sozinho
  const duration = item?.settings.durationSec ?? null;
  useEffect(() => {
    if (!duration || !autoAdvance) return;
    const t = setTimeout(() => step(1), Math.max(0, enteredAt + duration * 1000 - Date.now()));
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => {
      clearTimeout(t);
      clearInterval(tick);
    };
  }, [duration, autoAdvance, enteredAt, step]);
  const autoLeft = duration && autoAdvance ? Math.max(0, Math.ceil((enteredAt + duration * 1000 - now) / 1000)) : null;

  /* ---------------------------------------------------------------- tela cheia */
  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => toast.error("O navegador bloqueou a tela cheia."));
  }, []);
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  /* ---------------------------------------------------------------- teclado */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (t?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const onButton = tag === "BUTTON" || tag === "A";
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          step(1);
          break;
        case " ":
          if (onButton) return;
          e.preventDefault();
          step(1);
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          step(-1);
          break;
        case "f":
        case "F":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "b":
        case "B":
          setBlackout((b) => !b);
          break;
        case "Escape":
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
          else setBlackout(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, toggleFullscreen]);

  /* ---------------------------------------------------------------- telão de ensaio (outra janela) */
  const channel = useRef<BroadcastChannel | null>(null);
  const syncState: SyncState = useMemo(() => ({ index, sims, answered: item ? { [item.id]: answered[item.id] ?? 0 } : {}, blackout }), [index, sims, answered, item, blackout]);
  const syncRef = useRef(syncState);
  useEffect(() => {
    syncRef.current = syncState;
    channel.current?.postMessage({ type: "state", state: syncState } satisfies SyncMessage);
  }, [syncState]);
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  useEffect(() => {
    const ch = openChannel(id);
    channel.current = ch;
    if (!ch) return;
    ch.onmessage = (ev: MessageEvent<SyncMessage>) => {
      const m = ev.data;
      if (m?.type === "hello") ch.postMessage({ type: "state", state: syncRef.current } satisfies SyncMessage);
      if (m?.type === "nav") stepRef.current(m.dir);
    };
    return () => {
      try {
        ch.postMessage({ type: "bye" } satisfies SyncMessage);
        ch.close();
      } catch {
        /* ignore */
      }
      channel.current = null;
    };
  }, [id]);
  const openScreenWindow = () => {
    if (!channel.current) {
      toast.error("Este navegador não permite sincronizar janelas. Use a tela cheia (F) neste painel.");
      return;
    }
    const w = window.open(`/admin/apresentacoes/${id}/ensaio?tela=1`, `gestalt-ensaio-${id}`, "popup,width=1280,height=720");
    if (!w) toast.error("O navegador bloqueou a nova janela. Permita pop-ups para este site.");
  };

  /* ---------------------------------------------------------------- estado do telão */
  const state = useMemo(() => {
    const st = buildRehearsalState(source, index, sim);
    if (blackout && st.presenter) st.presenter = { ...st.presenter, override: "TELA_PRETA" };
    return st;
  }, [source, index, sim, blackout]);
  const curAnswered = item ? answered[item.id] ?? 0 : 0;

  const nextIndex = stepIndex(hidden, index, 1);
  const prevIndex = stepIndex(hidden, index, -1);
  const visibleCount = hidden.filter((h) => !h).length;
  const visiblePos = hidden.slice(0, index + 1).filter((h) => !h).length;
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!items.length) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-navy-950 p-6 text-center text-white">
        <p className="text-lg font-black">Esta apresentação ainda não tem itens para ensaiar.</p>
        <Button asChild>
          <Link href={`/admin/apresentacoes/${id}`}>Abrir editor</Link>
        </Button>
      </div>
    );
  }

  const scored = !!q && isScoredType(q.type);
  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-navy-950 text-white">
      <div role="status" className="shrink-0 bg-warning px-3 py-1.5 text-center text-xs font-black uppercase tracking-wide text-navy-950 sm:text-sm">
        <FlaskConical className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />
        {REHEARSAL_STRIP}
      </div>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2 sm:px-4">
        <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/10">
          <Link href={`/admin/apresentacoes/${id}`}>
            <ArrowLeft /> <span className="hidden sm:inline">Sair do ensaio</span>
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black">{source.presentation.title}</p>
          <p className="text-xs text-white/60">
            Item {fmtInt(visiblePos)} de {fmtInt(visibleCount)}
            {item?.hidden && " · item oculto (pulado ao apresentar)"}
          </p>
        </div>
        <Button variant="outline" size="sm" className="border-white/20 bg-transparent text-white hover:bg-white/10" onClick={openScreenWindow}>
          <MonitorPlay /> <span className="hidden md:inline">Abrir telão de ensaio</span>
        </Button>
        <Button variant="outline" size="sm" className="border-white/20 bg-transparent text-white hover:bg-white/10" onClick={() => setBlackout((b) => !b)} aria-pressed={blackout}>
          {blackout ? <Eye /> : <EyeOff />} <span className="hidden md:inline">{blackout ? "Mostrar telão" : "Tela preta"}</span>
        </Button>
        <Button variant="outline" size="sm" className="border-white/20 bg-transparent text-white hover:bg-white/10" onClick={toggleFullscreen} aria-label={fullscreen ? "Sair da tela cheia (F)" : "Tela cheia (F)"}>
          {fullscreen ? <Minimize /> : <Maximize />}
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-h-0 flex-col gap-3">
          <div ref={stageRef} className="flex w-full items-center justify-center [&:fullscreen]:bg-black">
            <div className="w-full max-w-[calc((100dvh-17rem)*16/9)] min-w-0 [:fullscreen_&]:w-[min(100vw,177.78vh)] [:fullscreen_&]:max-w-none">
              <ScreenView qrUrl={demoQr} state={state} answered={curAnswered} banner={<StageBanner />} className="aspect-video rounded-xl [:fullscreen_&]:rounded-none" />
            </div>
          </div>

          {/* controles */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10" onClick={() => step(-1)} disabled={prevIndex === null} aria-label="Item anterior (←)">
              <ChevronLeft /> Anterior
            </Button>
            <span className="min-w-20 text-center text-sm font-black tabular">
              {fmtInt(visiblePos)} / {fmtInt(visibleCount)}
            </span>
            <Button onClick={() => step(1)} disabled={nextIndex === null} aria-label="Próximo item (→)">
              Próximo <ChevronRight />
            </Button>
          </div>

          {item && (isOpener || item.type === "CHART" || item.type === "AWARDS") && (
            <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2.5" role="group" aria-label="Simulação do item">
              <span className="mr-1 text-xs font-bold uppercase tracking-wide text-white/60">Simular</span>
              {isOpener && sim && (
                <>
                  {sim.state === "PRONTA" && (
                    <Button size="sm" variant="positive" onClick={openQ}>
                      <Unlock /> Liberar pergunta
                    </Button>
                  )}
                  {sim.state === "ABERTA" && q?.timeLimitSec ? (
                    sim.startedAt !== null ? (
                      <Button size="sm" variant="secondary" onClick={pauseQ}>
                        <Pause /> Pausar cronômetro
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={resumeQ}>
                        <Play /> Retomar cronômetro
                      </Button>
                    )
                  ) : null}
                  {sim.state === "ABERTA" && (
                    <Button size="sm" variant="negative" onClick={() => closeQ(item.id)}>
                      <Lock /> Encerrar
                    </Button>
                  )}
                  {sim.state === "FECHADA" && (
                    <Button size="sm" variant="secondary" onClick={showResult}>
                      <Square /> Mostrar resultado
                    </Button>
                  )}
                </>
              )}
              {(isOpener || item.type === "CHART") && scored && sim && sim.state !== "PRONTA" && sim.state !== "ABERTA" && (
                <Button size="sm" variant="secondary" onClick={() => reveal(!sim.revealed)}>
                  <Sparkles /> {sim.revealed ? "Ocultar resposta" : "Revelar resposta"}
                </Button>
              )}
              {item.type === "AWARDS" && (
                <Button size="sm" variant="secondary" onClick={() => reveal(!sim?.revealed)}>
                  <Trophy /> {sim?.revealed ? "Ocultar pódio" : "Revelar pódio"}
                </Button>
              )}
              {(isOpener || item.type === "CHART") && (
                <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={resetQ}>
                  <RotateCcw /> Reiniciar
                </Button>
              )}
              {isOpener && sim && (
                <span className="text-xs text-white/60">
                  {sim.state === "PRONTA" ? "Aguardando liberação" : sim.state === "ABERTA" ? `Aberta · ${fmtInt(curAnswered)} respostas fictícias` : sim.state === "FECHADA" ? "Encerrada" : "Resultado exibido"}
                  {item.settings.openMode === "AUTOMATICO" && " · abre automaticamente"}
                </span>
              )}
            </div>
          )}
          {item && isOpener && !q && (
            <p className="text-center text-sm text-warning">{questionsFailed ? "Não foi possível carregar as perguntas do evento." : "A pergunta deste item não foi encontrada no evento vinculado."}</p>
          )}
          {duration ? (
            <label className="mx-auto inline-flex items-center gap-2 text-xs text-white/70">
              <input type="checkbox" checked={autoAdvance} onChange={(e) => setAutoAdvance(e.target.checked)} className="size-4 accent-[var(--brand)]" />
              <Timer className="size-3.5" aria-hidden />
              Avanço automático {autoLeft !== null ? `em ${autoLeft}s` : "desligado"}
            </label>
          ) : null}
          <p className="hidden text-center text-xs text-white/50 sm:block">
            ← / → ou PageUp / PageDown / Espaço navegam · F tela cheia · B tela preta · Esc sai da tela cheia
          </p>
        </div>

        {/* lateral: próximo, notas e roteiro */}
        <aside className="flex min-h-0 flex-col gap-3 lg:overflow-y-auto">
          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <h2 className="mb-2 text-xs font-black uppercase tracking-wide text-white/60">Próximo</h2>
            {nextIndex !== null ? (
              <>
                <ItemPreview source={source} index={nextIndex} variant="tela" className="border-white/10" label="Prévia do próximo item" />
                <p className="mt-1.5 truncate text-sm font-bold">{itemDisplayTitle(items[nextIndex])}</p>
              </>
            ) : (
              <p className="text-sm text-white/60">Fim da apresentação.</p>
            )}
          </section>
          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <h2 className="mb-1 flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-white/60">
              <NotebookPen className="size-3.5" aria-hidden /> Notas do palestrante
            </h2>
            <p className="mb-2 text-[11px] text-white/40">Visíveis apenas para você — nunca aparecem no telão.</p>
            {item?.notes?.trim() ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.notes}</p> : <p className="text-sm text-white/50">Sem notas para este item.</p>}
          </section>
          <section className="flex min-h-[12rem] flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-3 lg:min-h-0 lg:flex-1">
            <h2 className="mb-2 text-xs font-black uppercase tracking-wide text-white/60">Roteiro</h2>
            <ol ref={listRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" aria-label="Itens da apresentação">
              {items.map((it, i) => (
                <li key={it.id} data-idx={i}>
                  <button
                    type="button"
                    onClick={() => goTo(i)}
                    aria-current={i === index ? "step" : undefined}
                    className={cn("flex w-full items-center gap-2 rounded-lg p-1 text-left transition", i === index ? "bg-brand/25 ring-1 ring-brand" : "hover:bg-white/5", it.hidden && "opacity-50")}
                  >
                    <span className="w-6 shrink-0 text-center text-[11px] font-black tabular text-white/60">{i + 1}</span>
                    <ItemThumb item={it} className="w-16 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold">{itemDisplayTitle(it)}</span>
                      <span className="block text-[10px] text-white/50">
                        {ITEM_TYPE_LABELS[it.type]}
                        {it.hidden && " · oculto"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ janela do telão de ensaio */
function ScreenWindow({ id, source }: { id: string; source: RehearsalSource }) {
  const demoQr = useDemoQr();
  const [sync, setSync] = useState<SyncState | null>(null);
  const [ended, setEnded] = useState(false);
  const channel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const ch = openChannel(id);
    channel.current = ch;
    if (!ch) return;
    ch.onmessage = (ev: MessageEvent<SyncMessage>) => {
      const m = ev.data;
      if (m?.type === "state") {
        setSync(m.state);
        setEnded(false);
      }
      if (m?.type === "bye") setEnded(true);
    };
    ch.postMessage({ type: "hello" } satisfies SyncMessage);
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [id]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const nav = (dir: 1 | -1) => channel.current?.postMessage({ type: "nav", dir } satisfies SyncMessage);
      if (["ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        nav(1);
      } else if (["ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        nav(-1);
      } else if (e.key === "f" || e.key === "F") toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen]);

  const item = sync ? source.presentation.items[sync.index] ?? null : null;
  const sim = sync && item ? sync.sims[item.id] ?? null : null;
  const state = useMemo(() => {
    if (!sync) return null;
    const st = buildRehearsalState(source, sync.index, sim);
    if (sync.blackout && st.presenter) st.presenter = { ...st.presenter, override: "TELA_PRETA" };
    return st;
  }, [source, sync, sim]);

  if (typeof BroadcastChannel === "undefined") {
    return <FullScreenMessage>Este navegador não permite sincronizar janelas.</FullScreenMessage>;
  }
  if (!state || ended) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-black p-6 text-center text-white">
        <FlaskConical className="size-10 text-warning" aria-hidden />
        <p className="text-lg font-black">{ended ? "O painel do ensaio foi fechado." : "Aguardando o painel do ensaio…"}</p>
        <p className="text-sm text-white/60">{REHEARSAL_STRIP}</p>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black" onDoubleClick={toggleFullscreen}>
      <div className="w-[min(100vw,177.78dvh)]">
        <ScreenView qrUrl={demoQr} state={state} answered={item ? sync?.answered[item.id] ?? 0 : 0} banner={<StageBanner />} className="aspect-video" />
      </div>
    </div>
  );
}
