"use client";
import { useEffect, useState } from "react";
import { Building2, CalendarDays, Lock, Plus, Radio, Users } from "lucide-react";
import { orgCreateSchema } from "@shared/schemas";
import { admin } from "@/lib/api";
import { fieldErrors, useAction, useApi } from "@/lib/hooks";
import { fmtDate, fmtInt } from "@/lib/utils";
import { PageHeader } from "@/components/admin/admin-shell";
import { useAdmin } from "@/components/admin/admin-context";
import { LoadError } from "@/components/admin/load-error";
import { slugify } from "@/components/admin/event-types";
import { Button } from "@/components/ui/button";
import { Badge, Dialog, EmptyState, Field, Input, Skeleton, Stat, Switch } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

interface GlobalOverview {
  organizations: number;
  users: number;
  events: number;
  sessions: number;
  liveSessions: number;
  participants: number;
  participations: number;
  perOrg: { orgId: string; name: string; events: number; sessions: number; participants: number }[];
}

interface OrgFullRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  retentionDays: number | null;
}

function CreateOrgDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName("");
      setSlug("");
      setSlugTouched(false);
      setErrors({});
    }
  }, [open]);
  const submit = async () => {
    const parsed = orgCreateSchema.safeParse({ name, slug });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      return setErrors(errs);
    }
    setBusy(true);
    try {
      await admin.post("/orgs", parsed.data);
      toast.success("Organização criada.");
      onOpenChange(false);
      onCreated();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast.error(e instanceof Error ? e.message : "Não foi possível criar a organização.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title="Nova organização"
      description="Depois de criar, adicione os administradores em Configurações › Equipe (selecionando a organização no menu lateral)."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy}>
            Criar organização
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
        <Field label="Nome" htmlFor="o-name" required error={errors.name}>
          <Input
            id="o-name"
            value={name}
            maxLength={120}
            autoFocus
            aria-invalid={!!errors.name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field label="Identificador (slug)" htmlFor="o-slug" required error={errors.slug} hint="Letras minúsculas, números e hífen. Não pode ser repetido.">
          <Input
            id="o-slug"
            value={slug}
            maxLength={60}
            className="font-mono"
            aria-invalid={!!errors.slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
          />
        </Field>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

export default function OrganizationsPage() {
  const { me, reloadOrgs } = useAdmin();
  const isSuper = me.user.isSuperadmin;
  const global = useApi(isSuper ? () => admin.get<GlobalOverview>("/global") : null, [isSuper]);
  const orgs = useApi(isSuper ? () => admin.get<OrgFullRow[]>("/orgs") : null, [isSuper]);
  const [creating, setCreating] = useState(false);
  const { run, pending } = useAction();

  if (!isSuper) {
    return (
      <div>
        <PageHeader title="Organizações" />
        <EmptyState icon={<Lock />} title="Acesso restrito" description="Esta área é exclusiva de superadministradores." />
      </div>
    );
  }

  const reloadAll = () => {
    void global.reload();
    void orgs.reload();
    void reloadOrgs();
  };

  const toggle = async (o: OrgFullRow, isActive: boolean) => {
    const ok = await run(`act:${o.id}`, () => admin.patch(`/orgs/${o.id}`, { isActive }), isActive ? "Organização ativada." : "Organização desativada.");
    if (ok) void orgs.reload();
  };

  const stats = global.data;
  const perOrg = new Map((stats?.perOrg ?? []).map((p) => [p.orgId, p]));

  return (
    <div>
      <PageHeader
        title="Organizações"
        description="Indicadores gerais da plataforma e gestão das organizações clientes."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Nova organização
          </Button>
        }
      />

      {global.error ? (
        <LoadError error={global.error} onRetry={global.reload} className="mb-6" />
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {!stats ? (
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)
          ) : (
            <>
              <Stat label="Organizações" value={fmtInt(stats.organizations)} icon={<Building2 />} />
              <Stat label="Usuários" value={fmtInt(stats.users)} icon={<Users />} />
              <Stat label="Eventos" value={fmtInt(stats.events)} icon={<CalendarDays />} />
              <Stat label="Sessões" value={fmtInt(stats.sessions)} icon={<Radio />} />
              <Stat label="Ao vivo agora" value={fmtInt(stats.liveSessions)} icon={<Radio />} accent={stats.liveSessions ? "text-brand" : undefined} />
              <Stat label="Participantes" value={fmtInt(stats.participants)} icon={<Users />} hint={`${fmtInt(stats.participations)} participações`} />
            </>
          )}
        </div>
      )}

      {orgs.loading && !orgs.data ? (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : orgs.error ? (
        <LoadError error={orgs.error} onRetry={orgs.reload} />
      ) : !orgs.data?.length ? (
        <EmptyState icon={<Building2 />} title="Nenhuma organização" action={<Button onClick={() => setCreating(true)}>Nova organização</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3">Organização</th>
                <th scope="col" className="px-4 py-3 text-right">Eventos</th>
                <th scope="col" className="px-4 py-3 text-right">Sessões</th>
                <th scope="col" className="px-4 py-3 text-right">Participantes</th>
                <th scope="col" className="px-4 py-3">Criada em</th>
                <th scope="col" className="px-4 py-3">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orgs.data.map((o) => {
                const p = perOrg.get(o.id);
                return (
                  <tr key={o.id} className={o.isActive ? undefined : "opacity-70"}>
                    <td className="px-4 py-3">
                      <div className="font-bold">{o.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{o.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular">{p ? fmtInt(p.events) : "—"}</td>
                    <td className="px-4 py-3 text-right tabular">{p ? fmtInt(p.sessions) : "—"}</td>
                    <td className="px-4 py-3 text-right tabular">{p ? fmtInt(p.participants) : "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(o.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={o.isActive}
                          onCheckedChange={(v) => void toggle(o, v)}
                          disabled={pending === `act:${o.id}`}
                          label={<span className="sr-only">{o.isActive ? `Desativar ${o.name}` : `Ativar ${o.name}`}</span>}
                        />
                        <Badge tone={o.isActive ? "brand" : "muted"}>{o.isActive ? "Ativa" : "Inativa"}</Badge>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateOrgDialog open={creating} onOpenChange={setCreating} onCreated={reloadAll} />
    </div>
  );
}
