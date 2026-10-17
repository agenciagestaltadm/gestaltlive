"use client";
/** CRM de participantes: busca, segmentação, paginação e exportação autorizada. */
import { Suspense, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, EyeOff, Search, ShieldCheck, Users, X } from "lucide-react";
import { admin } from "@/lib/api";
import { useAction, useApi } from "@/lib/hooks";
import { useAdmin } from "@/components/admin/admin-context";
import { PageHeader } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, EmptyState, Field, NativeSelect, Skeleton } from "@/components/ui/primitives";
import { buildQuery, ErrorState, NoPermission, TableWrap, td, th } from "@/components/reports/report-ui";
import { DebouncedInput } from "@/components/reports/debounced-input";
import type { EventQuestionRow, EventRow, EventSessionRow, ParticipantList } from "@/components/reports/types";
import { cn, fmtDate, fmtInt } from "@/lib/utils";

const PAGE_SIZE = 50;
const KEYS = ["q", "eventId", "sessionId", "marketing", "fieldKey", "fieldValue", "questionId", "optionId", "page"] as const;
type Filters = Record<(typeof KEYS)[number], string>;

interface EventDetail {
  id: string;
  customFields: { key: string; label: string; type: string; options: string[] }[];
}

function ParticipantsCrm() {
  const { orgId, can } = useAdmin();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { pending, run } = useAction();
  const allowed = can("participants.read");

  const f = useMemo(() => Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? ""])) as Filters, [params]);
  const page = Math.max(1, Number(f.page) || 1);
  const filterQs = buildQuery({ orgId, ...f, page: undefined });
  const listQs = buildQuery({ orgId, ...f, page, pageSize: PAGE_SIZE });

  const list = useApi<ParticipantList>(allowed ? () => admin.get<ParticipantList>(`/participants${listQs}`) : null, [listQs, allowed]);
  const events = useApi<EventRow[]>(allowed ? () => admin.get<EventRow[]>(`/events?orgId=${orgId}`) : null, [orgId, allowed]);
  const eventDetail = useApi<EventDetail>(allowed && f.eventId ? () => admin.get<EventDetail>(`/events/${f.eventId}`) : null, [f.eventId, allowed]);
  const sessions = useApi<EventSessionRow[]>(allowed && f.eventId ? () => admin.get<EventSessionRow[]>(`/events/${f.eventId}/sessions`) : null, [f.eventId, allowed]);
  const questions = useApi<EventQuestionRow[]>(allowed && f.eventId ? () => admin.get<EventQuestionRow[]>(`/events/${f.eventId}/questions`) : null, [f.eventId, allowed]);

  const set = (patch: Partial<Filters>) => {
    const next = { ...f, page: "", ...patch };
    router.replace(`${pathname}${buildQuery(next)}`, { scroll: false });
  };
  const hasFilters = KEYS.some((k) => k !== "page" && f[k]);

  if (!allowed) {
    return (
      <>
        <PageHeader title="Participantes" />
        <NoPermission description="Seu perfil não tem a permissão “Participantes”. Peça acesso a um administrador da organização." />
      </>
    );
  }

  const evQuestions = f.eventId ? (questions.data ?? []).filter((q) => q.options.length > 0 && q.type !== "ESCALA" && q.type !== "NPS") : [];
  const selectedQuestion = evQuestions.find((q) => q.id === f.questionId);
  const customFields = f.eventId ? (eventDetail.data?.customFields ?? []) : [];
  const selectedField = customFields.find((c) => c.key === f.fieldKey);
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;

  const exportCsv = () => run("csv", () => admin.download(`/participants/export.csv${filterQs}`, "participantes.csv"), "Exportação concluída.");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Participantes"
        description="Base de participantes da organização: histórico, consentimentos e segmentação."
        actions={
          <Button onClick={() => void exportCsv()} loading={pending === "csv"}>
            <Download /> Exportar CSV
          </Button>
        }
      />

      <p className="flex items-start gap-2 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-positive" />
        <span>
          A exportação respeita os filtros aplicados e a LGPD: <b className="text-foreground">e-mail e WhatsApp só saem para quem consentiu marketing</b>; participantes anonimizados
          não são exportados. Toda exportação fica registrada na auditoria.
        </span>
      </p>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Buscar" htmlFor="crm-q" className="md:col-span-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <DebouncedInput id="crm-q" value={f.q} onCommit={(v) => set({ q: v.trim() })} placeholder="Nome, e-mail ou WhatsApp" className="pl-9" type="search" />
              </div>
            </Field>
            <Field label="Consentimento de marketing" htmlFor="crm-mkt">
              <NativeSelect id="crm-mkt" value={f.marketing} onChange={(e) => set({ marketing: e.target.value })}>
                <option value="">Todos</option>
                <option value="sim">Com consentimento vigente</option>
                <option value="nao">Sem consentimento</option>
              </NativeSelect>
            </Field>
            <Field label="Evento" htmlFor="crm-event">
              <NativeSelect
                id="crm-event"
                value={f.eventId}
                onChange={(e) => set({ eventId: e.target.value, sessionId: "", questionId: "", optionId: "", ...(f.fieldKey && customFields.length ? { fieldKey: "", fieldValue: "" } : {}) })}
              >
                <option value="">Todos os eventos</option>
                {(events.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
                {f.eventId && events.data && !events.data.some((e) => e.id === f.eventId) && <option value={f.eventId}>Evento selecionado (arquivado)</option>}
              </NativeSelect>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Sessão" htmlFor="crm-session" hint={f.eventId ? undefined : "Escolha um evento"}>
              <NativeSelect id="crm-session" value={f.sessionId} disabled={!f.eventId} onChange={(e) => set({ sessionId: e.target.value })}>
                <option value="">Todas as sessões</option>
                {(sessions.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Campo personalizado" htmlFor="crm-fkey" hint={customFields.length ? undefined : "Chave do campo (ex.: cargo)"}>
              {customFields.length ? (
                <NativeSelect id="crm-fkey" value={f.fieldKey} onChange={(e) => set({ fieldKey: e.target.value, fieldValue: "" })}>
                  <option value="">Nenhum</option>
                  {customFields.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <DebouncedInput id="crm-fkey" value={f.fieldKey} onCommit={(v) => set({ fieldKey: v.trim() })} placeholder="Chave" />
              )}
            </Field>
            <Field label="Valor do campo" htmlFor="crm-fval" hint={f.fieldKey ? "Valor exato informado no cadastro" : "Informe o campo primeiro"}>
              {selectedField && selectedField.options.length ? (
                <NativeSelect id="crm-fval" value={f.fieldValue} onChange={(e) => set({ fieldValue: e.target.value })}>
                  <option value="">Selecione</option>
                  {selectedField.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <DebouncedInput id="crm-fval" value={f.fieldValue} disabled={!f.fieldKey} onCommit={(v) => set({ fieldValue: v.trim() })} placeholder="Valor" />
              )}
            </Field>
            <div className="hidden xl:block" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Segmentar por resposta: pergunta" htmlFor="crm-question" hint={f.eventId ? (questions.error ? "Perguntas indisponíveis." : undefined) : "Escolha um evento para listar as perguntas"}>
              <NativeSelect id="crm-question" value={f.questionId} disabled={!f.eventId || !evQuestions.length} onChange={(e) => set({ questionId: e.target.value, optionId: "" })}>
                <option value="">{f.eventId && questions.data && !evQuestions.length ? "Sem perguntas de alternativas" : "Nenhuma"}</option>
                {evQuestions.map((q, i) => (
                  <option key={q.id} value={q.id}>
                    {`${i + 1}. ${q.title.length > 70 ? `${q.title.slice(0, 69)}…` : q.title}`}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Alternativa escolhida" htmlFor="crm-option">
              <NativeSelect id="crm-option" value={f.optionId} disabled={!selectedQuestion} onChange={(e) => set({ optionId: e.target.value })}>
                <option value="">{selectedQuestion ? "Selecione" : "Escolha a pergunta"}</option>
                {selectedQuestion?.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => router.replace(pathname, { scroll: false })}>
              <X /> Limpar filtros
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardContent className="p-5">
          {list.error && !list.data ? (
            <ErrorState error={list.error} onRetry={() => void list.reload()} />
          ) : !list.data ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-11" />
              ))}
            </div>
          ) : list.data.rows.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title={hasFilters ? "Nenhum participante encontrado" : "Nenhum participante ainda"}
              description={hasFilters ? "Ajuste a busca ou os filtros." : "Os participantes aparecem aqui após se inscreverem em uma sessão."}
            />
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground" role="status">
                {fmtInt(list.data.total)} {list.data.total === 1 ? "participante" : "participantes"} · dados de contato autodeclarados, não verificados
              </p>
              <TableWrap className={list.loading ? "opacity-60" : undefined}>
                <table className="w-full min-w-[860px] text-sm">
                  <caption className="sr-only">Participantes</caption>
                  <thead className="bg-muted/60">
                    <tr>
                      <th scope="col" className={th}>Nome</th>
                      <th scope="col" className={th}>E-mail</th>
                      <th scope="col" className={th}>WhatsApp</th>
                      <th scope="col" className={th}>Marketing</th>
                      <th scope="col" className={cn(th, "text-right")}>Sessões</th>
                      <th scope="col" className={cn(th, "text-right")}>Melhor pontuação</th>
                      <th scope="col" className={th}>Primeiro cadastro</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {list.data.rows.map((r) => (
                      <tr key={r.id} className={cn("hover:bg-muted/40", r.anonymizedAt && "text-muted-foreground")}>
                        <td className={td}>
                          <Link href={`/admin/participantes/${r.id}`} className="font-bold hover:text-brand hover:underline">
                            {r.fullName}
                          </Link>
                          {r.anonymizedAt && (
                            <Badge tone="muted" className="ml-2">
                              <EyeOff className="size-3" /> Anonimizado
                            </Badge>
                          )}
                        </td>
                        <td className={cn(td, "max-w-[220px] truncate")}>{r.email ?? "—"}</td>
                        <td className={cn(td, "whitespace-nowrap tabular")}>{r.phone ?? "—"}</td>
                        <td className={td}>
                          {r.marketing ? <Badge tone="positive">Consentiu</Badge> : <Badge tone="muted">Sem consentimento</Badge>}
                        </td>
                        <td className={cn(td, "text-right tabular")}>{fmtInt(r.sessions)}</td>
                        <td className={cn(td, "text-right tabular")}>{r.bestScore === null ? "—" : fmtInt(r.bestScore)}</td>
                        <td className={cn(td, "whitespace-nowrap tabular")}>{fmtDate(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <nav className="flex flex-wrap items-center justify-between gap-2" aria-label="Paginação">
                <span className="text-sm text-muted-foreground">
                  Página {fmtInt(page)} de {fmtInt(totalPages)}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1 || list.loading} onClick={() => set({ page: String(page - 1) })}>
                    <ChevronLeft /> Anterior
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages || list.loading} onClick={() => set({ page: String(page + 1) })}>
                    Próxima <ChevronRight />
                  </Button>
                </div>
              </nav>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ParticipantsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-12 w-1/3" />
          <Skeleton className="h-48" />
          <Skeleton className="h-96" />
        </div>
      }
    >
      <ParticipantsCrm />
    </Suspense>
  );
}
