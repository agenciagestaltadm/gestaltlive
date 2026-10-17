"use client";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Estado de erro de carregamento com botão "Tentar novamente". */
export function LoadError({ error, onRetry, className }: { error: Error | null | undefined; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border border-negative/30 bg-negative/5 p-8 text-center", className)}>
      <AlertTriangle className="size-8 text-negative" aria-hidden />
      <div>
        <p className="font-black">Não foi possível carregar os dados.</p>
        {error?.message && <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw /> Tentar novamente
        </Button>
      )}
    </div>
  );
}
