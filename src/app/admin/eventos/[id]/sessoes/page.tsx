"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, CheckCircle2, Gift, Link2, MonitorPlay, MoreVertical, Pencil, Plus, QrCode, Radio, Trash2, Tv } from "lucide-react";
import { sessionInputSchema } from "@shared/schemas";
import { admin, ApiError } from "@/lib/api";
import { useAction, useApi } from "@/lib/hooks";
import { fmtDateTime, fmtInt, ordinal } from "@/lib/utils";
import { useAdmin } from "@/components/admin/admin-context";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { useEventData } from "@/components/admin/event-context";
import { LoadError } from "@/components/admin/load-error";
import { SessionStatusBadge } from "@/components/admin/session-status-badge";
import { copyText, isoToLocalInput, localInputToIso, type AwardRow, type EventSessionRow, type SessionAdminDetail } from "@/components/admin/event-types";
import { Button } from "@/components/ui/button";
import { Badge, Card, Dialog, EmptyState, Field, Input, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton, Spinner, Textarea } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

/* ------------------------------------------------------------------ criar/editar */
function SessionFormDialog({
  open,
  onOpenChange,
  eventId,
  session,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventId: string;
  session: EventSessionRow | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [when, setWhen] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const editable = !session || session.status === "RASCUNHO" || session.status === "AGENDADA";
  useEffect(() => {
    if (open) {
      setName(session?.name ?? "");
      setWhen(isoToLocalInput(session?.scheduledAt));
      setErrors({});
    }
  }, [open, session]);

  const submit = async () => {
    const body = { name, scheduledAt: localInputToIso(when) };
    const parsed = sessionInputSchema.safeParse(body);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      return setErrors(errs);
    }
    setBusy(true);
    try {
      if (session) await admin.put(`/sessions/${session.id}`, parsed.data);
      else await admin.post(`/events/${eventId}/sessions`, parsed.data);
      toast.success(session ? "Sessão atualizada." : "Sessão criada.");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar a sessão.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title={session ? "Editar sessão" : "Nova sessão"}
      description="Cada sessão é uma turma/apresentação com código, QR Code e ranking próprios. As perguntas prontas do evento são usadas automaticamente."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy}>
            {session ? "Salvar" : "Criar sessão"}
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
        <Field label="Nome da turma/sessão" htmlFor="ss-name" required error={errors.name}>
          <Input id="ss-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} autoFocus placeholder="Ex.: Turma manhã — São Paulo" aria-invalid={!!errors.name} />
        </Field>
        <Field
          label="Agendamento (opcional)"
          htmlFor="ss-when"
          error={errors.scheduledAt}
          hint={editable ? "Com data, a sessão fica como Agendada; sem data, como Rascunho." : "A sessão já foi iniciada; o status não muda."}
        >
          <Input id="ss-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ QR Code */
function QrDialog({ session, onOpenChange }: { session: EventSessionRow | null; onOpenChange: (v: boolean) => void }) {
  const detail = useApi(session ? () => admin.get<SessionAdminDetail>(`/sessions/${session.id}`) : null, [session?.id]);
  const draft = session?.status === "RASCUNHO";
  const qrSrc = session ? `/api/public/sessions/${session.code}/qr.svg` : "";
  return (
    <Dialog open={!!session} onOpenChange={onOpenChange} title="QR Code de entrada" description={session ? `${session.name} · código ${session.code}` : undefined}>
      {session && (
        <div className="flex flex-col items-center gap-4 text-center">
          {draft ? (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
              <p className="font-black">QR Code indisponível em rascunho</p>
              <p className="mt-1 text-muted-foreground">
                Sessões em rascunho não ficam públicas (o link e o QR Code respondem &quot;não encontrada&quot;). Agende a sessão ou abra a sala de espera no painel de controle para liberar o QR Code.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-2xl bg-white p-4 shadow">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrSrc} alt={`QR Code para entrar na sessão ${session.code}`} className="size-64" />
              </div>
              <p className="font-mono text-3xl font-black tracking-[0.3em]">{session.code}</p>
              {session.status === "AGENDADA" && <p className="text-xs text-muted-foreground">Participantes só conseguem se cadastrar quando a sala de espera for aberta.</p>}
            </>
          )}
          {detail.loading ? (
            <Spinner />
          ) : detail.data ? (
            <div className="w-full space-y-2">
              <p className="break-all rounded-xl bg-muted px-3 py-2 font-mono text-xs">{detail.data.joinUrl}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => ((await copyText(detail.data!.joinUrl)) ? toast.success("Link de entrada copiado.") : toast.error("Não foi possível copiar."))}
                >
                  <Link2 /> Copiar link
                </Button>
                {!draft && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={qrSrc} target="_blank" rel="noreferrer" download={`qr-${session.code}.svg`}>
                      <QrCode /> Baixar SVG
                    </a>
                  </Button>
                )}
              </div>
            </div>
          ) : detail.error ? (
            <p className="text-sm text-negative">{detail.error.message}</p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ premiações */
const AWARD_STATUS: Record<AwardRow["status"], { label: string; tone: "warning" | "brand" | "muted" }> = {
  PENDENTE: { label: "Entrega pendente", tone: "warning" },
  ENTREGUE: { label: "Entregue", tone: "brand" },
  REVOGADO: { label: "Revogado", tone: "muted" },
};

function AwardsDialog({ session, onOpenChange }: { session: EventSessionRow | null; onOpenChange: (v: boolean) => void }) {
  const awards = useApi(session ? () => admin.get<AwardRow[]>(`/sessions/${session.id}/awards`) : null, [session?.id]);
  const [delivering, setDelivering] = useState<AwardRow | null>(null);
  const [notes, setNotes] = useState("");
  const { run, pending } = useAction();
  const confirm = async () => {
    if (!delivering) return;
    const ok = await run("deliver", () => admin.post(`/awards/${delivering.id}/deliver`, { notes: notes.trim() || null }), "Entrega confirmada.");
    if (ok) {
      setDelivering(null);
      setNotes("");
      void awards.reload();
    }
  };
  return (
    <Dialog open={!!session} onOpenChange={onOpenChange} title="Premiações da sessão" description={session?.name} className="max-w-2xl">
      {awards.loading && !awards.data ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : awards.error ? (
        <LoadError error={awards.error} onRetry={awards.reload} />
      ) : !awards.data?.length ? (
        <EmptyState icon={<Gift />} title="Nenhuma premiação registrada" description="As premiações são geradas quando o resultado oficial da sessão é finalizado no painel de controle." />
      ) : (
        <ul className="space-y-3">
          {awards.data.map((a) => (
            <li key={a.id} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-black">
                    {ordinal(a.rank)} · {a.displayName} <span className="font-normal text-muted-foreground">({a.fullName})</span>
                  </p>
                  <p className="text-sm text-muted-foreground">{a.prize?.name ?? "Sem prêmio cadastrado"}</p>
                  {(a.email || a.phone) && <p className="text-xs text-muted-foreground">{[a.email, a.phone].filter(Boolean).join(" · ")}</p>}
                  {a.status === "ENTREGUE" && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Entregue em {fmtDateTime(a.deliveredAt)}
                      {a.deliveredBy && ` por ${a.deliveredBy}`}
                      {a.notes && ` — ${a.notes}`}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={AWARD_STATUS[a.status].tone}>{AWARD_STATUS[a.status].label}</Badge>
                  {a.status === "PENDENTE" && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setNotes("");
                        setDelivering(a);
                      }}
                    >
                      <CheckCircle2 /> Confirmar entrega
                    </Button>
                  )}
                </div>
              </div>
              {delivering?.id === a.id && (
                <form
                  className="mt-3 space-y-2 border-t border-border pt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void confirm();
                  }}
                >
                  <Field label="Observações da entrega (opcional)" htmlFor={`notes-${a.id}`}>
                    <Textarea id={`notes-${a.id}`} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: retirado pelo próprio vencedor, documento conferido" />
                  </Field>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setDelivering(null)}>
                      Cancelar
                    </Button>
                    <Button type="submit" size="sm" loading={pending === "deliver"}>
                      Confirmar entrega
                    </Button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ página */
export default function EventSessionsPage() {
  const { event } = useEventData();
  const { can } = useAdmin();
  const list = useApi(() => admin.get<EventSessionRow[]>(`/events/${event.id}/sessions`), [event.id]);
  const [form, setForm] = useState<{ open: boolean; session: EventSessionRow | null }>({ open: false, session: null });
  const [qr, setQr] = useState<EventSessionRow | null>(null);
  const [awards, setAwards] = useState<EventSessionRow | null>(null);
  const [toDelete, setToDelete] = useState<EventSessionRow | null>(null);
  const { run, pending } = useAction();

  const canCreate = can("session.create");
  const canControl = can("session.control");
  const canResults = can("session.control") || can("reports.read");
  const canAwards = can("prizes.deliver");

  const copyLink = async (s: EventSessionRow, kind: "join" | "screen") => {
    const d = await run(`${kind}:${s.id}`, () => admin.get<SessionAdminDetail>(`/sessions/${s.id}`));
    if (!d) return;
    const url = kind === "join" ? d.joinUrl : d.screenUrl;
    if (await copyText(url)) toast.success(kind === "join" ? "Link de entrada copiado." : "Link do telão copiado. Não compartilhe com o público.");
    else toast.error("Não foi possível copiar o link.");
  };

  const remove = async (s: EventSessionRow) => {
    try {
      await admin.del(`/sessions/${s.id}`);
      toast.success("Sessão excluída.");
      void list.reload();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast.error("Esta sessão já tem participantes e não pode ser excluída (os dados são preservados). Cancele-a pelo painel de controle.");
      else toast.error(e instanceof Error ? e.message : "Não foi possível excluir a sessão.");
      return false;
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Cada sessão (turma) tem código, QR Code, telão e ranking próprios.</p>
        {canCreate && (
          <Button onClick={() => setForm({ open: true, session: null })} disabled={!!event.archivedAt}>
            <Plus /> Nova sessão
          </Button>
        )}
      </div>
      {event.archivedAt && <p className="mb-4 rounded-xl bg-warning/10 px-3 py-2 text-sm font-bold text-warning">Evento arquivado: desarquive para criar novas sessões.</p>}
      {event.questionCount === 0 && (
        <p className="mb-4 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
          Este evento ainda não tem perguntas. Cadastre-as na aba{" "}
          <Link href={`/admin/eventos/${event.id}/perguntas`} className="font-bold text-brand hover:underline">
            Perguntas
          </Link>{" "}
          — somente perguntas marcadas como prontas entram nas sessões.
        </p>
      )}

      {list.loading && !list.data ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data?.length ? (
        <EmptyState
          icon={<Radio />}
          title="Nenhuma sessão criada"
          description="Crie uma sessão para gerar o código de entrada, o QR Code e o link do telão."
          action={
            canCreate &&
            !event.archivedAt && (
              <Button onClick={() => setForm({ open: true, session: null })}>
                <Plus /> Nova sessão
              </Button>
            )
          }
        />
      ) : (
        <ul className="space-y-3">
          {list.data.map((s) => (
            <li key={s.id}>
              <Card className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black">{s.name}</span>
                    <SessionStatusBadge status={s.status} />
                    {s.finalizedAt && <Badge tone="outline">Resultado oficial</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Código <span className="font-mono font-bold tracking-wider text-foreground">{s.code}</span> · {fmtInt(s.participants)} {s.participants === 1 ? "participante" : "participantes"}
                    {s.scheduledAt && ` · agendada para ${fmtDateTime(s.scheduledAt)}`}
                    {s.startedAt && ` · iniciada em ${fmtDateTime(s.startedAt)}`}
                    {s.endedAt && ` · encerrada em ${fmtDateTime(s.endedAt)}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canControl && s.status !== "ENCERRADA" && s.status !== "CANCELADA" && (
                    <Button size="sm" asChild>
                      <Link href={`/admin/sessoes/${s.id}/controle`}>
                        <MonitorPlay /> Abrir controle
                      </Link>
                    </Button>
                  )}
                  {canResults && (
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/admin/sessoes/${s.id}/resultados`}>
                        <BarChart3 /> Resultados
                      </Link>
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setQr(s)}>
                    <QrCode /> QR Code
                  </Button>
                  <Menu>
                    <MenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Mais ações da sessão ${s.name}`}>
                        <MoreVertical />
                      </Button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem onSelect={() => void copyLink(s, "join")} disabled={pending === `join:${s.id}`}>
                        <Link2 /> Copiar link de entrada
                      </MenuItem>
                      {canControl && (
                        <MenuItem onSelect={() => void copyLink(s, "screen")} disabled={pending === `screen:${s.id}`}>
                          <Tv /> Copiar link do telão
                        </MenuItem>
                      )}
                      {canAwards && (
                        <MenuItem onSelect={() => setAwards(s)}>
                          <Gift /> Ver premiações
                        </MenuItem>
                      )}
                      {canCreate && (
                        <MenuItem onSelect={() => setForm({ open: true, session: s })}>
                          <Pencil /> Editar
                        </MenuItem>
                      )}
                      {canCreate && (
                        <MenuItem onSelect={() => setToDelete(s)} className="text-negative">
                          <Trash2 /> Excluir
                        </MenuItem>
                      )}
                    </MenuContent>
                  </Menu>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <SessionFormDialog open={form.open} onOpenChange={(v) => setForm((f) => ({ ...f, open: v }))} eventId={event.id} session={form.session} onSaved={() => void list.reload()} />
      <QrDialog session={qr} onOpenChange={(v) => !v && setQr(null)} />
      <AwardsDialog session={awards} onOpenChange={(v) => !v && setAwards(null)} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Excluir sessão?"
        description={
          toDelete && toDelete.participants > 0
            ? `"${toDelete.name}" tem ${toDelete.participants} participantes e não pode ser excluída (os dados são preservados). Cancele a sessão pelo painel de controle.`
            : `"${toDelete?.name ?? ""}" será removida definitivamente. O código ${toDelete?.code ?? ""} deixará de funcionar.`
        }
        confirmLabel={toDelete && toDelete.participants > 0 ? "Entendi" : "Excluir"}
        tone={toDelete && toDelete.participants > 0 ? "default" : "negative"}
        onConfirm={() => (toDelete && toDelete.participants === 0 ? remove(toDelete) : undefined)}
      />
    </div>
  );
}
