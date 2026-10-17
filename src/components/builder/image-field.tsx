"use client";
/** Campo de imagem com upload (`admin.upload`) e pré-visualização. */
import { useId, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { admin } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

export function ImageField({
  value,
  onChange,
  orgId,
  disabled,
  compact,
  label = "imagem",
  className,
}: {
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  orgId: string;
  disabled?: boolean;
  /** Versão compacta (botão-ícone), usada nas alternativas. */
  compact?: boolean;
  /** Nome acessível do conteúdo (ex.: "imagem da alternativa A"). */
  label?: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPT.split(",").includes(file.type)) {
      toast.error("Formato não suportado. Envie PNG, JPG, GIF ou WEBP.");
      return;
    }
    setBusy(true);
    try {
      const { url } = await admin.upload(orgId, file);
      onChange(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a imagem.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const fileInput = (
    <input
      ref={input}
      id={id}
      type="file"
      accept={ACCEPT}
      className="sr-only"
      tabIndex={-1}
      disabled={disabled || busy}
      onChange={(e) => void pick(e.target.files?.[0])}
    />
  );

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        {fileInput}
        {value ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="" className="size-10 rounded-lg border border-border object-cover" />
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={disabled}
              className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-negative text-white shadow disabled:opacity-50"
              aria-label={`Remover ${label}`}
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ) : (
          <Button type="button" variant="ghost" size="icon" loading={busy} disabled={disabled} onClick={() => input.current?.click()} aria-label={`Adicionar ${label}`}>
            {!busy && <ImagePlus />}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      {fileInput}
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt={`Pré-visualização da ${label}`} className="h-24 max-w-48 rounded-xl border border-border object-contain" />
      ) : (
        <div className="grid h-24 w-36 place-items-center rounded-xl border border-dashed border-border text-muted-foreground" aria-hidden="true">
          <ImagePlus className="size-6" />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" size="sm" loading={busy} disabled={disabled} onClick={() => input.current?.click()}>
          {!busy && <ImagePlus />}
          {value ? "Trocar imagem" : "Enviar imagem"}
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>
            <Trash2 /> Remover
          </Button>
        )}
        <span className="text-xs text-muted-foreground">PNG, JPG, GIF ou WEBP.</span>
      </div>
    </div>
  );
}
