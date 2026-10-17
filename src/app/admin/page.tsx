"use client";
import Link from "next/link";
import { BarChart3, CalendarDays, CalendarPlus, Clock, LayoutTemplate, Library, MonitorPlay, Radio, Users } from "lucide-react";
import { admin } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { fmtDateTime, fmtInt } from "@/lib/utils";
import { PageHeader } from "@/components/admin/admin-shell";
import { useAdmin } from "@/components/admin/admin-context";
import { LoadError } from "@/components/admin/load-error";
import { SessionStatusBadge } from "@/components/admin/session-status-badge";
import { ACTIVE_SESSION_STATUSES, type EventListRow, type OrgSessionRow } from "@/components/admin/event-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Skeleton, Stat } from "@/components/ui/primitives";

interface GlobalOverview {
  perOrg: { orgId: string; name: string; events: number; sessions: number; participants: number }[];
}

export default function AdminHomePage() {
  const { me, org, orgId, can } = useAdmin();
  const canRead = can("event.read");
  const events = useApi(canRead ? () => admin.get<EventListRow[]>(`/events?orgId=${orgId}`) : null, [orgId, canRead]);
  const sessions = useApi(canRead ? () => admin.get<OrgSessionRow[]>(`/sessions?orgId=${orgId}`) : null, [orgId, canRead]);
  const global = useApi(me.user.isSuperadmin ? () => admin.get<GlobalOverview>("/global") : null, [me.user.isSuperadmin]);
  const canPeople = can("participants.read");
  const people = useApi(canPeople && !me.user.isSuperadmin ? () => admin.get<{ total: number }>(`/participants?orgId=${orgId}&pageSize=1`) : null, [orgId, canPeople, me.user.isSuperadmin]);

  const all = sessions.data ?? [];
  const active = all
    .filter((s) => ACTIVE_SESSION_STATUSES.includes(s.status))
    .sort((a, b) => (a.status === "AO_VIVO" ? -1 : b.status === "AO_VIVO" ? 1 : 0));
  const live = all.filter((s) => s.status === "AO_VIVO").length;
  const upcoming = all
    .filter((s) => s.status === "AGENDADA" && s.scheduledAt)
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
    .slice(0, 5);
  const participations = all.reduce((acc, s) => acc + (s.participants ?? 0), 0);
  const uniqueParticipants = global.data?.perOrg.find((o) => o.orgId === orgId)?.participants ?? people.data?.total;

  const loadingKpi = events.loading || sessions.loading;
  const firstName = me.user.name.split(" ")[0];

  const shortcuts = [
    can("event.write") && { href: "/admin/eventos/novo", label: "Novo evento", icon: CalendarPlus, primary: true },
    canRead && { href: "/admin/eventos", label: "Eventos", icon: CalendarDays },
    can("session.control") && { href: "/admin/sessoes", label: "Sessões", icon: Radio },
    canRead && { href: "/admin/templates", label: "Templates", icon: LayoutTemplate },
    canRead && { href: "/admin/banco", label: "Banco de questões", icon: Library },
    can("participants.read") && { href: "/admin/participantes", label: "Participantes", icon: Users },
    can("reports.read") && { href: "/admin/relatorios", label: "Relatórios", icon: BarChart3 },
  ].filter(Boolean) as { href: string; label: string; icon: React.ComponentType; primary?: boolean }[];

  return (
    <div>
      <PageHeader
        title={`Olá, ${firstName}!`}
        description={`Visão geral de ${org.name}.`}
        actions={
          can("event.write") && (
            <Button asChild>
              <Link href="/admin/eventos/novo">
                <CalendarPlus /> Novo evento
              </Link>
            </Button>
          )
        }
      />

      {!canRead ? (
        <EmptyState title="Sem acesso aos eventos" description="Seu perfil não tem permissão para visualizar eventos desta organização." />
      ) : (
        <div className="space-y-6">
          {events.error || sessions.error ? (
            <LoadError
              error={events.error ?? sessions.error}
              onRetry={() => {
                void events.reload();
                void sessions.reload();
              }}
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {loadingKpi ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
              ) : (
                <>
                  <Stat label="Eventos ativos" value={fmtInt(events.data?.length ?? 0)} icon={<CalendarDays />} hint="Não arquivados" />
                  <Stat label="Sessões ao vivo" value={fmtInt(live)} icon={<Radio />} accent={live > 0 ? "text-brand" : undefined} hint={`${fmtInt(active.length)} em andamento ou aguardando`} />
                  <Stat label="Participações" value={fmtInt(participations)} icon={<Users />} hint="Inscrições somadas em todas as sessões" />
                  {uniqueParticipants !== undefined ? (
                    <Stat label="Participantes únicos" value={fmtInt(uniqueParticipants)} icon={<Users />} hint="Pessoas cadastradas na organização" />
                  ) : (
                    <Stat label="Sessões realizadas" value={fmtInt(all.filter((s) => s.status === "ENCERRADA").length)} icon={<Clock />} hint={`${fmtInt(all.length)} sessões no total`} />
                  )}
                </>
              )}
            </div>
          )}

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Sessões ao vivo e aguardando</CardTitle>
                <CardDescription>Abra o painel de controle para conduzir a dinâmica.</CardDescription>
              </CardHeader>
              <CardContent>
                {sessions.loading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16" />
                    <Skeleton className="h-16" />
                  </div>
                ) : sessions.error ? (
                  <LoadError error={sessions.error} onRetry={sessions.reload} />
                ) : active.length === 0 ? (
                  <EmptyState
                    icon={<MonitorPlay />}
                    title="Nenhuma sessão em andamento"
                    description="Crie ou abra uma sessão na aba Sessões de um evento."
                    action={
                      <Button variant="outline" size="sm" asChild>
                        <Link href="/admin/eventos">Ver eventos</Link>
                      </Button>
                    }
                  />
                ) : (
                  <ul className="divide-y divide-border">
                    {active.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-black">{s.name}</span>
                            <SessionStatusBadge status={s.status} />
                          </div>
                          <p className="truncate text-sm text-muted-foreground">
                            {s.eventTitle} · código <span className="font-mono font-bold tracking-wider">{s.code}</span> · {fmtInt(s.participants)} participantes
                          </p>
                        </div>
                        {can("session.control") && (
                          <Button size="sm" asChild>
                            <Link href={`/admin/sessoes/${s.id}/controle`}>
                              <MonitorPlay /> Abrir controle
                            </Link>
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Atalhos</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2">
                  {shortcuts.map((s) => (
                    <Button key={s.href} variant={s.primary ? "default" : "outline"} className="h-auto justify-start whitespace-normal py-3 text-left" asChild>
                      <Link href={s.href}>
                        <s.icon /> {s.label}
                      </Link>
                    </Button>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Próximas sessões agendadas</CardTitle>
                </CardHeader>
                <CardContent>
                  {sessions.loading ? (
                    <Skeleton className="h-12" />
                  ) : upcoming.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma sessão agendada.</p>
                  ) : (
                    <ul className="space-y-3">
                      {upcoming.map((s) => (
                        <li key={s.id} className="text-sm">
                          <Link href={`/admin/eventos/${s.eventId}/sessoes`} className="font-bold hover:text-brand">
                            {s.name}
                          </Link>
                          <p className="text-muted-foreground">
                            {s.eventTitle} · {fmtDateTime(s.scheduledAt)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
