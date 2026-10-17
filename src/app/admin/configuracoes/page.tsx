"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, History, KeyRound, Lock, Save, Trash2, UserPlus, Users } from "lucide-react";
import { orgCreateSchema, passwordSchema, userCreateSchema } from "@shared/schemas";
import { admin } from "@/lib/api";
import { fieldErrors, useAction, useApi } from "@/lib/hooks";
import { fmtDateTime } from "@/lib/utils";
import { PageHeader } from "@/components/admin/admin-shell";
import { useAdmin } from "@/components/admin/admin-context";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { ImageUpload } from "@/components/admin/image-upload";
import { LoadError } from "@/components/admin/load-error";
import { ROLE_LABELS, type MemberRow } from "@/components/admin/event-types";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

interface OrgFull {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  brand: { primary?: string; secondary?: string };
  retentionDays: number | null;
  isActive: boolean;
}

/* ================================================================== organização */
function OrgTab() {
  const { orgId, can, reloadOrgs } = useAdmin();
  const editable = can("members.manage");
  const q = useApi(() => admin.get<OrgFull>(`/orgs/${orgId}`), [orgId]);
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [retention, setRetention] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setName(q.data.name);
    setLogoUrl(q.data.logoUrl ?? "");
    setPrimary(q.data.brand?.primary ?? "");
    setSecondary(q.data.brand?.secondary ?? "");
    setRetention(q.data.retentionDays ? String(q.data.retentionDays) : "");
  }, [q.data]);

  const save = async () => {
    const body = {
      name,
      logoUrl,
      brand: { ...(primary ? { primary } : {}), ...(secondary ? { secondary } : {}) },
      retentionDays: retention ? Number(retention) : null,
    };
    const parsed = orgCreateSchema.partial().safeParse(body);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[i.path.join(".")] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await admin.patch(`/orgs/${orgId}`, parsed.data);
      toast.success("Organização atualizada.");
      await Promise.all([q.reload(), reloadOrgs()]);
    } catch (e) {
      setErrors(fieldErrors(e));
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  if (q.loading && !q.data) return <Skeleton className="h-96" />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={q.reload} />;

  const color = (id: string, label: string, value: string, set: (v: string) => void, fallback: string, err?: string) => (
    <Field label={label} htmlFor={id} error={err}>
      <div className="flex items-center gap-2">
        <input type="color" value={value || fallback} onChange={(e) => set(e.target.value.toUpperCase())} aria-label={`${label}: seletor`} className="h-11 w-12 shrink-0 cursor-pointer rounded-xl border border-input bg-card p-1" disabled={!editable} />
        <Input id={id} value={value} onChange={(e) => set(e.target.value)} placeholder={fallback} maxLength={7} className="font-mono" aria-invalid={!!err} />
      </div>
    </Field>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados da organização</CardTitle>
        <CardDescription>
          Identificador: <code className="font-mono">{q.data.slug}</code>
          {!editable && " · Apenas administradores da organização podem alterar estes dados."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!editable || saving} className="grid gap-4 md:grid-cols-2">
          <Field label="Nome" htmlFor="org-name" required error={errors.name} className="md:col-span-2">
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-invalid={!!errors.name} />
          </Field>
          <Field label="Logo" htmlFor="org-logo" error={errors.logoUrl} className="md:col-span-2" hint="Usado quando o evento não tem logo próprio.">
            <ImageUpload id="org-logo" orgId={orgId} value={logoUrl} onChange={setLogoUrl} disabled={!editable} label="logo" invalid={!!errors.logoUrl} />
          </Field>
          {color("org-primary", "Cor primária", primary, setPrimary, "#E6007E", errors["brand.primary"])}
          {color("org-secondary", "Cor secundária", secondary, setSecondary, "#0B1736", errors["brand.secondary"])}
          <Field label="Retenção de dados (dias)" htmlFor="org-ret" error={errors.retentionDays} hint="Entre 30 e 3650 dias. Em branco: sem prazo definido.">
            <Input id="org-ret" type="number" inputMode="numeric" min={30} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} aria-invalid={!!errors.retentionDays} />
          </Field>
        </fieldset>
        {editable && (
          <div className="mt-6 flex justify-end">
            <Button onClick={save} loading={saving}>
              <Save /> Salvar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ================================================================== equipe */
function AddMemberDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (v: boolean) => void; onAdded: () => void }) {
  const { orgId } = useAdmin();
  const [v, setV] = useState({ name: "", email: "", password: "", role: "SPEAKER" as "SPEAKER" | "ORG_ADMIN" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setV({ name: "", email: "", password: "", role: "SPEAKER" });
      setErrors({});
    }
  }, [open]);
  const submit = async () => {
    const parsed = userCreateSchema.safeParse(v);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      return setErrors(errs);
    }
    setBusy(true);
    try {
      await admin.post(`/orgs/${orgId}/members`, parsed.data);
      toast.success("Membro adicionado.");
      onOpenChange(false);
      onAdded();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast.error(e instanceof Error ? e.message : "Não foi possível adicionar.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(x) => !busy && onOpenChange(x)}
      title="Adicionar membro"
      description="Se o e-mail já tiver conta, o usuário apenas é vinculado à organização (a senha dele não muda)."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy}>
            <UserPlus /> Adicionar
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
        <Field label="Nome" htmlFor="m-name" required error={errors.name}>
          <Input id="m-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={120} autoFocus aria-invalid={!!errors.name} />
        </Field>
        <Field label="E-mail" htmlFor="m-email" required error={errors.email}>
          <Input id="m-email" type="email" autoComplete="off" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} aria-invalid={!!errors.email} />
        </Field>
        <Field label="Senha inicial" htmlFor="m-pass" required error={errors.password} hint="Mínimo de 10 caracteres, com letras e números. Compartilhe por um canal seguro.">
          <Input id="m-pass" type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} aria-invalid={!!errors.password} />
        </Field>
        <Field label="Papel" htmlFor="m-role" error={errors.role}>
          <NativeSelect id="m-role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as "SPEAKER" | "ORG_ADMIN" })}>
            <option value="SPEAKER">{ROLE_LABELS.SPEAKER} — visualiza eventos e conduz sessões</option>
            <option value="ORG_ADMIN">{ROLE_LABELS.ORG_ADMIN} — acesso total à organização</option>
          </NativeSelect>
        </Field>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

