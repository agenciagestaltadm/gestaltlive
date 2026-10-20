"use client";
/** Configurações do item selecionado (coluna direita do editor). */
import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, ImageIcon, Info, MousePointerClick, NotebookPen, Search, X } from "lucide-react";
import {
  FITS,
  FIT_LABELS,
  ITEM_TYPE_LABELS,
  OPEN_MODES,
  OPEN_MODE_LABELS,
  OPENS_QUESTION,
  TRANSITIONS,
  TRANSITION_LABELS,
  isQuestionItem,
  type AssetDTO,
  type ItemSettings,
  type PresentationItemType,
  type PresentationSettings,
} from "@shared/presentations";
import { CHART_META, type ChartType } from "@shared/charts/catalog";
import { chartContextForQuestion, compatibleCharts } from "@shared/charts/compat";
import { isScoredType, isTextType } from "@shared/schemas";
import { admin } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, EmptyState, Field, Input, NativeSelect, Separator, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import type { QuestionRow } from "@/components/builder/types";
import { ItemTypeIcon } from "./item-visual";
import { ItemPreview } from "./item-preview";
import type { RehearsalSource } from "./rehearsal-state";
import { itemDisplayTitle, questionRef, type AssetListResponse, type EditorItem } from "./types";

export type ItemUpdater = (id: string, fn: (it: EditorItem) => EditorItem, coalesce?: string) => void;

export interface ItemSettingsPanelProps {
  item: EditorItem | null;
  index: number;
  selectionCount: number;
  presentationSettings: PresentationSettings;
  questions: QuestionRow[];
  orgId: string;
  readOnly: boolean;
  invalid: string | null;
  previewSource: RehearsalSource;
  onUpdate: ItemUpdater;
}

export function ItemSettingsPanel(p: ItemSettingsPanelProps) {
  const { item } = p;
  if (!item) {
    return (
      <EmptyState
        icon={<MousePointerClick />}
        title={p.selectionCount > 1 ? `${p.selectionCount} itens selecionados` : "Nenhum item selecionado"}
        description={p.selectionCount > 1 ? "Use a barra de ações em lote acima da linha do tempo." : "Clique num item da linha do tempo para configurá-lo. Ctrl/Shift + clique seleciona vários."}
        className="p-6"
      />
    );
  }
  // remonta ao trocar de item (estados locais dos campos de cor/número)
  return <ItemForm key={item.id} {...p} item={item} />;
}

