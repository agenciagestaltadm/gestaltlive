"use client";
/** Prévia de um item da linha do tempo com o renderizador real do telão (dados demonstrativos). */
import { memo, useMemo } from "react";
import { ScreenView } from "@/components/screen/screen-view";
import { cn } from "@/lib/utils";
import { useDemoQr } from "./demo-qr";
import { buildRehearsalState, type QuestionSim, type RehearsalSource } from "./rehearsal-state";

export const ItemPreview = memo(function ItemPreview({
  source,
  index,
  sim,
  answered,
  variant = "mini",
  className,
  label,
}: {
  source: RehearsalSource;
  index: number;
  sim?: QuestionSim | null;
  answered?: number;
  variant?: "mini" | "tela";
  className?: string;
  label?: string;
}) {
  const demoQr = useDemoQr();
  const state = useMemo(() => buildRehearsalState(source, index, sim ?? null, { imageVariant: variant }), [source, index, sim, variant]);
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-black", className)} role="img" aria-label={label ?? "Prévia do telão"}>
      <ScreenView qrUrl={demoQr} state={state} answered={answered ?? state.counts.answered} preview className="aspect-video" />
    </div>
  );
});
