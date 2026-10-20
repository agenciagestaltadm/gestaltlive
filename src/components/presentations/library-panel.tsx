"use client";
/**
 * Biblioteca do editor (coluna esquerda): slides (envio em lote + biblioteca da organização),
 * perguntas do evento vinculado e telas interativas.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  CloudUpload,
  EllipsisVertical,
  FolderInput,
  ImageIcon,
  Link2,
  Loader2,
  Plus,
  Recycle,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { ITEM_TYPE_LABELS, type AssetDTO, type PresentationItemType } from "@shared/presentations";
import { isScoredType, isTextType, type QuestionType, type ResultsMode } from "@shared/schemas";
import { admin, ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn, fmtDate, fmtInt } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge, Dialog, EmptyState, Field, Input, Menu, MenuContent, MenuItem, MenuTrigger, NativeSelect, Progress, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { QuestionEditor } from "@/components/builder/question-editor";
import { TypeBadge, TypePickerDialog } from "@/components/builder/question-types";
import type { QuestionRow } from "@/components/builder/types";
import { ItemTypeIcon } from "./item-visual";
import { fmtBytes, newItem, questionItem, suggestedQuestionItemType, type AssetListResponse, type EditorItem } from "./types";
import { useUploadQueue, type UploadEntry } from "./use-upload-queue";

export type InsertMode = "end" | "after";

export interface LibraryPanelProps {
  orgId: string;
  eventId: string | null;
  items: EditorItem[];
  questions: { data: QuestionRow[] | null; loading: boolean; error: Error | null; reload: () => Promise<unknown> };
  defaultResultsMode?: ResultsMode;
  readOnly: boolean;
  insertMode: InsertMode;
  onInsertModeChange: (m: InsertMode) => void;
  /** Posição marcada pelo botão "+" da linha do tempo (1-based para exibição) ou nulo. */
  insertPointLabel: string | null;
  onClearInsertPoint: () => void;
  hasSelection: boolean;
  onInsertItems: (items: EditorItem[]) => void;
  /** Insere slides da biblioteca pelo servidor (ordem natural do nome). */
  /** `order: "pedida"` mantém a ordem de seleção; o padrão ("natural") ordena pelo nome do arquivo. */
  onInsertAssets: (assetIds: string[], order?: "natural" | "pedida") => Promise<boolean>;
  onLinkEvent: () => void;
  tab: string;
  onTabChange: (t: string) => void;
}

export function LibraryPanel(p: LibraryPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!p.readOnly && <InsertTarget {...p} />}
      <Tabs value={p.tab} onValueChange={p.onTabChange} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mb-3 grid w-full grid-cols-3" aria-label="Biblioteca">
          <TabsTrigger value="slides" className="justify-center">
            Slides
          </TabsTrigger>
          <TabsTrigger value="perguntas" className="justify-center">
            Perguntas
          </TabsTrigger>
          <TabsTrigger value="interativos" className="justify-center">
            Interativos
          </TabsTrigger>
        </TabsList>
        <TabsContent value="slides" className="min-h-0 flex-1 outline-none">
          <SlidesTab {...p} />
        </TabsContent>
        <TabsContent value="perguntas" className="min-h-0 flex-1 outline-none">
          <QuestionsTab {...p} />
        </TabsContent>
        <TabsContent value="interativos" className="min-h-0 flex-1 outline-none">
          <InteractiveTab {...p} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InsertTarget({ insertMode, onInsertModeChange, insertPointLabel, onClearInsertPoint, hasSelection }: LibraryPanelProps) {
  const id = useId();
  if (insertPointLabel) {
    return (
      <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2 text-sm">
        <span className="font-bold text-brand">Inserindo {insertPointLabel}</span>
        <Button variant="ghost" size="icon-sm" onClick={onClearInsertPoint} aria-label="Cancelar posição marcada">
          <X />
        </Button>
      </div>
    );
  }
  return (
    <div className="mb-3 flex items-center gap-2">
      <label htmlFor={id} className="shrink-0 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Inserir
      </label>
      <NativeSelect id={id} value={insertMode} onChange={(e) => onInsertModeChange(e.target.value as InsertMode)} className="h-9 text-sm">
        <option value="end">No fim da linha do tempo</option>
        <option value="after" disabled={!hasSelection}>
          Após o item selecionado
        </option>
      </NativeSelect>
    </div>
  );
}

