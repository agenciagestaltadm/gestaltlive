"use client";
import { useState } from "react";
import Link from "next/link";
import { BarChart3, MonitorPlay, Radio, Search } from "lucide-react";
import { admin } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { fmtDateTime, fmtInt } from "@/lib/utils";
import { PageHeader } from "@/components/admin/admin-shell";
import { useAdmin } from "@/components/admin/admin-context";
import { LoadError } from "@/components/admin/load-error";
import { SessionStatusBadge } from "@/components/admin/session-status-badge";
import type { OrgSessionRow } from "@/components/admin/event-types";
import { Button } from "@/components/ui/button";
import { EmptyState, Input, Skeleton, Tabs, TabsList, TabsTrigger } from "@/components/ui/primitives";

const FILTERS = {
  ativas: { label: "Em andamento", status: "AO_VIVO,PAUSADA,AGUARDANDO" },
  agendadas: { label: "Agendadas e rascunhos", status: "AGENDADA,RASCUNHO" },
  encerradas: { label: "Encerradas", status: "ENCERRADA,CANCELADA" },
  todas: { label: "Todas", status: "" },
} as const;
type FilterKey = keyof typeof FILTERS;

export default function OrgSessionsPage() {
  const { orgId, can } = useAdmin();
  const [filter, setFilter] = useState<FilterKey>("ativas");
  const [search, setSearch] = useState("");
  const status = FILTERS[filter].status;
  const list = useApi(() => admin.get<OrgSessionRow[]>(`/sessions?orgId=${orgId}${status ? `&status=${status}` : ""}`), [orgId, status]);
  const canControl = can("session.control");
  const canResults = can("session.control") || can("reports.read");

  const term = search.trim().toLowerCase();
  const rows = (list.data ?? []).filter((s) => !term || [s.name, s.eventTitle, s.code, s.speakerName].some((v) => v?.toLowerCase().includes(term)));

  return (
    <div>
      <PageHeader title="Sessões" description="Todas as sessões (turmas) da organização. Para criar uma sessão, abra o evento desejado." />

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
          <TabsList aria-label="Filtrar sessões por status">
            {(Object.keys(FILTERS) as FilterKey[]).map((k) => (
              <TabsTrigger key={k} value={k}>
                {FILTERS[k].label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por sessão, evento ou código…" aria-label="Buscar sessão" className="pl-9" />
        </div>
      </div>

      {list.loading && !list.data ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Radio />}
          title={term ? "Nenhuma sessão encontrada" : filter === "ativas" ? "Nenhuma sessão em andamento" : "Nenhuma sessão"}
          description={term ? "Tente outro termo de busca." : "Sessões são criadas na aba Sessões de cada evento."}
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/eventos">Ver eventos</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3">Sessão</th>
                <th scope="col" className="px-4 py-3">Evento</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Código</th>
                <th scope="col" className="px-4 py-3 text-right">Participantes</th>
                <th scope="col" className="px-4 py-3">Data</th>
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-muted/40">
                  <td className="px-4 py-3 font-bold">{s.name}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/eventos/${s.eventId}/sessoes`} className="hover:text-brand">
                      {s.eventTitle}
                    </Link>
                    {s.speakerName && <div className="text-xs text-muted-foreground">{s.speakerName}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <SessionStatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3 font-mono font-bold tracking-wider">{s.code}</td>
                  <td className="px-4 py-3 text-right tabular">{fmtInt(s.participants)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDateTime(s.startedAt ?? s.scheduledAt ?? s.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {canControl && s.status !== "ENCERRADA" && s.status !== "CANCELADA" && (
                        <Button size="sm" asChild>
                          <Link href={`/admin/sessoes/${s.id}/controle`} aria-label={`Abrir controle da sessão ${s.name}`}>
                            <MonitorPlay /> Controle
                          </Link>
                        </Button>
                      )}
                      {canResults && (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/admin/sessoes/${s.id}/resultados`} aria-label={`Resultados da sessão ${s.name}`}>
                            <BarChart3 /> Resultados
                          </Link>
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
