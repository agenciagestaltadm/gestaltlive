"use client";
/**
 * Editor visual de apresentações: biblioteca (esquerda), linha do tempo (centro) e configurações do
 * item (direita). Abaixo de 1280 px as três áreas viram abas (celular: ↑/↓ em vez de arrastar).
 * Salvamento automático da linha do tempo inteira, com desfazer/refazer por snapshots.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { arrayMove } from "@dnd-kit/sortable";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckSquare,
  Copy,
  Eye,
  EyeOff,
  LayoutGrid,
  Library,
  Link2,
  List,
  Loader2,
  MoveVertical,
  Play,
  Redo2,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { PresentationDTO } from "@shared/presentations";
import { admin, ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn, fmtInt } from "@/lib/utils";
import { useAdmin } from "@/components/admin/admin-context";
import { LoadError } from "@/components/admin/load-error";
import { parseSettings, type EventDetail } from "@/components/admin/event-types";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge, Dialog, EmptyState, Field, Input, Skeleton } from "@/components/ui/primitives";
import type { QuestionRow } from "@/components/builder/types";
import { DuplicateDialog, PresentationSettingsDialog, useOrgEvents } from "@/components/presentations/presentation-dialogs";
import { LibraryPanel, type InsertMode } from "@/components/presentations/library-panel";
import { Timeline, type SelectModifiers, type TimelineHandlers, type TimelineView } from "@/components/presentations/timeline";
import { ItemSettingsPanel, type ItemUpdater } from "@/components/presentations/item-settings";
import { questionMap, type RehearsalSource } from "@/components/presentations/rehearsal-state";
import { useTimeline, type SaveState } from "@/components/presentations/use-timeline";
import { cloneItem, validateItem, type EditorItem } from "@/components/presentations/types";

export default function PresentationEditorPage() {
  const { id } = useParams<{ id: string }>();
  const pres = useApi(() => admin.get<PresentationDTO>(`/presentations/${id}`), [id]);
  if (pres.loading && !pres.data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-14" />
        <div className="grid gap-4 xl:grid-cols-[300px_1fr_360px]">
          <Skeleton className="hidden h-[60dvh] xl:block" />
          <Skeleton className="h-[60dvh]" />
          <Skeleton className="hidden h-[60dvh] xl:block" />
        </div>
      </div>
    );
  }
  if (pres.error || !pres.data) {
    return (
      <div>
        <Link href="/admin/apresentacoes" className="mb-3 inline-block text-sm font-bold text-muted-foreground hover:text-brand">
          ← Apresentações
        </Link>
        <LoadError error={pres.error instanceof ApiError && pres.error.status === 404 ? new Error("Apresentação não encontrada.") : pres.error} onRetry={() => void pres.reload()} />
      </div>
    );
  }
  return <Editor key={pres.data.id} initial={pres.data} />;
}

type MobileTab = "linha" | "biblioteca" | "item";

function Editor({ initial }: { initial: PresentationDTO }) {
  const router = useRouter();
  const { orgId, org, can } = useAdmin();
  const canWrite = can("event.write");
  const readOnly = !canWrite;
  const [meta, setMeta] = useState<PresentationDTO>(initial);
  const tl = useTimeline(initial.id, initial.items, readOnly);
  const { apply, flush, replaceFromServer } = tl;
  const items = tl.items;
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const events = useOrgEvents(orgId);
  const questions = useApi<QuestionRow[]>(meta.eventId ? () => admin.get<QuestionRow[]>(`/events/${meta.eventId}/questions`) : null, [meta.eventId]);
  const eventDetail = useApi<EventDetail>(meta.eventId ? () => admin.get<EventDetail>(`/events/${meta.eventId}`) : null, [meta.eventId]);

  /* ---------------------------------------------------------------- seleção e inserção */
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial.items[0] ? [initial.items[0].id] : []));
  const [focusId, setFocusId] = useState<string | null>(initial.items[0]?.id ?? null);
  const anchor = useRef<string | null>(focusId);
  const [insertMode, setInsertMode] = useState<InsertMode>("end");
  const [insertPoint, setInsertPoint] = useState<number | null>(null);
  const [view, setView] = useState<TimelineView>("lista");
  const [mobileTab, setMobileTab] = useState<MobileTab>("linha");
  const [libTab, setLibTab] = useState("slides");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);

  // limpa da seleção ids que não existem mais (desfazer/refazer, exclusões)
  useEffect(() => {
    const ids = new Set(items.map((i) => i.id));
    setSelected((s) => {
      const n = new Set([...s].filter((x) => ids.has(x)));
      return n.size === s.size ? s : n;
    });
    setFocusId((f) => (f && ids.has(f) ? f : null));
    setInsertPoint((p) => (p !== null && p > items.length ? items.length : p));
  }, [items]);

  const focusIndex = focusId ? items.findIndex((i) => i.id === focusId) : -1;
  const focusItem = focusIndex >= 0 ? items[focusIndex] : null;

  const targetIndex = useCallback(() => {
    const list = itemsRef.current;
    if (insertPoint !== null) return Math.min(insertPoint, list.length);
    if (insertMode === "after" && focusId) {
      const i = list.findIndex((x) => x.id === focusId);
      if (i >= 0) return i + 1;
    }
    return list.length;
  }, [insertPoint, insertMode, focusId]);

  const selectOnly = useCallback((ids: string[]) => {
    setSelected(new Set(ids));
    const last = ids[ids.length - 1] ?? null;
    setFocusId(last);
    anchor.current = last;
  }, []);

  const insertItems = useCallback(
    (newItems: EditorItem[]) => {
      if (!newItems.length) return;
      const at = targetIndex();
      apply((prev) => [...prev.slice(0, at), ...newItems, ...prev.slice(at)]);
      if (insertPoint !== null) setInsertPoint(at + newItems.length);
      selectOnly(newItems.map((i) => i.id));
    },
    [insertPoint, selectOnly, targetIndex, apply],
  );

  const insertAssets = useCallback(
    async (assetIds: string[], order: "natural" | "pedida" = "natural") => {
      if (!assetIds.length) return true;
      const saved = await flush();
      if (!saved) {
        toast.error("Há alterações pendentes que não puderam ser salvas. Corrija os itens sinalizados e tente novamente.");
        return false;
      }
      const at = targetIndex();
      const before = new Set(itemsRef.current.map((i) => i.id));
      try {
        const p = await admin.post<PresentationDTO>(`/presentations/${initial.id}/slides`, { assetIds, insertAt: at, order });
        replaceFromServer(p.items);
        const fresh = p.items.filter((i) => !before.has(i.id));
        if (insertPoint !== null) setInsertPoint(at + fresh.length);
        selectOnly(fresh.map((i) => i.id));
        toast.success(`${fmtInt(fresh.length)} ${fresh.length === 1 ? "slide inserido" : "slides inseridos"} na linha do tempo.`);
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível inserir os slides.");
        return false;
      }
    },
    [initial.id, insertPoint, selectOnly, targetIndex, flush, replaceFromServer],
  );

  /* ---------------------------------------------------------------- ações da linha do tempo */
  const handlers = useMemo<TimelineHandlers>(
    () => ({
      onSelect: (id: string, mod: SelectModifiers) => {
        const list = itemsRef.current;
        if (mod.shift && anchor.current) {
          const a = list.findIndex((x) => x.id === anchor.current);
          const b = list.findIndex((x) => x.id === id);
          if (a >= 0 && b >= 0) {
            const [from, to] = a < b ? [a, b] : [b, a];
            const range = list.slice(from, to + 1).map((x) => x.id);
            setSelected((s) => new Set(mod.ctrl ? [...s, ...range] : range));
            setFocusId(id);
            return;
          }
        }
        if (mod.ctrl) {
          setSelected((s) => {
            const n = new Set(s);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
          });
          setFocusId(id);
          anchor.current = id;
          return;
        }
        setSelected(new Set([id]));
        setFocusId(id);
        anchor.current = id;
      },
      onToggleCheck: (id: string) => {
        setSelected((s) => {
          const n = new Set(s);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        });
        setFocusId(id);
        anchor.current = id;
      },
      onMove: (fromId: string, toId: string) =>
        apply((prev) => {
          const from = prev.findIndex((x) => x.id === fromId);
          const to = prev.findIndex((x) => x.id === toId);
          return from < 0 || to < 0 ? prev : arrayMove(prev, from, to);
        }),
      onMoveBy: (id: string, delta: number) =>
        apply((prev) => {
          const from = prev.findIndex((x) => x.id === id);
          const to = from + delta;
          return from < 0 || to < 0 || to >= prev.length ? prev : arrayMove(prev, from, to);
        }),
      onDuplicate: (id: string) => {
        const src = itemsRef.current.find((x) => x.id === id);
        if (!src) return;
        const copy = cloneItem(src);
        apply((prev) => {
          const i = prev.findIndex((x) => x.id === id);
          return i < 0 ? prev : [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
        });
        setSelected(new Set([copy.id]));
        setFocusId(copy.id);
        anchor.current = copy.id;
      },
      onToggleHidden: (id: string) => apply((prev) => prev.map((x) => (x.id === id ? { ...x, hidden: !x.hidden } : x))),
      onDelete: (id: string) => {
        apply((prev) => prev.filter((x) => x.id !== id));
        toast.info("Item excluído. Use Ctrl+Z para desfazer.");
      },
      onSetInsertPoint: (index: number | null) => {
        setInsertPoint(index);
        if (index !== null) setMobileTab("biblioteca");
      },
      onOpenSettings: (id: string) => {
        setSelected(new Set([id]));
        setFocusId(id);
        anchor.current = id;
        setMobileTab("item");
      },
    }),
    [apply],
  );

  const updateItem = useCallback<ItemUpdater>((id, fn, coalesce) => apply((prev) => prev.map((x) => (x.id === id ? fn(x) : x)), coalesce), [apply]);

  /* ---------------------------------------------------------------- ações em lote */
  const selCount = selected.size;
  const allSelectedHidden = selCount > 0 && items.filter((i) => selected.has(i.id)).every((i) => i.hidden);
  const batchDelete = () => {
    const n = selCount;
    apply((prev) => prev.filter((x) => !selected.has(x.id)));
    setSelected(new Set());
    toast.info(`${fmtInt(n)} ${n === 1 ? "item excluído" : "itens excluídos"}. Use Ctrl+Z para desfazer.`);
  };
  const batchHide = (hidden: boolean) => apply((prev) => prev.map((x) => (selected.has(x.id) ? { ...x, hidden } : x)));
  const batchDuplicate = () => {
    const copies: EditorItem[] = [];
    apply((prev) => {
      const sel = prev.filter((x) => selected.has(x.id));
      const lastIdx = Math.max(...prev.map((x, i) => (selected.has(x.id) ? i : -1)));
      const c = sel.map(cloneItem);
      copies.push(...c);
      return [...prev.slice(0, lastIdx + 1), ...c, ...prev.slice(lastIdx + 1)];
    });
    selectOnly(copies.map((c) => c.id));
  };
  const moveSelectionTo = (pos1: number) =>
    apply((prev) => {
      const sel = prev.filter((x) => selected.has(x.id));
      const rest = prev.filter((x) => !selected.has(x.id));
      const at = Math.max(0, Math.min(rest.length, pos1 - 1));
      return [...rest.slice(0, at), ...sel, ...rest.slice(at)];
    });

  /* ---------------------------------------------------------------- atalhos */
  const kb = useRef({ undo: tl.undo, redo: tl.redo, del: () => undefined as void, clear: () => undefined as void, count: 0 });
  useEffect(() => {
    kb.current = {
      undo: tl.undo,
      redo: tl.redo,
      del: () => (selCount > 1 ? setConfirmBatchDelete(true) : focusId ? handlers.onDelete(focusId) : undefined),
      clear: () => {
        setSelected(new Set());
        setInsertPoint(null);
      },
      count: selCount,
    };
  });
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
      if (document.querySelector("[role=dialog]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && !typing && k === "z") {
        e.preventDefault();
        if (e.shiftKey) kb.current.redo();
        else kb.current.undo();
      } else if (mod && !typing && k === "y") {
        e.preventDefault();
        kb.current.redo();
      } else if (!typing && (e.key === "Delete" || (e.key === "Backspace" && mod)) && kb.current.count > 0) {
        e.preventDefault();
        kb.current.del();
      } else if (!typing && e.key === "Escape") {
        kb.current.clear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly]);

  /* ---------------------------------------------------------------- cabeçalho */
  const [title, setTitle] = useState(meta.title);
  const saveMeta = async (patch: Partial<Pick<PresentationDTO, "title">>) => {
    try {
      const p = await admin.put<PresentationDTO>(`/presentations/${meta.id}`, {
        title: patch.title ?? meta.title,
        description: meta.description,
        eventId: meta.eventId,
        settings: meta.settings,
      });
      setMeta(p);
      setTitle(p.title);
      toast.success("Título salvo.");
    } catch (e) {
      setTitle(meta.title);
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar o título.");
    }
  };
  const commitTitle = () => {
    const t = title.trim();
    if (!t) return setTitle(meta.title);
    if (t !== meta.title) void saveMeta({ title: t });
  };

  const rehearse = async () => {
    const ok = await tl.flush();
    if (!ok && !window.confirm("Algumas alterações ainda não foram salvas. Ensaiar com a última versão salva?")) return;
    router.push(`/admin/apresentacoes/${meta.id}/ensaio`);
  };
  const openDuplicate = async () => {
    const ok = await tl.flush();
    if (!ok && !window.confirm("Algumas alterações ainda não foram salvas e não entrarão na cópia. Continuar?")) return;
    setDupOpen(true);
  };

  /* ---------------------------------------------------------------- dados derivados */
  const invalid = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) {
      const msg = validateItem(it);
      if (msg) m.set(it.id, msg);
    }
    return m;
  }, [items]);
  const qMap = useMemo(() => questionMap(questions.data), [questions.data]);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const previewSource = useMemo<RehearsalSource>(
    () => ({
      presentation: { id: meta.id, title: meta.title, settings: meta.settings, items },
      event: eventDetail.data ?? null,
      questions: qMap,
      org: { name: org.name, logoUrl: org.logoUrl },
      origin,
    }),
    [meta.id, meta.title, meta.settings, items, eventDetail.data, qMap, org.name, org.logoUrl, origin],
  );
  const dupSource = useMemo(
    () => (dupOpen ? { id: meta.id, title: meta.title, eventId: meta.eventId, eventTitle: meta.eventTitle } : null),
    [dupOpen, meta.id, meta.title, meta.eventId, meta.eventTitle],
  );
  const defaultResultsMode = eventDetail.data ? parseSettings(eventDetail.data.settings).defaultResultsMode : undefined;
  const slideCount = items.filter((i) => i.type === "IMAGE_SLIDE").length;
  const hiddenCount = items.filter((i) => i.hidden).length;
  const insertPointLabel = insertPoint === null ? null : insertPoint >= items.length ? "no fim" : `antes do item ${insertPoint + 1}`;

  return (
    <div className="flex flex-col gap-4">
      {/* ----------------------------------------------------------- cabeçalho */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Link href="/admin/apresentacoes" className="shrink-0 rounded-lg p-1.5 text-sm font-bold text-muted-foreground hover:bg-muted hover:text-brand" aria-label="Voltar para apresentações">
            ←
          </Link>
          <div className="min-w-0 flex-1">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setTitle(meta.title);
              }}
              disabled={readOnly}
              maxLength={160}
              aria-label="Título da apresentação"
              className="h-10 border-transparent bg-transparent px-2 text-lg font-black hover:border-border focus:bg-card lg:text-xl"
            />
            <div className="flex flex-wrap items-center gap-1.5 px-2 text-xs text-muted-foreground">
              {meta.eventId ? (
                <Link href={`/admin/eventos/${meta.eventId}`} className="inline-flex max-w-[16rem] items-center gap-1 font-bold text-brand hover:underline">
                  <CalendarDays className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{meta.eventTitle ?? "Evento"}</span>
                </Link>
              ) : (
                <button type="button" onClick={() => setSettingsOpen(true)} disabled={readOnly} className="inline-flex items-center gap-1 font-bold hover:text-brand">
                  <Link2 className="size-3.5" aria-hidden /> Sem evento {canWrite && "· vincular"}
                </button>
              )}
              <span>·</span>
              <span>
                {fmtInt(items.length)} {items.length === 1 ? "item" : "itens"} · {fmtInt(slideCount)} {slideCount === 1 ? "slide" : "slides"}
                {hiddenCount > 0 && ` · ${fmtInt(hiddenCount)} ${hiddenCount === 1 ? "oculto" : "ocultos"}`}
              </span>
              {!readOnly && (
                <>
                  <span>·</span>
                  <SaveIndicator state={tl.saveState} error={tl.saveError} invalidCount={invalid.size} onRetry={() => void tl.saveNow()} onShowInvalid={() => {
                    const first = items.find((i) => invalid.has(i.id));
                    if (first) handlers.onOpenSettings(first.id);
                  }} />
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!readOnly && (
            <>
              <Button variant="ghost" size="icon-sm" onClick={tl.undo} disabled={!tl.canUndo} aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)">
                <Undo2 />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={tl.redo} disabled={!tl.canRedo} aria-label="Refazer (Ctrl+Shift+Z)" title="Refazer (Ctrl+Shift+Z ou Ctrl+Y)">
                <Redo2 />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                <Settings2 /> <span className="hidden sm:inline">Configurações</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => void openDuplicate()}>
                <Copy /> <span className="hidden sm:inline">Duplicar</span>
              </Button>
            </>
          )}
          <Button size="sm" onClick={() => void rehearse()} disabled={items.length === 0}>
            <Play /> Ensaiar
          </Button>
        </div>
      </header>

      {readOnly && <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">Você tem acesso somente leitura a esta apresentação.</p>}

      {/* ----------------------------------------------------------- abas (abaixo de xl) */}
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1 xl:hidden" role="tablist" aria-label="Áreas do editor">
        {(
          [
            ["linha", `Linha do tempo (${items.length})`, List],
            ["biblioteca", "Biblioteca", Library],
            ["item", "Item", SlidersHorizontal],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mobileTab === key}
            onClick={() => setMobileTab(key)}
            className={cn("inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-bold transition sm:text-sm", mobileTab === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
          >
            <Icon className="size-4 shrink-0" aria-hidden /> <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:h-[calc(100dvh-12rem)] xl:min-h-[540px] xl:grid-cols-[300px_minmax(0,1fr)_360px] 2xl:grid-cols-[340px_minmax(0,1fr)_400px]">
        {/* ----------------------------------------------------------- biblioteca */}
        <aside aria-label="Biblioteca" className={cn("min-h-0 flex-col overflow-y-auto rounded-2xl border border-border bg-card p-3", mobileTab === "biblioteca" ? "flex" : "hidden", "xl:flex")}>
          {readOnly ? (
            <EmptyState icon={<Library />} title="Biblioteca indisponível" description="É preciso permissão de edição para inserir itens." className="p-6" />
          ) : (
            <LibraryPanel
              orgId={orgId}
              eventId={meta.eventId}
              items={items}
              questions={questions}
              defaultResultsMode={defaultResultsMode}
              readOnly={readOnly}
              insertMode={insertMode}
              onInsertModeChange={setInsertMode}
              insertPointLabel={insertPointLabel}
              onClearInsertPoint={() => setInsertPoint(null)}
              hasSelection={!!focusId}
              onInsertItems={insertItems}
              onInsertAssets={insertAssets}
              onLinkEvent={() => setSettingsOpen(true)}
              tab={libTab}
              onTabChange={setLibTab}
            />
          )}
        </aside>

        {/* ----------------------------------------------------------- linha do tempo */}
        <section aria-label="Linha do tempo" className={cn("min-h-0 flex-col rounded-2xl border border-border bg-muted/30", mobileTab === "linha" ? "flex" : "hidden", "xl:flex")}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            {selCount > 0 && !readOnly ? (
              <div className="flex w-full flex-wrap items-center gap-1.5" role="toolbar" aria-label="Ações em lote">
                <Badge tone="brand">{fmtInt(selCount)} {selCount === 1 ? "selecionado" : "selecionados"}</Badge>
                <Button size="sm" variant="ghost" onClick={() => batchHide(!allSelectedHidden)}>
                  {allSelectedHidden ? <Eye /> : <EyeOff />} {allSelectedHidden ? "Mostrar" : "Ocultar"}
                </Button>
                <Button size="sm" variant="ghost" onClick={batchDuplicate}>
                  <Copy /> Duplicar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMoveOpen(true)}>
                  <MoveVertical /> Mover para…
                </Button>
                <Button size="sm" variant="ghost" className="text-negative" onClick={() => (selCount > 1 ? setConfirmBatchDelete(true) : batchDelete())}>
                  <Trash2 /> Excluir
                </Button>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => selectOnly(items.map((i) => i.id))} disabled={selCount === items.length}>
                  <CheckSquare /> Todos
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => setSelected(new Set())} aria-label="Limpar seleção">
                  <X />
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm font-black">Linha do tempo</p>
                <p className="hidden text-xs text-muted-foreground md:block">Arraste para reordenar · Ctrl/Shift + clique para selecionar vários</p>
                <div className="flex-1" />
                <div className="hidden items-center rounded-lg bg-muted p-0.5 md:flex" role="group" aria-label="Visualização">
                  <button type="button" onClick={() => setView("lista")} aria-pressed={view === "lista"} className={cn("rounded-md p-1.5", view === "lista" ? "bg-card shadow-sm" : "text-muted-foreground")} aria-label="Ver em lista">
                    <List className="size-4" />
                  </button>
                  <button type="button" onClick={() => setView("grade")} aria-pressed={view === "grade"} className={cn("rounded-md p-1.5", view === "grade" ? "bg-card shadow-sm" : "text-muted-foreground")} aria-label="Ver em grade">
                    <LayoutGrid className="size-4" />
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {items.length === 0 ? (
              <EmptyState
                icon={<Library />}
                title="Linha do tempo vazia"
                description={readOnly ? "Esta apresentação ainda não tem itens." : "Envie os slides exportados do Canva (JPG/PNG) pela biblioteca e intercale perguntas e telas interativas."}
                action={
                  !readOnly && (
                    <Button
                      onClick={() => {
                        setLibTab("slides");
                        setMobileTab("biblioteca");
                      }}
                    >
                      <Library /> Abrir biblioteca
                    </Button>
                  )
                }
              />
            ) : (
              <Timeline
                items={items}
                selected={selected}
                focusId={focusId}
                invalid={invalid}
                readOnly={readOnly}
                view={view}
                insertPoint={insertPoint}
                handlers={handlers}
              />
            )}
          </div>
        </section>

        {/* ----------------------------------------------------------- configurações do item */}
        <aside aria-label="Configurações do item" className={cn("min-h-0 flex-col overflow-y-auto rounded-2xl border border-border bg-card p-4", mobileTab === "item" ? "flex" : "hidden", "xl:flex")}>
          <ItemSettingsPanel
            item={selCount > 1 && !focusItem ? null : focusItem}
            index={focusIndex}
            selectionCount={selCount}
            presentationSettings={meta.settings}
            questions={questions.data ?? []}
            orgId={orgId}
            readOnly={readOnly}
            invalid={focusItem ? invalid.get(focusItem.id) ?? null : null}
            previewSource={previewSource}
            onUpdate={updateItem}
          />
        </aside>
      </div>

      {canWrite && (
        <>
          <PresentationSettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            presentation={meta}
            events={events.data ?? []}
            hasQuestions={items.some((i) => !!i.questionId)}
            onSaved={(p) => {
              setMeta(p);
              setTitle(p.title);
            }}
          />
          <DuplicateDialog
            open={dupOpen}
            onOpenChange={setDupOpen}
            source={dupSource}
            events={events.data ?? []}
            onDuplicated={(p) => {
              setDupOpen(false);
              router.push(`/admin/apresentacoes/${p.id}`);
            }}
          />
          <MoveToDialog
            open={moveOpen}
            onOpenChange={setMoveOpen}
            count={selCount}
            total={items.length}
            onMove={(pos) => {
              moveSelectionTo(pos);
              setMoveOpen(false);
            }}
          />
          <ConfirmDialog
            open={confirmBatchDelete}
            onOpenChange={setConfirmBatchDelete}
            title={`Excluir ${fmtInt(selCount)} itens?`}
            description="Os itens saem da linha do tempo (os arquivos continuam na biblioteca e as perguntas no evento). Você pode desfazer com Ctrl+Z."
            confirmLabel="Excluir"
            onConfirm={batchDelete}
          />
        </>
      )}
    </div>
  );
}

function SaveIndicator({ state, error, invalidCount, onRetry, onShowInvalid }: { state: SaveState; error: string | null; invalidCount: number; onRetry: () => void; onShowInvalid: () => void }) {
  if (state === "salvando") {
    return (
      <span className="inline-flex items-center gap-1 font-bold" role="status">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Salvando…
      </span>
    );
  }
  if (state === "pendente") return <span role="status">Alterações pendentes…</span>;
  if (state === "erro") {
    return (
      <span className="inline-flex items-center gap-1.5 font-bold text-negative" role="alert">
        <AlertTriangle className="size-3.5" aria-hidden /> Erro ao salvar{error ? `: ${error}` : ""}
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-0.5 underline underline-offset-2">
          <RotateCcw className="size-3" aria-hidden /> tentar de novo
        </button>
      </span>
    );
  }
  if (state === "invalido" || (invalidCount > 0 && state !== "salvo")) {
    return (
      <button type="button" onClick={onShowInvalid} className="inline-flex items-center gap-1 font-bold text-warning underline-offset-2 hover:underline" role="alert">
        <AlertTriangle className="size-3.5" aria-hidden /> Corrija {fmtInt(invalidCount || 1)} {invalidCount === 1 ? "item" : "itens"} para salvar
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-positive" role="status">
      <Check className="size-3.5" aria-hidden /> Salvo
    </span>
  );
}

function MoveToDialog({ open, onOpenChange, count, total, onMove }: { open: boolean; onOpenChange: (v: boolean) => void; count: number; total: number; onMove: (pos: number) => void }) {
  const uid = useId();
  const max = Math.max(1, total - count + 1);
  const [pos, setPos] = useState("1");
  useEffect(() => {
    if (open) setPos("1");
  }, [open]);
  const n = Math.round(Number(pos));
  const valid = Number.isFinite(n) && n >= 1 && n <= max;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Mover ${fmtInt(count)} ${count === 1 ? "item" : "itens"}`}
      description="Os itens selecionados ficam juntos, na ordem atual, a partir da posição escolhida."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => valid && onMove(n)} disabled={!valid}>
            <MoveVertical /> Mover
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onMove(n);
        }}
      >
        <Field label="Nova posição" htmlFor={`${uid}-p`} hint={`De 1 a ${fmtInt(max)} (1 = início).`} error={pos && !valid ? "Posição inválida." : null}>
          <Input id={`${uid}-p`} type="number" inputMode="numeric" min={1} max={max} value={pos} onChange={(e) => setPos(e.target.value)} autoFocus />
        </Field>
        <div className="mt-3 flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => onMove(1)}>
            Para o início
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onMove(max)}>
            Para o fim
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
