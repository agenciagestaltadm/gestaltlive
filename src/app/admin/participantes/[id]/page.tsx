"use client";
/** Perfil individual do participante: dados, participações, respostas de perfil, pontuação e consentimentos (LGPD). */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, BellOff, EyeOff, History, Mail, MessageCircle, ShieldCheck, Trophy, User } from "lucide-react";
import { admin } from "@/lib/api";
import { useAction, useApi } from "@/lib/hooks";
import { useAdmin } from "@/components/admin/admin-context";
import { PageHeader } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, EmptyState, Field, Skeleton, Textarea } from "@/components/ui/primitives";
import { ErrorState, NoPermission, StatusBadge, TableWrap, td, th } from "@/components/reports/report-ui";
import type { ParticipantDetail } from "@/components/reports/types";
import { cn, fmtDateTime, fmtInt } from "@/lib/utils";

const KIND_LABELS: Record<ParticipantDetail["scoreHistory"][number]["kind"], string> = {
  ANSWER: "Resposta",
  REVERSAL: "Estorno",
  ADJUSTMENT: "Ajuste manual",
};
const PURPOSE_LABELS: Record<string, string> = { PARTICIPACAO: "Participação", MARKETING: "Marketing" };
const SOURCE_LABELS: Record<string, string> = { CADASTRO: "Cadastro na sessão", PARTICIPANTE: "Área do participante", ADMIN: "Organização (administrador)" };

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="break-words font-bold">{value}</div>
      </div>
    </div>
  );
}

