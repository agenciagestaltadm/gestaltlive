"use client";
/**
 * Construtor de perguntas do evento: lista ordenável (arrastar e soltar), ações por pergunta,
 * nova pergunta, banco de questões e importação/exportação do questionário.
 */
import { useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BookmarkPlus, CircleCheck, CircleDashed, Copy, EllipsisVertical, FileDown, FileUp, GripVertical, Library, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { isScoredType, type QuestionType } from "@shared/schemas";
import { admin, ApiError } from "@/lib/api";
import { useAction, useApi } from "@/lib/hooks";
import { cn, fmtInt } from "@/lib/utils";
import { useAdmin } from "@/components/admin/admin-context";
import { useEventData } from "@/components/admin/event-context";
import { parseSettings } from "@/components/admin/event-types";
import { LoadError } from "@/components/admin/load-error";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge, Dialog, EmptyState, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton } from "@/components/ui/primitives";
import { QuestionEditor } from "@/components/builder/question-editor";
import { TypeBadge, TypePickerDialog } from "@/components/builder/question-types";
import { LockedBadge, QuestionMeta, StatusBadge } from "@/components/builder/question-meta";
import { BankPickerDialog } from "@/components/builder/bank-picker";
import type { QuestionRow } from "@/components/builder/types";

interface EditorState {
  open: boolean;
  question: QuestionRow | null;
  type?: QuestionType;
}

const FIELD_LABELS: Record<string, string> = {
  title: "enunciado",
  description: "descrição",
  type: "tipo",
  options: "alternativas",
  label: "texto",
  minSelections: "mínimo de seleções",
  maxSelections: "máximo de seleções",
  scaleMin: "mínimo da escala",
  scaleMax: "máximo da escala",
  scoring: "pontuação",
  timeLimitSec: "tempo limite",
  chart: "gráfico",
  wordCloud: "nuvem de palavras",
  mode: "modo",
  maxWords: "máximo de palavras",
  maxEntries: "máximo de envios",
  maxChars: "limite de caracteres",
  blockedWords: "palavras bloqueadas",
  synonyms: "sinônimos",
  canonical: "termo canônico",
  variants: "variações",
  maxTerms: "máximo de termos",
  format: "formato",
  version: "versão",
  name: "nome",
  questions: "perguntas",
};

/** "questions.3.options.0.label" → "Pergunta 4 › alternativas › 1 › texto" */
function humanPath(path: string) {
  if (!path) return "Arquivo";
  const parts = path.split(".");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "questions" && /^\d+$/.test(parts[i + 1] ?? "")) {
      out.push(`Pergunta ${Number(parts[i + 1]) + 1}`);
      i++;
    } else if (/^\d+$/.test(p)) out.push(String(Number(p) + 1));
    else out.push(FIELD_LABELS[p] ?? p);
  }
  return out.join(" › ");
}