/* ================================================================== slides */
const STATUS_LABEL: Record<UploadEntry["status"], string> = { fila: "Na fila", enviando: "Enviando", ok: "Enviado", reaproveitado: "Reaproveitado", erro: "Erro" };

function SlidesTab({ orgId, readOnly, onInsertAssets }: LibraryPanelProps) {
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [folder, setFolder] = useState("");
  const [pages, setPages] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOf, setMoveOf] = useState<AssetDTO | null>(null);
  const [deleteOf, setDeleteOf] = useState<AssetDTO | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [inserting, setInserting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPages(1), [qDebounced, folder]);

  const pageSize = Math.min(500, 60 * pages);
  const lib = useApi(
    () => admin.get<AssetListResponse>(`/assets?orgId=${orgId}&pageSize=${pageSize}${qDebounced ? `&q=${encodeURIComponent(qDebounced)}` : ""}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`),
    [orgId, qDebounced, folder, pageSize],
  );
  const reloadLib = lib.reload;

  const upload = useUploadQueue({
    orgId,
    folder: folder || null,
    onIdle: async (done) => {
      const ids = [...new Set(done.map((d) => d.asset!.id))];
      void reloadLib();
      return onInsertAssets(ids);
    },
  });

  const onFiles = (list: FileList | File[] | null) => {
    if (!list || readOnly) return;
    const files = Array.from(list);
    if (!files.length) return;
    upload.add(files);
  };

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const insertSelected = async (ids: string[]) => {
    if (!ids.length) return;
    setInserting(true);
    const ok = await onInsertAssets(ids, "pedida");
    setInserting(false);
    if (ok) {
      setSelected(new Set());
      void reloadLib();
    }
  };

  const s = upload.summary;
  const rows = lib.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-3">
      {!readOnly && (
        <>
          <div
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              onFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-4 text-center transition",
              dragOver ? "border-brand bg-brand/10" : "border-border bg-muted/40",
            )}
          >
            <CloudUpload className="size-8 text-brand" aria-hidden />
            <p className="text-sm font-bold">Arraste os slides aqui</p>
            <p className="text-xs text-muted-foreground">JPG ou PNG exportados do Canva · até 20 MB cada · envie centenas de uma vez</p>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/png,image/jpeg"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                onFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              <CloudUpload /> Enviar slides
            </Button>
            {folder && <p className="text-xs text-muted-foreground">Os arquivos irão para a pasta “{folder}”.</p>}
          </div>

          {upload.entries.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-3" aria-live="polite">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-xs font-bold">
                <span>
                  {s.busy ? "Enviando" : "Envio concluído"} · {fmtInt(s.ok + s.reused)} de {fmtInt(upload.entries.length)}
                  {s.failed > 0 && <span className="text-negative"> · {fmtInt(s.failed)} com erro</span>}
                </span>
                <span className="tabular">{Math.round(s.pct)}%</span>
              </div>
              <Progress value={s.pct} tone={s.failed && !s.busy ? "negative" : "brand"} />
              {upload.inserting && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-brand">
                  <Loader2 className="size-3.5 animate-spin" /> Inserindo slides na linha do tempo…
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.retryable > 0 && !s.busy && (
                  <Button size="sm" variant="outline" onClick={() => upload.retry()}>
                    <RotateCcw /> Tentar novamente ({fmtInt(s.retryable)})
                  </Button>
                )}
                {s.pendingInsert > 0 && !s.busy && !upload.inserting && (
                  <Button size="sm" variant="outline" onClick={() => void upload.insertPending()}>
                    <Plus /> Inserir {fmtInt(s.pendingInsert)} na linha do tempo
                  </Button>
                )}
                {s.busy ? (
                  <Button size="sm" variant="ghost" onClick={upload.cancelAll}>
                    Cancelar envio
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={upload.clearFinished}>
                    Limpar lista
                  </Button>
                )}
              </div>
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1" aria-label="Arquivos do envio">
                {upload.entries.map((e) => (
                  <UploadRow key={e.key} e={e} onRetry={() => upload.retry(e.key)} onDismiss={() => upload.dismiss(e.key)} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <h3 className="text-sm font-black">Biblioteca da organização</h3>
        {lib.data && <span className="text-xs text-muted-foreground">{fmtInt(lib.data.total)} arquivos</span>}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar arquivo" aria-label="Buscar na biblioteca" className="h-9 pl-8 text-sm" />
        </div>
        <div className="w-32">
          <NativeSelect value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Filtrar por pasta" className="h-9 text-sm">
            <option value="">Todas as pastas</option>
            {(lib.data?.folders ?? []).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {selected.size > 0 && !readOnly && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-xl bg-navy-900 px-3 py-2 text-sm font-bold text-white shadow-lg">
          <span>{fmtInt(selected.size)} selecionados</span>
          <div className="flex gap-1">
            <Button size="sm" onClick={() => void insertSelected([...selected])} loading={inserting}>
              {!inserting && <Plus />} Inserir
            </Button>
            <Button size="icon-sm" variant="ghost" className="text-white hover:bg-white/10" onClick={() => setSelected(new Set())} aria-label="Limpar seleção">
              <X />
            </Button>
          </div>
        </div>
      )}

      {lib.loading && !lib.data ? (
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-video" />
          ))}
        </div>
      ) : lib.error ? (
        <div role="alert" className="rounded-xl border border-negative/30 bg-negative/5 p-3 text-sm">
          <p className="font-bold">Não foi possível carregar a biblioteca.</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void lib.reload()}>
            <RotateCcw /> Tentar novamente
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<ImageIcon />} title={qDebounced || folder ? "Nenhum arquivo encontrado" : "Biblioteca vazia"} description={qDebounced || folder ? "Ajuste a busca ou a pasta." : "Os slides enviados ficam aqui para reutilizar em outras apresentações."} className="p-6" />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-2" aria-label="Arquivos da biblioteca">
            {rows.map((a) => (
              <AssetCard
                key={a.id}
                a={a}
                selected={selected.has(a.id)}
                readOnly={readOnly}
                onToggle={toggle}
                onInsert={(id) => void insertSelected([id])}
                onMove={setMoveOf}
                onDelete={setDeleteOf}
              />
            ))}
          </ul>
          {lib.data && lib.data.total > rows.length && pageSize < 500 && (
            <Button variant="outline" size="sm" onClick={() => setPages((n) => n + 1)} loading={lib.loading}>
              Carregar mais ({fmtInt(lib.data.total - rows.length)} restantes)
            </Button>
          )}
        </>
      )}

      <MoveFolderDialog asset={moveOf} folders={lib.data?.folders ?? []} onOpenChange={(v) => !v && setMoveOf(null)} onMoved={() => void lib.reload()} />
      <ConfirmDialog
        open={!!deleteOf}
        onOpenChange={(v) => !v && setDeleteOf(null)}
        title="Excluir arquivo da biblioteca?"
        description={deleteOf ? `“${deleteOf.originalName}” será apagado definitivamente. Só é possível quando nenhuma apresentação usa o arquivo.` : undefined}
        confirmLabel="Excluir"
        onConfirm={async () => {
          if (!deleteOf) return;
          try {
            await admin.del(`/assets/${deleteOf.id}`);
            toast.success("Arquivo excluído.");
            void lib.reload();
          } catch (e) {
            toast.error(e instanceof ApiError && e.code === "ARQUIVO_EM_USO" ? "Este arquivo está em uso em apresentações. Remova os slides antes de excluí-lo." : e instanceof Error ? e.message : "Não foi possível excluir.");
            return false;
          }
        }}
      />
    </div>
  );
}

