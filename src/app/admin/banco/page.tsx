"use client";
/** Banco de questões da organização: perguntas reutilizáveis entre eventos. */
import { useState } from "react";
import { Copy, EllipsisVertical, Library, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { isOptionType, type QuestionType } from "@shared/schemas";
import { admin } from "@/lib/api";
import { useAction, useApi } from "@/lib/hooks";
import { fmtDate, fmtInt } from "@/lib/utils";
import { useAdmin } from "@/components/admin/admin-context";
import { PageHeader } from "@/components/admin/admin-shell";
import { LoadError } from "@/components/admin/load-error";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton } from "@/components/ui/primitives";
import { QuestionEditor } from "@/components/builder/question-editor";
import { TypeBadge, TypePickerDialog } from "@/components/builder/question-types";
import { QuestionMeta } from "@/components/builder/question-meta";
import { QuestionFilters, useQuestionFilter } from "@/components/builder/bank-picker";
import type { QuestionRow } from "@/components/builder/types";

export default function BankPage() {
  const { orgId, org, can } = useAdmin();
  const canWrite = can("event.write");
  const bank = useApi(() => admin.get<QuestionRow[]>(`/bank?orgId=${orgId}`), [orgId]);
  const { filter, setFilter, filtered, categories } = useQuestionFilter(bank.data);
  const { pending, run } = useAction();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [editor, setEditor] = useState<{ open: boolean; question: QuestionRow | null; type?: QuestionType }>({ open: false, question: null });
  const [toDelete, setToDelete] = useState<QuestionRow | null>(null);

  const total = bank.data?.length ?? 0;
  const filtering = !!(filter.search || filter.type || filter.category);

  const duplicate = async (q: QuestionRow) => {
    const r = await run(`dup:${q.id}`, () => admin.post(`/questions/${q.id}/duplicate`), "Pergunta duplicada no banco.");
    if (r) void bank.reload();
  };
  const remove = async (q: QuestionRow) => {
    const r = await run(`del:${q.id}`, () => admin.del(`/questions/${q.id}`), "Pergunta removida do banco.");
    if (r === undefined) return false;
    void bank.reload();
  };

  return (
    <div>
      <PageHeader
        title="Banco de questões"
        description={`Perguntas reutilizáveis de ${org.name}. Ao usar em um evento, uma cópia independente é criada.`}
        actions={
          canWrite && (
            <Button onClick={() => setPickerOpen(true)}>
              <Plus /> Nova pergunta
            </Button>
          )
        }
      />

      <div className="flex flex-col gap-4">
        <QuestionFilters filter={filter} setFilter={setFilter} categories={categories} />
        {bank.data && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {filtering ? `${fmtInt(filtered.length)} de ${fmtInt(total)} perguntas` : `${fmtInt(total)} ${total === 1 ? "pergunta" : "perguntas"} no banco`}
          </p>
        )}

        {bank.loading && !bank.data ? (
          <div className="grid gap-3 md:grid-cols-2" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        ) : bank.error ? (
          <LoadError error={bank.error} onRetry={() => void bank.reload()} />
        ) : total === 0 ? (
          <EmptyState
            icon={<Library />}
            title="O banco de questões está vazio"
            description="Crie perguntas aqui ou use “Salvar no banco” no construtor de um evento para reaproveitá-las depois."
            action={
              canWrite && (
                <Button onClick={() => setPickerOpen(true)}>
                  <Plus /> Nova pergunta
                </Button>
              )
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title="Nenhuma pergunta encontrada"
            description="Ajuste a busca ou os filtros."
            action={
              <Button variant="outline" onClick={() => setFilter({ search: "", type: "", category: "" })}>
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {filtered.map((q) => {
              const busy = pending === `dup:${q.id}` || pending === `del:${q.id}`;
              return (
                <li key={q.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <TypeBadge type={q.type} />
                      {q.category && <span className="text-xs font-bold text-muted-foreground">{q.category}</span>}
                    </div>
                    {canWrite && (
                      <Menu>
                        <MenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Ações da pergunta “${q.title}”`} loading={busy}>
                            {!busy && <EllipsisVertical />}
                          </Button>
                        </MenuTrigger>
                        <MenuContent>
                          <MenuItem onSelect={() => setEditor({ open: true, question: q })}>
                            <Pencil /> Editar
                          </MenuItem>
                          <MenuItem onSelect={() => void duplicate(q)}>
                            <Copy /> Duplicar
                          </MenuItem>
                          <MenuItem onSelect={() => setToDelete(q)} className="text-negative">
                            <Trash2 /> Excluir
                          </MenuItem>
                        </MenuContent>
                      </Menu>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!canWrite}
                    onClick={() => setEditor({ open: true, question: q })}
                    className="text-left font-bold leading-snug hover:text-brand disabled:hover:text-foreground"
                  >
                    {q.title}
                  </button>
                  {isOptionType(q.type) && q.options.length > 0 && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {q.options.map((o, i) => (
                        <span key={o.id}>
                          {i > 0 && " · "}
                          <span className={o.isCorrect ? "font-bold text-positive" : undefined}>
                            {o.label}
                            {o.isCorrect && <span className="sr-only"> (correta)</span>}
                          </span>
                        </span>
                      ))}
                    </p>
                  )}
                  <QuestionMeta q={q} />
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
                    <div className="flex flex-wrap gap-1">
                      {q.tags.map((t) => (
                        <span key={t} className="rounded-full bg-muted px-2 py-0.5 font-bold">
                          #{t}
                        </span>
                      ))}
                    </div>
                    <span>Atualizada em {fmtDate(q.updatedAt)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {canWrite && (
        <>
          <TypePickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={(type) => setEditor({ open: true, question: null, type })} />
          <QuestionEditor
            open={editor.open}
            onOpenChange={(open) => setEditor((s) => ({ ...s, open }))}
            mode="bank"
            orgId={orgId}
            question={editor.question}
            initialType={editor.type}
            siblings={bank.data ?? []}
            onSaved={() => {
              setEditor({ open: false, question: null });
              void bank.reload();
            }}
          />
          <ConfirmDialog
            open={!!toDelete}
            onOpenChange={(v) => !v && setToDelete(null)}
            title="Excluir pergunta do banco?"
            description={toDelete ? `“${toDelete.title}” será removida do banco. Perguntas já copiadas para eventos não são afetadas.` : undefined}
            confirmLabel="Excluir"
            onConfirm={() => (toDelete ? remove(toDelete) : undefined)}
          />
        </>
      )}
    </div>
  );
}
