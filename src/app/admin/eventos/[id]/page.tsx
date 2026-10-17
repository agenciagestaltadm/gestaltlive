"use client";
import Link from "next/link";
import { CheckCircle2, Circle, ClipboardList, Gift, ListChecks, Radio, Users } from "lucide-react";
import { admin } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { fmtInt } from "@/lib/utils";
import { useAdmin } from "@/components/admin/admin-context";
import { useEventData } from "@/components/admin/event-context";
import { EventForm } from "@/components/admin/event-form";
import { ACTIVE_SESSION_STATUSES, type EventSessionRow } from "@/components/admin/event-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton, Stat } from "@/components/ui/primitives";

export default function EventOverviewPage() {
  const { event, reload } = useEventData();
  const { can } = useAdmin();
  const sessions = useApi(() => admin.get<EventSessionRow[]>(`/events/${event.id}/sessions`), [event.id]);
  const base = `/admin/eventos/${event.id}`;
  const list = sessions.data ?? [];
  const active = list.filter((s) => ACTIVE_SESSION_STATUSES.includes(s.status)).length;
  const participations = list.reduce((a, s) => a + s.participants, 0);

  const steps = [
    { done: event.questionCount > 0, label: "Cadastrar perguntas", href: `${base}/perguntas`, icon: ListChecks },
    { done: event.customFields.length > 0, label: "Revisar o cadastro dos participantes", href: `${base}/cadastro`, icon: ClipboardList, optional: true },
    { done: event.prizes.length > 0, label: "Definir os prêmios do pódio", href: `${base}/premios`, icon: Gift, optional: true },
    { done: list.length > 0, label: "Criar a primeira sessão (turma)", href: `${base}/sessoes`, icon: Radio },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Perguntas" value={fmtInt(event.questionCount)} icon={<ListChecks />} />
        <Stat label="Sessões" value={sessions.loading ? <Skeleton className="h-8 w-12" /> : fmtInt(list.length)} icon={<Radio />} />
        <Stat label="Em andamento" value={sessions.loading ? <Skeleton className="h-8 w-12" /> : fmtInt(active)} icon={<Radio />} accent={active ? "text-brand" : undefined} />
        <Stat label="Participações" value={sessions.loading ? <Skeleton className="h-8 w-12" /> : fmtInt(participations)} icon={<Users />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Preparação</CardTitle>
          <CardDescription>Passos para deixar o evento pronto para a dinâmica ao vivo.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {steps.map((s) => (
              <li key={s.href}>
                <Link href={s.href} className="flex items-center gap-3 rounded-xl border border-border p-3 transition hover:border-brand/40 hover:bg-muted/40">
                  {s.done ? <CheckCircle2 className="size-5 shrink-0 text-brand" aria-label="Concluído" /> : <Circle className="size-5 shrink-0 text-muted-foreground" aria-label="Pendente" />}
                  <span className="flex-1 text-sm font-bold">{s.label}</span>
                  {s.optional && !s.done && <span className="text-xs text-muted-foreground">opcional</span>}
                  <s.icon className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          {can("session.create") && (
            <div className="mt-4">
              <Button size="sm" variant="outline" asChild>
                <Link href={`${base}/sessoes`}>
                  <Radio /> Gerenciar sessões
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-black">{can("event.write") ? "Editar evento" : "Dados do evento"}</h2>
        {!can("event.write") && <p className="mb-3 text-sm text-muted-foreground">Seu perfil permite apenas visualizar estas informações.</p>}
        <EventForm key={event.updatedAt} event={event} readOnly={!can("event.write")} onSaved={async () => void (await reload())} />
      </div>
    </div>
  );
}
