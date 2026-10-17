"use client";
import { useId, useRef, useState } from "react";
import { ImageIcon, Trash2, Upload } from "lucide-react";
import { admin } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * Campo de imagem: upload (PNG, JPG, GIF ou WEBP) ou URL https.
 * O valor é a URL (`/api/uploads/...` ou `https://...`) ou string vazia.
 */
export function ImageUpload({
  orgId,
  value,
  onChange,
  disabled,
  label = "imagem",
  id,
  invalid,
  previewClassName,
}: {
  orgId: string;
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  label?: string;
  id?: string;
  invalid?: boolean;
  previewClassName?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const autoId = useId();
  const inputId = id ?? autoId;
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { url } = await admin.upload(orgId, file);
      setBroken(false);
      onChange(url);
      toast.success("Imagem enviada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no envio da imagem.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div
        className={cn(
          "grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/50 text-muted-foreground",
          previewClassName,
        )}
      >
        {value && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={`Prévia da ${label}`} className="size-full object-contain" onError={() => setBroken(true)} />
        ) : (
          <ImageIcon className="size-7" aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} loading={busy} disabled={disabled}>
            <Upload /> Enviar {label}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")} disabled={disabled || busy}>
              <Trash2 /> Remover
            </Button>
          )}
        </div>
        <Input
          id={inputId}
          placeholder="ou cole uma URL https://..."
          value={value}
          onChange={(e) => {
            setBroken(false);
            onChange(e.target.value);
          }}
          disabled={disabled}
          aria-invalid={invalid}
          aria-label={`URL da ${label}`}
        />
        <p className="text-xs text-muted-foreground">PNG, JPG, GIF ou WEBP. SVG não é aceito por segurança.</p>
      </div>
    </div>
  );
}
