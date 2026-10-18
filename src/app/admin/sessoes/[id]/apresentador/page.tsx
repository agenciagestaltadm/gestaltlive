"use client";
/**
 * Modo apresentador: o palestrante controla, numa única tela, slides, perguntas, resultados,
 * ranking, satisfação e premiação. O servidor é a fonte da verdade (rotas do apresentador e do
 * controle ao vivo); o painel mostra a prévia real do telão e sincroniza em tempo real.
 * As notas do palestrante aparecem somente aqui — nunca no telão ou no celular do participante.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Coffee,
  DoorOpen,
  EllipsisVertical,
  Flag,
  Keyboard,
  LayoutGrid,
  Maximize,
  Minimize,
  Monitor,
  MonitorOff,
  Pause,
  Play,
  Presentation,
  Settings2,
  Square,
  Undo2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { ITEM_TYPE_LABELS, firstVisible, screenForItem } from "@shared/presentations";
import { SCREEN_LABELS, SESSION_STATUS_LABELS } from "@shared/schemas";
import { useAdmin } from "@/components/admin/admin-context";
import { ProductMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Badge, Dialog, Menu, MenuContent, MenuItem, MenuTrigger, Spinner, Tip } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { ItemButton, ItemStrip } from "@/components/presenter/item-visual";
import { ElapsedClock, Indicators, PresentationPicker, SpeakerNotes, TopThree } from "@/components/presenter/panels";
import { QuestionControls } from "@/components/presenter/question-controls";
import { LivePreview, NextPreview } from "@/components/presenter/stage";
import { itemLabel, nextVisibleIndex, questionForItem } from "@/components/presenter/types";
import { usePresenter } from "@/components/presenter/use-presenter";

const DARK_DIALOG = "dark border-white/10 bg-navy-900 text-white";

const SHORTCUTS: [string, string][] = [
  ["→ · PageDown · Espaço", "Próximo item"],
  ["← · PageUp · Backspace", "Item anterior"],
  ["B ou .", "Tela preta (liga/desliga)"],
  ["P", "Tela de pausa (liga/desliga)"],
  ["F", "Tela cheia do painel"],
  ["Esc", "Sair da tela cheia / fechar janela"],
  ["?", "Esta ajuda"],
];

function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}
function isInteractive(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el?.closest?.("button, a, [role='button'], [role='menuitem'], summary");
}
/** Após clique com mouse/toque, devolve o foco à página (o passador de slides não "aperta" o botão focado). */
const releaseFocus = (e: React.PointerEvent<HTMLElement>) => e.currentTarget.blur();

