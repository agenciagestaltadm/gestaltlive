"use client";
import { useRef, useState } from "react";
import { CalendarPlus, Download, FileUp, LayoutTemplate, Trash2 } from "lucide-react";
import { QUESTIONNAIRE_FORMAT } from "@shared/schemas";
import { admin, ApiError } from "@/lib/api";
import { useAction, useApi } from "@/lib/hooks";
import { downloadBlob, fmtDate, fmtInt } from "@/lib/utils";
import { PageHeader } from "@/components/admin/admin-shell";
import { useAdmin } from "@/components/admin/admin-context";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { LoadError } from "@/components/admin/load-error";
import { TemplateEventDialog } from "@/components/admin/template-event-dialog";
import { slugify, type TemplateRow } from "@/components/admin/event-types";
import { Button } from "@/components/ui/button";
import { Badge, Card, Dialog, EmptyState, Skeleton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

export default function TemplatesPage() {
  const { orgId, can } = useAdmin();
  const list = useApi(() => admin.get<TemplateRow[]>(`/templates?orgId=${orgId}`), [orgId]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<{ message: string; details: { path: string; message: string }[] } | null>(null);
  const [createFor, setCreateFor] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<TemplateRow | null>(null);
  const { run, pending } = useAction();
  const canWrite = can("event.write");

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Arquivo muito grande (máximo 5 MB).");
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error("O arquivo não é um JSON válido.");
      }
      await admin.post(`/templates/import?orgId=${orgId}`, data);
      toast.success("Questionário importado como template.");
      void list.reload();
    } catch (e) {
      if (e instanceof ApiError && e.details?.length) setImportErrors({ message: e.message, details: e.details });
      else toast.error(e instanceof Error ? e.message : "Não foi possível importar o arquivo.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const download = async (t: TemplateRow) => {
    const full = await run(`dl:${t.id}`, () => admin.get<{ content: unknown; name: string }>(`/templates/${t.id}`));
    if (!full) return;
    const blob = new Blob([JSON.stringify(full.content, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${slugify(full.name) || "questionario"}.json`);
  };

  const remove = async (t: TemplateRow) => {
    const ok = await run(`del:${t.id}`, () => admin.del(`/templates/${t.id}`), "Template excluído.");
    if (ok) void list.reload();
    return ok !== undefined;
  };

  return (
    <div>
      <PageHeader
        title="Templates"
        description="Modelos reutilizáveis de treinamento: perguntas, cadastro, campos personalizados e configurações."
        actions={
          canWrite && (
            <>
              <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void importFile(e.target.files?.[0])} />
              <Button variant="outline" onClick={() => fileRef.current?.click()} loading={importing}>
                <FileUp /> Importar JSON
              </Button>
            </>
          )
        }
      />
      <p className="mb-5 text-sm text-muted-foreground">
        Para criar um template a partir de um evento existente, use &quot;Salvar como template&quot; no cabeçalho do evento. A importação aceita arquivos no formato{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">{QUESTIONNAIRE_FORMAT}</code> (o mesmo do botão Baixar JSON).
      </p>

      {list.loading && !list.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data?.length ? (
        <EmptyState
          icon={<LayoutTemplate />}
          title="Nenhum template"
          description="Salve um evento como template ou importe um questionário em JSON."
          action={
            canWrite && (
              <Button variant="outline" onClick={() => fileRef.current?.click()} loading={importing}>
                <FileUp /> Importar JSON
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.data.map((t) => (
            <Card key={t.id} className="flex flex-col p-5">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand">
                  <LayoutTemplate className="size-5" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h2 className="line-clamp-2 font-black leading-tight">{t.name}</h2>
                  <p className="text-xs text-muted-foreground">Criado em {fmtDate(t.createdAt)}</p>
                </div>
              </div>
              {t.description && <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{t.description}</p>}
              <div className="mt-3">
                <Badge tone="muted">
                  {fmtInt(t.questionCount)} {t.questionCount === 1 ? "pergunta" : "perguntas"}
                </Badge>
              </div>
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                {canWrite && (
                  <Button size="sm" onClick={() => setCreateFor(t.id)}>
                    <CalendarPlus /> Criar evento
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => void download(t)} loading={pending === `dl:${t.id}`}>
                  <Download /> Baixar JSON
                </Button>
                {canWrite && (
                  <Button size="icon-sm" variant="ghost" onClick={() => setToDelete(t)} aria-label={`Excluir template ${t.name}`} className="ml-auto text-negative">
                    <Trash2 />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <TemplateEventDialog open={!!createFor} onOpenChange={(v) => !v && setCreateFor(null)} templateId={createFor} templateName={list.data?.find((t) => t.id === createFor)?.name} />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Excluir template?"
        description={`"${toDelete?.name ?? ""}" será removido. Eventos já criados a partir dele não são afetados.`}
        confirmLabel="Excluir"
        onConfirm={() => (toDelete ? remove(toDelete) : undefined)}
      />

      <Dialog open={!!importErrors} onOpenChange={(v) => !v && setImportErrors(null)} title="Arquivo de questionário inválido" description={importErrors?.message} footer={<Button onClick={() => setImportErrors(null)}>Fechar</Button>}>
        <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
          {importErrors?.details.map((d, i) => (
            <li key={i} className="rounded-lg bg-muted px-3 py-2">
              {d.path && <code className="mr-2 text-xs text-muted-foreground">{d.path}</code>}
              {d.message}
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
