"use client";
/** Miniaturas e ícones dos itens da apresentação (faixa, grade e prévia do próximo item). */
import { useEffect, useRef } from "react";
import { BarChart3, CircleHelp, EyeOff, Gift, Image as ImageIcon, LayoutTemplate, ListChecks, QrCode, ThumbsUp, Trophy, Vote } from "lucide-react";
import { ITEM_TYPE_LABELS, type PresentationItemDTO, type PresentationItemType } from "@shared/presentations";
import { cn } from "@/lib/utils";
import { itemLabel } from "./types";

export const ITEM_ICONS: Record<PresentationItemType, React.ComponentType<{ className?: string }>> = {
  IMAGE_SLIDE: ImageIcon,
  QUESTION: CircleHelp,
  POLL: Vote,
  QUIZ: ListChecks,
  CHART: BarChart3,
  LEADERBOARD: Trophy,
  SATISFACTION: ThumbsUp,
  QR_CODE: QrCode,
  AWARDS: Gift,
  CUSTOM_SCREEN: LayoutTemplate,
};

/** Miniatura do item: imagem do slide (versão "mini") ou ícone do tipo. */
export function ItemThumb({ item, className }: { item: PresentationItemDTO; className?: string }) {
  const Icon = ITEM_ICONS[item.type];
  const isSlide = item.type === "IMAGE_SLIDE" && item.asset;
  const bg = item.type === "CUSTOM_SCREEN" ? (item.settings.background ?? undefined) : undefined;
  return (
    <div className={cn("relative grid aspect-video w-full place-items-center overflow-hidden rounded-lg bg-navy-800", className)} style={bg ? { background: bg } : undefined}>
      {isSlide ? (
        <img src={item.asset!.urls.mini} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" draggable={false} />
      ) : item.type === "CUSTOM_SCREEN" && item.settings.heading ? (
        <span className="line-clamp-2 px-2 text-center text-[11px] font-black leading-tight" style={{ color: item.settings.textColor ?? "#fff" }}>
          {item.settings.heading}
        </span>
      ) : (
        <Icon className="size-7 text-white/70" />
      )}
    </div>
  );
}

/** Faixa horizontal de miniaturas com acesso rápido a qualquer item. */
export function ItemStrip({
  items,
  screenItemId,
  viewItemId,
  onSelect,
  disabled,
}: {
  items: PresentationItemDTO[];
  /** Item realmente no telão (confirmado pelo servidor). */
  screenItemId: string | null;
  /** Item atual no painel (pode estar à frente, enquanto os comandos são enviados). */
  viewItemId: string | null;
  onSelect: (item: PresentationItemDTO) => void;
  disabled?: boolean;
}) {
  const box = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!viewItemId || !box.current) return;
    const el = box.current.querySelector<HTMLElement>(`[data-item="${viewItemId}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [viewItemId]);
  return (
    <ol ref={box} className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]" aria-label="Itens da apresentação">
      {items.map((it, i) => (
        <li key={it.id} data-item={it.id} className="w-36 shrink-0 sm:w-40">
          <ItemButton item={it} index={i} active={it.id === viewItemId} onScreen={it.id === screenItemId} onSelect={onSelect} disabled={disabled} />
        </li>
      ))}
    </ol>
  );
}

export function ItemButton({
  item,
  index,
  active,
  onScreen,
  onSelect,
  disabled,
}: {
  item: PresentationItemDTO;
  index: number;
  active: boolean;
  onScreen: boolean;
  onSelect: (item: PresentationItemDTO) => void;
  disabled?: boolean;
}) {
  const label = itemLabel(item);
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      disabled={disabled}
      aria-current={active ? "step" : undefined}
      aria-label={`Ir para o item ${index + 1}: ${ITEM_TYPE_LABELS[item.type]} — ${label}${item.hidden ? " (oculto)" : ""}${onScreen ? " (no telão)" : ""}`}
      className={cn(
        "group w-full rounded-xl border p-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60",
        active ? "border-brand bg-brand/15 ring-2 ring-brand/60" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.08]",
      )}
    >
      <div className={cn("relative", item.hidden && "opacity-45")}>
        <ItemThumb item={item} />
        <span className="absolute left-1 top-1 rounded-md bg-navy-950/85 px-1.5 py-0.5 text-[10px] font-black tabular text-white">{index + 1}</span>
        {onScreen && <span className="absolute right-1 top-1 rounded-md bg-brand px-1.5 py-0.5 text-[10px] font-black uppercase text-white">No telão</span>}
        {item.hidden && (
          <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 rounded-md bg-navy-950/85 px-1.5 py-0.5 text-[10px] font-bold text-white">
            <EyeOff className="size-3" /> Oculto
          </span>
        )}
      </div>
      <p className="mt-1 truncate px-0.5 text-[10px] font-bold uppercase tracking-wide text-white/50">{ITEM_TYPE_LABELS[item.type]}</p>
      <p className="truncate px-0.5 text-xs font-bold text-white/90">{label}</p>
    </button>
  );
}