export default function QuestionsPage() {
  const { id } = useParams<{ id: string }>();
  const { orgId: ctxOrgId, can } = useAdmin();
  const { event, reload: reloadEvent } = useEventData();
  const orgId = event?.orgId ?? ctxOrgId;
  const canWrite = can("event.write");
  const defaultResultsMode = useMemo(() => parseSettings(event?.settings).defaultResultsMode, [event?.settings]);

  const list = useApi(() => admin.get<QuestionRow[]>(`/events/${id}/questions`), [id]);
  const questions = list.data ?? [];
  const { pending, run } = useAction();

  const [editor, setEditor] = useState<EditorState>({ open: false, question: null });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [toDelete, setToDelete] = useState<QuestionRow | null>(null);
  const [importErrors, setImportErrors] = useState<{ message: string; details: { path: string; message: string }[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    await list.reload();
    void reloadEvent();
  };

  /* ---------------------------------------------------------------- arrastar e soltar */
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const titleOf = (uid: UniqueIdentifier) => questions.find((q) => q.id === uid)?.title ?? "";
  const posOf = (uid: UniqueIdentifier) => questions.findIndex((q) => q.id === uid) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Pergunta “${titleOf(active.id)}” selecionada, na posição ${posOf(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `Pergunta “${titleOf(active.id)}” sobre a posição ${posOf(over.id)}.` : `Pergunta “${titleOf(active.id)}” fora da lista.`),
    onDragEnd: ({ active, over }) => (over ? `Pergunta “${titleOf(active.id)}” movida para a posição ${posOf(over.id)}.` : "Movimento cancelado."),
    onDragCancel: ({ active }) => `Movimento cancelado. A pergunta “${titleOf(active.id)}” voltou à posição original.`,
  };

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || !list.data) return;
    const prev = list.data;
    const from = prev.findIndex((q) => q.id === active.id);
    const to = prev.findIndex((q) => q.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(prev, from, to).map((q, i) => ({ ...q, position: i }));
    list.setData(next);
    try {
      await admin.put(`/events/${id}/questions/order`, { ids: next.map((q) => q.id) });
    } catch (e) {
      list.setData(prev);
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar a nova ordem.");
    }
  };

  /* ---------------------------------------------------------------- ações */
  const duplicate = async (q: QuestionRow, openCopy = false) => {
    const copy = await run(`dup:${q.id}`, () => admin.post<{ id: string }>(`/questions/${q.id}/duplicate`), "Pergunta duplicada logo abaixo da original.");
    if (!copy) return;
    const fresh = await list.reload();
    void reloadEvent();
    if (openCopy) {
      const row = fresh?.find((x) => x.id === copy.id);
      if (row) setEditor({ open: true, question: row });
    }
  };
  const saveToBank = (q: QuestionRow) => run(`bank:${q.id}`, () => admin.post(`/questions/${q.id}/bank`), "Cópia salva no banco de questões da organização.");
  const setStatus = async (q: QuestionRow, status: QuestionRow["status"]) => {
    const ok = await run(`st:${q.id}`, () => admin.post(`/questions/${q.id}/status`, { status }), status === "PRONTA" ? "Pergunta marcada como pronta." : "Pergunta marcada como rascunho.");
    if (ok) list.setData((list.data ?? []).map((x) => (x.id === q.id ? { ...x, status } : x)));
  };
  const remove = async (q: QuestionRow) => {
    try {
      await admin.del(`/questions/${q.id}`);
      toast.success("Pergunta excluída.");
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "PERGUNTA_BLOQUEADA") {
        toast.error("Esta pergunta já recebeu respostas e não pode ser excluída. Marque-a como rascunho para retirá-la das próximas sessões.");
        await list.reload();
        return;
      } else {
        toast.error(e instanceof Error ? e.message : "Não foi possível excluir a pergunta.");
      }
      return false;
    }
  };

  /* ---------------------------------------------------------------- importação/exportação */
  const exportFile = () => run("export", () => admin.download(`/events/${id}/questions/export`, "questionario.json"), "Questionário exportado.");

  const importFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast.error("O arquivo selecionado não é um JSON válido.");
      return;
    }
    setImporting(true);
    try {
      const r = await admin.post<{ imported: number }>(`/events/${id}/questions/import`, data);
      toast.success(`${fmtInt(r.imported)} ${r.imported === 1 ? "pergunta importada" : "perguntas importadas"}.`);
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && (e.details?.length || e.status === 400)) {
        setImportErrors({ message: e.message, details: e.details ?? [] });
      } else {
        toast.error(e instanceof Error ? e.message : "Não foi possível importar o arquivo.");
      }
    } finally {
      setImporting(false);
    }
  };

  /* ---------------------------------------------------------------- resumo */
  const ready = questions.filter((q) => q.status === "PRONTA");
  const maxPoints = ready.reduce((acc, q) => {
    if (!q.scoring || !isScoredType(q.type)) return acc;
    const bonus = q.scoring.speedBonusEnabled && q.timeLimitSec ? q.scoring.speedBonusMax : 0;
    return acc + Math.floor((q.scoring.basePoints + bonus) * q.scoring.weight);
  }, 0);

  const openNew = (type: QuestionType) => setEditor({ open: true, question: null, type });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-black tracking-tight">Perguntas</h2>
          <p className="text-sm text-muted-foreground">
            {list.data
              ? `${fmtInt(questions.length)} ${questions.length === 1 ? "pergunta" : "perguntas"} · ${fmtInt(ready.length)} ${ready.length === 1 ? "pronta" : "prontas"}${maxPoints ? ` · até ${fmtInt(maxPoints)} pontos possíveis` : ""}`
              : "Monte o roteiro da dinâmica: arraste para definir a ordem de apresentação."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <>
              <Button onClick={() => setPickerOpen(true)}>
                <Plus /> Nova pergunta
              </Button>
              <Button variant="outline" onClick={() => setBankOpen(true)}>
                <Library /> Adicionar do banco
              </Button>
            </>
          )}
          <Button variant="outline" onClick={() => void exportFile()} loading={pending === "export"} disabled={questions.length === 0}>
            {pending !== "export" && <FileDown />} Exportar
          </Button>
          {canWrite && (
            <>
              <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void importFile(e.target.files?.[0])} />
              <Button variant="outline" onClick={() => fileRef.current?.click()} loading={importing}>
                {!importing && <FileUp />} Importar
              </Button>
            </>
          )}
        </div>
      </div>

      {list.loading && !list.data ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : list.error ? (
        <LoadError error={list.error} onRetry={() => void list.reload()} />
      ) : questions.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title="Nenhuma pergunta ainda"
          description="Crie a primeira pergunta, reutilize uma do banco de questões ou importe um questionário (.json)."
          action={
            canWrite && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setPickerOpen(true)}>
                  <Plus /> Nova pergunta
                </Button>
                <Button variant="outline" onClick={() => setBankOpen(true)}>
                  <Library /> Adicionar do banco
                </Button>
              </div>
            )
          }
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => void onDragEnd(e)}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable: "Para reordenar, pressione Espaço ou Enter para pegar a pergunta, use as setas para mover e pressione Espaço ou Enter novamente para soltar. Esc cancela.",
            },
          }}
        >
          <SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
            <ol className="flex flex-col gap-2" aria-label="Perguntas do evento, na ordem de apresentação">
              {questions.map((q, i) => (
                <SortableQuestion
                  key={q.id}
                  q={q}
                  index={i}
                  canWrite={canWrite}
                  pending={pending}
                  onEdit={() => setEditor({ open: true, question: q })}
                  onDuplicate={() => void duplicate(q)}
                  onBank={() => void saveToBank(q)}
                  onStatus={(s) => void setStatus(q, s)}
                  onDelete={() => setToDelete(q)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      {canWrite && (
        <>
          <TypePickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={openNew} />
          <QuestionEditor
            open={editor.open}
            onOpenChange={(open) => setEditor((s) => ({ ...s, open }))}
            mode="event"
            orgId={orgId}
            eventId={id}
            question={editor.question}
            initialType={editor.type}
            siblings={questions}
            defaultResultsMode={defaultResultsMode}
            onSaved={() => {
              setEditor({ open: false, question: null });
              void refresh();
            }}
            onDuplicate={(q) => {
              setEditor({ open: false, question: null });
              void duplicate(q, true);
            }}
          />
          <BankPickerDialog open={bankOpen} onOpenChange={setBankOpen} orgId={orgId} eventId={id} onAdded={() => void refresh()} />
        </>
      )}

      <ConfirmDialog
        open={!!toDelete && !toDelete.locked}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Excluir pergunta?"
        description={toDelete ? `“${toDelete.title}” será removida do evento. Esta ação não pode ser desfeita.` : undefined}
        confirmLabel="Excluir"
        onConfirm={() => (toDelete ? remove(toDelete) : undefined)}
      />
      <Dialog
        open={!!toDelete && toDelete.locked}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Esta pergunta não pode ser excluída"
        description={
          toDelete
            ? `“${toDelete.title}” já recebeu ${fmtInt(toDelete.answersCount)} ${toDelete.answersCount === 1 ? "resposta" : "respostas"}. Para preservar resultados, rankings e relatórios, perguntas respondidas não são excluídas.`
            : undefined
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Fechar
            </Button>
            {toDelete?.status === "PRONTA" && (
              <Button
                onClick={() => {
                  void setStatus(toDelete, "RASCUNHO");
                  setToDelete(null);
                }}
              >
                Marcar como rascunho
              </Button>
            )}
          </>
        }
      >
        <p className="text-sm text-muted-foreground">Marque-a como rascunho para retirá-la das próximas sessões; os dados já coletados continuam disponíveis.</p>
      </Dialog>

      <Dialog open={!!importErrors} onOpenChange={(v) => !v && setImportErrors(null)} title="Não foi possível importar o questionário" description={importErrors?.message} className="max-w-xl">
        {importErrors && importErrors.details.length > 0 ? (
          <>
            <p className="mb-2 text-sm text-muted-foreground">Nenhuma pergunta foi gravada. Corrija os itens abaixo e tente novamente:</p>
            <ul className="max-h-[50dvh] space-y-1.5 overflow-y-auto rounded-xl bg-muted p-3 text-sm">
              {importErrors.details.map((d, i) => (
                <li key={i}>
                  <span className="font-bold">{humanPath(d.path)}:</span> {d.message}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Verifique se o arquivo foi exportado pelo Gestalt Live (formato “gestalt-live/questionario”, versão 1).</p>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={() => setImportErrors(null)}>
            Entendi
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/* ================================================================== item ordenável */
function SortableQuestion({
  q,
  index,
  canWrite,
  pending,
  onEdit,
  onDuplicate,
  onBank,
  onStatus,
  onDelete,
}: {
  q: QuestionRow;
  index: number;
  canWrite: boolean;
  pending: string | null;
  onEdit: () => void;
  onDuplicate: () => void;
  onBank: () => void;
  onStatus: (s: QuestionRow["status"]) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: q.id, disabled: !canWrite });
  const busy = pending === `dup:${q.id}` || pending === `bank:${q.id}` || pending === `st:${q.id}`;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-start gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4",
        q.status === "RASCUNHO" && "border-dashed",
        isDragging && "relative z-10 shadow-xl ring-2 ring-brand/40",
      )}
    >
      {canWrite && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="mt-1 cursor-grab touch-none rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
          aria-label={`Reordenar pergunta ${index + 1}: ${q.title}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-5" />
        </button>
      )}
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-navy-900 text-sm font-black text-white tabular" aria-label={`Pergunta ${index + 1}`}>
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <TypeBadge type={q.type} />
          <StatusBadge status={q.status} />
          <LockedBadge q={q} />
          {q.required && <Badge tone="outline">Obrigatória</Badge>}
          {q.category && <span className="text-xs font-bold text-muted-foreground">{q.category}</span>}
        </div>
        <button type="button" onClick={canWrite ? onEdit : undefined} disabled={!canWrite} className="text-left font-bold leading-snug hover:text-brand disabled:hover:text-foreground">
          {q.title}
        </button>
        <QuestionMeta q={q} className="mt-1.5" />
      </div>
      {canWrite && (
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Editar pergunta ${index + 1}`} className="hidden sm:inline-flex">
            <Pencil />
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Mais ações da pergunta ${index + 1}`} loading={busy}>
                {!busy && <EllipsisVertical />}
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={onEdit}>
                <Pencil /> Editar
              </MenuItem>
              <MenuItem onSelect={onDuplicate}>
                <Copy /> Duplicar
              </MenuItem>
              <MenuItem onSelect={onBank}>
                <BookmarkPlus /> Salvar no banco
              </MenuItem>
              {q.status === "PRONTA" ? (
                <MenuItem onSelect={() => onStatus("RASCUNHO")}>
                  <CircleDashed /> Marcar como rascunho
                </MenuItem>
              ) : (
                <MenuItem onSelect={() => onStatus("PRONTA")}>
                  <CircleCheck /> Marcar como pronta
                </MenuItem>
              )}
              <MenuItem onSelect={onDelete} className="text-negative">
                <Trash2 /> Excluir
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      )}
    </li>
  );
}