function ItemForm({ item, index, selectionCount, presentationSettings: pset, questions, orgId, readOnly, invalid, previewSource, onUpdate }: ItemSettingsPanelProps & { item: EditorItem }) {
  const uid = useId();
  const set = (fn: (it: EditorItem) => EditorItem, key?: string) => onUpdate(item.id, fn, key ? `${item.id}:${key}` : undefined);
  const setS = <K extends keyof ItemSettings>(k: K, v: ItemSettings[K], coalesce = false) => set((it) => ({ ...it, settings: { ...it.settings, [k]: v } }), coalesce ? `s.${String(k)}` : undefined);
  const s = item.settings;
  const q = item.questionId ? questions.find((x) => x.id === item.questionId) ?? null : null;
  const isQ = isQuestionItem(item.type);
  const opens = OPENS_QUESTION.includes(item.type);

  return (
    <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-4">
      <legend className="sr-only">Configurações do item {index + 1}</legend>
      <div className="flex items-start gap-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-navy-900 text-white">
          <ItemTypeIcon type={item.type} className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Item {index + 1} · {ITEM_TYPE_LABELS[item.type]}
            {selectionCount > 1 ? ` · ${selectionCount} selecionados` : ""}
          </p>
          <p className="truncate font-black">{itemDisplayTitle(item)}</p>
        </div>
      </div>
      {invalid && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-negative/10 p-2.5 text-sm font-bold text-negative">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {invalid} O salvamento automático aguarda a correção.
        </p>
      )}

      <ItemPreview source={previewSource} index={index} label={`Prévia do item ${index + 1} no telão`} />

      <Field label="Título na linha do tempo" htmlFor={`${uid}-title`} hint="Opcional — só aparece para você no editor e no painel do apresentador.">
        <Input
          id={`${uid}-title`}
          value={item.title ?? ""}
          placeholder={itemDisplayTitle({ ...item, title: null })}
          maxLength={200}
          onChange={(e) => set((it) => ({ ...it, title: e.target.value || null }), "title")}
        />
      </Field>

      <Switch checked={item.hidden} onCheckedChange={(v) => set((it) => ({ ...it, hidden: v }))} label="Ocultar (pular este item ao apresentar)" disabled={readOnly} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <Field label="Transição" htmlFor={`${uid}-tr`}>
          <NativeSelect id={`${uid}-tr`} value={item.transition ?? ""} onChange={(e) => set((it) => ({ ...it, transition: (e.target.value || null) as EditorItem["transition"] }))}>
            <option value="">Padrão da apresentação ({TRANSITION_LABELS[pset.defaultTransition]})</option>
            {TRANSITIONS.map((t) => (
              <option key={t} value={t}>
                {TRANSITION_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <NumberField
          id={`${uid}-dur`}
          label="Tempo de permanência (s)"
          hint="Avança sozinho ao fim. Vazio = avanço manual."
          value={s.durationSec}
          max={3600}
          onCommit={(v) => setS("durationSec", v, true)}
        />
      </div>

      {item.type === "IMAGE_SLIDE" && (
        <Section title="Slide">
          {item.asset && (
            <p className="text-xs text-muted-foreground">
              {item.asset.originalName} · {item.asset.width}×{item.asset.height}px
            </p>
          )}
          <Field label="Enquadramento" htmlFor={`${uid}-fit`}>
            <NativeSelect id={`${uid}-fit`} value={s.fit ?? ""} onChange={(e) => setS("fit", (e.target.value || null) as ItemSettings["fit"])}>
              <option value="">Padrão da apresentação ({FIT_LABELS[pset.fit]})</option>
              {FITS.map((f) => (
                <option key={f} value={f}>
                  {FIT_LABELS[f]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <ColorField id={`${uid}-bg`} label="Cor de fundo" value={s.background} fallback={pset.background} onChange={(v) => setS("background", v, true)} />
        </Section>
      )}

      {isQ && (
        <Section title={item.type === "CHART" ? "Gráfico de resultados" : "Pergunta"}>
          <QuestionChooser item={item} questions={questions} onChange={(row, type) => set((it) => ({ ...it, type, questionId: row.id, question: questionRef(row) }))} uid={uid} />
          {!q && item.questionId && <p className="text-xs font-bold text-warning">A pergunta não foi encontrada no evento vinculado.</p>}
          {opens && (
            <>
              <Field label="Liberação" htmlFor={`${uid}-open`}>
                <NativeSelect id={`${uid}-open`} value={s.openMode} onChange={(e) => setS("openMode", e.target.value as ItemSettings["openMode"])}>
                  {OPEN_MODES.map((m) => (
                    <option key={m} value={m}>
                      {OPEN_MODE_LABELS[m]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                label="Fechar automaticamente no fim do tempo"
                htmlFor={`${uid}-ac`}
                hint={q?.timeLimitSec ? `A pergunta tem ${q.timeLimitSec}s de tempo limite.` : "A pergunta não tem tempo limite: o fechamento será manual."}
              >
                <NativeSelect
                  id={`${uid}-ac`}
                  value={s.autoCloseOnTimer === null ? "" : s.autoCloseOnTimer ? "1" : "0"}
                  onChange={(e) => setS("autoCloseOnTimer", e.target.value === "" ? null : e.target.value === "1")}
                >
                  <option value="">Herdar a configuração do evento</option>
                  <option value="1">Sim, fechar ao zerar o cronômetro</option>
                  <option value="0">Não, aguardar o comando</option>
                </NativeSelect>
              </Field>
              <Switch checked={s.advanceAfterClose} onCheckedChange={(v) => setS("advanceAfterClose", v)} label="Avançar para o próximo item após o encerramento" disabled={readOnly} />
              <Switch checked={s.closeOnLeave} onCheckedChange={(v) => setS("closeOnLeave", v)} label="Fechar a pergunta ao sair deste item" disabled={readOnly} />
            </>
          )}
          {item.type === "CHART" && <ChartTypeField uid={uid} q={q} value={s.chartType} onChange={(v) => setS("chartType", v)} />}
        </Section>
      )}

      {item.type === "CUSTOM_SCREEN" && (
        <Section title="Tela personalizada">
          <Field label="Título" htmlFor={`${uid}-h`}>
            <Input id={`${uid}-h`} value={s.heading ?? ""} maxLength={200} onChange={(e) => setS("heading", e.target.value || null, true)} />
          </Field>
          <Field label="Subtítulo" htmlFor={`${uid}-sh`}>
            <Input id={`${uid}-sh`} value={s.subheading ?? ""} maxLength={300} onChange={(e) => setS("subheading", e.target.value || null, true)} />
          </Field>
          <Field label="Mensagem" htmlFor={`${uid}-m`}>
            <Textarea id={`${uid}-m`} value={s.message ?? ""} maxLength={2000} rows={3} onChange={(e) => setS("message", e.target.value || null, true)} />
          </Field>
          <BackgroundImageField
            orgId={orgId}
            url={s.backgroundImageUrl}
            readOnly={readOnly}
            onChange={(a) => set((it) => ({ ...it, settings: { ...it.settings, backgroundAssetId: a?.id ?? null, backgroundImageUrl: a?.urls.tela ?? null } }))}
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <ColorField id={`${uid}-tc`} label="Cor do texto" value={s.textColor} fallback="#FFFFFF" onChange={(v) => setS("textColor", v, true)} />
            <ColorField id={`${uid}-cbg`} label="Fundo" value={s.background} fallback={pset.background} onChange={(v) => setS("background", v, true)} />
          </div>
        </Section>
      )}

      {(item.type === "LEADERBOARD" || item.type === "SATISFACTION" || item.type === "QR_CODE" || item.type === "AWARDS") && (
        <p className="flex items-start gap-2 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          {item.type === "LEADERBOARD"
            ? "Mostra o ranking ao vivo da sessão. Congelar/ocultar continua no painel de controle."
            : item.type === "SATISFACTION"
              ? "Mostra o termômetro de satisfação da sessão em tempo real."
              : item.type === "QR_CODE"
                ? "Mostra o QR Code e o código de entrada da sessão em destaque."
                : "Mostra os prêmios do evento; o pódio aparece quando for revelado no painel."}
        </p>
      )}

      <Separator />
      <Field
        label={
          <span className="inline-flex items-center gap-1.5">
            <NotebookPen className="size-4 text-brand" aria-hidden /> Notas do palestrante
          </span>
        }
        htmlFor={`${uid}-notes`}
        hint="Visível apenas no painel do apresentador — nunca aparece no telão nem para os participantes."
      >
        <Textarea
          id={`${uid}-notes`}
          value={item.notes ?? ""}
          maxLength={10_000}
          rows={5}
          placeholder="Pontos a falar, histórias, tempo previsto…"
          onChange={(e) => set((it) => ({ ...it, notes: e.target.value || null }), "notes")}
        />
      </Field>
    </fieldset>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border p-3">
      <h3 className="text-sm font-black">{title}</h3>
      {children}
    </section>
  );
}

function NumberField({ id, label, hint, value, max, onCommit }: { id: string; label: string; hint?: string; value: number | null; max: number; onCommit: (v: number | null) => void }) {
  const [text, setText] = useState(value ? String(value) : "");
  useEffect(() => setText(value ? String(value) : ""), [value]);
  const commit = (raw: string) => {
    const n = Math.round(Number(raw.replace(",", ".")));
    if (!raw.trim() || !Number.isFinite(n) || n <= 0) return onCommit(null);
    onCommit(Math.min(max, n));
  };
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input
        id={id}
        inputMode="numeric"
        type="number"
        min={0}
        max={max}
        value={text}
        placeholder="Manual"
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
      />
    </Field>
  );
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function ColorField({ id, label, value, fallback, onChange }: { id: string; label: string; value: string | null; fallback: string; onChange: (v: string | null) => void }) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const invalid = !!text && !HEX.test(text);
  return (
    <Field label={label} htmlFor={id} error={invalid ? "Use o formato #RRGGBB" : null} hint={value ? undefined : `Padrão: ${fallback}`}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: seletor`}
          value={HEX.test(text) ? text : fallback}
          onChange={(e) => {
            const v = e.target.value.toUpperCase();
            setText(v);
            onChange(v);
          }}
          className="h-11 w-12 shrink-0 cursor-pointer rounded-xl border border-input bg-card p-1"
        />
        <Input
          id={id}
          value={text}
          placeholder={fallback}
          maxLength={7}
          className="font-mono"
          aria-invalid={invalid}
          onChange={(e) => {
            const v = e.target.value.trim();
            setText(v);
            if (!v) onChange(null);
            else if (HEX.test(v)) onChange(v.toUpperCase());
          }}
        />
        {value && (
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(null)} aria-label={`${label}: usar padrão`} title="Usar padrão">
            <X />
          </Button>
        )}
      </div>
    </Field>
  );
}

function QuestionChooser({ item, questions, onChange, uid }: { item: EditorItem; questions: QuestionRow[]; onChange: (q: QuestionRow, type: PresentationItemType) => void; uid: string }) {
  const current = questions.find((x) => x.id === item.questionId) ?? null;
  const scored = current ? isScoredType(current.type) : item.question?.scored ?? false;
  // nuvem de palavras: só como Pergunta (não é enquete nem quiz) ou Gráfico
  const text = !!current && isTextType(current.type);
  const typeOptions: PresentationItemType[] = item.type === "CHART" ? ["CHART"] : text ? ["QUESTION"] : scored ? ["QUIZ", "QUESTION"] : ["QUESTION", "POLL"];
  const allowed = item.type === "QUIZ" ? questions.filter((x) => isScoredType(x.type)) : questions;
  return (
    <>
      <Field label="Pergunta do evento" htmlFor={`${uid}-q`}>
        <NativeSelect
          id={`${uid}-q`}
          value={item.questionId ?? ""}
          onChange={(e) => {
            const row = questions.find((x) => x.id === e.target.value);
            if (!row) return;
            const type: PresentationItemType = item.type === "CHART" ? "CHART" : isTextType(row.type) ? "QUESTION" : isScoredType(row.type) ? (item.type === "QUESTION" ? "QUESTION" : "QUIZ") : item.type === "QUIZ" ? "QUESTION" : item.type;
            onChange(row, type);
          }}
        >
          {!current && <option value={item.questionId ?? ""}>{item.question?.title ?? "Selecione"}</option>}
          {allowed.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title.length > 80 ? `${x.title.slice(0, 80)}…` : x.title}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {typeOptions.length > 1 && current && (
        <Field label="Apresentar como" htmlFor={`${uid}-qt`}>
          <NativeSelect id={`${uid}-qt`} value={item.type} onChange={(e) => onChange(current, e.target.value as PresentationItemType)}>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {ITEM_TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
    </>
  );
}

function ChartTypeField({ uid, q, value, onChange }: { uid: string; q: QuestionRow | null; value: ChartType | null; onChange: (v: ChartType | null) => void }) {
  const compatible = useMemo(() => {
    if (!q) return [] as ChartType[];
    return compatibleCharts(
      chartContextForQuestion({ type: q.type, optionCount: q.options.length, maxSelections: q.maxSelections, scaleMin: q.scaleMin, scaleMax: q.scaleMax, hasCross: !!q.chart.crossQuestionId }),
    );
  }, [q]);
  const incompatible = !!value && !!q && !compatible.includes(value);
  if (q && isTextType(q.type)) {
    // nuvem de palavras: a única visualização válida é a nuvem
    return (
      <Field label="Tipo de gráfico" htmlFor={`${uid}-ct`} hint="A Nuvem de Palavras é sempre exibida como nuvem; a aparência é configurada na própria pergunta.">
        <NativeSelect id={`${uid}-ct`} value={value ?? ""} onChange={(e) => onChange((e.target.value || null) as ChartType | null)}>
          <option value={value ?? ""}>{CHART_META.wordcloud.label}</option>
        </NativeSelect>
      </Field>
    );
  }
  return (
    <Field
      label="Tipo de gráfico"
      htmlFor={`${uid}-ct`}
      error={incompatible ? "Este gráfico não é compatível com a estrutura da pergunta." : null}
      hint="Somente visualizações estatisticamente corretas para esta pergunta são listadas."
    >
      <NativeSelect id={`${uid}-ct`} value={value ?? ""} onChange={(e) => onChange((e.target.value || null) as ChartType | null)} disabled={!q}>
        <option value="">Usar o configurado na pergunta{q ? ` (${CHART_META[q.chart.type].label})` : ""}</option>
        {incompatible && value && <option value={value}>{CHART_META[value].label} (incompatível)</option>}
        {compatible.map((t) => (
          <option key={t} value={t}>
            {CHART_META[t].label}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

function BackgroundImageField({ orgId, url, readOnly, onChange }: { orgId: string; url: string | null; readOnly: boolean; onChange: (a: AssetDTO | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-bold">Imagem de fundo</span>
      <div className="flex items-center gap-2">
        <div className="grid aspect-video w-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted">
          {url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <ImageIcon className="size-5 text-muted-foreground" aria-hidden />}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} disabled={readOnly}>
            Escolher da biblioteca
          </Button>
          {url && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)} disabled={readOnly}>
              Remover
            </Button>
          )}
        </div>
      </div>
      <AssetPickerDialog
        open={open}
        onOpenChange={setOpen}
        orgId={orgId}
        onPick={(a) => {
          setOpen(false);
          onChange(a);
        }}
      />
    </div>
  );
}

export function AssetPickerDialog({ open, onOpenChange, orgId, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; orgId: string; onPick: (a: AssetDTO) => void }) {
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQd(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const lib = useApi(open ? () => admin.get<AssetListResponse>(`/assets?orgId=${orgId}&pageSize=120${qd ? `&q=${encodeURIComponent(qd)}` : ""}`) : null, [open, orgId, qd]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Escolher imagem da biblioteca" description="Envie novas imagens pela aba Slides da biblioteca." className="max-w-3xl">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar arquivo" aria-label="Buscar arquivo" className="pl-9" />
      </div>
      {lib.loading && !lib.data ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="aspect-video" />
          ))}
        </div>
      ) : (lib.data?.rows.length ?? 0) === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{lib.error ? "Não foi possível carregar a biblioteca." : "Nenhuma imagem encontrada."}</p>
      ) : (
        <ul className="grid max-h-[60dvh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
          {lib.data!.rows.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onPick(a)} className={cn("block w-full overflow-hidden rounded-xl border border-border text-left hover:border-brand")} aria-label={`Usar ${a.originalName}`}>
                <img src={a.urls.mini} alt="" loading="lazy" decoding="async" className="aspect-video w-full bg-black object-contain" />
                <span className="block truncate px-1.5 py-1 text-[11px] font-bold">{a.originalName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
