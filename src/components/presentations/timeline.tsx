"use client";
/**
 * Linha do tempo do editor (coluna central): lista ou grade ordenável com dnd-kit (mouse, toque e
 * teclado), seleção múltipla, inserção entre itens e ações rápidas. Linhas memorizadas para
 * aguentar centenas de itens; miniaturas sempre na variante "mini" com carregamento preguiçoso.
 */
import { memo, useMemo } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, ArrowDown, ArrowUp, Clock, Copy, Eye, EyeOff, GripVertical, NotebookPen, Plus, Settings2, Trash2 } from "lucide-react";
import { ITEM_TYPE_LABELS, TRANSITION_LABELS } from "@shared/presentations";
import { cn } from "@/lib/utils";
import { ItemThumb, ItemTypeIcon } from "./item-visual";
import { itemDisplayTitle, type EditorItem } from "./types";

export type TimelineView = "lista" | "grade";

export interface SelectModifiers {
  ctrl: boolean;
  shift: boolean;
}

export interface TimelineHandlers {
  onSelect: (id: string, mod: SelectModifiers) => void;
  onToggleCheck: (id: string) => void;
  onMove: (fromId: string, toId: string) => void;
  onMoveBy: (id: string, delta: number) => void;
  onDuplicate: (id: string) => void;
  onToggleHidden: (id: string) => void;
  onDelete: (id: string) => void;
  onSetInsertPoint: (index: number | null) => void;
  onOpenSettings: (id: string) => void;
}

export interface TimelineProps {
  handlers: TimelineHandlers;
  items: EditorItem[];
  selected: Set<string>;
  focusId: string | null;
  invalid: Map<string, string>;
  readOnly: boolean;
  view: TimelineView;
  insertPoint: number | null;
}

