"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, CalendarDays, CalendarPlus, Copy, LayoutTemplate, MapPin, MoreVertical, Search, Trash2, User } from "lucide-react";
import { admin, ApiError } from "@/lib/api";
import { useAction, useApi } from "@/lib/hooks";
import { fmtDateTime, fmtInt } from "@/lib/utils";
import { PageHeader } from "@/components/admin/admin-shell";
import { useAdmin } from "@/components/admin/admin-context";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { LoadError } from "@/components/admin/load-error";
import { TemplateEventDialog } from "@/components/admin/template-event-dialog";
import type { EventListRow } from "@/components/admin/event-types";
import { EventLogo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, Input, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton, Tabs, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

export default function EventsPage() {
  const { orgId, can } = useAdmin();
  const router = useRouter();
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [tplOpen, setTplOpen] = useState(false);
  const [toDelete, setToDelete] = useState<EventListRow | null>(null);
  const { run, pending } = useAction();
  const list = useApi(() => admin.get<EventListRow[]>(`/events?orgId=${orgId}${archived ? "&archived=1" : ""}`), [orgId, archived]);
  const canWrite = can("event.write");

  const term = search.trim().toLowerCase();
  const rows = (list.data ?? []).filter(
    (e) => !term || [e.title, e.description, e.location, e.speakerName].some((v) => v?.toLowerCase().includes(term)),
  );

  const duplicate = async (e: EventListRow) => {
    const copy = await run(`dup:${e.id}`, () => admin.post<{ id: string }>(`/events/${e.id}/duplicate`), "Evento duplicado.");
    if (copy) router.push(`/admin/eventos/${copy.id}`);
  };
  const toggleArchive = async (e: EventListRow) => {
    const ok = await run(`arc:${e.id}`, () => admin.post(`/events/${e.id}/archive`, { archived: !e.archivedAt }), e.archivedAt ? "Evento restaurado." : "Evento arquivado.");
    if (ok) void list.reload();
  };
  const remove = async (e: EventListRow) => {
    try {
      await admin.del(`/events/${e.id}`);
      toast.success("Evento excluído.");
      void list.reload();
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error("Este evento já possui sessões e não pode ser excluído. Arquive-o para tirá-lo da lista — os dados são preservados.");
      } else toast.error(err instanceof Error ? err.message : "Não foi possível excluir.");
      return false;
    }
  };

  return (
    <div>
      <PageHeader
        title="Eventos"
        description="Treinamentos e palestras da organização. Cada evento reúne perguntas, cadastro, prêmios e sessões."
        actions={
          canWrite && (
            <>
              <Button variant="outline" onClick={() => setTplOpen(true)}>
                <LayoutTemplate /> Criar a partir de template
              </Button>
              <Button asChild>
                <Link href="/admin/eventos/novo">
                  <CalendarPlus /> Novo evento
                </Link>
              </Button>
            </>
          )
        }
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={archived ? "arquivados" : "ativos"} onValueChange={(v) => setArchived(v === "arquivados")}>
          <TabsList aria-label="Filtrar eventos">
            <TabsTrigger value="ativos">Ativos</TabsTrigger>
            <TabsTrigger value="arquivados">
              <Archive /> Arquivados
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar evento…" aria-label="Buscar evento" className="pl-9" />
        </div>
      </div>

      {list.loading && !list.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title={term ? "Nenhum evento encontrado" : archived ? "Nenhum evento arquivado" : "Nenhum evento ainda"}
          description={term ? "Tente outro termo de busca." : archived ? "Eventos arquivados aparecem aqui." : "Crie o primeiro evento para começar a montar sua dinâmica."}
          action={
            !term &&
            !archived &&
            canWrite && (
              <Button asChild>
                <Link href="/admin/eventos/novo">
                  <CalendarPlus /> Novo evento
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((e) => (
            <Card key={e.id} className="group relative flex flex-col p-5 transition hover:border-brand/40 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-navy-900 p-1.5">
                  <EventLogo src={e.logoUrl} className="h-full max-h-9 w-full" />
                </div>
                {canWrite && (
                  <Menu>
                    <MenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Ações do evento ${e.title}`} className="relative z-10">
                        <MoreVertical />
                      </Button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem onSelect={() => void duplicate(e)} disabled={pending === `dup:${e.id}`}>
                        <Copy /> Duplicar
                      </MenuItem>
                      <MenuItem onSelect={() => void toggleArchive(e)} disabled={pending === `arc:${e.id}`}>
                        {e.archivedAt ? (
                          <>
                            <ArchiveRestore /> Desarquivar
                          </>
                        ) : (
                          <>
                            <Archive /> Arquivar
                          </>
                        )}
                      </MenuItem>
                      <MenuItem onSelect={() => setToDelete(e)} className="text-negative">
                        <Trash2 /> Excluir
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                )}
              </div>
              <Link href={`/admin/eventos/${e.id}`} className="mt-3 after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand">
                <h2 className="line-clamp-2 text-lg font-black leading-tight group-hover:text-brand">{e.title}</h2>
              </Link>
              <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                {e.startsAt && (
                  <p className="flex items-center gap-1.5">
                    <CalendarDays className="size-3.5" aria-hidden /> {fmtDateTime(e.startsAt)}
                  </p>
                )}
                {e.location && (
                  <p className="flex items-center gap-1.5 truncate">
                    <MapPin className="size-3.5" aria-hidden /> {e.location}
                  </p>
                )}
                {e.speakerName && (
                  <p className="flex items-center gap-1.5 truncate">
                    <User className="size-3.5" aria-hidden /> {e.speakerName}
                  </p>
                )}
              </div>
              <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
                <Badge tone="muted">{fmtInt(e.questionCount)} {e.questionCount === 1 ? "pergunta" : "perguntas"}</Badge>
                <Badge tone="muted">{fmtInt(e.sessionCount)} {e.sessionCount === 1 ? "sessão" : "sessões"}</Badge>
                {e.liveCount > 0 && (
                  <Badge tone="brand">
                    <span className="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden /> {fmtInt(e.liveCount)} ao vivo
                  </Badge>
                )}
                {e.archivedAt && <Badge tone="outline">Arquivado</Badge>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <TemplateEventDialog open={tplOpen} onOpenChange={setTplOpen} />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Excluir evento?"
        description={
          toDelete && toDelete.sessionCount > 0
            ? `"${toDelete.title}" possui ${toDelete.sessionCount} ${toDelete.sessionCount === 1 ? "sessão" : "sessões"} e não pode ser excluído (os dados são preservados). Arquive o evento em vez disso.`
            : `"${toDelete?.title ?? ""}" e todas as suas perguntas, prêmios e campos serão removidos definitivamente.`
        }
        confirmLabel={toDelete && toDelete.sessionCount > 0 ? (toDelete.archivedAt ? "Entendi" : "Arquivar evento") : "Excluir"}
        tone={toDelete && toDelete.sessionCount > 0 ? "default" : "negative"}
        onConfirm={async () => {
          if (!toDelete) return;
          if (toDelete.sessionCount > 0) {
            if (!toDelete.archivedAt) await toggleArchive(toDelete);
            return;
          }
          return remove(toDelete);
        }}
      />
    </div>
  );
}
