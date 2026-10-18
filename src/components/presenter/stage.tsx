"use client";
/** Prévia do telão (o que o público vê agora) e prévia do próximo item. */
import { AlertTriangle, Coffee, MonitorOff, RefreshCw } from "lucide-react";
import type { ControlQuestionDTO, ScreenStateDTO } from "@shared/types";
import { ITEM_TYPE_LABELS, OPENS_QUESTION, OPEN_MODE_LABELS, type PresentationItemDTO, type PresentationSettings } from "@shared/presentations";
import { SQ_STATE_LABELS } from "@shared/schemas";
import { ScreenView, SlideScreen } from "@/components/screen/screen-view";
import { Button } from "@/components/ui/button";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { ITEM_ICONS } from "./item-visual";
import { itemLabel, slideFromItem } from "./types";

export function LivePreview({ screen, answered, error, onRetry, className }: { screen: ScreenStateDTO | null; answered: number | null; error: string | null; onRetry: () => void; className?: string }) {
  const override = screen?.presenter?.override ?? "NENHUM";
  return (
    <figure className={cn("relative", className)} aria-label="Prévia do telão">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/40">
        {screen ? (
          <ScreenView state={screen} answered={answered} preview className="h-full" />
        ) : error ? (
          <div className="grid h-full place-items-center p-6 text-center">
            <div>
              <AlertTriangle className="mx-auto size-8 text-warning" />
              <p className="mt-2 text-sm font-bold">{error}</p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
                <RefreshCw /> Tentar novamente
              </Button>
            </div>
          </div>
        ) : (
          <Skeleton className="h-full w-full rounded-none bg-white/5" />
        )}
      </div>
      <figcaption className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-navy-950/85 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-white shadow">
          <span className="size-2 animate-pulse rounded-full bg-brand" aria-hidden /> No telão agora
        </span>
        {override === "TELA_PRETA" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-black uppercase text-navy-950">
            <MonitorOff className="size-3.5" /> Tela preta
          </span>
        )}
        {override === "PAUSA" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning px-2.5 py-1 text-[11px] font-black uppercase text-navy-950">
            <Coffee className="size-3.5" /> Pausa
          </span>
        )}
        {error && screen && <span className="rounded-full bg-warning px-2.5 py-1 text-[11px] font-black text-navy-950">prévia desatualizada</span>}
      </figcaption>
    </figure>
  );
}

/** Prévia do próximo item: slides são renderizados como no telão; itens interativos, como cartão. */
export function NextPreview({ item, index, settings, question }: { item: PresentationItemDTO | null; index: number | null; settings: PresentationSettings; question: ControlQuestionDTO | null }) {
  if (!item || index === null) {
    return (
      <div className="grid aspect-video w-full place-items-center rounded-xl border border-dashed border-white/15 text-center text-sm text-white/50">
        <p className="px-4">Fim da apresentação — não há próximo item.</p>
      </div>
    );
  }
  const slide = slideFromItem(item, settings);
  const Icon = ITEM_ICONS[item.type];
  return (
    <div>
      {slide ? (
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black [container-type:size]">
          <SlideScreen slide={slide} preview />
        </div>
      ) : (
        <div className="flex aspect-video w-full flex-col justify-center gap-2 rounded-xl border border-white/10 bg-gradient-to-br from-navy-800 to-navy-900 p-4">
          <div className="flex items-center gap-2 text-brand">
            <Icon className="size-5" />
            <span className="text-xs font-black uppercase tracking-wider">{ITEM_TYPE_LABELS[item.type]}</span>
          </div>
          <p className="line-clamp-3 text-base font-black leading-snug">{itemLabel(item)}</p>
          {OPENS_QUESTION.includes(item.type) && (
            <p className="text-xs text-white/60">{OPEN_MODE_LABELS[item.settings.openMode]}</p>
          )}
          {question && (
            <div>
              <Badge tone={question.state === "ABERTA" ? "brand" : "muted"}>{SQ_STATE_LABELS[question.state]}</Badge>
            </div>
          )}
          {!question && item.questionId && <p className="text-xs text-warning">Pergunta indisponível nesta sessão (rascunho ou removida).</p>}
        </div>
      )}
      <p className="mt-1.5 truncate text-xs text-white/60">
        <span className="font-black tabular text-white/80">{index + 1}.</span> {ITEM_TYPE_LABELS[item.type]} · {itemLabel(item)}
        {item.hidden && " · oculto"}
      </p>
    </div>
  );
}