export function Timeline(p: TimelineProps) {
  const { items, selected, focusId, invalid, readOnly, view, insertPoint } = p;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const indexOf = useMemo(() => new Map(items.map((it, i) => [it.id, i])), [items]);
  const titleOf = (id: UniqueIdentifier) => {
    const it = items[indexOf.get(String(id)) ?? -1];
    return it ? itemDisplayTitle(it) : "";
  };
  const posOf = (id: UniqueIdentifier) => (indexOf.get(String(id)) ?? 0) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Item “${titleOf(active.id)}” selecionado, na posição ${posOf(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `Item “${titleOf(active.id)}” sobre a posição ${posOf(over.id)}.` : `Item “${titleOf(active.id)}” fora da lista.`),
    onDragEnd: ({ active, over }) => (over ? `Item “${titleOf(active.id)}” movido para a posição ${posOf(over.id)}.` : "Movimento cancelado."),
    onDragCancel: ({ active }) => `Movimento cancelado. O item “${titleOf(active.id)}” voltou à posição original.`,
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    p.handlers.onMove(String(active.id), String(over.id));
  };

  const grid = view === "grade";
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: "Para reordenar, pressione Espaço ou Enter para pegar o item, use as setas para mover e pressione Espaço ou Enter novamente para soltar. Esc cancela.",
        },
      }}
    >
      <SortableContext items={ids} strategy={grid ? rectSortingStrategy : verticalListSortingStrategy}>
        <ol
          className={cn(grid ? "grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4" : "flex flex-col")}
          aria-label="Linha do tempo da apresentação"
        >
          {items.map((it, i) => (
            <TimelineRow
              key={it.id}
              item={it}
              index={i}
              total={items.length}
              selected={selected.has(it.id)}
              focused={focusId === it.id}
              invalid={invalid.get(it.id) ?? null}
              readOnly={readOnly}
              grid={grid}
              gapActive={insertPoint === i}
              handlers={p.handlers}
            />
          ))}
          {!readOnly &&
            (grid ? (
              <li>
                <button
                  type="button"
                  onClick={() => p.handlers.onSetInsertPoint(items.length)}
                  className={cn(
                    "grid aspect-video w-full place-items-center rounded-xl border-2 border-dashed text-sm font-bold transition",
                    insertPoint === items.length ? "border-brand bg-brand/10 text-brand" : "border-border text-muted-foreground hover:border-brand hover:text-brand",
                  )}
                  aria-label="Inserir novos itens no fim"
                >
                  <span className="flex items-center gap-1">
                    <Plus className="size-4" /> No fim
                  </span>
                </button>
              </li>
            ) : (
              <InsertGap index={items.length} active={insertPoint === items.length} onSet={p.handlers.onSetInsertPoint} last />
            ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

const InsertGap = memo(function InsertGap({ index, active, onSet, last }: { index: number; active: boolean; onSet: (i: number | null) => void; last?: boolean }) {
  return (
    <li className={cn("group/gap relative flex items-center justify-center", last ? "h-10" : "h-3")} aria-hidden={false}>
      <span className={cn("absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 rounded-full transition", active ? "bg-brand" : "bg-transparent group-hover/gap:bg-brand/40 group-focus-within/gap:bg-brand/40")} />
      <button
        type="button"
        onClick={() => onSet(active ? null : index)}
        className={cn(
          "relative z-[1] flex items-center gap-1 rounded-full border px-2 text-[11px] font-bold transition",
          active
            ? "border-brand bg-brand text-white opacity-100"
            : last
              ? "border-dashed border-border bg-card text-muted-foreground opacity-100 hover:border-brand hover:text-brand"
              : "border-border bg-card text-muted-foreground opacity-0 hover:text-brand focus-visible:opacity-100 group-hover/gap:opacity-100",
          last ? "h-7" : "h-5",
        )}
        aria-label={active ? "Cancelar posição de inserção" : last ? "Inserir novos itens no fim" : `Inserir novos itens antes da posição ${index + 1}`}
        aria-pressed={active}
      >
        <Plus className="size-3" />
        {active ? "Os novos itens entrarão aqui" : last ? "Inserir no fim" : null}
      </button>
    </li>
  );
});

const TimelineRow = memo(function TimelineRow({
  item,
  index,
  total,
  selected,
  focused,
  invalid,
  readOnly,
  grid,
  gapActive,
  handlers: h,
}: {
  item: EditorItem;
  index: number;
  total: number;
  selected: boolean;
  focused: boolean;
  invalid: string | null;
  readOnly: boolean;
  grid: boolean;
  gapActive: boolean;
  handlers: TimelineHandlers;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: readOnly });
  const title = itemDisplayTitle(item);
  const n = index + 1;
  const style = { transform: CSS.Transform.toString(transform), transition };
  const select = (e: React.MouseEvent) => h.onSelect(item.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
  const meta = (
    <>
      <span className="inline-flex items-center gap-1">
        <ItemTypeIcon type={item.type} className="size-3" />
        {ITEM_TYPE_LABELS[item.type]}
      </span>
      {item.settings.durationSec ? (
        <span className="inline-flex items-center gap-0.5" title="Avança sozinho">
          <Clock className="size-3" aria-hidden /> {item.settings.durationSec}s
        </span>
      ) : null}
      {item.transition && <span title="Transição própria">{TRANSITION_LABELS[item.transition]}</span>}
      {item.notes?.trim() ? <NotebookPen className="size-3" aria-label="Tem notas do palestrante" /> : null}
    </>
  );

  const actions = !readOnly && (
    <div className={cn("flex shrink-0 items-center", grid ? "gap-0.5" : "gap-0.5")}>
      <IconBtn label={`Duplicar item ${n}`} onClick={() => h.onDuplicate(item.id)} className="hidden sm:grid">
        <Copy />
      </IconBtn>
      <IconBtn label={item.hidden ? `Mostrar item ${n}` : `Ocultar item ${n}`} onClick={() => h.onToggleHidden(item.id)}>
        {item.hidden ? <EyeOff /> : <Eye />}
      </IconBtn>
      <IconBtn label={`Excluir item ${n}`} onClick={() => h.onDelete(item.id)} className="hover:text-negative">
        <Trash2 />
      </IconBtn>
    </div>
  );

  if (grid) {
    return (
      <li
        ref={setNodeRef}
        style={style}
        className={cn(
          "group relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm",
          selected ? "border-brand ring-2 ring-brand/40" : "border-border",
          item.hidden && "opacity-55",
          isDragging && "z-10 shadow-xl",
        )}
      >
        <div className="relative">
          <button type="button" onClick={select} className="block w-full" aria-label={`Selecionar item ${n}: ${title}`} aria-pressed={selected}>
            <ItemThumb item={item} className="rounded-none" />
          </button>
          <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-md bg-navy-950/85 px-1.5 text-[11px] font-black text-white tabular">{n}</span>
          {item.hidden && (
            <span className="pointer-events-none absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-navy-950/85 px-1.5 text-[10px] font-bold text-white">
              <EyeOff className="size-3" /> Oculto
            </span>
          )}
          {!readOnly && (
            <>
              <input
                type="checkbox"
                checked={selected}
                onChange={() => h.onToggleCheck(item.id)}
                className="absolute right-1.5 top-1.5 size-4 accent-[var(--brand)]"
                aria-label={`Marcar item ${n}`}
              />
              <button
                ref={setActivatorNodeRef}
                type="button"
                className="absolute bottom-1.5 right-1.5 grid size-7 cursor-grab touch-none place-items-center rounded-md bg-navy-950/85 text-white active:cursor-grabbing"
                aria-label={`Reordenar item ${n}: ${title}`}
                {...attributes}
                {...listeners}
              >
                <GripVertical className="size-4" />
              </button>
            </>
          )}
        </div>
        <div className="flex min-w-0 items-start gap-1 p-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold" title={title}>
              {title}
            </p>
            <p className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted-foreground">{meta}</p>
            {invalid && (
              <p className="mt-0.5 flex items-center gap-1 text-[10px] font-bold text-negative">
                <AlertTriangle className="size-3" /> {invalid}
              </p>
            )}
          </div>
        </div>
        {!readOnly && <div className="flex items-center justify-between border-t border-border px-1 py-0.5">
          <IconBtn label={`Inserir novos itens após o item ${n}`} onClick={() => h.onSetInsertPoint(index + 1)}>
            <Plus />
          </IconBtn>
          {actions}
        </div>}
      </li>
    );
  }

  return (
    <>
      {!readOnly && <InsertGap index={index} active={gapActive} onSet={h.onSetInsertPoint} />}
      <li
        ref={setNodeRef}
        style={style}
        className={cn(
          "relative flex items-center gap-2 rounded-xl border bg-card p-1.5 pr-1 shadow-sm sm:gap-2.5",
          selected ? "border-brand bg-brand/[0.04] ring-1 ring-brand/40" : "border-border",
          focused && "ring-2 ring-brand",
          isDragging && "z-10 shadow-xl",
        )}
      >
        {!readOnly && (
          <>
            <input type="checkbox" checked={selected} onChange={() => h.onToggleCheck(item.id)} className="ml-1 size-4 shrink-0 accent-[var(--brand)]" aria-label={`Marcar item ${n}`} />
            <button
              ref={setActivatorNodeRef}
              type="button"
              className="hidden cursor-grab touch-none rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing md:block"
              aria-label={`Reordenar item ${n}: ${title}`}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-4" />
            </button>
          </>
        )}
        <button type="button" onClick={select} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-label={`Selecionar item ${n}: ${title}`} aria-pressed={selected}>
          <span className="w-7 shrink-0 text-center text-xs font-black text-muted-foreground tabular">{n}</span>
          <ItemThumb item={item} className={cn("w-20 shrink-0 sm:w-24", item.hidden && "opacity-50")} />
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-sm font-bold", item.hidden && "text-muted-foreground line-through decoration-1")}>{title}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
              {meta}
              {item.hidden && (
                <span className="inline-flex items-center gap-0.5 font-bold">
                  <EyeOff className="size-3" aria-hidden /> Oculto
                </span>
              )}
            </span>
            {invalid && (
              <span className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-negative">
                <AlertTriangle className="size-3" aria-hidden /> {invalid}
              </span>
            )}
          </span>
        </button>
        {!readOnly && (
          <div className="flex shrink-0 flex-col md:hidden">
            <IconBtn label={`Mover item ${n} para cima`} onClick={() => h.onMoveBy(item.id, -1)} disabled={index === 0}>
              <ArrowUp />
            </IconBtn>
            <IconBtn label={`Mover item ${n} para baixo`} onClick={() => h.onMoveBy(item.id, 1)} disabled={index === total - 1}>
              <ArrowDown />
            </IconBtn>
          </div>
        )}
        {actions}
        <IconBtn label={`Configurar item ${n}`} onClick={() => h.onOpenSettings(item.id)} className="xl:hidden">
          <Settings2 />
        </IconBtn>
      </li>
    </>
  );
});

function IconBtn({ label, onClick, children, className, disabled }: { label: string; onClick: () => void; children: React.ReactNode; className?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn("grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30 [&_svg]:size-4", className)}
    >
      {children}
    </button>
  );
}