const UploadRow = memo(function UploadRow({ e, onRetry, onDismiss }: { e: UploadEntry; onRetry: () => void; onDismiss: () => void }) {
  const pct = e.size ? (e.loaded / e.size) * 100 : 0;
  return (
    <li className="rounded-lg px-1.5 py-1 text-xs hover:bg-muted/60">
      <div className="flex items-center gap-2">
        {e.status === "ok" ? (
          <CheckCircle2 className="size-4 shrink-0 text-positive" aria-hidden />
        ) : e.status === "reaproveitado" ? (
          <Recycle className="size-4 shrink-0 text-positive" aria-hidden />
        ) : e.status === "erro" ? (
          <AlertTriangle className="size-4 shrink-0 text-negative" aria-hidden />
        ) : e.status === "enviando" ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-brand" aria-hidden />
        ) : (
          <span className="size-4 shrink-0 rounded-full border-2 border-border" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate font-bold" title={e.name}>
          {e.name}
        </span>
        <span className="shrink-0 text-muted-foreground">{fmtBytes(e.size)}</span>
        <span className={cn("shrink-0 font-bold", e.status === "erro" ? "text-negative" : e.status === "ok" || e.status === "reaproveitado" ? "text-positive" : "text-muted-foreground")}>
          {e.status === "enviando" ? `${Math.round(pct)}%` : STATUS_LABEL[e.status]}
        </span>
        {e.status === "erro" &&
          (e.retryable ? (
            <button type="button" onClick={onRetry} className="rounded p-0.5 text-brand hover:bg-brand/10" aria-label={`Tentar enviar ${e.name} novamente`}>
              <RotateCcw className="size-3.5" />
            </button>
          ) : (
            <button type="button" onClick={onDismiss} className="rounded p-0.5 text-muted-foreground hover:bg-muted" aria-label={`Remover ${e.name} da lista`}>
              <X className="size-3.5" />
            </button>
          ))}
      </div>
      {e.status === "enviando" && <Progress value={pct} className="mt-1 h-1" />}
      {e.status === "erro" && e.error && <p className="mt-0.5 pl-6 text-negative">{e.error}</p>}
      {e.status === "reaproveitado" && <p className="mt-0.5 pl-6 text-muted-foreground">Arquivo idêntico já estava na biblioteca — sem novo envio.</p>}
    </li>
  );
});

const AssetCard = memo(function AssetCard({
  a,
  selected,
  readOnly,
  onToggle,
  onInsert,
  onMove,
  onDelete,
}: {
  a: AssetDTO;
  selected: boolean;
  readOnly: boolean;
  onToggle: (id: string) => void;
  onInsert: (id: string) => void;
  onMove: (a: AssetDTO) => void;
  onDelete: (a: AssetDTO) => void;
}) {
  return (
    <li className={cn("group relative overflow-hidden rounded-xl border bg-card", selected ? "border-brand ring-2 ring-brand/40" : "border-border")}>
      <button
        type="button"
        onClick={() => !readOnly && onToggle(a.id)}
        disabled={readOnly}
        aria-pressed={selected}
        aria-label={`${selected ? "Desmarcar" : "Selecionar"} ${a.originalName}`}
        className="block w-full text-left disabled:cursor-default"
      >
        <div className="relative aspect-video bg-black">
          <img src={a.urls.mini} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-contain" />
          {selected && (
            <span className="absolute left-1 top-1 grid size-5 place-items-center rounded-full bg-brand text-white">
              <Check className="size-3.5" aria-hidden />
            </span>
          )}
        </div>
        <div className="px-1.5 py-1">
          <p className="truncate text-[11px] font-bold" title={a.originalName}>
            {a.originalName}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {fmtDate(a.createdAt)} · {a.usage ? `${fmtInt(a.usage)} ${a.usage === 1 ? "uso" : "usos"}` : "sem uso"}
            {a.folder ? ` · ${a.folder}` : ""}
          </p>
        </div>
      </button>
      {!readOnly && (
        <div className="absolute right-1 top-1 flex gap-1 opacity-100 sm:opacity-0 sm:transition sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <button type="button" onClick={() => onInsert(a.id)} className="grid size-6 place-items-center rounded-md bg-brand text-white shadow" aria-label={`Inserir ${a.originalName} na linha do tempo`}>
            <Plus className="size-3.5" />
          </button>
          <Menu>
            <MenuTrigger asChild>
              <button type="button" className="grid size-6 place-items-center rounded-md bg-navy-900/85 text-white shadow" aria-label={`Mais ações de ${a.originalName}`}>
                <EllipsisVertical className="size-3.5" />
              </button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => onMove(a)}>
                <FolderInput /> Mover para pasta
              </MenuItem>
              <MenuItem onSelect={() => onDelete(a)} className="text-negative">
                <Trash2 /> Excluir da biblioteca
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      )}
    </li>
  );
});

