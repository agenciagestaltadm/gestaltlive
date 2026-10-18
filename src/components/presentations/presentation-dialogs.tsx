"use client";
/** Diálogos do Gerenciador de Apresentações: nova, duplicar e configurações da apresentação. */
import { useEffect, useId, useState } from "react";
import { Copy, Info, Plus, Save } from "lucide-react";
import {
  FITS,
  FIT_LABELS,
  TRANSITIONS,
  TRANSITION_LABELS,
  presentationSettingsSchema,
  type PresentationDTO,
  type PresentationSettings,
} from "@shared/presentations";
import { admin, ApiError } from "@/lib/api";
import { fieldErrors, useApi } from "@/lib/hooks";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Dialog, Field, Input, NativeSelect, Switch, Textarea } from "@/components/ui/primitives";
import type { EventListRow } from "@/components/admin/event-types";

/** Eventos da organização (não arquivados) para os seletores. */
export function useOrgEvents(orgId: string) {
  return useApi(() => admin.get<EventListRow[]>(`/events?orgId=${orgId}`), [orgId]);
}

function EventSelect({ id, value, onChange, events, emptyLabel = "Sem evento (somente slides e telas estáticas)", disabled }: { id: string; value: string; onChange: (v: string) => void; events: EventListRow[]; emptyLabel?: string; disabled?: boolean }) {
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">{emptyLabel}</option>
      {events.map((ev) => (
        <option key={ev.id} value={ev.id}>
          {ev.title}
        </option>
      ))}
    </NativeSelect>
  );
}

function QuestionsHint() {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
      <span>
        Perguntas, enquetes, quizzes e gráficos de resultado usam as perguntas <b>de um evento</b>. Vincule a apresentação ao evento para inseri-las. Sem evento, você ainda pode
        montar slides, telas personalizadas e telas interativas.
      </span>
    </p>
  );
}

