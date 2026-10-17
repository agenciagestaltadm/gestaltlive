"use client";
import { useMemo, useRef } from "react";
import { Controller, useForm, type FieldErrors, type Resolver } from "react-hook-form";
import { Save } from "lucide-react";
import {
  eventInputSchema,
  eventSettingsSchema,
  RESULTS_MODES,
  RESULTS_MODE_LABELS,
  type EventInput,
  type EventSettings,
  type RegistrationConfig,
} from "@shared/schemas";
import { admin } from "@/lib/api";
import { fieldErrors, useApi } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, NativeSelect, Switch, Textarea } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useAdmin } from "./admin-context";
import { ImageUpload } from "./image-upload";
import { isoToLocalInput, localInputToIso, parseRegistration, parseSettings, ROLE_LABELS, type EventDetail, type MemberRow } from "./event-types";

interface FormValues {
  title: string;
  description: string;
  startsAt: string;
  location: string;
  speakerUserId: string;
  speakerName: string;
  logoUrl: string;
  welcomeMessage: string;
  closingMessage: string;
  theme: { primary: string; secondary: string };
  settings: EventSettings;
}

const DEFAULT_PRIMARY = "#E6007E";
const DEFAULT_SECONDARY = "#0B1736";

function toValues(ev?: EventDetail | null): FormValues {
  return {
    title: ev?.title ?? "",
    description: ev?.description ?? "",
    startsAt: isoToLocalInput(ev?.startsAt),
    location: ev?.location ?? "",
    speakerUserId: ev?.speakerUserId ?? "",
    speakerName: ev?.speakerName ?? "",
    logoUrl: ev?.logoUrl ?? "",
    welcomeMessage: ev?.welcomeMessage ?? "",
    closingMessage: ev?.closingMessage ?? "",
    theme: { primary: ev?.theme?.primary ?? "", secondary: ev?.theme?.secondary ?? "" },
    settings: ev ? parseSettings(ev.settings) : eventSettingsSchema.parse({}),
  };
}

function toPayload(v: FormValues, registration: RegistrationConfig | undefined) {
  return {
    title: v.title,
    description: v.description,
    startsAt: localInputToIso(v.startsAt),
    location: v.location,
    speakerUserId: v.speakerUserId || null,
    speakerName: v.speakerName,
    logoUrl: v.logoUrl,
    welcomeMessage: v.welcomeMessage,
    closingMessage: v.closingMessage,
    theme: {
      ...(v.theme.primary ? { primary: v.theme.primary } : {}),
      ...(v.theme.secondary ? { secondary: v.theme.secondary } : {}),
    },
    ...(registration ? { registration } : {}),
    settings: { ...v.settings, maxParticipants: Number(v.settings.maxParticipants) },
  };
}

/** Converte "a.b.c" → objeto aninhado de erros do React Hook Form. */
function nestErrors(flat: Record<string, string>): FieldErrors<FormValues> {
  const out: Record<string, unknown> = {};
  for (const [path, message] of Object.entries(flat)) {
    const parts = path.split(".").filter(Boolean);
    if (parts.length === 0) continue;
    let cur = out as Record<string, unknown>;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) cur[p] ??= { type: "validation", message };
      else cur = (cur[p] ??= {}) as Record<string, unknown>;
    });
  }
  return out as FieldErrors<FormValues>;
}

function makeResolver(registration: { current: RegistrationConfig | undefined }): Resolver<FormValues, unknown, EventInput> {
  return (values) => {
    const r = eventInputSchema.safeParse(toPayload(values, registration.current));
    if (r.success) return { values: r.data, errors: {} };
    const flat: Record<string, string> = {};
    for (const i of r.error.issues) flat[i.path.join(".")] ??= i.message;
    return { values: {}, errors: nestErrors(flat) };
  };
}

function ColorField({ id, label, value, onChange, fallback, disabled, error }: { id: string; label: string; value: string; onChange: (v: string) => void; fallback: string; disabled?: boolean; error?: string }) {
  return (
    <Field label={label} htmlFor={id} error={error} hint={value ? undefined : "Padrão da marca"}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || fallback}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          disabled={disabled}
          aria-label={`${label}: seletor`}
          className="h-11 w-12 shrink-0 cursor-pointer rounded-xl border border-input bg-card p-1"
        />
        <Input id={id} value={value} placeholder={fallback} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-invalid={!!error} maxLength={7} className="font-mono" />
        {value && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")} disabled={disabled}>
            Limpar
          </Button>
        )}
      </div>
    </Field>
  );
}

