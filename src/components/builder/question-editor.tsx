"use client";
/**
 * Editor completo de perguntas (diálogo amplo com abas).
 *
 * - React Hook Form + validação client-side espelhando `questionInputSchema` e as normalizações do
 *   servidor (ver ./question-form.ts).
 * - Perguntas bloqueadas (já respondidas) mantêm campos estruturais desabilitados; textos, imagens,
 *   gráfico e explicação continuam editáveis (cada salvamento gera nova versão).
 * - Erros do servidor (400 com `details`, GRAFICO_INCOMPATIVEL, PERGUNTA_BLOQUEADA) são mapeados
 *   nos campos e nas abas correspondentes.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Controller, get, useFieldArray, useForm, type FieldErrors, type Path } from "react-hook-form";
import { ArrowDown, ArrowUp, Check, Copy, Info, Lock, Play, Plus, RotateCcw, Trash2, TriangleAlert, X } from "lucide-react";
import {
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  RESULTS_MODES,
  RESULTS_MODE_LABELS,
  isNumericType,
  isScoredType,
  isTextType,
  type QuestionType,
  type ResultsMode,
} from "@shared/schemas";
import { CHART_META } from "@shared/charts/catalog";
import { checkChart } from "@shared/charts/compat";
import { PALETTE, previewWordCloud } from "@shared/charts/options";
import { scoreAnswer } from "@shared/scoring";
import { WC_ANIMATIONS, WC_ANIMATION_LABELS, WC_MODES, WC_MODE_LABELS, WC_STYLES, WC_STYLE_LABELS, prepareEntry, type WordCloudBackground, type WordCloudMode, type WordCloudStyle } from "@shared/wordcloud";
import { admin, ApiError } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge, Dialog, Field, Input, Label, NativeSelect, Switch, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from "@/components/ui/primitives";
import { ChartGallery } from "@/components/charts/chart-gallery";
import { ChartView } from "@/components/charts/chart-view";
import { paletteFor } from "@/components/charts/word-cloud-layout";
import { cn } from "@/lib/utils";
import { ImageField } from "./image-field";
import { TYPE_DESCRIPTIONS } from "./question-types";
import {
  MAX_OPTIONS,
  blankOption,
  chartContextFor,
  emptyForm,
  fromRow,
  isForcedSingle,
  minOptionsFor,
  pickChart,
  questionResolver,
  tabForPath,
  toPayload,
  type EditorTab,
  type FormValues,
  type OptionForm,
  type PayloadContext,
} from "./question-form";
import { isCrossCandidate, type QuestionRow } from "./types";

export interface QuestionEditorProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** "event": pergunta de um evento (permite cruzamento); "bank": banco de questões da organização. */
  mode: "event" | "bank";
  orgId: string;
  eventId?: string;
  /** Pergunta em edição (ausente = nova). */
  question?: QuestionRow | null;
  /** Tipo inicial de uma nova pergunta. */
  initialType?: QuestionType;
  /** Demais perguntas do evento (cruzamento e sugestões de categoria). */
  siblings?: QuestionRow[];
  defaultResultsMode?: ResultsMode;
  onSaved: (saved: { id: string }) => void;
  /** Ação "duplicar" sugerida no aviso de pergunta bloqueada. */
  onDuplicate?: (q: QuestionRow) => void;
}

const letter = (i: number) => String.fromCharCode(65 + (i % 26));

const TAB_ORDER: EditorTab[] = ["pergunta", "respostas", "pontuacao", "grafico", "comportamento"];

/** Abas que contêm algum erro (percorre o objeto de erros aninhado do React Hook Form). */
function tabsWithErrors(errors: unknown): Set<EditorTab> {
  const found = new Set<EditorTab>();
  const walk = (obj: unknown, prefix: string) => {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    if (typeof o.message === "string" && prefix) found.add(tabForPath(prefix));
    for (const [k, val] of Object.entries(o)) if (k !== "ref" && k !== "message" && k !== "type" && k !== "types") walk(val, prefix ? `${prefix}.${k}` : k);
  };
  walk(errors, "");
  return found;
}

export function QuestionEditor(props: QuestionEditorProps) {
  const dirty = useRef(false);
  const editing = !!props.question;
  const close = (v: boolean) => {
    if (!v && dirty.current && !window.confirm("Descartar as alterações não salvas?")) return;
    if (!v) dirty.current = false;
    props.onOpenChange(v);
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={close}
      title={editing ? "Editar pergunta" : props.mode === "bank" ? "Nova pergunta no banco" : "Nova pergunta"}
      description={
        editing
          ? `Versão ${props.question!.version}${props.question!.locked ? ` · ${props.question!.answersCount} ${props.question!.answersCount === 1 ? "resposta registrada" : "respostas registradas"}` : ""}`
          : "Preencha as abas e salve. A validação segue as mesmas regras do servidor."
      }
      className="max-w-5xl pb-0"
    >
      {props.open && (
        <EditorBody
          key={props.question?.id ?? `nova-${props.initialType ?? ""}`}
          {...props}
          onDirtyChange={(d) => {
            dirty.current = d;
          }}
          onCancel={() => close(false)}
          onSavedInternal={(saved) => {
            dirty.current = false;
            props.onSaved(saved);
          }}
        />
      )}
    </Dialog>
  );
}

