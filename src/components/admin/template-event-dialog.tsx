"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate } from "lucide-react";
import { admin } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Dialog, EmptyState, Field, Input, NativeSelect, Skeleton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useAdmin } from "./admin-context";
import { LoadError } from "./load-error";
import { localInputToIso, type TemplateRow } from "./event-types";

/** Cria um evento a partir de um template (perguntas, cadastro, campos e configurações são copiados). */
export function TemplateEventDialog({
  open,
  onOpenChange,
  templateId,
  templateName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Template pré-selecionado (ex.: tela de templates). Sem ele, o diálogo lista os templates. */
  templateId?: string | null;
  /** Nome do template pré-selecionado (sugerido como título). */
  templateName?: string;
}) {
  const { orgId } = useAdmin();
  const router = useRouter();
  const list = useApi(open && !templateId ? () => admin.get<TemplateRow[]>(`/templates?orgId=${orgId}`) : null, [open, templateId, orgId]);
  const [selected, setSelected] = useState("");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(templateId ?? "");
      setTitle(templateName ?? "");
      setStartsAt("");
      setError(null);
    }
  }, [open, templateId, templateName]);

  useEffect(() => {
    if (!templateId && !selected && list.data?.length) setSelected(list.data[0].id);
  }, [list.data, selected, templateId]);

  useEffect(() => {
    if (!title && list.data && selected) {
      const t = list.data.find((x) => x.id === selected);
      if (t) setTitle(t.name);
    }
    // sugere o nome do template apenas quando o título ainda está vazio
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, list.data]);

  const submit = async () => {
    const id = templateId ?? selected;
    if (!id) return setError("Selecione um template.");
    if (!title.trim()) return setError("Informe o título do novo evento.");
    setBusy(true);
    setError(null);
    try {
      const ev = await admin.post<{ id: string }>(`/templates/${id}/create-event`, { title: title.trim(), startsAt: localInputToIso(startsAt) });
      toast.success("Evento criado a partir do template.");
      onOpenChange(false);
      router.push(`/admin/eventos/${ev.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível criar o evento.");
    } finally {
      setBusy(false);
    }
  };

  const noTemplates = !templateId && list.data && list.data.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title="Criar evento a partir de template"
      description="Perguntas, configuração de cadastro, campos personalizados e configurações do template são copiados para o novo evento."
      footer={
        !noTemplates && (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={busy} disabled={!templateId && !list.data}>
              Criar evento
            </Button>
          </>
        )
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {!templateId && (
          <>
            {list.loading && <Skeleton className="h-11" />}
            {list.error && <LoadError error={list.error} onRetry={list.reload} />}
            {noTemplates && (
              <EmptyState
                icon={<LayoutTemplate />}
                title="Nenhum template ainda"
                description="Salve um evento como template ou importe um questionário em Templates."
                action={
                  <Button variant="outline" size="sm" onClick={() => router.push("/admin/templates")}>
                    Ir para Templates
                  </Button>
                }
              />
            )}
            {list.data && list.data.length > 0 && (
              <Field label="Template" htmlFor="tpl-select" required>
                <NativeSelect id="tpl-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
                  {list.data.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.questionCount} {t.questionCount === 1 ? "pergunta" : "perguntas"})
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </>
        )}
        {!noTemplates && (
          <>
            <Field label="Título do novo evento" htmlFor="tpl-title" required>
              <Input id="tpl-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} autoFocus />
            </Field>
            <Field label="Data e hora (opcional)" htmlFor="tpl-starts">
              <Input id="tpl-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </Field>
          </>
        )}
        {error && (
          <p className="rounded-xl bg-negative/10 px-3 py-2 text-sm font-bold text-negative" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}