/* ------------------------------------------------------------------ nova apresentação */
export function NewPresentationDialog({
  open,
  onOpenChange,
  orgId,
  events,
  defaultEventId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgId: string;
  events: EventListRow[];
  defaultEventId?: string | null;
  onCreated: (p: PresentationDTO) => void;
}) {
  const uid = useId();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventId, setEventId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setEventId(defaultEventId ?? "");
      setErrors({});
    }
  }, [open, defaultEventId]);

  const submit = async () => {
    if (!title.trim()) return setErrors({ title: "Informe o título." });
    setBusy(true);
    try {
      const p = await admin.post<PresentationDTO>(`/presentations?orgId=${orgId}`, {
        title: title.trim(),
        description: description.trim() || null,
        eventId: eventId || null,
        settings: presentationSettingsSchema.parse({}),
      });
      toast.success("Apresentação criada.");
      onCreated(p);
    } catch (e) {
      setErrors(fieldErrors(e));
      toast.error(e instanceof Error ? e.message : "Não foi possível criar a apresentação.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title="Nova apresentação"
      description="Comece vazia: depois envie os slides exportados do Canva (JPG/PNG) e intercale perguntas e telas interativas."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {!busy && <Plus />} Criar e abrir editor
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Título" htmlFor={`${uid}-t`} required error={errors.title}>
          <Input id={`${uid}-t`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} autoFocus aria-invalid={!!errors.title} placeholder="Ex.: Palestra Vendas 2027" />
        </Field>
        <Field label="Descrição" htmlFor={`${uid}-d`} error={errors.description}>
          <Textarea id={`${uid}-d`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} />
        </Field>
        <Field label="Evento vinculado (opcional)" htmlFor={`${uid}-e`} error={errors.eventId}>
          <EventSelect id={`${uid}-e`} value={eventId} onChange={setEventId} events={events} />
        </Field>
        <QuestionsHint />
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ duplicar */
export function DuplicateDialog({
  open,
  onOpenChange,
  source,
  events,
  onDuplicated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  source: { id: string; title: string; eventId: string | null; eventTitle: string | null } | null;
  events: EventListRow[];
  onDuplicated: (p: PresentationDTO) => void;
}) {
  const uid = useId();
  const [target, setTarget] = useState("__same__");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && source) {
      setTarget("__same__");
      setTitle(`${source.title} (cópia)`.slice(0, 160));
    }
  }, [open, source]);

  const other = target !== "__same__" && target !== (source?.eventId ?? "");
  const submit = async () => {
    if (!source) return;
    setBusy(true);
    try {
      const body: { title: string; targetEventId?: string | null } = { title: title.trim() || `${source.title} (cópia)` };
      if (target !== "__same__") body.targetEventId = target || null;
      const p = await admin.post<PresentationDTO>(`/presentations/${source.id}/duplicate`, body);
      toast.success(other && target ? "Apresentação duplicada. As perguntas foram copiadas para o evento de destino." : "Apresentação duplicada.");
      onDuplicated(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível duplicar a apresentação.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title="Duplicar apresentação"
      description="Os slides são reaproveitados da biblioteca (sem novo envio). As notas do palestrante também são copiadas."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {!busy && <Copy />} Duplicar
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Título da cópia" htmlFor={`${uid}-t`}>
          <Input id={`${uid}-t`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
        </Field>
        <Field
          label="Evento de destino"
          htmlFor={`${uid}-e`}
          hint={
            other
              ? target
                ? "As perguntas usadas na apresentação serão copiadas para o evento escolhido e a cópia passará a usá-las."
                : "Sem evento: só é possível se a apresentação não tiver perguntas."
              : "A cópia continua usando as mesmas perguntas do evento atual."
          }
        >
          <NativeSelect id={`${uid}-e`} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="__same__">{source?.eventTitle ? `Mesmo evento (${source.eventTitle})` : "Mesmo destino (sem evento)"}</option>
            {events
              .filter((ev) => ev.id !== source?.eventId)
              .map((ev) => (
                <option key={ev.id} value={ev.id}>
                  Outro evento: {ev.title}
                </option>
              ))}
            {source?.eventId && <option value="">Sem evento</option>}
          </NativeSelect>
        </Field>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ configurações */
export function PresentationSettingsDialog({
  open,
  onOpenChange,
  presentation,
  events,
  hasQuestions,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  presentation: PresentationDTO;
  events: EventListRow[];
  hasQuestions: boolean;
  onSaved: (p: PresentationDTO) => void;
}) {
  const uid = useId();
  const [title, setTitle] = useState(presentation.title);
  const [description, setDescription] = useState(presentation.description ?? "");
  const [eventId, setEventId] = useState(presentation.eventId ?? "");
  const [settings, setSettings] = useState<PresentationSettings>(presentation.settings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setTitle(presentation.title);
      setDescription(presentation.description ?? "");
      setEventId(presentation.eventId ?? "");
      setSettings(presentation.settings);
      setErrors({});
    }
  }, [open, presentation]);

  const set = <K extends keyof PresentationSettings>(k: K, v: PresentationSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    if (!title.trim()) return setErrors({ title: "Informe o título." });
    setBusy(true);
    try {
      const p = await admin.put<PresentationDTO>(`/presentations/${presentation.id}`, {
        title: title.trim(),
        description: description.trim() || null,
        eventId: eventId || null,
        settings,
      });
      toast.success("Configurações salvas.");
      onSaved(p);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === "EVENTO_COM_PERGUNTAS") {
        setErrors({ eventId: e.message });
      } else {
        setErrors(fieldErrors(e));
        toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title="Configurações da apresentação"
      description="Valem para todos os itens que não tiverem configuração própria."
      className="max-w-xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {!busy && <Save />} Salvar
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Título" htmlFor={`${uid}-t`} required error={errors.title}>
          <Input id={`${uid}-t`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} aria-invalid={!!errors.title} />
        </Field>
        <Field label="Descrição" htmlFor={`${uid}-d`}>
          <Textarea id={`${uid}-d`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={2} />
        </Field>
        <Field
          label="Evento vinculado"
          htmlFor={`${uid}-e`}
          error={errors.eventId}
          hint={hasQuestions ? "A apresentação já tem perguntas deste evento. Para usá-la em outro evento, duplique-a escolhendo o evento de destino." : undefined}
        >
          <EventSelect id={`${uid}-e`} value={eventId} onChange={setEventId} events={events} />
        </Field>
        {!eventId && <QuestionsHint />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Transição padrão" htmlFor={`${uid}-tr`}>
            <NativeSelect id={`${uid}-tr`} value={settings.defaultTransition} onChange={(e) => set("defaultTransition", e.target.value as PresentationSettings["defaultTransition"])}>
              {TRANSITIONS.map((t) => (
                <option key={t} value={t}>
                  {TRANSITION_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Enquadramento dos slides" htmlFor={`${uid}-fit`}>
            <NativeSelect id={`${uid}-fit`} value={settings.fit} onChange={(e) => set("fit", e.target.value as PresentationSettings["fit"])}>
              {FITS.map((f) => (
                <option key={f} value={f}>
                  {FIT_LABELS[f]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Cor de fundo" htmlFor={`${uid}-bg`} hint="Aparece nas bordas quando o slide não tem proporção 16:9." error={errors["settings.background"]}>
            <div className="flex items-center gap-2">
              <input
                id={`${uid}-bg`}
                type="color"
                value={settings.background}
                onChange={(e) => set("background", e.target.value.toUpperCase())}
                className="h-11 w-14 shrink-0 cursor-pointer rounded-xl border border-input bg-card p-1"
              />
              <Input aria-label="Cor de fundo em hexadecimal" value={settings.background} onChange={(e) => set("background", e.target.value)} maxLength={7} className="font-mono" />
            </div>
          </Field>
        </div>
        <Switch
          checked={settings.showJoinBadgeOnSlides}
          onCheckedChange={(v) => set("showJoinBadgeOnSlides", v)}
          label="Mostrar QR Code e código de entrada no canto do telão durante os slides"
        />
      </form>
    </Dialog>
  );
}
