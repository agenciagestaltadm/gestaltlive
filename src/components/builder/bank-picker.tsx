"use client";
/** Filtros do banco de questões e diálogo "Adicionar do banco" (usado no construtor do evento). */
import { useMemo, useState } from "react";
import { Check, Library, Plus, Search } from "lucide-react";
import { QUESTION_TYPES, QUESTION_TYPE_LABELS, type QuestionType } from "@shared/schemas";
import { admin } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Dialog, EmptyState, Input, Label, NativeSelect, Skeleton } from "@/components/ui/primitives";
import { LoadError } from "@/components/admin/load-error";
import { QuestionMeta } from "./question-meta";
import { TypeBadge } from "./question-types";
import type { QuestionRow } from "./types";

export interface QuestionFilterState {
  search: string;
  type: QuestionType | "";
  category: string;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function useQuestionFilter(list: QuestionRow[] | null) {
  const [filter, setFilter] = useState<QuestionFilterState>({ search: "", type: "", category: "" });
  const categories = useMemo(() => Array.from(new Set((list ?? []).map((q) => q.category).filter((c): c is string => !!c))).sort((a, b) => a.localeCompare(b, "pt-BR")), [list]);
  const filtered = useMemo(() => {
    const s = norm(filter.search.trim());
    return (list ?? []).filter((q) => {
      if (filter.type && q.type !== filter.type) return false;
      if (filter.category && q.category !== filter.category) return false;
      if (!s) return true;
      const hay = norm([q.title, q.description ?? "", q.category ?? "", ...q.tags, ...q.options.map((o) => o.label)].join(" "));
      return hay.includes(s);
    });
  }, [list, filter]);
  return { filter, setFilter, filtered, categories };
}

export function QuestionFilters({ filter, setFilter, categories }: { filter: QuestionFilterState; setFilter: (f: QuestionFilterState) => void; categories: string[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
      <div className="relative">
        <Label htmlFor="bank-search" className="sr-only">
          Buscar perguntas
        </Label>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input id="bank-search" type="search" placeholder="Buscar por enunciado, tag ou alternativa" className="pl-9" value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} />
      </div>
      <div>
        <Label htmlFor="bank-type" className="sr-only">
          Filtrar por tipo
        </Label>
        <NativeSelect id="bank-type" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value as QuestionType | "" })} className="sm:w-56">
          <option value="">Todos os tipos</option>
          {QUESTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {QUESTION_TYPE_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div>
        <Label htmlFor="bank-cat" className="sr-only">
          Filtrar por categoria
        </Label>
        <NativeSelect id="bank-cat" value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })} className="sm:w-48" disabled={categories.length === 0}>
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}

export function BankPickerDialog({ open, onOpenChange, orgId, eventId, onAdded }: { open: boolean; onOpenChange: (v: boolean) => void; orgId: string; eventId: string; onAdded: () => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Adicionar do banco de questões"
      description="Uma cópia da pergunta é adicionada ao final do evento. Alterações posteriores não afetam o banco."
      className="max-w-3xl"
    >
      {open && <BankPickerBody orgId={orgId} eventId={eventId} onAdded={onAdded} />}
    </Dialog>
  );
}

function BankPickerBody({ orgId, eventId, onAdded }: { orgId: string; eventId: string; onAdded: () => void }) {
  const bank = useApi(() => admin.get<QuestionRow[]>(`/bank?orgId=${orgId}`), [orgId]);
  const { filter, setFilter, filtered, categories } = useQuestionFilter(bank.data);
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, number>>({});

  const add = async (q: QuestionRow) => {
    setBusy(q.id);
    try {
      await admin.post(`/bank/${q.id}/use`, { eventId });
      setAdded((a) => ({ ...a, [q.id]: (a[q.id] ?? 0) + 1 }));
      toast.success("Pergunta adicionada ao evento.");
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível adicionar a pergunta.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <QuestionFilters filter={filter} setFilter={setFilter} categories={categories} />
      {bank.loading && !bank.data ? (
        <div className="space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : bank.error ? (
        <LoadError error={bank.error} onRetry={() => void bank.reload()} />
      ) : (bank.data ?? []).length === 0 ? (
        <EmptyState icon={<Library />} title="O banco de questões está vazio" description="Salve perguntas no banco a partir de qualquer evento ou crie-as em Banco de questões." />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search />} title="Nenhuma pergunta encontrada" description="Ajuste a busca ou os filtros." />
      ) : (
        <ul className="flex max-h-[55dvh] flex-col gap-2 overflow-y-auto pr-1">
          {filtered.map((q) => (
            <li key={q.id} className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <TypeBadge type={q.type} />
                  {q.category && <span className="text-xs font-bold text-muted-foreground">{q.category}</span>}
                </div>
                <p className="font-bold">{q.title}</p>
                <QuestionMeta q={q} className="mt-1" />
              </div>
              <Button size="sm" variant={added[q.id] ? "outline" : "default"} loading={busy === q.id} onClick={() => void add(q)} aria-label={`Adicionar “${q.title}” ao evento`}>
                {busy !== q.id && (added[q.id] ? <Check /> : <Plus />)}
                {added[q.id] ? `Adicionada${added[q.id] > 1 ? ` (${added[q.id]}×)` : ""}` : "Adicionar"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