function MoveFolderDialog({ asset, folders, onOpenChange, onMoved }: { asset: AssetDTO | null; folders: string[]; onOpenChange: (v: boolean) => void; onMoved: () => void }) {
  const id = useId();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(asset?.folder ?? ""), [asset]);
  const submit = async () => {
    if (!asset) return;
    setBusy(true);
    try {
      await admin.patch(`/assets/${asset.id}`, { folder: value.trim() || null });
      toast.success(value.trim() ? `Movido para “${value.trim()}”.` : "Arquivo retirado da pasta.");
      onMoved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível mover o arquivo.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!asset}
      onOpenChange={onOpenChange}
      title="Mover para pasta"
      description={asset?.originalName}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            <FolderInput /> Mover
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Pasta" htmlFor={id} hint="Escolha uma pasta existente ou digite um nome novo. Deixe vazio para tirar da pasta.">
          <Input id={id} value={value} onChange={(e) => setValue(e.target.value)} list={`${id}-l`} maxLength={80} autoFocus />
          <datalist id={`${id}-l`}>
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </Field>
      </form>
    </Dialog>
  );
}

/* ================================================================== perguntas */
function NoEvent({ readOnly, onLinkEvent }: { readOnly: boolean; onLinkEvent: () => void }) {
  return (
    <EmptyState
      icon={<Link2 />}
      title="Vincule um evento"
      description="Perguntas, enquetes, quizzes e gráficos usam as perguntas de um evento. Abra as configurações da apresentação e escolha o evento — depois as perguntas dele aparecem aqui."
      action={
        !readOnly && (
          <Button size="sm" onClick={onLinkEvent}>
            <Link2 /> Vincular evento
          </Button>
        )
      }
      className="p-6"
    />
  );
}

