"use client";
/** Notificações discretas (sem dependências externas). Uso: toast.success("Salvo"). */
import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Kind = "success" | "error" | "info";
interface Item {
  id: number;
  kind: Kind;
  message: string;
}

let listeners: ((items: Item[]) => void)[] = [];
let items: Item[] = [];
let seq = 0;

function push(kind: Kind, message: string, ms = 3500) {
  const it = { id: ++seq, kind, message };
  items = [...items.slice(-3), it];
  listeners.forEach((l) => l(items));
  setTimeout(() => {
    items = items.filter((x) => x.id !== it.id);
    listeners.forEach((l) => l(items));
  }, ms);
}

export const toast = {
  success: (m: string) => push("success", m),
  error: (m: string) => push("error", m, 5000),
  info: (m: string) => push("info", m),
};

export function Toaster() {
  const [list, setList] = useState<Item[]>([]);
  useEffect(() => {
    listeners.push(setList);
    return () => {
      listeners = listeners.filter((l) => l !== setList);
    };
  }, []);
  const icons = { success: CheckCircle2, error: AlertTriangle, info: Info };
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {list.map((t) => {
        const Icon = icons[t.kind];
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex w-full max-w-md animate-rise items-start gap-3 rounded-xl border px-4 py-3 text-sm font-bold shadow-xl",
              t.kind === "success" && "border-positive/40 bg-[#0d2a1c] text-white",
              t.kind === "error" && "border-negative/40 bg-[#2a0d14] text-white",
              t.kind === "info" && "border-navy-600 bg-navy-900 text-white",
            )}
            role={t.kind === "error" ? "alert" : "status"}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", t.kind === "success" && "text-positive", t.kind === "error" && "text-negative", t.kind === "info" && "text-brand")} />
            <span className="flex-1">{t.message}</span>
            <button
              className="opacity-60 hover:opacity-100"
              aria-label="Fechar"
              onClick={() => {
                items = items.filter((x) => x.id !== t.id);
                listeners.forEach((l) => l(items));
              }}
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