/** Formulário de criação/edição de evento. Na edição envia o objeto completo (inclui o cadastro atual). */
export function EventForm({
  event,
  onSaved,
  readOnly,
  submitLabel,
}: {
  event?: EventDetail | null;
  onSaved: (ev: { id: string }) => void | Promise<void>;
  readOnly?: boolean;
  submitLabel?: string;
}) {
  const { orgId } = useAdmin();
  const isEdit = !!event;
  // o cadastro atual é reenviado sem alterações (ele é editado na aba "Cadastro")
  const registration = useRef<RegistrationConfig | undefined>(undefined);
  registration.current = event ? parseRegistration(event.registration) : undefined;
  const resolver = useMemo(() => makeResolver(registration), []);
  const members = useApi(() => admin.get<MemberRow[]>(`/orgs/${orgId}/members`), [orgId]);

  const { register, control, handleSubmit, setValue, getValues, setError, formState } = useForm<FormValues, unknown, EventInput>({
    defaultValues: toValues(event),
    resolver,
  });
  const e = formState.errors;

  const onSubmit = handleSubmit(async (input) => {
    try {
      const saved = isEdit ? await admin.put<{ id: string }>(`/events/${event!.id}`, input) : await admin.post<{ id: string }>(`/events?orgId=${orgId}`, input);
      toast.success(isEdit ? "Evento atualizado." : "Evento criado.");
      await onSaved(saved);
    } catch (err) {
      const fe = fieldErrors(err);
      for (const [path, message] of Object.entries(fe)) setError(path as Parameters<typeof setError>[0], { message });
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar o evento.");
    }
  });

  const speakers = (members.data ?? []).filter((m) => m.role === "SPEAKER" || m.role === "ORG_ADMIN");

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <fieldset disabled={readOnly || formState.isSubmitting} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Informações do evento</CardTitle>
            <CardDescription>Exibidas na página de entrada, no celular dos participantes e no telão.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="Título" required htmlFor="ev-title" error={e.title?.message} className="md:col-span-2">
              <Input id="ev-title" {...register("title")} aria-invalid={!!e.title} maxLength={160} placeholder="Ex.: Treinamento de Vendas 2026" />
            </Field>
            <Field label="Descrição" htmlFor="ev-description" error={e.description?.message} className="md:col-span-2">
              <Textarea id="ev-description" {...register("description")} aria-invalid={!!e.description} maxLength={4000} rows={3} />
            </Field>
            <Field label="Data e hora" htmlFor="ev-startsAt" error={e.startsAt?.message} hint="Horário local deste computador.">
              <Input id="ev-startsAt" type="datetime-local" {...register("startsAt")} aria-invalid={!!e.startsAt} />
            </Field>
            <Field label="Local" htmlFor="ev-location" error={e.location?.message}>
              <Input id="ev-location" {...register("location")} aria-invalid={!!e.location} maxLength={200} placeholder="Ex.: Auditório principal" />
            </Field>
            <Field label="Palestrante (usuário)" htmlFor="ev-speaker" error={e.speakerUserId?.message} hint={members.error ? "Não foi possível carregar a equipe." : "Membro da equipe que conduz o evento."}>
              <Controller
                control={control}
                name="speakerUserId"
                render={({ field }) => (
                  <NativeSelect
                    id="ev-speaker"
                    name={field.name}
                    ref={field.ref}
                    value={field.value}
                    onBlur={field.onBlur}
                    onChange={(ev) => {
                      field.onChange(ev.target.value);
                      const m = speakers.find((s) => s.userId === ev.target.value);
                      if (m && !getValues("speakerName")) setValue("speakerName", m.name);
                    }}
                    disabled={members.loading || readOnly}
                  >
                    <option value="">{members.loading ? "Carregando…" : "Nenhum"}</option>
                    {speakers.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name} — {ROLE_LABELS[m.role]}
                      </option>
                    ))}
                    {field.value && !speakers.some((s) => s.userId === field.value) && <option value={field.value}>{event?.speaker?.name ?? "Palestrante atual"}</option>}
                  </NativeSelect>
                )}
              />
            </Field>
            <Field label="Nome exibido do palestrante" htmlFor="ev-speakerName" error={e.speakerName?.message} hint="Texto livre mostrado ao público.">
              <Input id="ev-speakerName" {...register("speakerName")} aria-invalid={!!e.speakerName} maxLength={120} />
            </Field>
            <Field label="Logo do evento" error={e.logoUrl?.message} className="md:col-span-2" htmlFor="ev-logo">
              <Controller
                control={control}
                name="logoUrl"
                render={({ field }) => <ImageUpload id="ev-logo" orgId={orgId} value={field.value} onChange={field.onChange} disabled={readOnly} label="logo" invalid={!!e.logoUrl} />}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mensagens e tema</CardTitle>
            <CardDescription>Textos de abertura e encerramento e cores usadas no telão e no celular.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="Mensagem de boas-vindas" htmlFor="ev-welcome" error={e.welcomeMessage?.message}>
              <Textarea id="ev-welcome" {...register("welcomeMessage")} aria-invalid={!!e.welcomeMessage} maxLength={1000} rows={3} />
            </Field>
            <Field label="Mensagem de encerramento" htmlFor="ev-closing" error={e.closingMessage?.message}>
              <Textarea id="ev-closing" {...register("closingMessage")} aria-invalid={!!e.closingMessage} maxLength={1000} rows={3} />
            </Field>
            <Controller
              control={control}
              name="theme.primary"
              render={({ field }) => (
                <ColorField id="ev-primary" label="Cor primária" value={field.value} onChange={field.onChange} fallback={DEFAULT_PRIMARY} disabled={readOnly} error={e.theme?.primary?.message} />
              )}
            />
            <Controller
              control={control}
              name="theme.secondary"
              render={({ field }) => (
                <ColorField id="ev-secondary" label="Cor secundária" value={field.value} onChange={field.onChange} fallback={DEFAULT_SECONDARY} disabled={readOnly} error={e.theme?.secondary?.message} />
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Configurações da dinâmica</CardTitle>
            <CardDescription>Valem para novas sessões e para sessões ainda não iniciadas.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <Field label="Modo padrão de exibição de resultados" htmlFor="ev-results" error={e.settings?.defaultResultsMode?.message}>
              <NativeSelect id="ev-results" {...register("settings.defaultResultsMode")}>
                {RESULTS_MODES.map((m) => (
                  <option key={m} value={m}>
                    {RESULTS_MODE_LABELS[m]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Máximo de participantes por sessão" htmlFor="ev-max" error={e.settings?.maxParticipants?.message}>
              <Input id="ev-max" type="number" min={1} max={100000} inputMode="numeric" {...register("settings.maxParticipants", { valueAsNumber: true })} aria-invalid={!!e.settings?.maxParticipants} />
            </Field>
            <div className="grid gap-4 md:col-span-2 md:grid-cols-2">
              {(
                [
                  ["showLeaderboardToParticipants", "Mostrar ranking aos participantes"],
                  ["showPrizesToParticipants", "Mostrar prêmios aos participantes"],
                  ["autoCloseOnTimer", "Fechar a pergunta automaticamente quando o cronômetro zerar"],
                  ["soundEffects", "Efeitos sonoros"],
                ] as const
              ).map(([name, label]) => (
                <Controller
                  key={name}
                  control={control}
                  name={`settings.${name}`}
                  render={({ field }) => <Switch id={`ev-${name}`} checked={!!field.value} onCheckedChange={field.onChange} disabled={readOnly} label={label} />}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </fieldset>

      {!readOnly && (
        <div className="flex flex-wrap justify-end gap-2">
          {Object.keys(e).length > 0 && (
            <p className="mr-auto self-center text-sm font-bold text-negative" role="alert">
              Revise os campos destacados.
            </p>
          )}
          <Button type="submit" size="lg" loading={formState.isSubmitting}>
            <Save /> {submitLabel ?? (isEdit ? "Salvar alterações" : "Criar evento")}
          </Button>
        </div>
      )}
    </form>
  );
}
