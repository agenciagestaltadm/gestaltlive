"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { Archive, ArchiveRestore, CalendarDays, Copy, LayoutTemplate, MapPin, MoreVertical, User } from "lucide-react";
import { admin } from "@/lib/api";
import { useAction, useApi } from "@/lib/hooks";
import { cn, fmtDateTime, fmtInt } from "@/lib/utils";
import { useAdmin } from "@/components/admin/admin-context";
import { EventDataProvider } from "@/components/admin/event-context";
import { LoadError } from "@/components/admin/load-error";
import type { EventDetail } from "@/components/admin/event-types";
import { EventLogo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Badge, Dialog, Field, Input, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton, Textarea } from "@/components/ui/primitives";

const TABS: { seg: string; label: string; href?: (eventId: string) => string }[] = [
  { seg: "", label: "Visão geral" },
  { seg: "/perguntas", label: "Perguntas" },
  { seg: "/cadastro", label: "Cadastro" },
  { seg: "/premios", label: "Prêmios" },
  { seg: "/sessoes", label: "Sessões" },
  { seg: "/apresentacoes", label: "Apresentações", href: (eventId) => `/admin/apresentacoes?eventId=${eventId}` },
];

function SaveTemplateDialog({ event, open, onOpenChange }: { event: EventDetail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAction();
  useEffect(() => {
    if (open) {
      setName(event.title);
      setDescription(event.description ?? "");
      setError(null);
    }
  }, [open, event.title, event.description]);
  const submit = async () => {
    if (!name.trim()) return setError("Informe o nome do template.");
    const r = await run("tpl", () => admin.post(`/events/${event.id}/save-template`, { name: name.trim(), description: description.trim() || null }), "Template salvo. Ele já está disponível em Templates.");
    if (r) onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Salvar como template"
      description="Guarda as perguntas, a configuração de cadastro, os campos personalizados e as configurações para reutilizar em novos eventos."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending === "tpl"}>
            <LayoutTemplate /> Salvar template
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
        <Field label="Nome do template" htmlFor="tpl-name" required error={error}>
          <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} aria-invalid={!!error} />
        </Field>
        <Field label="Descrição" htmlFor="tpl-desc">
          <Textarea id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} />
        </Field>
      </form>
    </Dialog>
  );
}

export default function EventLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const path = usePathname();
  const router = useRouter();
  const { can } = useAdmin();
  const { run, pending } = useAction();
  const [tplOpen, setTplOpen] = useState(false);
  const q = useApi(() => admin.get<EventDetail>(`/events/${id}`), [id]);
  const ev = q.data;
  const base = `/admin/eventos/${id}`;
  const canWrite = can("event.write");

  const duplicate = async () => {
    const copy = await run("dup", () => admin.post<{ id: string }>(`/events/${id}/duplicate`), "Evento duplicado.");
    if (copy) router.push(`/admin/eventos/${copy.id}`);
  };
  const toggleArchive = async () => {
    if (!ev) return;
    const ok = await run("arc", () => admin.post(`/events/${id}/archive`, { archived: !ev.archivedAt }), ev.archivedAt ? "Evento restaurado." : "Evento arquivado.");
    if (ok) void q.reload();
  };

  return (
    <div>
      <Link href="/admin/eventos" className="mb-2 inline-block text-sm font-bold text-muted-foreground hover:text-brand">
        ← Eventos
      </Link>

      {q.loading && !ev ? (
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-10 w-full max-w-xl" />
          <Skeleton className="h-64" />
        </div>
      ) : q.error || !ev ? (
        <LoadError error={q.error} onRetry={q.reload} />
      ) : (
        <>
          <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-navy-900 p-2">
                <EventLogo src={ev.logoUrl} className="h-full max-h-10 w-full" />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-black tracking-tight lg:text-3xl">{ev.title}</h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
                  {ev.archivedAt && <Badge tone="warning">Arquivado</Badge>}
                  <Badge tone="muted">
                    {fmtInt(ev.questionCount)} {ev.questionCount === 1 ? "pergunta" : "perguntas"}
                  </Badge>
                  {ev.startsAt && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="size-3.5" aria-hidden /> {fmtDateTime(ev.startsAt)}
                    </span>
                  )}
                  {ev.location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3.5" aria-hidden /> {ev.location}
                    </span>
                  )}
                  {(ev.speakerName || ev.speaker) && (
                    <span className="inline-flex items-center gap-1">
                      <User className="size-3.5" aria-hidden /> {ev.speakerName || ev.speaker?.name}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {canWrite && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={duplicate} loading={pending === "dup"}>
                  <Copy /> Duplicar
                </Button>
                <Button variant="outline" size="sm" onClick={() => setTplOpen(true)}>
                  <LayoutTemplate /> Salvar como template
                </Button>
                <Menu>
                  <MenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Mais ações do evento">
                      <MoreVertical />
                    </Button>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem onSelect={() => void toggleArchive()} disabled={pending === "arc"}>
                      {ev.archivedAt ? (
                        <>
                          <ArchiveRestore /> Desarquivar evento
                        </>
                      ) : (
                        <>
                          <Archive /> Arquivar evento
                        </>
                      )}
                    </MenuItem>
                  </MenuContent>
                </Menu>
              </div>
            )}
          </header>

          <nav aria-label="Seções do evento" className="-mx-4 mb-6 overflow-x-auto border-b border-border px-4 lg:mx-0 lg:px-0">
            <ul className="flex min-w-max gap-1">
              {TABS.map((t) => {
                const href = t.href ? t.href(id) : `${base}${t.seg}`;
                const active = t.href ? false : t.seg === "" ? path === base : path.startsWith(href);
                return (
                  <li key={t.seg}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "-mb-px inline-flex items-center border-b-2 px-3 py-2.5 text-sm font-bold transition",
                        active ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <EventDataProvider value={{ event: ev, reload: q.reload }}>{children}</EventDataProvider>
          {canWrite && <SaveTemplateDialog event={ev} open={tplOpen} onOpenChange={setTplOpen} />}
        </>
      )}
    </div>
  );
}
