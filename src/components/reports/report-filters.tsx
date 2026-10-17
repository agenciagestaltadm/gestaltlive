"use client";
/** Filtros de segmentação do relatório da sessão (campo personalizado e pergunta de perfil). */
import { useEffect, useMemo, useState } from "react";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, NativeSelect } from "@/components/ui/primitives";
import type { SessionReport } from "./types";

export interface SegmentFilter {
  fieldKey: string;
  fieldValue: string;
  profileSqId: string;
  profileOptionId: string;
}

export const EMPTY_SEGMENT: SegmentFilter = { fieldKey: "", fieldValue: "", profileSqId: "", profileOptionId: "" };

/** Texto legível do segmento aplicado (ou null se nenhum). */
export function segmentLabel(f: SegmentFilter, source: Pick<SessionReport, "customFields" | "questions"> | null): string | null {
  const parts: string[] = [];
  if (f.fieldKey && f.fieldValue) {
    const field = source?.customFields.find((c) => c.key === f.fieldKey);
    parts.push(`${field?.label ?? f.fieldKey}: ${f.fieldValue}`);
  }
  if (f.profileSqId && f.profileOptionId) {
    const q = source?.questions.find((x) => x.sessionQuestionId === f.profileSqId);
    const o = q?.options.find((x) => x.id === f.profileOptionId);
    parts.push(`${q ? `P${q.position}. ${q.title}` : "Pergunta"} → ${o?.label ?? "alternativa"}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export function ReportFilters({
  value,
  source,
  onApply,
  loading,
}: {
  value: SegmentFilter;
  /** Relatório SEM filtro (fonte das opções disponíveis). */
  source: Pick<SessionReport, "customFields" | "questions" | "demographics"> | null;
  onApply: (f: SegmentFilter) => void;
  loading?: boolean;
}) {
  const [draft, setDraft] = useState<SegmentFilter>(value);
  const valueKey = JSON.stringify(value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setDraft(value);
  }, [valueKey]);

  const fieldValues = useMemo(() => {
    if (!source || !draft.fieldKey) return [];
    const set = new Set<string>();
    for (const v of source.demographics.find((d) => d.key === draft.fieldKey)?.values ?? []) set.add(v.value);
    for (const o of source.customFields.find((c) => c.key === draft.fieldKey)?.options ?? []) set.add(o);
    if (draft.fieldValue) set.add(draft.fieldValue);
    return [...set];
  }, [source, draft.fieldKey, draft.fieldValue]);

  const selectable = useMemo(() => (source?.questions ?? []).filter((q) => q.selectable && q.options.length > 0), [source]);
  const question = selectable.find((q) => q.sessionQuestionId === draft.profileSqId);
  const hasAny = !!(value.fieldKey || value.profileSqId);
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  const fieldIncomplete = !!draft.fieldKey && !draft.fieldValue;
  const questionIncomplete = !!draft.profileSqId && !draft.profileOptionId;

  if (!source) return null;
  const noOptions = source.customFields.length === 0 && selectable.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Filter className="size-4 text-brand" /> Segmentação
        </CardTitle>
        <CardDescription>Filtre todos os indicadores por um campo do cadastro e/ou pela resposta a uma pergunta de escolha única.</CardDescription>
      </CardHeader>
      <CardContent>
        {noOptions ? (
          <p className="text-sm text-muted-foreground">Esta sessão não tem campos personalizados nem perguntas de escolha única para segmentar.</p>
        ) : (
          <form
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              onApply({
                fieldKey: draft.fieldKey && draft.fieldValue ? draft.fieldKey : "",
                fieldValue: draft.fieldKey && draft.fieldValue ? draft.fieldValue : "",
                profileSqId: draft.profileSqId && draft.profileOptionId ? draft.profileSqId : "",
                profileOptionId: draft.profileSqId && draft.profileOptionId ? draft.profileOptionId : "",
              });
            }}
          >
            {source.customFields.length > 0 && (
              <>
                <Field label="Campo do cadastro" htmlFor="seg-field">
                  <NativeSelect id="seg-field" value={draft.fieldKey} onChange={(e) => setDraft({ ...draft, fieldKey: e.target.value, fieldValue: "" })}>
                    <option value="">Todos</option>
                    {source.customFields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Valor" htmlFor="seg-value" error={fieldIncomplete ? "Escolha um valor para aplicar." : null}>
                  <NativeSelect id="seg-value" value={draft.fieldValue} disabled={!draft.fieldKey} onChange={(e) => setDraft({ ...draft, fieldValue: e.target.value })}>
                    <option value="">{draft.fieldKey ? (fieldValues.length ? "Selecione" : "Sem valores registrados") : "Escolha o campo"}</option>
                    {fieldValues.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </>
            )}
            {selectable.length > 0 && (
              <>
                <Field label="Pergunta de perfil" htmlFor="seg-q">
                  <NativeSelect id="seg-q" value={draft.profileSqId} onChange={(e) => setDraft({ ...draft, profileSqId: e.target.value, profileOptionId: "" })}>
                    <option value="">Todas</option>
                    {selectable.map((q) => (
                      <option key={q.sessionQuestionId} value={q.sessionQuestionId}>
                        {`P${q.position}. ${q.title.length > 60 ? `${q.title.slice(0, 59)}…` : q.title}`}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Alternativa escolhida" htmlFor="seg-opt" error={questionIncomplete ? "Escolha uma alternativa para aplicar." : null}>
                  <NativeSelect id="seg-opt" value={draft.profileOptionId} disabled={!question} onChange={(e) => setDraft({ ...draft, profileOptionId: e.target.value })}>
                    <option value="">{question ? "Selecione" : "Escolha a pergunta"}</option>
                    {question?.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </>
            )}
            <div className="flex flex-wrap items-end gap-2 md:col-span-2 xl:col-span-4">
              <Button type="submit" loading={loading} disabled={!dirty || fieldIncomplete || questionIncomplete}>
                <Filter /> Aplicar filtros
              </Button>
              {hasAny && (
                <Button type="button" variant="ghost" onClick={() => onApply(EMPTY_SEGMENT)}>
                  <X /> Limpar
                </Button>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