function QuestionsTab({ orgId, eventId, items, questions, readOnly, defaultResultsMode, onInsertItems, onLinkEvent }: LibraryPanelProps) {
  const [q, setQ] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editor, setEditor] = useState<{ open: boolean; type?: QuestionType }>({ open: false });
  const used = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) if (it.questionId) m.set(it.questionId, (m.get(it.questionId) ?? 0) + 1);
    return m;
  }, [items]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (questions.data ?? []).filter((x) => !t || x.title.toLowerCase().includes(t));
  }, [questions.data, q]);

  if (!eventId) return <NoEvent readOnly={readOnly} onLinkEvent={onLinkEvent} />;

  const add = (type: "QUESTION" | "POLL" | "QUIZ" | "CHART", row: QuestionRow) => {
    onInsertItems([questionItem(type, row)]);
    toast.success(`${ITEM_TYPE_LABELS[type]} inserido na linha do tempo.`);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pergunta" aria-label="Buscar perguntas do evento" className="h-9 pl-8 text-sm" />
        </div>
        {!readOnly && (
          <Button size="sm" className="h-9" onClick={() => setPickerOpen(true)}>
            <Plus /> Nova
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Pesquisas entram como <b>Pergunta</b> ou <b>Enquete</b>; perguntas pontuadas como <b>Quiz</b>; nuvens de palavras como <b>Pergunta</b>. <b>Gráfico</b> exibe o resultado de uma pergunta já liberada.
      </p>
      {questions.loading && !questions.data ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : questions.error ? (
        <div role="alert" className="rounded-xl border border-negative/30 bg-negative/5 p-3 text-sm">
          <p className="font-bold">Não foi possível carregar as perguntas.</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void questions.reload()}>
            <RotateCcw /> Tentar novamente
          </Button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Sparkles />}
          title={q ? "Nenhuma pergunta encontrada" : "O evento ainda não tem perguntas"}
          description={q ? undefined : "Crie a primeira pergunta aqui mesmo — ela é salva no evento e inserida na linha do tempo."}
          className="p-6"
        />
      ) : (
        <ul className="space-y-2" aria-label="Perguntas do evento">
          {list.map((row) => {
            const scored = isScoredType(row.type);
            const n = used.get(row.id) ?? 0;
            return (
              <li key={row.id} className="rounded-xl border border-border bg-card p-2.5">
                <div className="mb-1 flex flex-wrap items-center gap-1">
                  <TypeBadge type={row.type} />
                  {row.status === "RASCUNHO" && <Badge tone="warning">Rascunho</Badge>}
                  {n > 0 && (
                    <Badge tone="positive">
                      <Check className="size-3" aria-hidden /> Na linha do tempo{n > 1 ? ` (${n}×)` : ""}
                    </Badge>
                  )}
                </div>
                <p className="text-sm font-bold leading-snug">{row.title}</p>
                {row.status === "RASCUNHO" && <p className="mt-0.5 text-[11px] text-warning">Marque como pronta no evento para que entre nas sessões.</p>}
                {!readOnly && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {scored ? (
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => add("QUIZ", row)}>
                        <ItemTypeIcon type="QUIZ" /> Quiz
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => add("QUESTION", row)}>
                          <ItemTypeIcon type="QUESTION" /> Pergunta
                        </Button>
                        {!isTextType(row.type) && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => add("POLL", row)}>
                            <ItemTypeIcon type="POLL" /> Enquete
                          </Button>
                        )}
                      </>
                    )}
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => add("CHART", row)}>
                      <BarChart3 /> Gráfico
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && (
        <>
          <TypePickerDialog
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onPick={(type) => {
              setPickerOpen(false);
              setEditor({ open: true, type });
            }}
          />
          <QuestionEditor
            open={editor.open}
            onOpenChange={(open) => setEditor((s) => ({ ...s, open }))}
            mode="event"
            orgId={orgId}
            eventId={eventId}
            question={null}
            initialType={editor.type}
            siblings={questions.data ?? []}
            defaultResultsMode={defaultResultsMode}
            onSaved={async (saved) => {
              setEditor({ open: false });
              const fresh = (await questions.reload()) as QuestionRow[] | undefined;
              const row = fresh?.find((x) => x.id === saved.id);
              if (row) {
                const type = suggestedQuestionItemType(row);
                onInsertItems([questionItem(type, row)]);
                toast.success("Pergunta criada no evento e inserida na linha do tempo.");
              }
            }}
          />
        </>
      )}
    </div>
  );
}

