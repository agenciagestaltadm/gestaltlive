import { cn } from "@/lib/utils";

/** Logo oficial Gestalt (arquivos da identidade visual em /public/brand). */
export function GestaltLogo({ variant = "white", kind = "sublogo", className }: { variant?: "white" | "black"; kind?: "logo" | "sublogo"; className?: string }) {
  const file = `/brand/${kind}-${variant === "white" ? "branco" : "preto"}.png`;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={file} alt="Gestalt Marketing, Tecnologia e Educação" className={cn("h-8 w-auto select-none", className)} draggable={false} />;
}

/** Marca do produto: "Gestalt Live" com destaque fúcsia. */
export function ProductMark({ className, light = true }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 font-display text-xl tracking-wide", light ? "text-white" : "text-navy-900", className)}>
      GESTALT
      <span className="rounded-md bg-brand px-1.5 py-0.5 font-sans text-[0.6em] font-black tracking-widest text-white">LIVE</span>
    </span>
  );
}

/** Logo do evento/organização, com fallback para a marca Gestalt. */
export function EventLogo({ src, className }: { src?: string | null; className?: string }) {
  if (!src) return <GestaltLogo className={className} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Logo do evento" className={cn("h-8 w-auto object-contain", className)} />;
}
