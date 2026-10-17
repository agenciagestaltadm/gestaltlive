"use client";
/** Relatórios: visão geral das sessões com filtros e comparativo entre turmas de um evento. */
import { Suspense, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart3, ChevronRight, X } from "lucide-react";
import { admin } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useAdmin } from "@/components/admin/admin-context";
import { PageHeader } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Field, Input, NativeSelect, Skeleton, Stat } from "@/components/ui/primitives";
import { buildQuery, ErrorState, NoPermission, StatusBadge, TableWrap, td, th, useAdminTheme } from "@/components/reports/report-ui";
import { CompareSection } from "@/components/reports/compare-section";
import type { EventRow, MemberRow, OverviewRow } from "@/components/reports/types";
import { cn, fmtDate, fmtInt, fmtPct } from "@/lib/utils";

function Overview() {
  const { orgId, can } = useAdmin();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const theme = useAdminTheme();
  const allowed = can("reports.read");

  const filters = useMemo(
    () => ({
      eventId: params.get("eventId") ?? "",
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
      speakerUserId: params.get("speakerUserId") ?? "",
    }),
    [params],
  );
  const invalidRange = !!filters.from && !!filters.to && filters.from > filters.to;
  const qs = buildQuery({ orgId, ...filters, ...(invalidRange ? { from: "", to: "" } : {}) });

  const events = useApi<EventRow[]>(allowed ? () => admin.get<EventRow[]>(`/events?orgId=${orgId}`) : null, [orgId, allowed]);
  const members = useApi<MemberRow[]>(allowed ? () => admin.get<MemberRow[]>(`/orgs/${orgId}/members`) : null, [orgId, allowed]);
  const rows = useApi<OverviewRow[]>(allowed ? () => admin.get<OverviewRow[]>(`/reports/sessions${qs}`) : null, [qs, allowed]);

  const setFilter = (patch: Partial<typeof filters>) => {
    const next = { ...filters, ...patch };
    router.replace(`${pathname}${buildQuery(next)}`, { scroll: false });
  };
  const hasFilters = Object.values(filters).some(Boolean);

  const totals = useMemo(() => {
    const list = rows.data ?? [];
    return {
      sessions: list.length,
      registered: list.reduce((a, r) => a + r.registered, 0),
      interacted: list.reduce((a, r) => a + r.interacted, 0),
      answers: list.reduce((a, r) => a + r.answers, 0),
    };
  }, [rows.data]);

  if (!allowed) {
    return (
      <>
        <PageHeader title="Relatórios" />
        <NoPermission description="Seu perfil não tem a permissão “Relatórios”. Peça acesso a um administrador da organização." />
      </>
    );
  }

  const speakers = (members.data ?? []).filter((m) => m.isActive !== false);
  const selectedEvent = events.data?.find((e) => e.id === filters.eventId);

  return (
    <div className="space-y-8">
      <PageHeader title="Relatórios" description="Indicadores de todas as sessões da organização e comparativo entre turmas do mesmo evento." />

      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-5">
          <Field label="Evento" htmlFor="f-event" className="xl:col-span-2">
            <NativeSelect id="f-event" value={filters.eventId} onChange={(e) => setFilter({ eventId: e.target.value })} disabled={events.loading && !events.data}>
              <option value="">Todos os eventos</option>
              {(events.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
              {filters.eventId && events.data && !selectedEvent && <option value={filters.eventId}>Evento selecionado (arquivado)</option>}
            </NativeSelect>
          </Field>
          <Field label="De" htmlFor="f-from">
            <Input id="f-from" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter({ from: e.target.value })} />
          </Field>
          <Field label="Até" htmlFor="f-to" error={invalidRange ? "A data final deve ser posterior à inicial." : null}>
            <Input id="f-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter({ to: e.target.value })} aria-invalid={invalidRange} />
          </Field>
          <Field label="Palestrante" htmlFor="f-speaker" hint={members.error ? "Lista de palestrantes indisponível." : undefined}>
            <NativeSelect id="f-speaker" value={filters.speakerUserId} onChange={(e) => setFilter({ speakerUserId: e.target.value })} disabled={!!members.error || (members.loading && !members.data)}>
              <option value="">Todos</option>
              {speakers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {hasFilters && (
            <div className="sm:col-span-2 xl:col-span-5">
              <Button variant="ghost" size="sm" onClick={() => router.replace(pathname, { scroll: false })}>
                <X /> Limpar filtros
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sessões" value={rows.data ? fmtInt(totals.sessions) : "—"} />
        <Stat label="Inscrições" value={rows.data ? fmtInt(totals.registered) : "—"} hint="soma das inscrições por sessão" />
        <Stat label="Interações" value={rows.data ? fmtInt(totals.interacted) : "—"} hint="inscritos que responderam" />
        <Stat label="Respostas" value={rows.data ? fmtInt(totals.answers) : "—"} />
      </div>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Sessões</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.error && !rows.data ? (
            <ErrorState error={rows.error} onRetry={() => void rows.reload()} />
          ) : !rows.data ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : rows.data.length === 0 ? (
            <EmptyState
              icon={<BarChart3 />}
              title={hasFilters ? "Nenhuma sessão encontrada" : "Nenhuma sessão ainda"}
              description={hasFilters ? "Ajuste os filtros para ver outras sessões." : "Os relatórios aparecem aqui assim que houver sessões criadas."}
            />
          ) : (
            <TableWrap className={rows.loading ? "opacity-60" : undefined}>
              <table className="w-full min-w-[980px] text-sm">
                <caption className="sr-only">Sessões e seus indicadores</caption>
                <thead className="bg-muted/60">
                  <tr>
                    <th scope="col" className={th}>Sessão</th>
                    <th scope="col" className={th}>Evento</th>
                    <th scope="col" className={th}>Palestrante</th>
                    <th scope="col" className={th}>Status</th>
                    <th scope="col" className={th}>Data</th>
                    <th scope="col" className={cn(th, "text-right")}>Inscritos</th>
                    <th scope="col" className={cn(th, "text-right")}>Interagiram</th>
                    <th scope="col" className={cn(th, "text-right")}>Respostas</th>
                    <th scope="col" className={cn(th, "text-right")}>Acerto médio</th>
                    <th scope="col" className={cn(th, "text-right")}>Satisfação</th>
                    <th scope="col" className={th}>
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.data.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/40">
                      <td className={td}>
                        <Link href={`/admin/sessoes/${r.id}/resultados`} className="font-bold hover:text-brand hover:underline">
                          {r.name}
                        </Link>
                        <div className="text-xs tracking-wider text-muted-foreground tabular">{r.code}</div>
                      </td>
                      <td className={td}>
                        <button type="button" className="text-left hover:text-brand hover:underline" onClick={() => setFilter({ eventId: r.eventId })} title="Filtrar por este evento">
                          {r.eventTitle}
                        </button>
                      </td>
                      <td className={cn(td, "text-muted-foreground")}>{r.speakerName ?? "—"}</td>
                      <td className={td}>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className={cn(td, "whitespace-nowrap tabular")}>{fmtDate(r.startedAt ?? r.createdAt)}</td>
                      <td className={cn(td, "text-right tabular")}>{fmtInt(r.registered)}</td>
                      <td className={cn(td, "text-right tabular")}>
                        {fmtInt(r.interacted)}
                        {r.registered > 0 && <div className="text-xs text-muted-foreground">{fmtPct((r.interacted / r.registered) * 100)}</div>}
                      </td>
                      <td className={cn(td, "text-right tabular")}>{fmtInt(r.answers)}</td>
                      <td className={cn(td, "text-right tabular")}>{r.accuracyPct === null ? "—" : <span className="font-bold text-positive">{fmtPct(r.accuracyPct)}</span>}</td>
                      <td className={cn(td, "text-right tabular")}>
                        {r.satisfaction && r.satisfaction.total > 0 ? (
                          <>
                            <span className="font-bold text-positive">{fmtPct(r.satisfaction.positivePct)}</span>
                            <div className="text-xs text-muted-foreground">{fmtInt(r.satisfaction.total)} avaliações</div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Sem avaliações</span>
                        )}
                      </td>
                      <td className={cn(td, "text-right")}>
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/admin/sessoes/${r.id}/resultados`} aria-label={`Ver relatório da sessão ${r.name}`}>
                            Relatório <ChevronRight />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {rows.data && rows.data.length >= 500 && <p className="mt-2 text-xs text-muted-foreground">Exibindo as 500 sessões mais recentes. Use os filtros para refinar.</p>}
        </CardContent>
      </Card>

      {filters.eventId ? (
        <CompareSection key={filters.eventId} eventId={filters.eventId} theme={theme} />
      ) : (
        <section id="comparativo" className="scroll-mt-20">
          <EmptyState
            title="Comparativo entre turmas"
            description="Escolha um evento no filtro acima para comparar participação, acerto e satisfação entre as turmas (sessões) dele."
          />
        </section>
      )}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-12 w-1/3" />
          <Skeleton className="h-28" />
          <Skeleton className="h-80" />
        </div>
      }
    >
      <Overview />
    </Suspense>
  );
}
