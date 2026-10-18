"use client";
/** Gerenciador de Apresentações — lista de apresentações da organização. */
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Copy, EllipsisVertical, ImageIcon, Layers, Pencil, Play, Plus, Presentation, Search, Trash2 } from "lucide-react";
import { admin, ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { fmtDateTime, fmtInt } from "@/lib/utils";
import { useAdmin } from "@/components/admin/admin-context";
import { PageHeader } from "@/components/admin/admin-shell";
import { LoadError } from "@/components/admin/load-error";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, Input, Menu, MenuContent, MenuItem, MenuTrigger, NativeSelect, Skeleton } from "@/components/ui/primitives";
import { DuplicateDialog, NewPresentationDialog, useOrgEvents } from "@/components/presentations/presentation-dialogs";
import type { PresentationListRow } from "@/components/presentations/types";

function PresentationsList() {
  const { orgId, can } = useAdmin();
  const canWrite = can("event.write");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const eventId = params.get("eventId") ?? "";
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [dupOf, setDupOf] = useState<PresentationListRow | null>(null);
  const [toDelete, setToDelete] = useState<PresentationListRow | null>(null);

  const list = useApi(() => admin.get<PresentationListRow[]>(`/presentations?orgId=${orgId}${eventId ? `&eventId=${eventId}` : ""}`), [orgId, eventId]);
  const events = useOrgEvents(orgId);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = list.data ?? [];
    if (!q) return all;
    return all.filter((r) => r.title.toLowerCase().includes(q) || (r.eventTitle ?? "").toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q));
  }, [list.data, query]);

  const setEventFilter = (v: string) => {
    const sp = new URLSearchParams(params.toString());
    if (v) sp.set("eventId", v);
    else sp.delete("eventId");
    router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`);
  };

  const remove = async (p: PresentationListRow) => {
    try {
      await admin.del(`/presentations/${p.id}`);
      toast.success("Apresentação excluída. Os slides continuam na biblioteca.");
      list.setData((list.data ?? []).filter((x) => x.id !== p.id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast.error(e.message || "A apresentação está em uso numa sessão em andamento.");
      else toast.error(e instanceof Error ? e.message : "Não foi possível excluir.");
      return false;
    }
  };

  const filteredEvent = events.data?.find((e) => e.id === eventId);

  return (
    <div>
      <PageHeader
        title="Apresentações"
        description="Envie os slides exportados do Canva, intercale perguntas e telas interativas e apresente tudo no Gestalt Live."
        back={filteredEvent ? { href: `/admin/eventos/${filteredEvent.id}`, label: filteredEvent.title } : undefined}
        actions={
          canWrite && (
            <Button onClick={() => setNewOpen(true)}>
              <Plus /> Nova apresentação
            </Button>
          )
        }
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por título ou evento" aria-label="Buscar apresentações" className="pl-9" />
        </div>
        <div className="sm:w-72">
          <NativeSelect value={eventId} onChange={(e) => setEventFilter(e.target.value)} aria-label="Filtrar por evento">
            <option value="">Todos os eventos</option>
            {(events.data ?? []).map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {list.loading && !list.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : list.error ? (
        <LoadError error={list.error} onRetry={() => void list.reload()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Presentation />}
          title={query || eventId ? "Nenhuma apresentação encontrada" : "Nenhuma apresentação ainda"}
          description={
            query || eventId
              ? "Ajuste a busca ou o filtro de evento."
              : "Crie uma apresentação, envie os slides do Canva em lote (JPG/PNG) e intercale perguntas, enquetes, quizzes, ranking e satisfação."
          }
          action={
            canWrite && !query ? (
              <Button onClick={() => setNewOpen(true)}>
                <Plus /> Nova apresentação
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Apresentações">
          {rows.map((p) => (
            <li key={p.id}>
              <Card className="flex h-full flex-col overflow-hidden">
                <Link href={`/admin/apresentacoes/${p.id}`} className="group relative block aspect-video bg-navy-950" aria-label={`Abrir editor de ${p.title}`}>
                  {p.coverUrl ? (
                    <img src={p.coverUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain transition group-hover:opacity-90" />
                  ) : (
                    <div className="grid h-full place-items-center text-white/40">
                      <ImageIcon className="size-10" aria-hidden />
                    </div>
                  )}
                  <span className="absolute bottom-2 right-2 rounded-full bg-navy-950/80 px-2.5 py-1 text-xs font-bold text-white">
                    {fmtInt(p.itemCount)} {p.itemCount === 1 ? "item" : "itens"}
                  </span>
                </Link>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/admin/apresentacoes/${p.id}`} className="min-w-0 font-black leading-snug hover:text-brand">
                      {p.title}
                    </Link>
                    {canWrite && (
                      <Menu>
                        <MenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Mais ações de ${p.title}`} className="-mr-2 -mt-1 shrink-0">
                            <EllipsisVertical />
                          </Button>
                        </MenuTrigger>
                        <MenuContent>
                          <MenuItem onSelect={() => router.push(`/admin/apresentacoes/${p.id}`)}>
                            <Pencil /> Editar
                          </MenuItem>
                          <MenuItem onSelect={() => setDupOf(p)}>
                            <Copy /> Duplicar
                          </MenuItem>
                          <MenuItem onSelect={() => setToDelete(p)} className="text-negative">
                            <Trash2 /> Excluir
                          </MenuItem>
                        </MenuContent>
                      </Menu>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {p.eventTitle ? (
                      <Badge tone="brand" className="max-w-full">
                        <CalendarDays className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{p.eventTitle}</span>
                      </Badge>
                    ) : (
                      <Badge tone="outline">Sem evento</Badge>
                    )}
                    <Badge tone="muted">
                      <Layers className="size-3.5" aria-hidden /> {fmtInt(p.slideCount)} {p.slideCount === 1 ? "slide" : "slides"}
                    </Badge>
                  </div>
                  {p.description && <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}
                  <p className="mt-auto text-xs text-muted-foreground">Atualizada em {fmtDateTime(p.updatedAt)}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button asChild size="sm" className="flex-1">
                      <Link href={`/admin/apresentacoes/${p.id}`}>
                        <Pencil /> {canWrite ? "Abrir editor" : "Visualizar"}
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline" className="flex-1">
                      <Link href={`/admin/apresentacoes/${p.id}/ensaio`}>
                        <Play /> Ensaiar
                      </Link>
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <>
          <NewPresentationDialog
            open={newOpen}
            onOpenChange={setNewOpen}
            orgId={orgId}
            events={events.data ?? []}
            defaultEventId={eventId || null}
            onCreated={(p) => {
              setNewOpen(false);
              router.push(`/admin/apresentacoes/${p.id}`);
            }}
          />
          <DuplicateDialog
            open={!!dupOf}
            onOpenChange={(v) => !v && setDupOf(null)}
            source={dupOf}
            events={events.data ?? []}
            onDuplicated={(p) => {
              setDupOf(null);
              void list.reload();
              router.push(`/admin/apresentacoes/${p.id}`);
            }}
          />
        </>
      )}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Excluir apresentação?"
        description={toDelete ? `“${toDelete.title}” e sua linha do tempo serão excluídas. Os slides continuam disponíveis na biblioteca e as perguntas no evento.` : undefined}
        confirmLabel="Excluir"
        onConfirm={() => (toDelete ? remove(toDelete) : undefined)}
      />
    </div>
  );
}

export default function PresentationsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-12 w-1/3" />
          <Skeleton className="h-11" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
          </div>
        </div>
      }
    >
      <PresentationsList />
    </Suspense>
  );
}
