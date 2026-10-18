"use client";
/** Ícones e miniaturas dos itens da linha do tempo (leves: só a variante "mini" das imagens). */
import { memo } from "react";
import { Award, BarChart3, Brain, HelpCircle, ImageIcon, LayoutTemplate, QrCode, ThumbsUp, Trophy, Vote } from "lucide-react";
import { ITEM_TYPE_LABELS, type PresentationItemType } from "@shared/presentations";
import { cn } from "@/lib/utils";
import type { EditorItem } from "./types";

export const ITEM_TYPE_ICONS: Record<PresentationItemType, React.ComponentType<{ className?: string }>> = {
  IMAGE_SLIDE: ImageIcon,
  QUESTION: HelpCircle,
  POLL: Vote,
  QUIZ: Brain,
  CHART: BarChart3,
  LEADERBOARD: Trophy,
  SATISFACTION: ThumbsUp,
  QR_CODE: QrCode,
  AWARDS: Award,
  CUSTOM_SCREEN: LayoutTemplate,
};

/** Cor do cartão de cada tipo (miniatura dos itens sem imagem). */
const TYPE_TONES: Record<PresentationItemType, string> = {
  IMAGE_SLIDE: "from-navy-800 to-navy-950",
  QUESTION: "from-[#3B82F6] to-[#1E3A8A]",
  POLL: "from-[#06B6D4] to-[#0E4F63]",
  QUIZ: "from-brand to-[#7A0032]",
  CHART: "from-[#8B5CF6] to-[#3B1D7A]",
  LEADERBOARD: "from-[#F5B700] to-[#8A5A00]",
  SATISFACTION: "from-[#10B981] to-[#065F46]",
  QR_CODE: "from-navy-700 to-navy-950",
  AWARDS: "from-[#F97316] to-[#7C2D12]",
  CUSTOM_SCREEN: "from-[#475569] to-[#0F172A]",
};

export function ItemTypeIcon({ type, className }: { type: PresentationItemType; className?: string }) {
  const Icon = ITEM_TYPE_ICONS[type];
  return <Icon className={className} aria-hidden />;
}

/** Miniatura 16:9 de um item. */
export const ItemThumb = memo(function ItemThumb({ item, className }: { item: Pick<EditorItem, "type" | "asset" | "settings">; className?: string }) {
  if (item.type === "IMAGE_SLIDE") {
    return (
      <div className={cn("relative aspect-video overflow-hidden rounded-lg bg-black", className)} style={{ background: item.settings.background ?? undefined }}>
        {item.asset ? (
          <img
            src={item.asset.urls.mini}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className={cn("h-full w-full select-none", item.settings.fit === "COVER" ? "object-cover" : item.settings.fit === "FILL" ? "object-fill" : "object-contain")}
          />
        ) : (
          <div className="grid h-full place-items-center text-[10px] font-bold text-white/60">Sem imagem</div>
        )}
      </div>
    );
  }
  if (item.type === "CUSTOM_SCREEN") {
    const bg = item.settings.backgroundImageUrl;
    return (
      <div
        className={cn("relative grid aspect-video place-items-center overflow-hidden rounded-lg px-1 text-center", className)}
        style={{ background: item.settings.background ?? "#0B1736", color: item.settings.textColor ?? "#FFFFFF" }}
      >
        {bg && <img src={bg} alt="" loading="lazy" decoding="async" draggable={false} className="absolute inset-0 h-full w-full object-cover opacity-40" />}
        <span className="relative line-clamp-2 text-[10px] font-black leading-tight">{item.settings.heading || "Tela personalizada"}</span>
      </div>
    );
  }
  return (
    <div className={cn("grid aspect-video place-items-center rounded-lg bg-gradient-to-br text-white", TYPE_TONES[item.type], className)}>
      <div className="flex flex-col items-center gap-0.5">
        <ItemTypeIcon type={item.type} className="size-5" />
        <span className="text-[9px] font-black uppercase tracking-wide opacity-80">{ITEM_TYPE_LABELS[item.type]}</span>
      </div>
    </div>
  );
});