function TeamTab() {
  const { orgId, can, me } = useAdmin();
  const manage = can("members.manage");
  const list = useApi(() => admin.get<MemberRow[]>(`/orgs/${orgId}/members`), [orgId]);
  const [adding, setAdding] = useState(false);
  const [toRemove, setToRemove] = useState<MemberRow | null>(null);
  const { run, pending } = useAction();

  const changeRole = async (m: MemberRow, role: MemberRow["role"]) => {
    const ok = await run(`role:${m.id}`, () => admin.patch(`/orgs/${orgId}/members/${m.id}`, { role }), "Papel atualizado.");
    if (ok) void list.reload();
  };
  const remove = async (m: MemberRow) => {
    const ok = await run(`rm:${m.id}`, () => admin.del(`/orgs/${orgId}/members/${m.id}`), "Membro removido da organização.");
    if (ok) void list.reload();
    return ok !== undefined;
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Equipe</CardTitle>
          <CardDescription>Administradores e palestrantes com acesso a esta organização.</CardDescription>
        </div>
        {manage && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <UserPlus /> Adicionar membro
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {list.loading && !list.data ? (
          <div className="space-y-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : !list.data?.length ? (
          <EmptyState icon={<Users />} title="Nenhum membro" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="border-b border-border text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-4">Nome</th>
                  <th scope="col" className="py-2 pr-4">Papel</th>
                  <th scope="col" className="py-2 pr-4">Último acesso</th>
                  <th scope="col" className="py-2 text-right">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.data.map((m) => {
                  const self = m.userId === me.user.id;
                  return (
                    <tr key={m.id}>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap items-center gap-2 font-bold">
                          {m.name}
                          {self && <Badge tone="brand">você</Badge>}
                          {!m.isActive && <Badge tone="muted">inativo</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </td>
                      <td className="py-3 pr-4">
                        {manage && !self ? (
                          <NativeSelect
                            aria-label={`Papel de ${m.name}`}
                            value={m.role}
                            disabled={pending === `role:${m.id}`}
                            onChange={(e) => void changeRole(m, e.target.value as MemberRow["role"])}
                            className="h-9 min-w-52 text-sm"
                          >
                            <option value="SPEAKER">{ROLE_LABELS.SPEAKER}</option>
                            <option value="ORG_ADMIN">{ROLE_LABELS.ORG_ADMIN}</option>
                          </NativeSelect>
                        ) : (
                          ROLE_LABELS[m.role]
                        )}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">{m.lastLoginAt ? fmtDateTime(m.lastLoginAt) : "Nunca"}</td>
                      <td className="py-3 text-right">
                        {manage && !self && (
                          <Button variant="ghost" size="icon-sm" className="text-negative" onClick={() => setToRemove(m)} aria-label={`Remover ${m.name}`}>
                            <Trash2 />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <AddMemberDialog open={adding} onOpenChange={setAdding} onAdded={() => void list.reload()} />
      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(v) => !v && setToRemove(null)}
        title="Remover membro?"
        description={`${toRemove?.name ?? ""} perderá o acesso a esta organização. A conta do usuário não é excluída.`}
        confirmLabel="Remover"
        onConfirm={() => (toRemove ? remove(toRemove) : undefined)}
      />
    </Card>
  );
}

/* ================================================================== minha conta */
function AccountTab() {
  const { me } = useAdmin();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!current) errs.current = "Informe a senha atual.";
    const p = passwordSchema.safeParse(next);
    if (!p.success) errs.next = p.error.issues[0]?.message ?? "Senha inválida.";
    if (next !== confirm) errs.confirm = "As senhas não conferem.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await admin.post("/me/password", { current, next });
      toast.success("Senha alterada. Entre novamente com a nova senha.");
      router.push("/login");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar a senha.");
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Meus dados</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">Nome:</span> <strong>{me.user.name}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">E-mail:</span> <strong>{me.user.email}</strong>
          </p>
          {me.user.isSuperadmin && <Badge tone="brand">Superadministrador</Badge>}
          <div className="pt-2">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Organizações</p>
            <ul className="space-y-1">
              {me.memberships.map((m) => (
                <li key={m.orgId}>
                  {m.orgName} <span className="text-muted-foreground">— {ROLE_LABELS[m.role]}</span>
                </li>
              ))}
              {me.memberships.length === 0 && <li className="text-muted-foreground">Acesso como superadministrador.</li>}
            </ul>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Trocar senha</CardTitle>
          <CardDescription>Ao trocar a senha, todas as suas sessões são encerradas e você precisará entrar novamente.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field label="Senha atual" htmlFor="pw-current" required error={errors.current}>
              <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} aria-invalid={!!errors.current} />
            </Field>
            <Field label="Nova senha" htmlFor="pw-next" required error={errors.next} hint="Mínimo de 10 caracteres, com letras e números.">
              <Input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={!!errors.next} />
            </Field>
            <Field label="Confirme a nova senha" htmlFor="pw-confirm" required error={errors.confirm}>
              <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!errors.confirm} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" loading={busy}>
                <KeyRound /> Alterar senha
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/* ================================================================== auditoria */
interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  actorName: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  "org.create": "Criou a organização",
  "org.update": "Alterou a organização",
  "member.add": "Adicionou membro",
  "member.role": "Alterou papel de membro",
  "member.remove": "Removeu membro",
  "event.create": "Criou evento",
  "event.create_from_template": "Criou evento a partir de template",
  "event.update": "Alterou evento",
  "event.archive": "Arquivou evento",
  "event.unarchive": "Desarquivou evento",
  "event.delete": "Excluiu evento",
  "event.duplicate": "Duplicou evento",
  "event.custom_fields": "Alterou campos de cadastro",
  "event.prizes": "Alterou prêmios",
  "template.create": "Criou template",
  "template.delete": "Excluiu template",
  "session.create": "Criou sessão",
  "session.delete": "Excluiu sessão",
  "session.screen_token": "Gerou novo link do telão",
  "prize.deliver": "Confirmou entrega de prêmio",
};

const ENTITY_LABELS: Record<string, string> = {
  organization: "Organização",
  user: "Usuário",
  event: "Evento",
  template: "Template",
  session: "Sessão",
  question: "Pergunta",
  prize_award: "Premiação",
  participant: "Participante",
};

function AuditTab() {
  const { orgId } = useAdmin();
  const [entity, setEntity] = useState("");
  const list = useApi(() => admin.get<AuditRow[]>(`/audit?orgId=${orgId}${entity ? `&entityType=${entity}` : ""}`), [orgId, entity]);
  const summary = (d: Record<string, unknown>) => {
    const keys = ["title", "name", "email", "code", "role", "reason"];
    return keys
      .filter((k) => typeof d?.[k] === "string" || typeof d?.[k] === "number")
      .map((k) => String(d[k]))
      .join(" · ");
  };
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-end justify-between gap-3">
        <div>
          <CardTitle>Auditoria</CardTitle>
          <CardDescription>Últimas 200 ações administrativas registradas.</CardDescription>
        </div>
        <div className="w-full sm:w-56">
          <NativeSelect aria-label="Filtrar por entidade" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Todas as entidades</option>
            {Object.entries(ENTITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </div>
      </CardHeader>
      <CardContent>
        {list.loading && !list.data ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : !list.data?.length ? (
          <EmptyState icon={<History />} title="Nenhum registro" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b border-border text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-4">Data</th>
                  <th scope="col" className="py-2 pr-4">Usuário</th>
                  <th scope="col" className="py-2 pr-4">Ação</th>
                  <th scope="col" className="py-2">Entidade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.data.map((r) => {
                  const s = summary(r.data);
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="whitespace-nowrap py-2.5 pr-4 tabular text-muted-foreground">{fmtDateTime(r.createdAt)}</td>
                      <td className="py-2.5 pr-4">{r.actorName ?? <span className="text-muted-foreground">Sistema</span>}</td>
                      <td className="py-2.5 pr-4">
                        <span className="font-bold">{ACTION_LABELS[r.action] ?? r.action}</span>
                        {s && <div className="max-w-xs truncate text-xs text-muted-foreground">{s}</div>}
                      </td>
                      <td className="py-2.5">
                        {ENTITY_LABELS[r.entityType] ?? r.entityType}
                        {r.entityId && <div className="font-mono text-[11px] text-muted-foreground">{r.entityId.slice(0, 8)}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ================================================================== página */
export default function SettingsPage() {
  const { can } = useAdmin();
  const tabs = [
    { value: "organizacao", label: "Organização", icon: Building2, show: can("event.read") },
    { value: "equipe", label: "Equipe", icon: Users, show: can("event.read") },
    { value: "conta", label: "Minha conta", icon: Lock, show: true },
    { value: "auditoria", label: "Auditoria", icon: History, show: can("audit.read") },
  ].filter((t) => t.show);
  const [tab, setTab] = useState(tabs[0]?.value ?? "conta");

  return (
    <div>
      <PageHeader title="Configurações" description="Organização, equipe, sua conta e registro de auditoria." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6" aria-label="Seções das configurações">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              <t.icon /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.some((t) => t.value === "organizacao") && (
          <TabsContent value="organizacao">
            <OrgTab />
          </TabsContent>
        )}
        {tabs.some((t) => t.value === "equipe") && (
          <TabsContent value="equipe">
            <TeamTab />
          </TabsContent>
        )}
        <TabsContent value="conta">
          <AccountTab />
        </TabsContent>
        {can("audit.read") && (
          <TabsContent value="auditoria">
            <AuditTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
