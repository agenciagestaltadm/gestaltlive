"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Info, Pencil, Plus, Save, ShieldCheck, Trash2, Undo2 } from "lucide-react";
import {
  CUSTOM_FIELD_TYPES,
  customFieldInputSchema,
  PRESET_CUSTOM_FIELDS,
  RANKING_DISPLAYS,
  RANKING_DISPLAY_LABELS,
  registrationConfigSchema,
  UNIQUENESS_LABELS,
  UNIQUENESS_POLICIES,
  type CustomFieldInput,
  type RegistrationConfig,
} from "@shared/schemas";
import { admin, ApiError } from "@/lib/api";
import { fieldErrors } from "@/lib/hooks";
import { useAdmin } from "@/components/admin/admin-context";
import { useEventData } from "@/components/admin/event-context";
import { eventToInput, parseRegistration, slugify, type EventDetail } from "@/components/admin/event-types";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, EmptyState, Field, Input, NativeSelect, Switch, Textarea } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

type FieldType = (typeof CUSTOM_FIELD_TYPES)[number];
const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  TEXTO: "Texto curto",
  TEXTO_LONGO: "Texto longo",
  SELECAO: "Seleção (lista de opções)",
  NUMERO: "Número",
  EMAIL: "E-mail",
  TELEFONE: "Telefone",
};

const toFieldInputs = (ev: EventDetail): CustomFieldInput[] =>
  [...ev.customFields]
    .sort((a, b) => a.position - b.position)
    .map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options ?? [], required: f.required }));

