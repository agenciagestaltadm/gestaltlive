"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/primitives";

/** Diálogo de confirmação para ações irreversíveis (excluir, remover...). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  tone = "negative",
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  tone?: "negative" | "default";
  /** Retorne `false` para manter o diálogo aberto (ex.: erro). */
  onConfirm: () => Promise<unknown> | unknown;
  children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant={tone === "negative" ? "negative" : "default"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await onConfirm();
                if (r !== false) onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