export default function PresenterPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const h = usePresenter(id);
  const { orgId, can } = useAdmin();
  const [notesOpen, setNotesOpen] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  const [gridOpen, setGridOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const { control: c, presenter: p, send } = h;
  const items = useMemo(() => p?.items ?? [], [p]);
  const serverItemId = p?.currentItemId ?? null;
  const viewItemId = h.optimisticId ?? serverItemId;
  const viewIndex = items.findIndex((i) => i.id === viewItemId);
  const viewItem = viewIndex >= 0 ? items[viewIndex] : null;
  const serverItem = items.find((i) => i.id === serverItemId) ?? null;
  const nextIndex = viewIndex >= 0 ? nextVisibleIndex(items, viewIndex, 1) : firstVisible(items.map((i) => i.hidden));
  const prevIndex = viewIndex >= 0 ? nextVisibleIndex(items, viewIndex, -1) : null;
  const nextItem = nextIndex !== null ? items[nextIndex] : null;
  const notStarted = !p || p.status === "PRONTA" || !serverItemId;
  const override = p?.override ?? "NENHUM";

  const toggleOverride = useCallback(
    (o: "TELA_PRETA" | "PAUSA") => {
      if (!p || p.status === "PRONTA") return;
      send({ action: "override", override: p.override === o ? "NENHUM" : o });
    },
    [p, send],
  );
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // teclado e passador de slides (setas, Page Up/Down, Espaço, Backspace)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === "Escape") {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        return; // diálogos fecham sozinhos com Esc
      }
      if (document.querySelector("[role='dialog'], [role='menu']")) return;
      if (e.repeat) return;
      const k = e.key;
      if (k === " " && isInteractive(e.target)) return; // Espaço num botão focado aciona o botão
      let handled = true;
      if (k === "ArrowRight" || k === "PageDown" || k === " ") send({ action: "next" });
      else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") send({ action: "prev" });
      else if (k === "b" || k === "B" || k === ".") toggleOverride("TELA_PRETA");
      else if (k === "p" || k === "P") toggleOverride("PAUSA");
      else if (k === "f" || k === "F") toggleFullscreen();
      else if (k === "?") setHelpOpen(true);
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send, toggleOverride, toggleFullscreen]);

  /* ---------------------------------------------------------------- estados de carregamento */
  if (!c) {
    return (
      <div className="dark grid min-h-dvh place-items-center bg-navy-950 p-6 text-center text-white">
        {h.error ? (
          <div>
            <AlertTriangle className="mx-auto size-10 text-warning" />
            <p className="mt-3 text-lg font-black">{h.error}</p>
            <Button className="mt-4" onClick={h.reload}>
              Tentar novamente
            </Button>
            <Link href="/admin/sessoes" className="mt-3 block text-sm font-bold text-brand">
              Voltar às sessões
            </Link>
          </div>
        ) : (
          <Spinner className="size-8" />
        )}
      </div>
    );
  }

  const s = c.session;
  const live = s.status === "AO_VIVO";
  const ended = s.status === "ENCERRADA" || s.status === "CANCELADA";
  const canEditSession = can("session.create");
  const itemQ = questionForItem(serverItem, p, c);
  const openQ = c.questions.find((q) => q.state === "ABERTA") ?? null;
  const focusQ = openQ ?? itemQ;
  const answeredOf = (sqId: string, fallback: number) => h.results[sqId]?.totals.respondents ?? fallback;
  const focusAnswered = focusQ ? answeredOf(focusQ.sessionQuestionId, focusQ.answeredCount) : null;
  const nextQ = questionForItem(nextItem, p, c);
  const linkedId = h.detail?.presentationId;
  const mismatch = !!p && linkedId !== undefined && linkedId !== null && linkedId !== p.presentationId;
  const expectedScreen = serverItem ? screenForItem(serverItem.type) : null;
  const screenDiverges = !!serverItem && p?.status === "APRESENTANDO" && expectedScreen !== c.presentation.screen;
  const openScreen = () => s.screenUrl && window.open(s.screenUrl, "telao", "noopener=yes,width=1280,height=720");

  const sessionActions = (
    <>
      {(s.status === "RASCUNHO" || s.status === "AGENDADA") && (
        <Button size="sm" variant="secondary" onClick={() => h.act("lobby", "/lobby", {}, "Inscrições abertas.")} loading={h.pending === "lobby"}>
          <DoorOpen /> Abrir inscrições
        </Button>
      )}
      {(s.status === "RASCUNHO" || s.status === "AGENDADA" || s.status === "AGUARDANDO") && (
        <Button size="sm" onClick={() => h.act("start-session", "/start", {}, "Sessão iniciada!")} loading={h.pending === "start-session"}>
          <Play /> Iniciar sessão
        </Button>
      )}
      {s.status === "PAUSADA" && (
        <Button size="sm" onClick={() => h.act("resume", "/resume", {}, "Sessão retomada.")} loading={h.pending === "resume"}>
          <Play /> Retomar sessão
        </Button>
      )}
    </>
  );

  return (
    <div className="dark min-h-dvh bg-navy-950 text-white">
      {/* ------------------------------------------------------------ barra superior */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-navy-950/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4">
          <Link href={`/admin/eventos/${s.eventId}/sessoes`} className="rounded-lg p-2 text-white/70 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" aria-label="Voltar às sessões do evento">
            <ArrowLeft className="size-5" />
          </Link>
          <ProductMark className="hidden text-lg xl:inline-flex" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black">
              <Presentation className="mr-1 inline size-4 text-brand" />
              {p?.presentationTitle ?? "Modo apresentador"}
            </p>
            <p className="truncate text-xs text-white/60">
              {s.name} · código <span className="font-black tracking-widest text-brand">{s.code}</span>
            </p>
          </div>
          <Badge tone={live ? "brand" : s.status === "PAUSADA" ? "warning" : ended ? "muted" : "outline"} className={cn(!live && !ended && s.status !== "PAUSADA" && "border-white/20 text-white/70")}>
            {live && <span className="size-2 animate-pulse rounded-full bg-brand" aria-hidden />}
            {SESSION_STATUS_LABELS[s.status]}
          </Badge>
          <Tip content={h.status === "conectado" ? "Tempo real conectado" : h.status === "negado" ? "Acesso ao tempo real negado" : "Reconectando ao tempo real…"}>
            <span className={cn("rounded-lg p-1.5", h.status === "conectado" ? "text-positive" : "text-warning")} role="status" aria-label={h.status === "conectado" ? "Conectado" : "Sem conexão em tempo real"}>
              {h.status === "conectado" ? <Wifi className="size-5" /> : <WifiOff className="size-5" />}
            </span>
          </Tip>
          <div className="hidden items-center gap-4 border-l border-white/10 pl-3 md:flex">
            <ElapsedClock label="Apresentação" since={p?.startedAt ?? null} offsetMs={h.clockOffset} />
            <ElapsedClock label="Neste item" since={notStarted ? null : (p?.itemEnteredAt ?? null)} offsetMs={h.clockOffset} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant={override === "TELA_PRETA" ? "default" : "secondary"}
              onClick={() => toggleOverride("TELA_PRETA")}
              disabled={notStarted}
              aria-pressed={override === "TELA_PRETA"}
              aria-keyshortcuts="B"
            >
              <MonitorOff /> <span className="hidden sm:inline">Tela preta</span>
            </Button>
            <Button size="sm" variant={override === "PAUSA" ? "default" : "secondary"} onClick={() => toggleOverride("PAUSA")} disabled={notStarted} aria-pressed={override === "PAUSA"} aria-keyshortcuts="P">
              <Coffee /> <span className="hidden sm:inline">Pausa</span>
            </Button>
            {s.screenUrl && (
              <Button size="sm" variant="secondary" onClick={openScreen}>
                <Monitor /> <span className="hidden lg:inline">Abrir telão</span>
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10" onClick={toggleFullscreen} aria-label={fullscreen ? "Sair da tela cheia (F)" : "Tela cheia (F)"}>
              {fullscreen ? <Minimize /> : <Maximize />}
            </Button>
            <Button variant="ghost" size="icon-sm" className="hidden text-white hover:bg-white/10 sm:inline-flex" onClick={() => setHelpOpen(true)} aria-label="Atalhos de teclado">
              <Keyboard />
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10" aria-label="Mais ações">
                  <EllipsisVertical />
                </Button>
              </MenuTrigger>
              <MenuContent className={DARK_DIALOG}>
                <MenuItem asChild>
                  <Link href={`/admin/sessoes/${id}/controle`}>
                    <Settings2 /> Painel de controle completo
                  </Link>
                </MenuItem>
                {canEditSession && (
                  <MenuItem onSelect={() => setPickerOpen(true)}>
                    <Presentation /> Trocar apresentação
                  </MenuItem>
                )}
                {live && (
                  <MenuItem onSelect={() => void h.act("pause", "/pause", {}, "Sessão pausada.")}>
                    <Pause /> Pausar sessão
                  </MenuItem>
                )}
                {p && p.status === "APRESENTANDO" && (
                  <MenuItem onSelect={() => setConfirmFinish(true)}>
                    <Flag /> Encerrar apresentação
                  </MenuItem>
                )}
                {!ended && s.status !== "RASCUNHO" && s.status !== "AGENDADA" && (
                  <MenuItem onSelect={() => setConfirmEnd(true)} className="text-negative">
                    <Square /> Encerrar sessão e mostrar pódio
                  </MenuItem>
                )}
                <MenuItem onSelect={() => setHelpOpen(true)}>
                  <Keyboard /> Atalhos de teclado
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
        {h.status !== "conectado" && (
          <p className="flex items-center gap-2 border-t border-warning/30 bg-warning/15 px-4 py-1.5 text-xs font-bold text-warning" role="status">
            <WifiOff className="size-3.5" />
            {h.status === "negado"
              ? "Acesso ao tempo real negado. Faça login novamente."
              : "Sem conexão em tempo real — reconectando… Os comandos continuam sendo enviados; a posição é recuperada ao reconectar."}
          </p>
        )}
      </header>

      {/* ------------------------------------------------------------ avisos de estado */}
      <div className="space-y-2 px-3 pt-3 sm:px-4 empty:hidden">
        {!live && !ended && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3">
            <AlertTriangle className="size-5 shrink-0 text-warning" />
            <p className="min-w-0 flex-1 text-sm">
              <b>A sessão está {SESSION_STATUS_LABELS[s.status].toLowerCase()}.</b> Os slides podem ser exibidos, mas os participantes só respondem com a sessão ao vivo.
            </p>
            <div className="flex flex-wrap gap-2">{sessionActions}</div>
          </div>
        )}
        {ended && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
            <Flag className="size-5 text-white/60" />
            <p className="flex-1">Sessão encerrada. O telão exibe o pódio e o encerramento.</p>
            <Button size="sm" variant="secondary" asChild>
              <Link href={`/admin/sessoes/${id}/resultados`}>Ver resultados</Link>
            </Button>
          </div>
        )}
        {p && mismatch && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand/40 bg-brand/10 px-4 py-3 text-sm">
            <Presentation className="size-5 text-brand" />
            <p className="flex-1">A sessão foi vinculada a outra apresentação. Clique em “Iniciar apresentação” para carregá-la (a posição atual será reiniciada).</p>
            <Button size="sm" onClick={() => send({ action: "start" })} loading={h.busy}>
              <Play /> Iniciar apresentação
            </Button>
          </div>
        )}
        {p && !mismatch && p.status === "PRONTA" && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand/40 bg-brand/10 px-4 py-3 text-sm">
            <Presentation className="size-5 text-brand" />
            <p className="flex-1">
              <b>{p.presentationTitle}</b> pronta com {p.items.length} {p.items.length === 1 ? "item" : "itens"}. O telão só muda quando você iniciar.
            </p>
            <Button onClick={() => send({ action: "start" })} loading={h.busy} disabled={p.items.length === 0}>
              <Play /> Iniciar apresentação
            </Button>
          </div>
        )}
        {p && !mismatch && p.status === "ENCERRADA" && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
            <Flag className="size-5 text-white/60" />
            <p className="flex-1">Apresentação encerrada. O telão mantém a última tela exibida.</p>
            <Button size="sm" onClick={() => send({ action: "start" })} loading={h.busy}>
              <Play /> Retomar apresentação
            </Button>
          </div>
        )}
      </div>

      {!p ? (
        /* ---------------------------------------------------------- sem apresentação vinculada */
        <div className="mx-auto grid max-w-6xl gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <LivePreview screen={h.screen} answered={h.screenAnswered} error={h.screenError} onRetry={h.reload} />
          <section className="rounded-2xl border border-white/10 bg-navy-900 p-5">
            <h1 className="text-lg font-black">Escolha a apresentação desta sessão</h1>
            <p className="mt-1 text-sm text-white/60">Use uma apresentação deste evento ou uma sem evento. Depois, inicie a apresentação para controlar o telão por aqui.</p>
            <div className="mt-4">
              <PresentationPicker orgId={orgId} eventId={s.eventId} currentId={null} canEdit={canEditSession} saving={h.pending === "link"} onSave={(pid) => void h.linkPresentation(pid)} />
            </div>
          </section>
        </div>
      ) : (
        /* ---------------------------------------------------------- painel do apresentador */
        <div className="grid gap-3 p-3 sm:gap-4 sm:p-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* telão agora */}
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <div className="mx-auto w-full lg:max-w-[calc((100dvh_-_330px)*16/9)]">
              <LivePreview screen={h.screen} answered={h.screenAnswered} error={h.screenError} onRetry={h.reload} />
            </div>
          </div>

          {/* navegação */}
          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            <div className="flex items-stretch gap-2 sm:gap-3">
              <Button
                size="xl"
                variant="secondary"
                className="h-16 flex-1 px-3 text-lg sm:max-w-56"
                onClick={() => send({ action: "prev" })}
                onPointerUp={releaseFocus}
                disabled={notStarted || prevIndex === null}
                aria-keyshortcuts="ArrowLeft PageUp"
              >
                <ChevronLeft className="size-6!" /> Anterior
              </Button>
              <div className="flex min-w-0 flex-[1.4] flex-col items-center justify-center rounded-2xl border border-white/10 bg-navy-900 px-3 text-center" aria-live="polite">
                <p className="text-sm font-black tabular text-white/80">
                  {viewIndex >= 0 ? (
                    <>
                      <span className="text-2xl text-white">{viewIndex + 1}</span> de {items.length}
                    </>
                  ) : (
                    `${items.length} itens`
                  )}
                  {h.busy && <Spinner className="ml-2 inline size-4 align-[-2px]" />}
                </p>
                <p className="w-full truncate text-xs text-white/60">{viewItem ? `${ITEM_TYPE_LABELS[viewItem.type]} · ${itemLabel(viewItem)}` : "Apresentação não iniciada"}</p>
              </div>
              <Button
                size="xl"
                className="h-16 flex-1 px-3 text-lg sm:max-w-56"
                onClick={() => send({ action: "next" })}
                onPointerUp={releaseFocus}
                disabled={items.length === 0 || (!notStarted && nextIndex === null)}
                aria-keyshortcuts="ArrowRight PageDown Space"
              >
                {notStarted ? "Iniciar" : "Próximo"} <ChevronRight className="size-6!" />
              </Button>
            </div>
            {screenDiverges && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
                <AlertTriangle className="size-4 text-warning" />
                <span className="flex-1">
                  O telão está mostrando <b>{SCREEN_LABELS[c.presentation.screen]}</b> (definido fora da sequência), não o item atual.
                </span>
                <Button size="sm" variant="secondary" onClick={() => h.act("back", "/presentation", { back: true })} loading={h.pending === "back"}>
                  <Undo2 /> Voltar à tela anterior
                </Button>
              </div>
            )}
          </div>

          {/* coluna lateral */}
          <aside className="flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-span-3 lg:row-start-1" aria-label="Controles do apresentador">
            <section className="order-3 rounded-2xl border border-white/10 bg-navy-900 p-4 lg:order-1" aria-label="Próximo item">
              <h2 className="mb-2 text-xs font-black uppercase tracking-wider text-white/70">{notStarted ? "Primeiro item" : "Próximo item"}</h2>
              <NextPreview item={nextItem} index={nextIndex} settings={h.settings} question={nextQ} />
            </section>

            <div className="order-1 flex flex-col gap-3 lg:order-2">
              {openQ && (
                <QuestionControls
                  q={openQ}
                  onScreen={!!itemQ && itemQ.sessionQuestionId === openQ.sessionQuestionId}
                  registered={c.counts.registered}
                  results={h.results[openQ.sessionQuestionId] ?? null}
                  live={live}
                  pending={h.pending}
                  act={h.act}
                  fetchResults={h.fetchResults}
                />
              )}
              {itemQ && itemQ.sessionQuestionId !== openQ?.sessionQuestionId && (
                <QuestionControls
                  q={itemQ}
                  onScreen
                  registered={c.counts.registered}
                  results={h.results[itemQ.sessionQuestionId] ?? null}
                  live={live}
                  pending={h.pending}
                  act={h.act}
                  fetchResults={h.fetchResults}
                />
              )}
              {serverItem && !itemQ && serverItem.questionId && (
                <p className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
                  A pergunta deste item não está disponível nesta sessão (rascunho ou removida). O telão mostra “aguardando”.
                </p>
              )}
              {!openQ && !itemQ && (
                <p className="rounded-2xl border border-dashed border-white/15 px-4 py-3 text-xs text-white/50">Nenhuma pergunta aberta para os participantes.</p>
              )}
            </div>

            <div className="order-2 lg:order-3">
              <Indicators control={c} answered={focusAnswered} hasQuestion={!!focusQ} />
            </div>

            <SpeakerNotes className="order-4" notes={(viewItem ?? (notStarted ? nextItem : null))?.notes} open={notesOpen} onToggle={() => setNotesOpen((v) => !v)} />

            <div className="order-5">
              <TopThree control={c} pending={h.pending} act={h.act} />
            </div>
          </aside>

          {/* acesso rápido aos itens */}
          <section className="min-w-0 rounded-2xl border border-white/10 bg-navy-900 p-3 lg:col-start-1 lg:row-start-3" aria-label="Acesso rápido aos itens">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-white/70">
                Itens <span className="font-bold text-white/40">· {items.filter((i) => !i.hidden).length} visíveis de {items.length}</span>
              </h2>
              <Button size="sm" variant="ghost" className="text-white/80 hover:bg-white/10" onClick={() => setGridOpen(true)}>
                <LayoutGrid /> Ver grade
              </Button>
            </div>
            {items.length === 0 ? (
              <p className="py-4 text-center text-sm text-white/50">Esta apresentação não tem itens. Adicione slides e perguntas no editor.</p>
            ) : (
              <ItemStrip items={items} screenItemId={notStarted ? null : serverItemId} viewItemId={viewItemId} onSelect={(it) => send({ action: "goto", toItemId: it.id })} />
            )}
          </section>
        </div>
      )}

      {/* ------------------------------------------------------------ diálogos */}
      <Dialog open={gridOpen} onOpenChange={setGridOpen} title="Ir para um item" description="Itens ocultos podem ser exibidos diretamente por aqui." className={cn(DARK_DIALOG, "max-w-5xl")}>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((it, i) => (
            <li key={it.id}>
              <ItemButton
                item={it}
                index={i}
                active={it.id === viewItemId}
                onScreen={!notStarted && it.id === serverItemId}
                onSelect={(x) => {
                  setGridOpen(false);
                  send({ action: "goto", toItemId: x.id });
                }}
              />
            </li>
          ))}
        </ol>
      </Dialog>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen} title="Apresentação da sessão" description="Ao trocar, inicie a apresentação novamente para carregar a nova sequência." className={DARK_DIALOG}>
        <PresentationPicker
          key={linkedId ?? p?.presentationId ?? "nenhuma"}
          orgId={orgId}
          eventId={s.eventId}
          currentId={linkedId ?? p?.presentationId ?? null}
          canEdit={canEditSession}
          saving={h.pending === "link"}
          onSave={async (pid) => {
            if (await h.linkPresentation(pid)) setPickerOpen(false);
          }}
        />
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen} title="Atalhos de teclado e passador" description="Funcionam com passadores de slides comuns (setas e Page Up/Down)." className={DARK_DIALOG}>
        <ul className="space-y-2 text-sm">
          {SHORTCUTS.map(([k, d]) => (
            <li key={k} className="flex items-center gap-3">
              <kbd className="min-w-44 rounded-lg bg-white/10 px-2 py-1 text-center text-xs font-black">{k}</kbd>
              {d}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-white/50">Os atalhos ficam desativados enquanto você digita num campo.</p>
      </Dialog>

      <Dialog
        open={confirmFinish}
        onOpenChange={setConfirmFinish}
        title="Encerrar a apresentação?"
        description="A navegação pelos itens é encerrada e o telão mantém a última tela. A sessão continua ativa — você pode retomar a apresentação depois."
        className={DARK_DIALOG}
        footer={
          <>
            <Button variant="ghost" className="text-white hover:bg-white/10" onClick={() => setConfirmFinish(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                send({ action: "finish" });
                setConfirmFinish(false);
              }}
            >
              <Flag /> Encerrar apresentação
            </Button>
          </>
        }
      />

      <Dialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="Encerrar a sessão?"
        description="A pergunta aberta será fechada, a pontuação publicada e a classificação congelada oficialmente. O telão exibirá o pódio com os prêmios. Esta ação não pode ser desfeita."
        className={DARK_DIALOG}
        footer={
          <>
            <Button variant="ghost" className="text-white hover:bg-white/10" onClick={() => setConfirmEnd(false)}>
              Cancelar
            </Button>
            <Button
              variant="negative"
              loading={h.pending === "end"}
              onClick={async () => {
                await h.act("end", "/end", {}, "Sessão encerrada. Pódio no telão!");
                setConfirmEnd(false);
              }}
            >
              <Square /> Encerrar e mostrar pódio
            </Button>
          </>
        }
      />
    </div>
  );
}