/* ================================================================== interativos */
const INTERACTIVE: { type: PresentationItemType; description: string; needsEvent?: boolean }[] = [
  { type: "LEADERBOARD", description: "Top 10 da sessão, com pódio e variação de posições." },
  { type: "SATISFACTION", description: "Termômetro de satisfação (positivo × negativo) ao vivo." },
  { type: "QR_CODE", description: "Tela de entrada com QR Code e código da sessão." },
  { type: "AWARDS", description: "Prêmios do evento e revelação do pódio." },
  { type: "CUSTOM_SCREEN", description: "Título, subtítulo, mensagem e imagem de fundo." },
  { type: "CHART", description: "Gráfico de resultados de uma pergunta do evento.", needsEvent: true },
];

function InteractiveTab({ eventId, readOnly, questions, onInsertItems, onLinkEvent }: LibraryPanelProps) {
  const [chartPick, setChartPick] = useState(false);
  const add = (type: PresentationItemType) => {
    if (type === "CHART") return setChartPick(true);
    const it = type === "CUSTOM_SCREEN" ? newItem("CUSTOM_SCREEN", { settings: { ...newItem("CUSTOM_SCREEN").settings, heading: "Título da tela" } }) : newItem(type);
    onInsertItems([it]);
    toast.success(`${ITEM_TYPE_LABELS[type]} inserido na linha do tempo.`);
  };
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid gap-2" aria-label="Telas interativas">
        {INTERACTIVE.map((x) => {
          const disabled = readOnly || (x.needsEvent && !eventId);
          return (
            <li key={x.type}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => add(x.type)}
                className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition hover:border-brand hover:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-card"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-navy-900 text-white">
                  <ItemTypeIcon type={x.type} className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-black">{ITEM_TYPE_LABELS[x.type]}</span>
                  <span className="block text-xs text-muted-foreground">{x.needsEvent && !eventId ? "Vincule um evento para usar gráficos de perguntas." : x.description}</span>
                </span>
                {!disabled && <Plus className="mt-1 size-4 shrink-0 text-brand" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>
      {!eventId && !readOnly && (
        <Button variant="link" size="sm" className="self-start" onClick={onLinkEvent}>
          <Link2 /> Vincular evento
        </Button>
      )}
      <QuestionPickerDialog
        open={chartPick}
        onOpenChange={setChartPick}
        title="Gráfico de qual pergunta?"
        questions={questions.data ?? []}
        onPick={(row) => {
          setChartPick(false);
          onInsertItems([questionItem("CHART", row)]);
          toast.success("Gráfico inserido na linha do tempo.");
        }}
      />
    </div>
  );
}

export function QuestionPickerDialog({
  open,
  onOpenChange,
  title,
  questions,
  onPick,
  filter,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  questions: QuestionRow[];
  onPick: (q: QuestionRow) => void;
  filter?: (q: QuestionRow) => boolean;
}) {
  const [q, setQ] = useState("");
  const list = questions.filter((x) => (!filter || filter(x)) && (!q.trim() || x.title.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} className="max-w-xl">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pergunta" aria-label="Buscar pergunta" className="mb-3" />
      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma pergunta disponível.</p>
      ) : (
        <ul className="max-h-[55dvh] space-y-1.5 overflow-y-auto">
          {list.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => onPick(row)} className="flex w-full flex-col items-start gap-1 rounded-xl border border-border p-3 text-left hover:border-brand hover:bg-brand/5">
                <TypeBadge type={row.type} />
                <span className="text-sm font-bold">{row.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