/* ================================================================== cadastro */
function RegistrationSection({ event, onSaved, readOnly }: { event: EventDetail; onSaved: () => Promise<unknown>; readOnly: boolean }) {
  const initial = useMemo(() => parseRegistration(event.registration), [event.registration]);
  const [reg, setReg] = useState<RegistrationConfig>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setReg(initial);
  }, [initial]);
  const dirty = JSON.stringify(reg) !== JSON.stringify(initial);
  const set = <K extends keyof RegistrationConfig>(k: K, v: RegistrationConfig[K]) => setReg((r) => ({ ...r, [k]: v }));

  const setRule = (k: "phone" | "email", patch: Partial<RegistrationConfig["phone"]>) =>
    setReg((r) => {
      const next = { ...r[k], ...patch };
      if (!next.enabled) next.required = false;
      return { ...r, [k]: next };
    });

  const save = async () => {
    const parsed = registrationConfigSchema.safeParse({ ...reg, privacyPolicyUrl: reg.privacyPolicyUrl ?? "" });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0] ?? "")] ??= i.message;
      setErrors(errs);
      toast.error("Revise os campos destacados.");
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await admin.put(`/events/${event.id}`, eventToInput(event, { registration: parsed.data }));
      toast.success("Configuração de cadastro salva.");
      await onSaved();
    } catch (e) {
      const fe = fieldErrors(e);
      const errs: Record<string, string> = {};
      for (const [p, m] of Object.entries(fe)) errs[p.replace(/^registration\./, "").split(".")[0]] ??= m;
      setErrors(errs);
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  const contact = (k: "phone" | "email", label: string) => (
    <div className="rounded-xl border border-border p-4">
      <p className="font-black">{label}</p>
      <div className="mt-3 flex flex-col gap-3">
        <Switch id={`reg-${k}-en`} checked={reg[k].enabled} onCheckedChange={(v) => setRule(k, { enabled: v })} disabled={readOnly} label="Pedir no cadastro" />
        <Switch id={`reg-${k}-req`} checked={reg[k].required} onCheckedChange={(v) => setRule(k, { required: v })} disabled={readOnly || !reg[k].enabled} label="Obrigatório" />
      </div>
      {errors[k] && (
        <p className="mt-2 text-xs font-bold text-negative" role="alert">
          {errors[k]}
        </p>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cadastro do participante</CardTitle>
        <CardDescription>
          Dados pedidos na entrada da sessão. Alterações valem para novas sessões e para as ainda não iniciadas (rascunho ou agendadas).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset disabled={readOnly || saving} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {contact("phone", "WhatsApp")}
            {contact("email", "E-mail")}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Política de unicidade" htmlFor="reg-uniq" error={errors.uniqueness} hint="Impede o mesmo participante de se cadastrar duas vezes na sessão.">
              <NativeSelect id="reg-uniq" value={reg.uniqueness} onChange={(e) => set("uniqueness", e.target.value as RegistrationConfig["uniqueness"])}>
                {UNIQUENESS_POLICIES.map((p) => (
                  <option key={p} value={p}>
                    {UNIQUENESS_LABELS[p]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Nome exibido no ranking e no telão" htmlFor="reg-rank" error={errors.rankingDisplay} hint="O nome completo nunca é exibido publicamente.">
              <NativeSelect id="reg-rank" value={reg.rankingDisplay} onChange={(e) => set("rankingDisplay", e.target.value as RegistrationConfig["rankingDisplay"])}>
                {RANKING_DISPLAYS.map((p) => (
                  <option key={p} value={p}>
                    {RANKING_DISPLAY_LABELS[p]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          <div className="space-y-4 rounded-xl border border-border p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-brand" aria-hidden />
              <p className="font-black">Consentimento (LGPD)</p>
            </div>
            <Field
              label={
                <>
                  Termo de participação <Badge tone="brand">aceite obrigatório</Badge>
                </>
              }
              htmlFor="reg-consent"
              required
              error={errors.consentParticipationText}
              hint="O participante precisa aceitar este texto para entrar na sessão."
            >
              <Textarea id="reg-consent" rows={4} maxLength={4000} value={reg.consentParticipationText} onChange={(e) => set("consentParticipationText", e.target.value)} aria-invalid={!!errors.consentParticipationText} />
            </Field>
            <div className="space-y-3 rounded-xl bg-muted/50 p-4">
              <Switch id="reg-mkt" checked={reg.marketingEnabled} onCheckedChange={(v) => set("marketingEnabled", v)} disabled={readOnly} label="Oferecer aceite opcional de comunicações de marketing" />
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                O aceite de marketing é sempre <strong className="text-foreground">opcional</strong>: aparece desmarcado e o participante entra normalmente sem marcá-lo. Ele não pode ser
                obrigatório nem condição para participar.
              </p>
              {reg.marketingEnabled && (
                <Field
                  label={
                    <>
                      Texto do aceite de marketing <Badge tone="muted">opcional para o participante</Badge>
                    </>
                  }
                  htmlFor="reg-mkt-text"
                  required
                  error={errors.consentMarketingText}
                >
                  <Textarea id="reg-mkt-text" rows={3} maxLength={4000} value={reg.consentMarketingText} onChange={(e) => set("consentMarketingText", e.target.value)} aria-invalid={!!errors.consentMarketingText} />
                </Field>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-[180px_1fr]">
              <Field label="Versão do texto" htmlFor="reg-ver" required error={errors.consentVersion} hint="Muda sozinha se você editar os textos sem alterá-la.">
                <Input id="reg-ver" value={reg.consentVersion} maxLength={40} onChange={(e) => set("consentVersion", e.target.value)} aria-invalid={!!errors.consentVersion} />
              </Field>
              <Field label="URL da política de privacidade" htmlFor="reg-priv" error={errors.privacyPolicyUrl} hint="Endereço https exibido junto ao termo.">
                <Input
                  id="reg-priv"
                  type="url"
                  placeholder="https://"
                  value={reg.privacyPolicyUrl ?? ""}
                  onChange={(e) => set("privacyPolicyUrl", e.target.value || null)}
                  aria-invalid={!!errors.privacyPolicyUrl}
                />
              </Field>
            </div>
          </div>
        </fieldset>
        {!readOnly && (
          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            {dirty && <span className="mr-auto text-sm text-muted-foreground">Alterações não salvas</span>}
            {dirty && (
              <Button variant="ghost" onClick={() => setReg(initial)} disabled={saving}>
                <Undo2 /> Descartar
              </Button>
            )}
            <Button onClick={save} loading={saving} disabled={!dirty}>
              <Save /> Salvar cadastro
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ================================================================== campos personalizados */
function FieldDialog({
  open,
  onOpenChange,
  initial,
  existingKeys,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: CustomFieldInput | null;
  existingKeys: string[];
  onSubmit: (f: CustomFieldInput) => void;
}) {
  const isEdit = !!initial;
  const [f, setF] = useState<CustomFieldInput>({ key: "", label: "", type: "TEXTO", options: [], required: false });
  const [optionsText, setOptionsText] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    const base = initial ?? { key: "", label: "", type: "TEXTO" as const, options: [], required: false };
    setF(base);
    setOptionsText(base.options.join("\n"));
    setKeyTouched(!!initial);
    setErrors({});
  }, [open, initial]);

  const submit = () => {
    const candidate = { ...f, options: f.type === "SELECAO" ? optionsText.split("\n").map((s) => s.trim()).filter(Boolean) : [] };
    const r = customFieldInputSchema.safeParse(candidate);
    const errs: Record<string, string> = {};
    if (!r.success) for (const i of r.error.issues) errs[String(i.path[0] ?? "")] ??= i.message;
    if (!isEdit && existingKeys.includes(candidate.key)) errs.key = "Já existe um campo com esta chave.";
    if (candidate.type === "SELECAO" && new Set(candidate.options.map((o) => o.toLowerCase())).size !== candidate.options.length) errs.options = "Há opções repetidas.";
    setErrors(errs);
    if (Object.keys(errs).length || !r.success) return;
    onSubmit(r.data);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Editar campo" : "Novo campo personalizado"}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit}>{isEdit ? "Aplicar" : "Adicionar campo"}</Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Rótulo (pergunta exibida)" htmlFor="cf-label" required error={errors.label}>
          <Input
            id="cf-label"
            value={f.label}
            maxLength={120}
            autoFocus
            aria-invalid={!!errors.label}
            onChange={(e) => {
              const label = e.target.value;
              setF((x) => ({ ...x, label, key: keyTouched ? x.key : slugify(label).replace(/-/g, "_").slice(0, 40) }));
            }}
          />
        </Field>
        <Field label="Chave interna" htmlFor="cf-key" required error={errors.key} hint={isEdit ? "A chave não pode ser alterada depois de criada." : "Letras minúsculas, números e _. Usada em filtros e exportações."}>
          <Input
            id="cf-key"
            value={f.key}
            maxLength={40}
            disabled={isEdit}
            className="font-mono"
            aria-invalid={!!errors.key}
            onChange={(e) => {
              setKeyTouched(true);
              setF((x) => ({ ...x, key: e.target.value }));
            }}
          />
        </Field>
        <Field label="Tipo" htmlFor="cf-type">
          <NativeSelect id="cf-type" value={f.type} onChange={(e) => setF((x) => ({ ...x, type: e.target.value as FieldType }))}>
            {CUSTOM_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {FIELD_TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {f.type === "SELECAO" && (
          <Field label="Opções (uma por linha)" htmlFor="cf-options" required error={errors.options} hint="Informe pelo menos 2 opções.">
            <Textarea id="cf-options" rows={5} value={optionsText} onChange={(e) => setOptionsText(e.target.value)} aria-invalid={!!errors.options} />
          </Field>
        )}
        <Switch id="cf-required" checked={f.required} onCheckedChange={(v) => setF((x) => ({ ...x, required: v }))} label="Resposta obrigatória" />
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

function CustomFieldsSection({ event, onSaved, readOnly }: { event: EventDetail; onSaved: () => Promise<unknown>; readOnly: boolean }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = useMemo(() => toFieldInputs(event), [event.customFields]);
  const [fields, setFields] = useState<CustomFieldInput[]>(initial);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; index: number | null }>({ open: false, index: null });
  useEffect(() => {
    setFields(initial);
  }, [initial]);
  const dirty = JSON.stringify(fields) !== JSON.stringify(initial);
  const keys = fields.map((f) => f.key);

  const move = (i: number, d: -1 | 1) =>
    setFields((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = async () => {
    setSaving(true);
    setConflict(null);
    try {
      await admin.put(`/events/${event.id}/custom-fields`, fields);
      toast.success("Campos personalizados salvos.");
      await onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.code === "CAMPO_EM_USO") {
        setConflict(e.message);
      } else toast.error(e instanceof Error ? e.message : "Não foi possível salvar os campos.");
    } finally {
      setSaving(false);
    }
  };

  const presets = PRESET_CUSTOM_FIELDS.filter((p) => !keys.includes(p.key));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campos personalizados</CardTitle>
        <CardDescription>Perguntas extras do cadastro (empresa, cidade...). Ficam disponíveis como filtros em relatórios e na base de participantes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {presets.map((p) => (
              <Button key={p.key} variant="outline" size="sm" onClick={() => setFields((l) => (l.length >= 30 ? l : [...l, { ...p, options: [...p.options] }]))}>
                <Plus /> {p.label}
              </Button>
            ))}
            <Button size="sm" variant="secondary" onClick={() => setDialog({ open: true, index: null })} disabled={fields.length >= 30}>
              <Plus /> Criar campo
            </Button>
          </div>
        )}

        {conflict && (
          <div role="alert" className="flex flex-wrap items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="flex-1">
              <strong>Não foi possível remover:</strong> {conflict} Campos que já têm respostas são preservados para não perder dados.
            </p>
            <Button size="sm" variant="outline" onClick={() => setFields(initial)}>
              Restaurar campos
            </Button>
          </div>
        )}

        {fields.length === 0 ? (
          <EmptyState title="Nenhum campo personalizado" description="O cadastro pedirá apenas nome, apelido e os contatos configurados acima." />
        ) : (
          <ol className="space-y-2">
            {fields.map((f, i) => (
              <li key={f.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-xs font-black tabular">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-bold">
                    {f.label}
                    {f.required && <Badge tone="brand">obrigatório</Badge>}
                    {!initial.some((x) => x.key === f.key) && <Badge tone="outline">novo</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{f.key}</span> · {FIELD_TYPE_LABELS[f.type]}
                    {f.type === "SELECAO" && ` · ${f.options.join(", ")}`}
                  </p>
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Mover ${f.label} para cima`}>
                      <ArrowUp />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => move(i, 1)} disabled={i === fields.length - 1} aria-label={`Mover ${f.label} para baixo`}>
                      <ArrowDown />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ open: true, index: i })} aria-label={`Editar ${f.label}`}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setFields((l) => l.filter((_, j) => j !== i))} aria-label={`Remover ${f.label}`} className="text-negative">
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}

        {!readOnly && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {dirty && <span className="mr-auto text-sm text-muted-foreground">Alterações não salvas</span>}
            {dirty && (
              <Button variant="ghost" onClick={() => setFields(initial)} disabled={saving}>
                <Undo2 /> Descartar
              </Button>
            )}
            <Button onClick={save} loading={saving} disabled={!dirty}>
              <Save /> Salvar campos
            </Button>
          </div>
        )}
      </CardContent>

      <FieldDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))}
        initial={dialog.index !== null ? fields[dialog.index] ?? null : null}
        existingKeys={keys}
        onSubmit={(f) =>
          setFields((list) => (dialog.index !== null ? list.map((x, j) => (j === dialog.index ? f : x)) : [...list, f]))
        }
      />
    </Card>
  );
}

export default function EventRegistrationPage() {
  const { event, reload } = useEventData();
  const { can } = useAdmin();
  const readOnly = !can("event.write");
  return (
    <div className="space-y-6">
      {readOnly && <p className="text-sm text-muted-foreground">Seu perfil permite apenas visualizar a configuração de cadastro.</p>}
      <RegistrationSection event={event} onSaved={reload} readOnly={readOnly} />
      <CustomFieldsSection event={event} onSaved={reload} readOnly={readOnly} />
    </div>
  );
}