/* ================================================================== corpo */
function EditorBody({
  mode,
  orgId,
  eventId,
  question,
  initialType,
  siblings = [],
  defaultResultsMode,
  onDuplicate,
  onDirtyChange,
  onCancel,
  onSavedInternal,
}: QuestionEditorProps & { onDirtyChange: (d: boolean) => void; onCancel: () => void; onSavedInternal: (saved: { id: string }) => void }) {
  const original = question ?? null;
  const locked = !!original?.locked;
  const allowCross = mode === "event";
  const ctxRef = useRef<PayloadContext>({ allowCross, original });
  ctxRef.current = { allowCross, original };

  const resolver = useMemo(() => questionResolver(() => ctxRef.current), []);
  const form = useForm<FormValues>({
    defaultValues: original ? fromRow(original) : emptyForm(initialType ?? "OPINIAO", defaultResultsMode ?? "MANUAL"),
    resolver,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  const { register, control, handleSubmit, setValue, getValues, watch, setError, formState } = form;
  const { errors, isSubmitting, isDirty } = formState;
  const options = useFieldArray({ control, name: "options", keyName: "key" });
  const v = watch();

  const [tab, setTab] = useState<EditorTab>("pergunta");
  const [serverError, setServerError] = useState<string | null>(null);
  const [chartNotice, setChartNotice] = useState<string | null>(null);
  const optionsBackup = useRef<OptionForm[] | null>(null);
  const resultsModeBackup = useRef<ResultsMode | null>(null);

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const type = v.type;
  const numeric = isNumericType(type);
  const scored = isScoredType(type);
  const text = isTextType(type);

  /* ---------------------------------------------------------------- cruzamento */
  const crossCandidates = useMemo(() => siblings.filter((q) => q.id !== original?.id && isCrossCandidate(q)), [siblings, original?.id]);
  const crossId = allowCross ? v.chart.crossQuestionId : null;
  const crossValid = !!crossId && crossCandidates.some((c) => c.id === crossId);
  useEffect(() => {
    // pergunta de cruzamento removida/alterada → limpa a referência
    if (crossId && !crossValid && siblings.length > 0) setValue("chart.crossQuestionId", null, { shouldDirty: true });
  }, [crossId, crossValid, siblings.length, setValue]);
  const hasCross = crossValid;

  /* ---------------------------------------------------------------- compatibilidade do gráfico */
  const chartCtx = chartContextFor(v, hasCross);
  const ctxKey = JSON.stringify(chartCtx);
  useEffect(() => {
    // nuvem de palavras: a visualização é sempre a nuvem (definida na troca de tipo)
    if (isTextType(getValues("type"))) return;
    const current = getValues("chart.type");
    const check = checkChart(current, chartCtx);
    if (!check.compatible) {
      const next = pickChart(chartCtx);
      if (next !== current) {
        setValue("chart.type", next, { shouldDirty: true });
        setChartNotice(`“${CHART_META[current].label}” deixou de ser compatível (${check.reason}) e foi trocado por “${CHART_META[next].label}”.`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey]);

  /* ---------------------------------------------------------------- troca de tipo */
  const changeType = (next: QuestionType) => {
    if (locked || next === getValues("type")) return;
    const cur = getValues();
    let opts = cur.options;
    if (isNumericType(next) || isTextType(next)) {
      if (opts.length) optionsBackup.current = opts;
      opts = [];
    } else {
      if (opts.length === 0 && optionsBackup.current) opts = optionsBackup.current;
      if (next === "SIM_NAO") {
        opts = [
          { ...blankOption("Sim"), id: opts[0]?.id, color: opts[0]?.color ?? null },
          { ...blankOption("Não"), id: opts[1]?.id, color: opts[1]?.color ?? null },
        ];
      }
      const min = Math.max(minOptionsFor(next), next === "SIM_NAO" ? 2 : 0);
      opts = [...opts];
      while (opts.length < min) opts.push(blankOption());
      if (!isScoredType(next)) opts = opts.map((o) => ({ ...o, isCorrect: false }));
      if (next === "CONHECIMENTO") {
        let seen = false;
        opts = opts.map((o) => {
          if (o.isCorrect && !seen) {
            seen = true;
            return o;
          }
          return { ...o, isCorrect: false };
        });
      }
    }
    options.replace(opts);
    setValue("type", next, { shouldDirty: true });
    if (isForcedSingle(next)) {
      setValue("minSelections", 1);
      setValue("maxSelections", 1);
    } else if (next === "MULTIPLA_CORRETA") {
      setValue("minSelections", Math.max(2, cur.minSelections));
      setValue("maxSelections", Math.max(Math.max(2, cur.minSelections), opts.length));
    } else if (cur.type === "MULTIPLA_CORRETA") {
      setValue("minSelections", 1);
      setValue("maxSelections", Math.min(cur.maxSelections, opts.length));
    }
    if (next === "NPS") {
      setValue("scaleMin", 0);
      setValue("scaleMax", 10);
      if (!cur.scaleMinLabel) setValue("scaleMinLabel", "Nada provável");
      if (!cur.scaleMaxLabel) setValue("scaleMaxLabel", "Extremamente provável");
    } else if (next === "ESCALA" && cur.type !== "ESCALA") {
      setValue("scaleMin", 1);
      setValue("scaleMax", 5);
    }
    if (isScoredType(next) && !cur.timeLimitSec && cur.scoring.speedBonusEnabled) setValue("timeLimitSec", 30);
    if (!isNumericType(next)) setValue("chart.colors", null);
    if (isTextType(next)) {
      // nuvem de palavras: sem alternativas/pontuação, visualização fixa em nuvem e resultados ao vivo
      resultsModeBackup.current = cur.resultsMode;
      setValue("resultsMode", "AO_VIVO");
      setValue("allowEdit", false);
      setValue("chart.type", "wordcloud");
      setValue("chart.crossQuestionId", null);
      setChartNotice(null);
    } else if (isTextType(cur.type)) {
      if (resultsModeBackup.current) setValue("resultsMode", resultsModeBackup.current);
      setValue("chart.type", pickChart(chartContextFor({ ...cur, type: next, options: opts }, false)));
      setChartNotice(null);
    }
    form.clearErrors();
  };

  /* ---------------------------------------------------------------- alternativas */
  const clampSelections = (count: number) => {
    const max = getValues("maxSelections");
    const min = getValues("minSelections");
    if (max > count) setValue("maxSelections", Math.max(1, count), { shouldDirty: true });
    if (min > Math.max(1, count)) setValue("minSelections", Math.max(1, count), { shouldDirty: true });
  };
  const removeOption = (i: number) => {
    options.remove(i);
    clampSelections(getValues("options").length);
  };
  const toggleCorrect = (i: number) => {
    if (locked) return;
    const list = getValues("options");
    if (type === "CONHECIMENTO") {
      list.forEach((_, j) => setValue(`options.${j}.isCorrect`, j === i, { shouldDirty: true }));
    } else if (type === "MULTIPLA_CORRETA") {
      setValue(`options.${i}.isCorrect`, !list[i].isCorrect, { shouldDirty: true });
    }
    if (formState.isSubmitted) void form.trigger();
  };

  /* ---------------------------------------------------------------- envio */
  const errorTabs = tabsWithErrors(errors);
  const firstErrorTab = (errs: FieldErrors<FormValues>): EditorTab => {
    const found = tabsWithErrors(errs);
    return TAB_ORDER.find((t) => found.has(t)) ?? "pergunta";
  };

  const onValid = async (values: FormValues) => {
    setServerError(null);
    const payload = toPayload(values, ctxRef.current);
    try {
      let saved: { id: string };
      if (original) {
        saved = await admin.put<{ id: string }>(`/questions/${original.id}`, mode === "event" ? { ...payload, status: values.status } : payload);
      } else if (mode === "bank") {
        saved = await admin.post<{ id: string }>(`/bank?orgId=${orgId}`, payload);
      } else {
        saved = await admin.post<{ id: string }>(`/events/${eventId}/questions`, payload);
        if (values.status === "RASCUNHO") await admin.post(`/questions/${saved.id}/status`, { status: "RASCUNHO" });
      }
      toast.success(original ? "Pergunta atualizada." : mode === "bank" ? "Pergunta salva no banco." : "Pergunta criada.");
      onSavedInternal(saved);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "GRAFICO_INCOMPATIVEL") {
          setError("chart.type", { type: "server", message: e.message });
          setTab("grafico");
          setServerError(e.message);
        } else if (e.code === "PERGUNTA_BLOQUEADA") {
          setServerError(e.message);
        } else if (e.details?.length) {
          for (const d of e.details) {
            if (!d.path) continue;
            const path = d.path === "options" ? "options.root" : d.path;
            setError(path as Path<FormValues>, { type: "server", message: d.message });
          }
          const first = e.details.find((d) => d.path)?.path;
          if (first) setTab(tabForPath(first));
          setServerError(e.message || "Revise os campos destacados.");
        } else {
          setServerError(e.message);
        }
      } else {
        setServerError("Erro inesperado ao salvar. Tente novamente.");
      }
    }
  };

  const onInvalid = (errs: FieldErrors<FormValues>) => {
    setTab(firstErrorTab(errs));
    toast.error("Revise os campos destacados.");
  };

  const msg = (path: string): string | undefined => (get(errors, path) as { message?: string } | undefined)?.message;
  const optionsError = msg("options") ?? msg("options.root");

  const tabTrigger = (value: EditorTab, label: string) => (
    <TabsTrigger value={value}>
      {label}
      {errorTabs.has(value) && <span className="size-2 rounded-full bg-negative" aria-label="contém erros" />}
    </TabsTrigger>
  );

  const categorySuggestions = useMemo(() => Array.from(new Set(siblings.map((s) => s.category).filter((c): c is string => !!c))).slice(0, 50), [siblings]);
  const listId = useId();

  return (
    <form onSubmit={handleSubmit(onValid, onInvalid)} noValidate className="flex flex-col">
      {locked && (
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-start">
          <Lock className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
          <div className="flex-1 text-sm">
            <p className="font-black">Pergunta bloqueada: já recebeu {original!.answersCount} {original!.answersCount === 1 ? "resposta" : "respostas"}.</p>
            <p className="mt-1 text-muted-foreground">
              {text ? (
                <>
                  Para preservar os resultados, o tipo e as regras de coleta da nuvem (modo, limites de palavras, envios e caracteres, repetição e aprovação) não podem mudar. Sinônimos,
                  palavras bloqueadas, agrupamento, aparência e textos continuam editáveis — cada salvamento gera uma nova versão. Para uma variação estrutural, duplique a pergunta.
                </>
              ) : (
                <>
              Para preservar os resultados e a pontuação, tipo, alternativas (inclusão, remoção, ordem e gabarito), seleções, escala e pontuação não podem mudar. Você ainda pode
              ajustar textos, imagens, cores, gráfico e explicação — cada salvamento gera uma nova versão. Para uma variação estrutural, duplique a pergunta.
                </>
              )}
            </p>
          </div>
          {onDuplicate && (
            <Button type="button" variant="outline" size="sm" onClick={() => onDuplicate(original!)}>
              <Copy /> Duplicar
            </Button>
          )}
        </div>
      )}

      <Tabs value={tab} onValueChange={(t) => setTab(t as EditorTab)}>
        <TabsList className="mb-5 w-full sm:w-auto">
          {tabTrigger("pergunta", "Pergunta")}
          {tabTrigger("respostas", text ? "Nuvem" : numeric ? "Escala" : "Alternativas")}
          {scored && tabTrigger("pontuacao", "Pontuação")}
          {tabTrigger("grafico", text ? "Aparência" : "Gráfico")}
          {tabTrigger("comportamento", "Comportamento")}
        </TabsList>

        {/* ============================================================ pergunta */}
        <TabsContent value="pergunta" className="flex flex-col gap-5">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Tipo de pergunta" htmlFor="q-type" required hint={locked ? "Bloqueado: a pergunta já tem respostas." : TYPE_DESCRIPTIONS[type].text} error={msg("type")}>
              <NativeSelect id="q-type" value={type} disabled={locked} onChange={(e) => changeType(e.target.value as QuestionType)}>
                {QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {QUESTION_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {mode === "event" ? (
              <Field label="Status" htmlFor="q-status" hint="Somente perguntas prontas entram nas sessões. Rascunhos ficam guardados para depois.">
                <Controller
                  control={control}
                  name="status"
                  render={({ field }) => (
                    <NativeSelect id="q-status" value={field.value} onChange={(e) => field.onChange(e.target.value)}>
                      <option value="PRONTA">Pronta</option>
                      <option value="RASCUNHO">Rascunho</option>
                    </NativeSelect>
                  )}
                />
              </Field>
            ) : (
              <div />
            )}
          </div>

          <Field label="Enunciado" htmlFor="q-title" required error={msg("title")} hint={`${v.title.length}/300 caracteres`}>
            <Textarea id="q-title" rows={2} maxLength={300} placeholder="Digite a pergunta que aparecerá no telão e no celular" aria-invalid={!!msg("title")} {...register("title")} />
          </Field>

          <Field label="Descrição (opcional)" htmlFor="q-desc" error={msg("description")} hint="Contexto adicional exibido abaixo do enunciado.">
            <Textarea id="q-desc" rows={2} maxLength={2000} aria-invalid={!!msg("description")} {...register("description")} />
          </Field>

          <Field label="Imagem da pergunta (opcional)" error={msg("imageUrl")}>
            <Controller control={control} name="imageUrl" render={({ field }) => <ImageField value={field.value} onChange={field.onChange} orgId={orgId} label="imagem da pergunta" />} />
          </Field>

          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Categoria (opcional)" htmlFor="q-cat" error={msg("category")} hint="Ajuda a organizar e filtrar no banco de questões.">
              <Input id="q-cat" list={listId} maxLength={80} aria-invalid={!!msg("category")} {...register("category")} />
              <datalist id={listId}>
                {categorySuggestions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Tags (opcional)" htmlFor="q-tags" error={msg("tags") ?? Object.keys(get(errors, "tags") ?? {}).map((k) => msg(`tags.${k}`)).find(Boolean)}>
              <Controller control={control} name="tags" render={({ field }) => <TagsInput id="q-tags" value={field.value} onChange={field.onChange} />} />
            </Field>
          </div>
        </TabsContent>

        {/* ============================================================ alternativas / escala */}
        <TabsContent value="respostas" className="flex flex-col gap-5">
          {text ? (
            <WordCloudRulesSection control={control} register={register} locked={locked} msg={msg} v={v} goTo={setTab} />
          ) : numeric ? (
            <ScaleSection control={control} register={register} type={type} locked={locked} msg={msg} v={v} />
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h4 className="font-black">
                    Alternativas <span className="font-bold text-muted-foreground tabular">({options.fields.length}/{MAX_OPTIONS})</span>
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {type === "CONHECIMENTO" && "Marque exatamente uma alternativa correta."}
                    {type === "MULTIPLA_CORRETA" && "Cadastre pelo menos 3 alternativas e marque 2 ou mais corretas."}
                    {(type === "PERFIL" || type === "OPINIAO") && "Pesquisas não têm resposta correta. Cadastre pelo menos 2 alternativas."}
                    {type === "SIM_NAO" && "Alternativas geradas automaticamente: Sim e Não. Você pode ajustar o texto, a cor e a imagem."}
                  </p>
                </div>
                {type !== "SIM_NAO" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={locked || options.fields.length >= MAX_OPTIONS}
                    onClick={() => {
                      options.append(blankOption());
                      if (type === "MULTIPLA_CORRETA" && getValues("maxSelections") === options.fields.length) setValue("maxSelections", options.fields.length + 1);
                    }}
                  >
                    <Plus /> Adicionar alternativa
                  </Button>
                )}
              </div>
              {optionsError && (
                <p className="rounded-xl bg-negative/10 px-3 py-2 text-sm font-bold text-negative" role="alert">
                  {optionsError}
                </p>
              )}
              <ol className="flex flex-col gap-2">
                {options.fields.map((f, i) => {
                  const op = v.options[i] ?? f;
                  const labelErr = msg(`options.${i}.label`);
                  const structuralLocked = locked || type === "SIM_NAO";
                  return (
                    <li key={f.key} className={cn("flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-start", op.isCorrect && scored ? "border-positive/60 bg-positive/5" : "border-border")}>
                      <div className="flex items-center gap-1 sm:pt-1">
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-sm font-black" aria-hidden="true">
                          {letter(i)}
                        </span>
                        <div className="flex flex-row sm:flex-col">
                          <Button type="button" variant="ghost" size="icon-sm" className="h-5" disabled={structuralLocked || i === 0} onClick={() => options.move(i, i - 1)} aria-label={`Mover alternativa ${letter(i)} para cima`}>
                            <ArrowUp />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="h-5"
                            disabled={structuralLocked || i === options.fields.length - 1}
                            onClick={() => options.move(i, i + 1)}
                            aria-label={`Mover alternativa ${letter(i)} para baixo`}
                          >
                            <ArrowDown />
                          </Button>
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <Label htmlFor={`opt-${f.key}`} className="sr-only">
                          Texto da alternativa {letter(i)}
                        </Label>
                        <Input id={`opt-${f.key}`} maxLength={200} placeholder={`Alternativa ${letter(i)}`} aria-invalid={!!labelErr} {...register(`options.${i}.label`)} />
                        {labelErr && (
                          <p className="mt-1 text-xs font-bold text-negative" role="alert">
                            {labelErr}
                          </p>
                        )}
                        {msg(`options.${i}.imageUrl`) && <p className="mt-1 text-xs font-bold text-negative">{msg(`options.${i}.imageUrl`)}</p>}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {scored && (
                          <Button
                            type="button"
                            size="sm"
                            variant={op.isCorrect ? "positive" : "outline"}
                            disabled={locked}
                            aria-pressed={op.isCorrect}
                            onClick={() => toggleCorrect(i)}
                            aria-label={`${op.isCorrect ? "Desmarcar" : "Marcar"} alternativa ${letter(i)} como correta`}
                          >
                            <Check /> {op.isCorrect ? "Correta" : "Correta?"}
                          </Button>
                        )}
                        <ColorDot value={op.color} fallback={PALETTE[i % PALETTE.length]} onChange={(c) => setValue(`options.${i}.color`, c, { shouldDirty: true })} label={`Cor da alternativa ${letter(i)}`} />
                        <ImageField compact value={op.imageUrl} onChange={(url) => setValue(`options.${i}.imageUrl`, url, { shouldDirty: true })} orgId={orgId} label={`imagem da alternativa ${letter(i)}`} />
                        {type !== "SIM_NAO" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={locked || options.fields.length <= 1}
                            onClick={() => removeOption(i)}
                            aria-label={`Remover alternativa ${letter(i)}`}
                            className="text-negative hover:bg-negative/10"
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
              <SelectionsSection control={control} type={type} locked={locked} count={v.options.length} msg={msg} setValue={setValue} v={v} />
            </>
          )}
        </TabsContent>

        {/* ============================================================ pontuação */}
        {scored && (
          <TabsContent value="pontuacao" className="flex flex-col gap-5">
            <ScoringSection control={control} locked={locked} msg={msg} v={v} goToBehavior={() => setTab("comportamento")} />
          </TabsContent>
        )}

        {/* ============================================================ gráfico */}
        <TabsContent value="grafico" className="flex flex-col gap-5">
          {msg("chart.type") && (
            <p className="rounded-xl bg-negative/10 px-3 py-2 text-sm font-bold text-negative" role="alert">
              {msg("chart.type")}
            </p>
          )}
          {chartNotice && (
            <div className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-sm" role="status">
              <Info className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
              <span className="flex-1">{chartNotice}</span>
              <button type="button" onClick={() => setChartNotice(null)} aria-label="Fechar aviso" className="rounded p-0.5 hover:bg-card">
                <X className="size-4" />
              </button>
            </div>
          )}

          {text ? (
            <WordCloudDisplaySection control={control} setValue={setValue} msg={msg} v={v} />
          ) : (
            <>
          <div className="grid gap-5 lg:grid-cols-2">
            {allowCross ? (
              <Field
                label="Cruzar com (opcional)"
                htmlFor="q-cross"
                error={msg("chart.crossQuestionId")}
                hint={
                  crossCandidates.length === 0
                    ? "Nenhuma pergunta de escolha única (perfil, opinião ou sim/não) neste evento para cruzar."
                    : "Segunda dimensão real: habilita barras agrupadas/empilhadas, Sankey, mapa de calor por segmento e hierarquias."
                }
              >
                <Controller
                  control={control}
                  name="chart.crossQuestionId"
                  render={({ field }) => (
                    <NativeSelect id="q-cross" value={field.value ?? ""} disabled={crossCandidates.length === 0} onChange={(e) => field.onChange(e.target.value || null)}>
                      <option value="">Sem cruzamento</option>
                      {crossCandidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.position + 1}. {c.title.length > 70 ? `${c.title.slice(0, 69)}…` : c.title} ({QUESTION_TYPE_LABELS[c.type]})
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                />
              </Field>
            ) : (
              <p className="text-sm text-muted-foreground">Cruzamentos com outras perguntas são configurados depois que a pergunta é adicionada a um evento.</p>
            )}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-bold">Exibição</span>
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
                <Controller control={control} name="chart.showPercent" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} label="Mostrar percentuais" />} />
                <Controller control={control} name="chart.showValues" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} label="Mostrar valores" />} />
                <Controller control={control} name="chart.showLegend" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} label="Mostrar legenda" />} />
                <Controller control={control} name="chart.sortDesc" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} label="Ordenar decrescente" />} />
              </div>
            </div>
          </div>

          <ColorsSection v={v} numeric={numeric} scored={scored} setValue={setValue} msg={msg} />

          <Controller
            control={control}
            name="chart.type"
            render={({ field }) => (
              <ChartGallery
                question={{
                  type,
                  title: v.title,
                  options: v.options.map((o) => ({ label: o.label, color: o.color, isCorrect: o.isCorrect })),
                  maxSelections: isForcedSingle(type) ? 1 : v.maxSelections,
                  scaleMin: v.scaleMin,
                  scaleMax: v.scaleMax,
                }}
                value={field.value}
                onChange={(t) => {
                  field.onChange(t);
                  setChartNotice(null);
                  form.clearErrors("chart.type");
                }}
                hasCross={hasCross}
                config={{
                  showPercent: v.chart.showPercent,
                  showValues: v.chart.showValues,
                  showLegend: v.chart.showLegend,
                  sortDesc: v.chart.sortDesc,
                  colors: numeric ? v.chart.colors : null,
                }}
              />
            )}
          />
            </>
          )}
        </TabsContent>

        {/* ============================================================ comportamento */}
        <TabsContent value="comportamento" className="flex flex-col gap-5">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Tempo limite" htmlFor="q-time" error={msg("timeLimitSec")} hint="Entre 5 e 3.600 segundos. Sem tempo limite, o palestrante encerra manualmente.">
              <Controller
                control={control}
                name="timeLimitSec"
                render={({ field }) => (
                  <div className="flex flex-wrap items-center gap-3">
                    <Switch checked={field.value !== null} onCheckedChange={(on) => field.onChange(on ? 30 : null)} label="Com tempo limite" />
                    {field.value !== null && (
                      <div className="flex items-center gap-2">
                        <NumberInput id="q-time" className="w-28" value={field.value} onChange={(n) => field.onChange(n ?? NaN)} min={5} max={3600} step={5} invalid={!!msg("timeLimitSec")} />
                        <span className="text-sm text-muted-foreground">segundos</span>
                      </div>
                    )}
                  </div>
                )}
              />
            </Field>
            <Field label="Exibição dos resultados" htmlFor="q-results" error={msg("resultsMode")}>
              <Controller
                control={control}
                name="resultsMode"
                render={({ field }) => (
                  <NativeSelect id="q-results" value={field.value} onChange={(e) => field.onChange(e.target.value as ResultsMode)}>
                    {RESULTS_MODES.map((m) => (
                      <option key={m} value={m}>
                        {RESULTS_MODE_LABELS[m]}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              />
            </Field>
          </div>
          <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
            <Controller control={control} name="required" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} label="Resposta obrigatória" />} />
            {!text && (
              <Controller
                control={control}
                name="allowEdit"
                render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} label="Permitir que o participante altere a resposta antes do encerramento" />}
              />
            )}
          </div>
          <Field label="Explicação após a resposta (opcional)" htmlFor="q-expl" error={msg("explanation")} hint="Exibida quando o resultado é revelado — ideal para comentar o gabarito.">
            <Textarea id="q-expl" rows={3} maxLength={2000} aria-invalid={!!msg("explanation")} {...register("explanation")} />
          </Field>
        </TabsContent>
      </Tabs>

      {/* ============================================================ rodapé fixo */}
      <div className="sticky bottom-0 -mx-6 mt-6 flex flex-col gap-3 border-t border-border bg-card px-6 py-4">
        {serverError && (
          <div className="flex items-start gap-2 rounded-xl bg-negative/10 px-3 py-2 text-sm font-bold text-negative" role="alert">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{serverError}</span>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Gráfico: <span className="font-bold text-foreground">{CHART_META[v.chart.type].label}</span>
            {scored && <> · {v.scoring.basePoints} pts base</>}
            {v.timeLimitSec ? <> · {v.timeLimitSec}s</> : null}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {original ? "Salvar alterações" : "Salvar pergunta"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

/* ================================================================== seções */
type Msg = (path: string) => string | undefined;
type Ctl = ReturnType<typeof useForm<FormValues>>["control"];
type SetVal = ReturnType<typeof useForm<FormValues>>["setValue"];
type Reg = ReturnType<typeof useForm<FormValues>>["register"];

function ScaleSection({ control, register, type, locked, msg, v }: { control: Ctl; register: Reg; type: QuestionType; locked: boolean; msg: Msg; v: FormValues }) {
  const nps = type === "NPS";
  const min = nps ? 0 : v.scaleMin;
  const max = nps ? 10 : v.scaleMax;
  const valid = Number.isFinite(min) && Number.isFinite(max) && min < max;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h4 className="font-black">{nps ? "Escala NPS (fixa de 0 a 10)" : "Limites da escala"}</h4>
        <p className="text-sm text-muted-foreground">
          {nps ? "Promotores: 9–10 · Neutros: 7–8 · Detratores: 0–6. Escalas não usam alternativas nem pontuação." : "Escolha valores entre 0 e 10. Escalas não usam alternativas nem pontuação."}
        </p>
      </div>
      {!nps && (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Valor mínimo" htmlFor="q-smin" required error={msg("scaleMin")} hint={locked ? "Bloqueado: a pergunta já tem respostas." : undefined}>
            <Controller
              control={control}
              name="scaleMin"
              render={({ field }) => (
                <NativeSelect id="q-smin" value={field.value} disabled={locked} onChange={(e) => field.onChange(Number(e.target.value))}>
                  {Array.from({ length: 10 }, (_, i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </NativeSelect>
              )}
            />
          </Field>
          <Field label="Valor máximo" htmlFor="q-smax" required error={msg("scaleMax")}>
            <Controller
              control={control}
              name="scaleMax"
              render={({ field }) => (
                <NativeSelect id="q-smax" value={field.value} disabled={locked} onChange={(e) => field.onChange(Number(e.target.value))}>
                  {Array.from({ length: 10 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </NativeSelect>
              )}
            />
          </Field>
        </div>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={`Rótulo do valor ${min}`} htmlFor="q-smin-l" error={msg("scaleMinLabel")} hint="Opcional. Ex.: Discordo totalmente">
          <Input id="q-smin-l" maxLength={60} {...register("scaleMinLabel")} />
        </Field>
        <Field label={`Rótulo do valor ${max}`} htmlFor="q-smax-l" error={msg("scaleMaxLabel")} hint="Opcional. Ex.: Concordo totalmente">
          <Input id="q-smax-l" maxLength={60} {...register("scaleMaxLabel")} />
        </Field>
      </div>
      {valid && (
        <div aria-label="Como o participante verá a escala">
          <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-muted-foreground">Como o participante verá</span>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
              <span
                key={n}
                className={cn(
                  "grid size-10 place-items-center rounded-xl border text-sm font-black tabular",
                  nps ? (n <= 6 ? "border-negative/40 text-negative" : n <= 8 ? "border-warning/40 text-warning" : "border-positive/40 text-positive") : "border-border",
                )}
              >
                {n}
              </span>
            ))}
          </div>
          {(v.scaleMinLabel || v.scaleMaxLabel) && (
            <div className="mt-1.5 flex justify-between gap-4 text-xs text-muted-foreground">
              <span>{v.scaleMinLabel}</span>
              <span>{v.scaleMaxLabel}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SelectionsSection({ control, type, locked, count, msg, setValue, v }: { control: Ctl; type: QuestionType; locked: boolean; count: number; msg: Msg; setValue: SetVal; v: FormValues }) {
  const forced = isForcedSingle(type);
  const multi = type === "MULTIPLA_CORRETA" || (!forced && v.maxSelections > 1);
  return (
    <div className="rounded-xl border border-border p-4">
      <h4 className="font-black">Seleções</h4>
      {forced ? (
        <p className="mt-1 text-sm text-muted-foreground">Resposta única — o participante escolhe exatamente uma alternativa.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-4">
          {type !== "MULTIPLA_CORRETA" && (
            <Switch
              checked={multi}
              disabled={locked || count < 2}
              onCheckedChange={(on) => {
                setValue("minSelections", 1, { shouldDirty: true });
                setValue("maxSelections", on ? Math.max(2, count) : 1, { shouldDirty: true });
              }}
              label="Permitir múltiplas respostas"
            />
          )}
          {type === "MULTIPLA_CORRETA" && (
            <p className="text-sm text-muted-foreground">Esta modalidade exige selecionar mais de uma alternativa (mínimo 2). A resposta só é correta se o conjunto marcado for exatamente o gabarito.</p>
          )}
          {multi && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Mínimo de seleções" htmlFor="q-minsel" error={msg("minSelections")}>
                <Controller
                  control={control}
                  name="minSelections"
                  render={({ field }) => (
                    <NumberInput id="q-minsel" value={field.value} onChange={(n) => field.onChange(n ?? NaN)} min={type === "MULTIPLA_CORRETA" ? 2 : 1} max={Math.max(1, count)} disabled={locked} invalid={!!msg("minSelections")} />
                  )}
                />
              </Field>
              <Field label="Máximo de seleções" htmlFor="q-maxsel" error={msg("maxSelections")} hint={`Até ${count} (número de alternativas).`}>
                <Controller
                  control={control}
                  name="maxSelections"
                  render={({ field }) => <NumberInput id="q-maxsel" value={field.value} onChange={(n) => field.onChange(n ?? NaN)} min={1} max={Math.max(1, count)} disabled={locked} invalid={!!msg("maxSelections")} />}
                />
              </Field>
            </div>
          )}
          {multi && <p className="text-xs text-muted-foreground">Gráficos parte-do-todo (pizza, rosca, waffle…) ficam indisponíveis em múltipla seleção, pois a soma das seleções excede o número de pessoas.</p>}
        </div>
      )}
      {forced && msg("maxSelections") && <p className="mt-1 text-xs font-bold text-negative">{msg("maxSelections")}</p>}
    </div>
  );
}

function ScoringSection({ control, locked, msg, v, goToBehavior }: { control: Ctl; locked: boolean; msg: Msg; v: FormValues; goToBehavior: () => void }) {
  const s = v.scoring;
  const limit = v.timeLimitSec;
  const valid = [s.basePoints, s.weight, s.speedBonusMax, s.wrongPenalty].every((n) => Number.isFinite(n));
  const exampleTime = limit ? Math.max(1, Math.round(limit / 3)) : null;
  const ex = valid && exampleTime && limit ? scoreAnswer(s, true, exampleTime * 1000, limit * 1000) : null;
  const exFast = valid && limit ? scoreAnswer(s, true, 1000, limit * 1000) : null;
  const exNoBonus = valid ? scoreAnswer({ ...s, speedBonusEnabled: false }, true, 0, null) : null;
  const exWrong = valid ? scoreAnswer(s, false, 0, null) : null;
  const num = (name: "scoring.basePoints" | "scoring.weight" | "scoring.speedBonusMax" | "scoring.wrongPenalty", label: string, opts: { min: number; max: number; step?: number; hint?: string; disabled?: boolean }) => (
    <Field label={label} htmlFor={`q-${name}`} error={msg(name)} hint={opts.hint}>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <NumberInput id={`q-${name}`} value={field.value} onChange={(n) => field.onChange(n ?? NaN)} min={opts.min} max={opts.max} step={opts.step ?? 1} disabled={locked || opts.disabled} invalid={!!msg(name)} />
        )}
      />
    </Field>
  );
  return (
    <div className="flex flex-col gap-5">
      {locked && (
        <p className="flex items-center gap-2 text-sm font-bold text-warning">
          <Lock className="size-4" /> Pontuação bloqueada: a pergunta já tem respostas.
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        {num("scoring.basePoints", "Pontos base (acerto)", { min: 0, max: 10000, hint: "Padrão: 100." })}
        {num("scoring.weight", "Peso", { min: 0.1, max: 10, step: 0.1, hint: "Multiplica os pontos (0,1 a 10). Padrão: 1." })}
      </div>
      <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
        <Controller
          control={control}
          name="scoring.speedBonusEnabled"
          render={({ field }) => <Switch checked={field.value} disabled={locked} onCheckedChange={field.onChange} label="Bônus por velocidade" />}
        />
        {s.speedBonusEnabled && !limit && (
          <p className="flex flex-wrap items-center gap-1 text-sm font-bold text-warning">
            <TriangleAlert className="size-4" /> O bônus por velocidade exige um tempo limite.
            <Button type="button" variant="link" size="sm" className="h-auto" onClick={goToBehavior}>
              Definir tempo limite
            </Button>
          </p>
        )}
        {num("scoring.speedBonusMax", "Bônus máximo", { min: 0, max: 10000, hint: "Padrão: 50.", disabled: !s.speedBonusEnabled })}
      </div>
      {num("scoring.wrongPenalty", "Penalidade por erro", { min: 0, max: 10000, hint: "Pontos descontados em caso de erro (multiplicados pelo peso). Padrão: 0." })}

      <div className="rounded-2xl bg-muted p-4 text-sm">
        <p className="font-black">Como a pontuação é calculada</p>
        <p className="mt-2">
          Acerto: <code className="rounded bg-card px-1.5 py-0.5 font-mono text-xs">pontos = floor((pontosBase + bonus) × peso)</code>
        </p>
        <p className="mt-1">
          Bônus: <code className="rounded bg-card px-1.5 py-0.5 font-mono text-xs">bonus = floor(bonusMaximo × max(0, 1 − tempo/limite))</code>
        </p>
        <p className="mt-1">
          Erro: <code className="rounded bg-card px-1.5 py-0.5 font-mono text-xs">pontos = −floor(penalidade × peso)</code>
        </p>
        <div className="mt-3 border-t border-border pt-3">
          <p className="font-bold">Exemplo com a configuração atual</p>
          {!valid ? (
            <p className="text-muted-foreground">Preencha os valores para ver o exemplo.</p>
          ) : s.speedBonusEnabled && limit && ex && exFast && exampleTime ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>
                Acerto em {exampleTime}s de {limit}s: bônus = floor({s.speedBonusMax} × (1 − {exampleTime}/{limit})) = <b>{ex.bonus}</b> → total <b className="tabular">{ex.points} pts</b>
              </li>
              <li>
                Acerto em 1s: bônus {exFast.bonus} → <b className="tabular">{exFast.points} pts</b>
              </li>
              <li>
                Acerto no último segundo: <b className="tabular">{Math.floor(s.basePoints * s.weight)} pts</b> (sem bônus)
              </li>
              <li>
                Erro ou sem resposta: <b className="tabular">{exWrong!.points} pts</b>
              </li>
            </ul>
          ) : (
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>
                Acerto: <b className="tabular">{exNoBonus!.points} pts</b> {!s.speedBonusEnabled ? "(bônus por velocidade desligado)" : "(sem tempo limite não há bônus)"}
              </li>
              <li>
                Erro: <b className="tabular">{exWrong!.points} pts</b>
              </li>
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ nuvem de palavras */
const WC_MODE_HINTS: Record<WordCloudMode, string> = {
  PALAVRA: "Cada palavra da resposta conta separadamente na nuvem; artigos e preposições podem ser descartados. Ideal para respostas de uma a três palavras.",
  FRASE: "A resposta inteira vira um único termo (ex.: “falta de tempo”), preservando a expressão. Ideal para frases curtas.",
};

type WcSwitch = "wordCloud.allowRepeat" | "wordCloud.requireApproval" | "wordCloud.profanityFilter" | "wordCloud.groupEquivalent" | "wordCloud.ignoreCase" | "wordCloud.foldAccents" | "wordCloud.ignoreStopwords";

function WordCloudRulesSection({ control, register, locked, msg, v, goTo }: { control: Ctl; register: Reg; locked: boolean; msg: Msg; v: FormValues; goTo: (t: EditorTab) => void }) {
  const w = v.wordCloud;
  const synonyms = useFieldArray({ control, name: "wordCloud.synonyms", keyName: "key" });
  const [sample, setSample] = useState("");
  const lockHint = "Bloqueado: a pergunta já tem respostas.";
  const limitsValid = [w.maxWords, w.maxEntries, w.maxChars].every((n) => Number.isFinite(n) && n > 0);
  const test = sample.trim() && limitsValid ? prepareEntry(sample, w) : null;
  const blockedErr = msg("wordCloud.blockedWords") ?? w.blockedWords.map((_, i) => msg(`wordCloud.blockedWords.${i}`)).find(Boolean);

  const num = (name: "wordCloud.maxWords" | "wordCloud.maxEntries" | "wordCloud.maxChars", label: string, opts: { min: number; max: number; hint: string }) => (
    <Field label={label} htmlFor={`q-${name}`} error={msg(name)} hint={locked ? lockHint : opts.hint}>
      <Controller
        control={control}
        name={name}
        render={({ field }) => <NumberInput id={`q-${name}`} value={field.value} onChange={(n) => field.onChange(n ?? NaN)} min={opts.min} max={opts.max} disabled={locked} invalid={!!msg(name)} />}
      />
    </Field>
  );
  const sw = (name: WcSwitch, label: string, hint: string, disabled = false) => (
    <div className="flex flex-col gap-1">
      <Controller control={control} name={name} render={({ field }) => <Switch checked={field.value} disabled={disabled} onCheckedChange={field.onChange} label={label} />} />
      <p className="pl-14 text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {locked && (
        <p className="flex items-center gap-2 text-sm font-bold text-warning">
          <Lock className="size-4" /> Regras de coleta bloqueadas: a pergunta já tem respostas. Moderação, sinônimos e bloqueios continuam editáveis.
        </p>
      )}
      {msg("wordCloud") && (
        <p className="rounded-xl bg-negative/10 px-3 py-2 text-sm font-bold text-negative" role="alert">
          {msg("wordCloud")}
        </p>
      )}

      {/* ---------------------------------------------------------- modo */}
      <div>
        <h4 className="font-black">Modo de resposta</h4>
        <Controller
          control={control}
          name="wordCloud.mode"
          render={({ field }) => (
            <div className="mt-2 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Modo de resposta">
              {WC_MODES.map((m) => {
                const active = field.value === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={locked}
                    onClick={() => field.onChange(m)}
                    className={cn(
                      "rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-60",
                      active ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-border bg-card hover:border-brand/50 hover:bg-muted/50",
                    )}
                  >
                    <span className="font-black">{WC_MODE_LABELS[m]}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">{WC_MODE_HINTS[m]}</span>
                  </button>
                );
              })}
            </div>
          )}
        />
        {locked && <p className="mt-1.5 text-xs text-muted-foreground">{lockHint}</p>}
      </div>

      {/* ---------------------------------------------------------- limites */}
      <div className="rounded-xl border border-border p-4">
        <h4 className="font-black">Limites por participante</h4>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {num("wordCloud.maxWords", "Máximo de palavras por resposta", { min: 1, max: 10, hint: w.mode === "PALAVRA" ? "De 1 a 10. Artigos e preposições ignorados não contam." : "De 1 a 10 palavras na frase." })}
          {num("wordCloud.maxEntries", "Máximo de envios por participante", { min: 1, max: 20, hint: "De 1 a 20 respostas por pessoa." })}
          {num("wordCloud.maxChars", "Limite de caracteres", { min: 10, max: 200, hint: "De 10 a 200 caracteres por resposta." })}
        </div>
        <div className="mt-4 flex flex-col gap-3">
          {sw("wordCloud.allowRepeat", "Permitir respostas repetidas do mesmo participante", locked ? lockHint : "Quando desligado, a mesma pessoa não pode enviar o mesmo termo duas vezes.", locked)}
          {sw("wordCloud.requireApproval", "Exigir aprovação antes de exibir", locked ? lockHint : "Cada envio fica pendente até o moderador aprovar; só os aprovados entram na nuvem.", locked)}
        </div>
      </div>

      {/* ---------------------------------------------------------- moderação e agrupamento */}
      <div className="rounded-xl border border-border p-4">
        <h4 className="font-black">Moderação e agrupamento</h4>
        <p className="text-sm text-muted-foreground">Estas regras são aplicadas na contagem e podem ser ajustadas a qualquer momento — valem também para as respostas já recebidas.</p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {sw("wordCloud.profanityFilter", "Filtro de palavras inadequadas", "Recusa palavrões e ofensas comuns (inclusive com troca de letras por números).")}
          {sw("wordCloud.groupEquivalent", "Agrupar palavras equivalentes", "Conta como um só termo as variações abaixo (ex.: “Vendas” e “vendas”).")}
          {sw("wordCloud.ignoreCase", "Ignorar maiúsculas/minúsculas", "“CRM”, “crm” e “Crm” viram o mesmo termo.", !w.groupEquivalent)}
          {sw("wordCloud.foldAccents", "Ignorar acentos", "“negociação” e “negociacao” viram o mesmo termo.", !w.groupEquivalent)}
          {sw(
            "wordCloud.ignoreStopwords",
            "Ignorar palavras comuns (artigos e preposições)",
            w.mode === "PALAVRA" ? "“a”, “de”, “para”, “com”… não entram na nuvem nem contam no limite de palavras." : "Só se aplica ao modo Palavra-chave.",
            w.mode !== "PALAVRA",
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------- bloqueios */}
      <Field
        label="Palavras bloqueadas"
        htmlFor="q-wc-blocked"
        error={blockedErr}
        hint={`Uma por linha ou separadas por vírgula. Respostas com esses termos são recusadas no celular. ${w.blockedWords.length}/200 termos.`}
      >
        <Controller
          control={control}
          name="wordCloud.blockedWords"
          render={({ field }) => <TermListInput id="q-wc-blocked" multiline value={field.value} onChange={field.onChange} maxItems={200} invalid={!!blockedErr} placeholder={"concorrente x\npalavra proibida"} />}
        />
      </Field>

      {/* ---------------------------------------------------------- sinônimos */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h4 className="font-black">
              Sinônimos <span className="font-bold text-muted-foreground tabular">({synonyms.fields.length}/100)</span>
            </h4>
            <p className="text-sm text-muted-foreground">Agrupe variações sob um termo canônico — ex.: “Prospecção” reúne “prospectar”, “captação” e “prospeccao”.</p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={synonyms.fields.length >= 100} onClick={() => synonyms.append({ canonical: "", variants: [] })}>
            <Plus /> Adicionar grupo
          </Button>
        </div>
        {msg("wordCloud.synonyms") && <p className="text-xs font-bold text-negative">{msg("wordCloud.synonyms")}</p>}
        {synonyms.fields.length > 0 && (
          <ol className="flex flex-col gap-2">
            {synonyms.fields.map((f, i) => {
              const canonErr = msg(`wordCloud.synonyms.${i}.canonical`);
              const varErr = msg(`wordCloud.synonyms.${i}.variants`) ?? (v.wordCloud.synonyms[i]?.variants ?? []).map((_, j) => msg(`wordCloud.synonyms.${i}.variants.${j}`)).find(Boolean);
              return (
                <li key={f.key} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-start">
                  <div className="sm:w-56">
                    <Label htmlFor={`syn-c-${f.key}`} className="sr-only">
                      Termo canônico do grupo {i + 1}
                    </Label>
                    <Input id={`syn-c-${f.key}`} maxLength={60} placeholder="Termo canônico" aria-invalid={!!canonErr} {...register(`wordCloud.synonyms.${i}.canonical`)} />
                    {canonErr && <p className="mt-1 text-xs font-bold text-negative">{canonErr}</p>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Label htmlFor={`syn-v-${f.key}`} className="sr-only">
                      Variações do grupo {i + 1}
                    </Label>
                    <Controller
                      control={control}
                      name={`wordCloud.synonyms.${i}.variants`}
                      render={({ field }) => <TermListInput id={`syn-v-${f.key}`} value={field.value} onChange={field.onChange} maxItems={30} invalid={!!varErr} placeholder="Variações separadas por vírgula" />}
                    />
                    {varErr && <p className="mt-1 text-xs font-bold text-negative">{varErr}</p>}
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => synonyms.remove(i)} aria-label={`Remover grupo de sinônimos ${i + 1}`} className="text-negative hover:bg-negative/10">
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* ---------------------------------------------------------- teste */}
      <div className="rounded-2xl bg-muted p-4 text-sm">
        <Label htmlFor="q-wc-test" className="font-black">
          Testar uma resposta
        </Label>
        <p className="text-muted-foreground">Digite como um participante para ver como a resposta será contada com as regras atuais.</p>
        <Input id="q-wc-test" className="mt-2 bg-card" value={sample} maxLength={300} placeholder="Ex.: falta de tempo para prospectar" onChange={(e) => setSample(e.target.value)} />
        {test && (
          <div className="mt-2" role="status">
            {test.ok ? (
              <p className="flex flex-wrap items-center gap-1.5">
                <span className="font-bold text-positive">Aceita · conta como:</span>
                {test.terms.map((t, i) => (
                  <Badge key={`${t}-${i}`} tone="muted">
                    {t}
                  </Badge>
                ))}
              </p>
            ) : (
              <p className="font-bold text-negative">Recusada: {test.message}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-border px-3 py-2 text-sm" role="note">
        <Info className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
        <p className="text-muted-foreground">
          A <b className="text-foreground">duração</b> da coleta fica em{" "}
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => goTo("comportamento")}>
            Comportamento › Tempo limite
          </Button>{" "}
          e o <b className="text-foreground">texto de orientação</b> ao participante em{" "}
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => goTo("pergunta")}>
            Pergunta › Descrição
          </Button>
          .
        </p>
      </div>
    </div>
  );
}

const WC_STYLE_HINTS: Record<WordCloudStyle, string> = {
  GESTALT: "Azul-marinho com destaques em fúcsia e branco.",
  COLORIDO: "Paleta viva e variada, ideal para telões.",
  MINIMALISTA: "Fundo claro e tons neutros, discreto.",
};
/** Fundo sugerido ao escolher o estilo (o organizador ainda pode trocar). */
const WC_STYLE_BG: Record<WordCloudStyle, WordCloudBackground | null> = { GESTALT: "ESCURO", COLORIDO: null, MINIMALISTA: "CLARO" };

function WordCloudDisplaySection({ control, setValue, msg, v }: { control: Ctl; setValue: SetVal; msg: Msg; v: FormValues }) {
  const d = v.chart.wordCloud;
  const [replay, setReplay] = useState(0);
  const title = v.title.trim() || "Pré-visualização da nuvem";
  const data = useMemo(() => previewWordCloud(title, v.wordCloud.mode), [title, v.wordCloud.mode]);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="flex flex-col gap-5">
        <div>
          <span className="text-sm font-bold">Estilo</span>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Estilo da nuvem">
            {WC_STYLES.map((s) => {
              const active = d.style === s;
              const p = paletteFor(s, WC_STYLE_BG[s] ?? d.background);
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setValue("chart.wordCloud.style", s, { shouldDirty: true });
                    const bg = WC_STYLE_BG[s];
                    if (bg) setValue("chart.wordCloud.background", bg, { shouldDirty: true });
                  }}
                  className={cn(
                    "flex flex-col gap-2 rounded-2xl border p-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                    active ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-border bg-card hover:border-brand/50 hover:bg-muted/50",
                  )}
                >
                  <span className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-black/10 font-black" style={{ background: p.background }} aria-hidden="true">
                    <span className="text-lg" style={{ color: p.accent }}>
                      Aa
                    </span>
                    <span className="text-sm" style={{ color: p.colors[0] }}>
                      Aa
                    </span>
                    <span className="text-xs" style={{ color: p.colors[1] }}>
                      Aa
                    </span>
                  </span>
                  <span className="font-black">{WC_STYLE_LABELS[s]}</span>
                  <span className="text-xs text-muted-foreground">{WC_STYLE_HINTS[s]}</span>
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Fundo" error={msg("chart.wordCloud.background")}>
          <Controller
            control={control}
            name="chart.wordCloud.background"
            render={({ field }) => (
              <div className="inline-flex w-fit rounded-xl border border-border p-1" role="radiogroup" aria-label="Fundo">
                {(["ESCURO", "CLARO"] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    role="radio"
                    aria-checked={field.value === b}
                    onClick={() => field.onChange(b)}
                    className={cn("rounded-lg px-4 py-1.5 text-sm font-bold transition", field.value === b ? "bg-brand text-white" : "text-muted-foreground hover:bg-muted")}
                  >
                    {b === "ESCURO" ? "Escuro" : "Claro"}
                  </button>
                ))}
              </div>
            )}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Animação de entrada" htmlFor="q-wc-anim" error={msg("chart.wordCloud.animation")}>
            <Controller
              control={control}
              name="chart.wordCloud.animation"
              render={({ field }) => (
                <NativeSelect id="q-wc-anim" value={field.value} onChange={(e) => field.onChange(e.target.value)}>
                  {WC_ANIMATIONS.map((a) => (
                    <option key={a} value={a}>
                      {WC_ANIMATION_LABELS[a]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            />
          </Field>
          <Field label="Máximo de termos exibidos" htmlFor="q-wc-max" error={msg("chart.wordCloud.maxTerms")} hint="De 10 a 150. Os mais citados têm prioridade.">
            <Controller
              control={control}
              name="chart.wordCloud.maxTerms"
              render={({ field }) => <NumberInput id="q-wc-max" value={field.value} onChange={(n) => field.onChange(n ?? NaN)} min={10} max={150} step={5} invalid={!!msg("chart.wordCloud.maxTerms")} />}
            />
          </Field>
        </div>

        <Controller
          control={control}
          name="chart.wordCloud.showFrequency"
          render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} label="Mostrar frequência dos termos" />}
        />
        <p className="text-xs text-muted-foreground">A aparência pode ser ajustada a qualquer momento, inclusive durante a palestra.</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold">Pré-visualização</span>
          <Button type="button" variant="outline" size="sm" disabled={d.animation === "NENHUMA"} onClick={() => setReplay((r) => r + 1)}>
            <Play /> Ver animação
          </Button>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border">
          <ChartView
            key={replay}
            data={data}
            type="wordcloud"
            config={{ showPercent: v.chart.showPercent, showValues: v.chart.showValues, showLegend: v.chart.showLegend, sortDesc: v.chart.sortDesc, colors: null, wordCloud: d }}
            theme={d.background === "CLARO" ? "light" : "dark"}
            preview={replay === 0}
            showToolbar={false}
            showTotals={false}
            height={260}
          />
        </div>
        <p className="text-xs text-muted-foreground">Dados de demonstração — veja como a nuvem ficará no telão antes de salvar.</p>
      </div>
    </div>
  );
}

const parseTerms = (raw: string) => {
  const out: string[] = [];
  for (const part of raw.split(/[\n,;]/)) {
    const t = part.trim();
    if (t && !out.some((x) => x.toLocaleLowerCase("pt-BR") === t.toLocaleLowerCase("pt-BR"))) out.push(t);
  }
  return out;
};

/** Lista de termos digitada como texto livre (vírgula, ponto e vírgula ou quebra de linha). */
function TermListInput({
  id,
  value,
  onChange,
  multiline,
  maxItems,
  invalid,
  placeholder,
}: {
  id: string;
  value: string[];
  onChange: (v: string[]) => void;
  multiline?: boolean;
  maxItems: number;
  invalid?: boolean;
  placeholder?: string;
}) {
  const join = (list: string[]) => list.join(multiline ? "\n" : ", ");
  const [text, setText] = useState(() => join(value ?? []));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    // valor trocado por fora (ex.: grupo removido): reflete no texto
    setPrev(value);
    if (parseTerms(text).slice(0, maxItems).join("\u0000") !== (value ?? []).join("\u0000")) setText(join(value ?? []));
  }
  const change = (t: string) => {
    setText(t);
    onChange(parseTerms(t).slice(0, maxItems));
  };
  return multiline ? (
    <Textarea id={id} rows={4} value={text} placeholder={placeholder} aria-invalid={invalid} onChange={(e) => change(e.target.value)} />
  ) : (
    <Input id={id} value={text} placeholder={placeholder} aria-invalid={invalid} onChange={(e) => change(e.target.value)} />
  );
}

function ColorsSection({ v, numeric, scored, setValue, msg }: { v: FormValues; numeric: boolean; scored: boolean; setValue: SetVal; msg: Msg }) {
  if (numeric) {
    const min = v.type === "NPS" ? 0 : v.scaleMin;
    const max = v.type === "NPS" ? 10 : v.scaleMax;
    const n = Number.isFinite(min) && Number.isFinite(max) && max > min ? max - min + 1 : 0;
    const custom = !!v.chart.colors;
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
        <Switch
          checked={custom}
          onCheckedChange={(on) => setValue("chart.colors", on ? Array.from({ length: n }, (_, i) => PALETTE[i % PALETTE.length]) : null, { shouldDirty: true })}
          label="Cores personalizadas por valor da escala"
        />
        {custom && (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: n }, (_, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <ColorDot
                  value={v.chart.colors?.[i] ?? null}
                  fallback={PALETTE[i % PALETTE.length]}
                  allowReset={false}
                  onChange={(c) => {
                    const arr = Array.from({ length: n }, (_, j) => v.chart.colors?.[j] ?? PALETTE[j % PALETTE.length]);
                    arr[i] = c ?? PALETTE[i % PALETTE.length];
                    setValue("chart.colors", arr, { shouldDirty: true });
                  }}
                  label={`Cor do valor ${min + i}`}
                />
                <span className="text-xs font-bold tabular">{min + i}</span>
              </div>
            ))}
          </div>
        )}
        {msg("chart.colors") && <p className="text-xs font-bold text-negative">{msg("chart.colors")}</p>}
      </div>
    );
  }
  if (v.options.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-4">
      <span className="text-sm font-bold">Cores por alternativa</span>
      <div className="flex flex-wrap gap-3">
        {v.options.map((o, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <ColorDot value={o.color} fallback={PALETTE[i % PALETTE.length]} onChange={(c) => setValue(`options.${i}.color`, c, { shouldDirty: true })} label={`Cor da alternativa ${letter(i)}`} />
            <span className="max-w-32 truncate text-xs font-bold">{o.label || `Alternativa ${letter(i)}`}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Sem cor definida, a paleta padrão é usada.{scored && " Ao revelar o gabarito, as corretas aparecem em verde e as demais esmaecidas."}
      </p>
    </div>
  );
}

/* ================================================================== controles */
function ColorDot({ value, fallback, onChange, label, allowReset = true }: { value: string | null; fallback: string; onChange: (c: string | null) => void; label: string; allowReset?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-center">
      <label htmlFor={id} className="relative grid size-9 cursor-pointer place-items-center rounded-lg border border-border hover:bg-muted" title={label}>
        <span className={cn("size-5 rounded-full border border-black/10", !value && "opacity-60 ring-2 ring-dashed ring-border")} style={{ background: value ?? fallback }} aria-hidden="true" />
        <input id={id} type="color" className="absolute inset-0 cursor-pointer opacity-0" value={(value ?? fallback).toLowerCase()} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      </label>
      {allowReset && value && (
        <button type="button" onClick={() => onChange(null)} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label={`${label}: usar cor automática`} title="Usar cor automática">
          <RotateCcw className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Campo numérico que aceita vazio durante a digitação (vazio → null). */
function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  id,
  className,
  invalid,
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
  invalid?: boolean;
}) {
  const show = (n: number | null) => (n === null || Number.isNaN(n) ? "" : String(n));
  const [text, setText] = useState(show(value));
  useEffect(() => {
    const parsed = text.trim() === "" ? null : Number(text.replace(",", "."));
    const same = parsed === value || (Number.isNaN(parsed as number) && Number.isNaN(value as number));
    if (!same) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      id={id}
      type="number"
      inputMode={step < 1 ? "decimal" : "numeric"}
      className={className}
      value={text}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-invalid={invalid}
      onChange={(e) => {
        setText(e.target.value);
        const t = e.target.value.trim();
        onChange(t === "" ? null : Number(t.replace(",", ".")));
      }}
    />
  );
}

function TagsInput({ id, value, onChange }: { id: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim().slice(0, 40))
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase()) && next.length < 20) next.push(p);
    onChange(next);
    setText("");
  };
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-input bg-card px-2 py-1.5 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
      {value.map((t) => (
        <Badge key={t} tone="muted" className="gap-1 pr-1">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="rounded-full p-0.5 hover:bg-card" aria-label={`Remover tag ${t}`}>
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <input
        id={id}
        value={text}
        maxLength={41}
        disabled={value.length >= 20}
        placeholder={value.length ? "" : "Digite e pressione Enter"}
        className="h-7 min-w-24 flex-1 bg-transparent px-1 text-[15px] outline-none placeholder:text-muted-foreground/70"
        onChange={(e) => {
          if (e.target.value.includes(",")) add(e.target.value);
          else setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => add(text)}
      />
    </div>
  );
}