function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  confirmVariant,
  requireAck,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel: string;
  confirmVariant: "negative" | "default";
  requireAck?: string;
  onConfirm: (reason: string) => Promise<boolean>;
  loading: boolean;
}) {
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [touched, setTouched] = useState(false);
  const valid = reason.trim().length >= 5 && (!requireAck || ack);
  const reset = () => {
    setReason("");
    setAck(false);
    setTouched(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant={confirmVariant}
            loading={loading}
            onClick={async () => {
              setTouched(true);
              if (!valid) return;
              if (await onConfirm(reason.trim())) reset();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {children}
        <Field label="Motivo" required htmlFor="reason" hint="Mínimo de 5 caracteres. Fica registrado na auditoria." error={touched && reason.trim().length < 5 ? "Descreva o motivo (mínimo 5 caracteres)." : null}>
          <Textarea id="reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} aria-invalid={touched && reason.trim().length < 5} />
        </Field>
        {requireAck && (
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-negative)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>{requireAck}</span>
          </label>
        )}
        {touched && requireAck && !ack && (
          <p className="text-xs font-bold text-negative" role="alert">
            Confirme que entendeu a irreversibilidade.
          </p>
        )}
      </div>
    </Dialog>
  );
}

export default function ParticipantProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAdmin();
  const allowed = can("participants.read");
  const canManage = can("participants.manage");
  const canReports = can("reports.read");
  const { data, error, loading, reload } = useApi<ParticipantDetail>(allowed ? () => admin.get<ParticipantDetail>(`/participants/${id}`) : null, [id, allowed]);
  const { pending, run } = useAction();
  const [dialog, setDialog] = useState<"revoke" | "anonymize" | null>(null);

  const sessionById = useMemo(() => new Map((data?.sessions ?? []).map((s) => [s.sessionParticipantId, s])), [data]);
  const groupBySession = <T extends { key: string }>(items: (T & { spId: string })[]) => {
    const map = new Map<string, (T & { spId: string })[]>();
    for (const it of items) map.set(it.spId, [...(map.get(it.spId) ?? []), it]);
    return [...map.entries()];
  };

  if (!allowed) {
    return (
      <>
        <PageHeader title="Participante" back={{ href: "/admin/participantes", label: "Participantes" }} />
        <NoPermission description="Seu perfil não tem a permissão “Participantes”. Peça acesso a um administrador da organização." />
      </>
    );
  }
  if (error && !data) {
    return (
      <>
        <PageHeader title="Participante" back={{ href: "/admin/participantes", label: "Participantes" }} />
        <ErrorState error={error} onRetry={() => void reload()} />
      </>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-14 w-1/2" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-56" />
          <Skeleton className="h-56 lg:col-span-2" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const p = data.participant;
  const anonymized = !!p.anonymizedAt;
  const lastMarketing = data.consents.find((c) => c.purpose === "MARKETING");
  const marketingActive = !!lastMarketing?.granted && !anonymized;
  const sessionLabel = (spId: string) => {
    const s = sessionById.get(spId);
    return s ? `${s.eventTitle} · ${s.sessionName}` : "Sessão";
  };
  const customGroups = groupBySession(data.custom);
  const profileGroups = (() => {
    const map = new Map<string, ParticipantDetail["profileAnswers"]>();
    for (const a of data.profileAnswers) map.set(a.sessionParticipantId, [...(map.get(a.sessionParticipantId) ?? []), a]);
    return [...map.entries()];
  })();

  const revoke = async (reason: string) => {
    const ok = await run("revoke", () => admin.post(`/participants/${id}/revoke-marketing`, { reason }), "Consentimento de marketing revogado.");
    if (ok !== undefined) {
      setDialog(null);
      await reload();
      return true;
    }
    return false;
  };
  const anonymize = async (reason: string) => {
    const ok = await run("anonymize", () => admin.post(`/participants/${id}/anonymize`, { reason }), "Participante anonimizado.");
    if (ok !== undefined) {
      setDialog(null);
      await reload();
      return true;
    }
    return false;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/admin/participantes", label: "Participantes" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {p.fullName}
            {anonymized && (
              <Badge tone="muted" className="text-sm">
                <EyeOff className="size-3.5" /> Anonimizado
              </Badge>
            )}
          </span>
        }
        description={anonymized ? `Dados pessoais removidos em ${fmtDateTime(p.anonymizedAt)}. Estatísticas agregadas foram preservadas.` : `Primeiro cadastro em ${fmtDateTime(p.createdAt)}`}
        actions={
          canManage && !anonymized ? (
            <>
              {marketingActive && (
                <Button variant="outline" onClick={() => setDialog("revoke")}>
                  <BellOff /> Revogar marketing
                </Button>
              )}
              <Button variant="negative" onClick={() => setDialog("anonymize")}>
                <EyeOff /> Anonimizar
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Dados de contato</CardTitle>
            <CardDescription>Dados autodeclarados, não verificados.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <InfoRow icon={<User />} label="Nome" value={p.fullName} />
            <InfoRow icon={<Mail />} label="E-mail" value={p.email ? <a href={`mailto:${p.email}`} className="hover:text-brand hover:underline">{p.email}</a> : "—"} />
            <InfoRow icon={<MessageCircle />} label="WhatsApp" value={p.phone ?? "—"} />
            <InfoRow
              icon={<ShieldCheck />}
              label="Marketing"
              value={
                marketingActive ? (
                  <Badge tone="positive">Consentimento vigente</Badge>
                ) : (
                  <Badge tone="muted">{lastMarketing ? "Revogado / não concedido" : "Nunca concedido"}</Badge>
                )
              }
            />
            {!marketingActive && !anonymized && (
              <p className="text-xs text-muted-foreground">Sem consentimento de marketing: não use estes contatos para comunicações promocionais.</p>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="size-4 text-gold" /> Participações
            </CardTitle>
            <CardDescription>
              {fmtInt(data.sessions.length)} {data.sessions.length === 1 ? "sessão" : "sessões"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.sessions.length === 0 ? (
              <EmptyState title="Sem participações" className="p-6" />
            ) : (
              <TableWrap>
                <table className="w-full min-w-[640px] text-sm">
                  <caption className="sr-only">Sessões em que participou</caption>
                  <thead className="bg-muted/60">
                    <tr>
                      <th scope="col" className={th}>Evento / sessão</th>
                      <th scope="col" className={th}>Nome no ranking</th>
                      <th scope="col" className={th}>Inscrição</th>
                      <th scope="col" className={cn(th, "text-right")}>Pontos</th>
                      <th scope="col" className={cn(th, "text-right")}>Posição</th>
                      <th scope="col" className={cn(th, "text-right")}>Acertos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.sessions.map((s) => (
                      <tr key={s.sessionParticipantId}>
                        <td className={td}>
                          <div className="font-bold">{s.eventTitle}</div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {canReports ? (
                              <Link href={`/admin/sessoes/${s.sessionId}/resultados`} className="hover:text-brand hover:underline">
                                {s.sessionName} ({s.code})
                              </Link>
                            ) : (
                              <span>
                                {s.sessionName} ({s.code})
                              </span>
                            )}
                            <StatusBadge status={s.status} />
                          </div>
                        </td>
                        <td className={td}>{s.displayName}</td>
                        <td className={cn(td, "whitespace-nowrap tabular")}>{fmtDateTime(s.joinedAt)}</td>
                        <td className={cn(td, "text-right font-bold tabular")}>{fmtInt(s.score)}</td>
                        <td className={cn(td, "text-right tabular")}>{s.disqualifiedAt ? <Badge tone="negative">Desclassificado</Badge> : `${s.position}º`}</td>
                        <td className={cn(td, "text-right tabular")}>
                          {fmtInt(s.correctCount)}
                          <span className="text-muted-foreground"> / {fmtInt(s.answeredCount)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Respostas de perfil e opinião</CardTitle>
            <CardDescription>Perguntas de perfil, opinião, enquetes, escalas e NPS.</CardDescription>
          </CardHeader>
          <CardContent>
            {profileGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma resposta de perfil registrada.</p>
            ) : (
              <div className="space-y-4">
                {profileGroups.map(([spId, answers]) => (
                  <div key={spId}>
                    <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{sessionLabel(spId)}</h4>
                    <dl className="divide-y divide-border rounded-xl border border-border">
                      {answers.map((a, i) => (
                        <div key={i} className="grid gap-1 px-3 py-2 sm:grid-cols-2 sm:gap-3">
                          <dt className="text-sm text-muted-foreground">{a.question}</dt>
                          <dd className="text-sm font-bold">{a.answer || "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Campos personalizados</CardTitle>
            <CardDescription>Informações extras do cadastro em cada sessão (autodeclaradas).</CardDescription>
          </CardHeader>
          <CardContent>
            {customGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">{anonymized ? "Removidos na anonimização." : "Nenhum campo personalizado preenchido."}</p>
            ) : (
              <div className="space-y-4">
                {customGroups.map(([spId, items]) => (
                  <div key={spId}>
                    <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{sessionLabel(spId)}</h4>
                    <dl className="divide-y divide-border rounded-xl border border-border">
                      {items.map((c) => (
                        <div key={c.key} className="grid gap-1 px-3 py-2 sm:grid-cols-2 sm:gap-3">
                          <dt className="text-sm text-muted-foreground">{c.label}</dt>
                          <dd className="break-words text-sm font-bold">{c.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4 text-brand" /> Histórico de pontuação
          </CardTitle>
          <CardDescription>Lançamentos de pontos (respostas, estornos e ajustes manuais justificados).</CardDescription>
        </CardHeader>
        <CardContent>
          {data.scoreHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lançamento de pontuação.</p>
          ) : (
            <TableWrap className="max-h-[420px] overflow-y-auto">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">Histórico de pontuação</caption>
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th scope="col" className={th}>Data</th>
                    <th scope="col" className={th}>Sessão</th>
                    <th scope="col" className={th}>Tipo</th>
                    <th scope="col" className={cn(th, "text-right")}>Pontos</th>
                    <th scope="col" className={th}>Motivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.scoreHistory.map((h, i) => (
                    <tr key={i}>
                      <td className={cn(td, "whitespace-nowrap tabular")}>{fmtDateTime(h.createdAt)}</td>
                      <td className={td}>{sessionLabel(h.spId)}</td>
                      <td className={td}>
                        <Badge tone={h.kind === "ADJUSTMENT" ? "warning" : h.kind === "REVERSAL" ? "negative" : "muted"}>{KIND_LABELS[h.kind] ?? h.kind}</Badge>
                      </td>
                      <td className={cn(td, "text-right font-bold tabular", h.points > 0 ? "text-positive" : h.points < 0 ? "text-negative" : "")}>
                        {h.points > 0 ? `+${fmtInt(h.points)}` : fmtInt(h.points)}
                      </td>
                      <td className={cn(td, "text-muted-foreground")}>{h.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-positive" /> Histórico de consentimentos
          </CardTitle>
          <CardDescription>Registro imutável (LGPD): finalidade, versão do texto aceito, data, situação e origem.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.consents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum consentimento registrado.</p>
          ) : (
            <TableWrap>
              <table className="w-full min-w-[720px] text-sm">
                <caption className="sr-only">Histórico de consentimentos</caption>
                <thead className="bg-muted/60">
                  <tr>
                    <th scope="col" className={th}>Data</th>
                    <th scope="col" className={th}>Finalidade</th>
                    <th scope="col" className={th}>Situação</th>
                    <th scope="col" className={th}>Versão do texto</th>
                    <th scope="col" className={th}>Origem</th>
                    <th scope="col" className={th}>Texto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.consents.map((c) => (
                    <tr key={c.id}>
                      <td className={cn(td, "whitespace-nowrap tabular")}>{fmtDateTime(c.createdAt)}</td>
                      <td className={td}>{PURPOSE_LABELS[c.purpose] ?? c.purpose}</td>
                      <td className={td}>{c.granted ? <Badge tone="positive">Concedido</Badge> : <Badge tone="negative">Revogado / negado</Badge>}</td>
                      <td className={cn(td, "font-mono text-xs")}>{c.textVersion}</td>
                      <td className={td}>{SOURCE_LABELS[c.source] ?? c.source}</td>
                      <td className={cn(td, "max-w-sm")}>
                        <details>
                          <summary className="cursor-pointer text-xs font-bold text-brand">Ver texto</summary>
                          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{c.textSnapshot}</p>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      {loading && <span className="sr-only" role="status">Atualizando…</span>}

      <ReasonDialog
        open={dialog === "revoke"}
        onOpenChange={(v) => setDialog(v ? "revoke" : null)}
        title="Revogar consentimento de marketing"
        description="O participante deixará de constar como apto a receber comunicações de marketing e seus contatos não sairão mais nas exportações."
        confirmLabel="Revogar consentimento"
        confirmVariant="default"
        onConfirm={revoke}
        loading={pending === "revoke"}
      >
        <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
          A revogação fica registrada no histórico. Somente o próprio participante pode conceder o consentimento novamente.
        </p>
      </ReasonDialog>

      <ReasonDialog
        open={dialog === "anonymize"}
        onOpenChange={(v) => setDialog(v ? "anonymize" : null)}
        title="Anonimizar participante"
        description="Esta ação é IRREVERSÍVEL."
        confirmLabel="Anonimizar definitivamente"
        confirmVariant="negative"
        requireAck="Entendo que nome, e-mail, WhatsApp e campos personalizados serão apagados definitivamente e não poderão ser recuperados."
        onConfirm={anonymize}
        loading={pending === "anonymize"}
      >
        <div className="flex gap-3 rounded-xl bg-negative/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-negative" />
          <ul className="list-disc space-y-1 pl-4">
            <li>Nome, e-mail, WhatsApp e campos personalizados são removidos.</li>
            <li>O nome no ranking de todas as sessões passa a ser “Anônimo”.</li>
            <li>Pontuações e respostas são mantidas apenas para as estatísticas agregadas.</li>
            <li>O consentimento de marketing é revogado e a ação é registrada na auditoria.</li>
          </ul>
        </div>
      </ReasonDialog>
    </div>
  );
}
