"use client";
/**
 * Nuvem de Palavras no painel de controle ao vivo: indicadores, nuvem e ranking dos termos (com ocultar/bloquear),
 * moderação dos envios (pendentes, aprovados, recusados), termos ocultos/bloqueados e exportação.
 *
 * A lista de moderação é carregada ao abrir a pergunta, ao trocar de aba, quando chega RT.wordCloudPending
 * e após atualizações de resultado — no máximo uma recarga a cada 3 s (nunca por varredura periódica).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, Check, Clock, Download, EyeOff, RefreshCw, RotateCcw, ShieldAlert, X } from "lucide-react";
import type { ControlQuestionDTO, ResultsDTO } from "@shared/types";
import { admin, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge, Dialog, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { ChartView } from "@/components/charts/chart-view";
import { WordCloudTable } from "@/components/charts/word-cloud-table";
import { cn, fmtInt } from "@/lib/utils";
import { setWordCloudPending, useWordCloudPending } from "./word-cloud-pending";

export type WcEntryStatus = "APROVADA" | "PENDENTE" | "REJEITADA";

export interface WcModerationEntry {
  id: string;
  text: string;
  terms: string[];
  status: WcEntryStatus;
  reason: string | null;
  displayName: string;
  createdAt: string;
  moderatedAt: string | null;
}

export interface WcModerationList {
  entries: WcModerationEntry[];
  counts: Record<WcEntryStatus, number>;
  termRules: { termKey: string; label: string; action: "OCULTO" | "BLOQUEADO"; createdAt: string }[];
}

const MIN_REFRESH_MS = 3000;

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message || fallback : fallback);

/* ------------------------------------------------------------------ dados da moderação */
export function useWordCloudModeration(
  sessionId: string,
  sqId: string,
  opts: { enabled: boolean; initialTab: WcEntryStatus; resultsVersion?: string | null; livePending?: number },
) {
  const { enabled, resultsVersion, livePending } = opts;
  const [tab, setTab] = useState<WcEntryStatus>(opts.initialTab);
  const [data, setData] = useState<{ tab: WcEntryStatus; list: WcModerationList } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyEntry, setBusyEntry] = useState<string | null>(null);
  const [busyTerm, setBusyTerm] = useState<string | null>(null);
  const seq = useRef(0);
  const lastAt = useRef(0);
  const lastPending = useRef<number | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    const my = ++seq.current;
    lastAt.current = Date.now();
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    try {
      const list = await admin.get<WcModerationList>(`/sessions/${sessionId}/questions/${sqId}/wordcloud?status=${tab}`);
      if (my !== seq.current) return;
      lastPending.current = list.counts.PENDENTE;
      setData({ tab, list });
      setError(null);
      setWordCloudPending(sqId, list.counts.PENDENTE);
    } catch (e) {
      if (my === seq.current) setError(errMsg(e, "Não foi possível carregar a moderação."));
    }
  }, [enabled, sessionId, sqId, tab]);

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  // abertura da pergunta e troca de aba: carga imediata
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /** Recarga limitada a uma a cada 3 s (rajadas de respostas viram uma única requisição). */
  const schedule = useCallback(() => {
    if (!enabled || timer.current) return;
    const wait = MIN_REFRESH_MS - (Date.now() - lastAt.current);
    if (wait <= 0) void loadRef.current();
    else
      timer.current = setTimeout(() => {
        timer.current = null;
        void loadRef.current();
      }, wait);
  }, [enabled]);

  const prevVersion = useRef(resultsVersion);
  useEffect(() => {
    if (resultsVersion === prevVersion.current) return;
    prevVersion.current = resultsVersion;
    schedule();
  }, [resultsVersion, schedule]);

  useEffect(() => {
    if (livePending === undefined || livePending === lastPending.current) return;
    schedule();
  }, [livePending, schedule]);

  const moderate = useCallback(
    async (entry: WcModerationEntry, decision: "approve" | "reject") => {
      setBusyEntry(entry.id);
      try {
        await admin.post(`/sessions/${sessionId}/questions/${sqId}/wordcloud/entries/${entry.id}/${decision}`);
        toast.success(decision === "approve" ? "Envio aprovado — já conta na nuvem." : "Envio recusado — não aparece na nuvem.");
        // otimista: o envio sai da aba atual (mudou de status); a recarga confirma as contagens
        setData((d) => (d ? { ...d, list: { ...d.list, entries: d.list.entries.filter((e) => e.id !== entry.id) } } : d));
        await load();
      } catch (e) {
        toast.error(errMsg(e, "Não foi possível moderar o envio."));
      } finally {
        setBusyEntry(null);
      }
    },
    [sessionId, sqId, load],
  );

  const termAction = useCallback(
    async (term: string, action: "hide" | "block" | "restore") => {
      setBusyTerm(term);
      try {
        const list = await admin.post<WcModerationList>(`/sessions/${sessionId}/questions/${sqId}/wordcloud/terms`, { term, action });
        // a resposta traz todos os envios: mantém só os da aba atual
        setData((d) => {
          const t = d?.tab ?? tab;
          return { tab: t, list: { ...list, entries: list.entries.filter((e) => e.status === t) } };
        });
        setWordCloudPending(sqId, list.counts.PENDENTE);
        lastPending.current = list.counts.PENDENTE;
        toast.success(
          action === "hide"
            ? `“${term}” foi ocultado da nuvem.`
            : action === "block"
              ? `“${term}” foi bloqueado: saiu da nuvem e novos envios com ele serão recusados.`
              : `“${term}” voltou a contar na nuvem.`,
        );
      } catch (e) {
        toast.error(errMsg(e, "Não foi possível atualizar o termo."));
      } finally {
        setBusyTerm(null);
      }
    },
    [sessionId, sqId, tab],
  );

  return {
    tab,
    setTab,
    list: data?.list ?? null,
    loading: !data || data.tab !== tab,
    error,
    busyEntry,
    busyTerm,
    reload: load,
    moderate,
    termAction,
  };
}

/* ------------------------------------------------------------------ selo de pendentes */
export function WordCloudPendingBadge({ sqId, className }: { sqId: string; className?: string }) {
  const n = useWordCloudPending(sqId);
  if (!n) return null;
  return (
    <Badge tone="warning" className={className}>
      <Clock className="size-3" /> {fmtInt(n)} {n === 1 ? "pendente" : "pendentes"}
    </Badge>
  );
}

/* ------------------------------------------------------------------ painel completo (controle ao vivo) */
const TABS: { key: WcEntryStatus; label: string }[] = [
  { key: "PENDENTE", label: "Pendentes" },
  { key: "APROVADA", label: "Aprovadas" },
  { key: "REJEITADA", label: "Recusadas" },
];

const EMPTY: Record<WcEntryStatus, string> = {
  PENDENTE: "Nenhum envio aguardando aprovação.",
  APROVADA: "Nenhum envio aprovado ainda.",
  REJEITADA: "Nenhum envio recusado.",
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function WordCloudLive({
  sessionId,
  sessionCode,
  q,
  results,
  connected,
  isActive,
}: {
  sessionId: string;
  sessionCode: string;
  q: ControlQuestionDTO;
  results: ResultsDTO | null;
  connected: number;
  isActive: boolean;
}) {
  const ready = q.state !== "PRONTA";
  const requireApproval = !!q.wordCloud?.requireApproval;
  const livePending = useWordCloudPending(q.sessionQuestionId);
  const mod = useWordCloudModeration(sessionId, q.sessionQuestionId, {
    enabled: ready,
    initialTab: requireApproval ? "PENDENTE" : "APROVADA",
    resultsVersion: results?.generatedAt ?? null,
    livePending,
  });
  const [confirmBlock, setConfirmBlock] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const wc = results?.wordCloud ?? null;
  const pendingCount = livePending ?? mod.list?.counts.PENDENTE ?? 0;

  const exportCsv = async () => {
    setExporting(true);
    try {
      await admin.download(`/sessions/${sessionId}/export.csv?kind=nuvem`, `nuvem-de-palavras-${sessionCode.toLowerCase()}.csv`);
      toast.success("Exportação concluída.");
    } catch (e) {
      toast.error(errMsg(e, "Não foi possível exportar."));
    } finally {
      setExporting(false);
    }
  };

  const tiles: { l: string; v: string; accent?: string; highlight?: boolean }[] = [
    { l: "Conectados", v: fmtInt(connected), accent: "text-positive" },
    { l: "Responderam", v: results ? fmtInt(results.totals.respondents) : "—", accent: "text-brand" },
    { l: "Envios válidos", v: wc ? fmtInt(wc.totals.entries) : "—" },
    { l: "Termos contabilizados", v: wc ? fmtInt(wc.totals.termOccurrences) : "—" },
    { l: "Termos únicos", v: wc ? fmtInt(wc.totals.uniqueTerms) : "—" },
    { l: "Pendentes", v: ready ? fmtInt(pendingCount) : "—", highlight: pendingCount > 0 },
  ];

  return (
    <>
      <section className="rounded-2xl border border-white/10 bg-navy-900 p-5" aria-label="Nuvem de palavras">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black uppercase tracking-wider text-white/70">Nuvem de palavras {isActive && q.state === "ABERTA" ? "ao vivo" : ""}</h2>
          <Button size="sm" variant="secondary" onClick={() => void exportCsv()} loading={exporting}>
            <Download /> Exportar respostas (CSV)
          </Button>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-3 xl:grid-cols-6">
          {tiles.map((k) => (
            <div key={k.l} className={cn("bg-navy-950 px-3 py-2", k.highlight && "bg-warning/15")}>
              <p className={cn("truncate text-[11px] font-bold uppercase tracking-wider", k.highlight ? "text-warning" : "text-white/50")}>{k.l}</p>
              <p className={cn("text-xl font-black tabular", k.highlight ? "text-warning" : k.accent)}>{k.v}</p>
            </div>
          ))}
        </div>
        {!ready ? (
          <div className="grid h-72 place-items-center rounded-xl bg-white/[0.03] text-white/50">Libere a pergunta para receber palavras.</div>
        ) : (
          <>
            <ChartView data={results} type="wordcloud" config={q.chart} theme="dark" height={380} showTotals={false} exportName={`nuvem-pergunta-${q.position}`} />
            {wc && (
              <WordCloudTable
                data={wc}
                limit={15}
                theme="dark"
                className="mt-4"
                busyTerm={mod.busyTerm}
                onHide={(term) => void mod.termAction(term, "hide")}
                onBlock={(term) => setConfirmBlock(term)}
              />
            )}
          </>
        )}
        <p className="mt-2 text-xs text-white/40">
          {q.resultsShownAt ? "O público está vendo a nuvem." : "O público ainda não vê a nuvem."} Para baixar a imagem (PNG, SVG ou PDF), use o botão de download acima da nuvem.
        </p>
      </section>

      {ready && <ModerationPanel mod={mod} requireApproval={requireApproval} pendingCount={pendingCount} />}

      <Dialog
        open={confirmBlock !== null}
        onOpenChange={(v) => !v && setConfirmBlock(null)}
        title={`Bloquear “${confirmBlock ?? ""}”?`}
        description="O termo sai da nuvem e novos envios que o contenham serão recusados nesta pergunta. Os envios já feitos continuam registrados e você pode restaurar o termo depois."
        className="dark bg-navy-900 text-white"
        footer={
          <>
            <Button variant="ghost" className="text-white hover:bg-white/10" onClick={() => setConfirmBlock(null)}>
              Cancelar
            </Button>
            <Button
              variant="negative"
              loading={!!confirmBlock && mod.busyTerm === confirmBlock}
              onClick={async () => {
                if (!confirmBlock) return;
                await mod.termAction(confirmBlock, "block");
                setConfirmBlock(null);
              }}
            >
              <Ban /> Bloquear termo
            </Button>
          </>
        }
      />
    </>
  );
}

function ModerationPanel({ mod, requireApproval, pendingCount }: { mod: ReturnType<typeof useWordCloudModeration>; requireApproval: boolean; pendingCount: number }) {
  const counts = mod.list?.counts;
  const rules = mod.list?.termRules ?? [];
  return (
    <section className="rounded-2xl border border-white/10 bg-navy-900 p-5" aria-label="Moderação da nuvem de palavras">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-white/70">
          Moderação
          {pendingCount > 0 && (
            <Badge tone="warning" className="normal-case tracking-normal">
              {fmtInt(pendingCount)} {pendingCount === 1 ? "pendente" : "pendentes"}
            </Badge>
          )}
        </h2>
        <Button variant="ghost" size="sm" className="text-white/70 hover:bg-white/10" onClick={() => void mod.reload()}>
          <RefreshCw /> Atualizar
        </Button>
      </div>
      <p className={cn("mb-3 flex gap-2 rounded-xl px-3 py-2 text-xs", requireApproval ? "bg-warning/10 text-warning" : "bg-white/5 text-white/60")}>
        <ShieldAlert className="size-4 shrink-0" />
        {requireApproval
          ? "Aprovação prévia ativada: envios pendentes não aparecem no telão até a aprovação."
          : "Aprovação prévia desativada: envios válidos entram na nuvem automaticamente. Você ainda pode recusar envios ou ocultar termos."}
      </p>

      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar envios por situação">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => mod.setTab(t.key)}
            aria-pressed={mod.tab === t.key}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm font-bold transition",
              mod.tab === t.key ? "border-brand bg-brand text-white" : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
            )}
          >
            {t.label}
            {counts && <span className="ml-1.5 tabular opacity-80">({fmtInt(counts[t.key] ?? 0)})</span>}
          </button>
        ))}
      </div>

      {mod.error && (mod.loading || !mod.list) ? (
        <p className="rounded-xl bg-negative/10 px-3 py-2 text-sm text-negative">{mod.error}</p>
      ) : mod.loading || !mod.list ? (
        <div className="grid h-24 place-items-center">
          <Spinner className="size-6" />
        </div>
      ) : (
        <ul className="max-h-96 space-y-1.5 overflow-y-auto pr-1" aria-live="polite">
          {mod.list.entries.length === 0 && <li className="rounded-xl bg-white/[0.03] px-3 py-4 text-center text-sm text-white/50">{EMPTY[mod.tab]}</li>}
          {mod.list.entries.map((e) => {
            const busy = mod.busyEntry === e.id;
            const filtered = e.reason === "TERMO_NAO_PERMITIDO";
            return (
              <li key={e.id} className={cn("flex flex-wrap items-start gap-3 rounded-xl border px-3 py-2", e.status === "PENDENTE" ? "border-warning/30 bg-warning/5" : "border-white/10 bg-white/5")}>
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words font-bold">{e.text}</p>
                  <p className="mt-0.5 text-xs text-white/50">
                    {e.displayName} · {time(e.createdAt)}
                    {e.status === "PENDENTE" && <span className="text-warning"> · não aparece no telão até a aprovação</span>}
                    {e.status === "REJEITADA" && <span className="text-negative"> · {filtered ? "recusado pelo filtro de termos" : "recusado pela moderação"}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {e.status !== "APROVADA" && !filtered && (
                    <Button size="sm" variant="positive" onClick={() => void mod.moderate(e, "approve")} loading={busy} aria-label={`Aprovar envio “${e.text}”`}>
                      <Check /> Aprovar
                    </Button>
                  )}
                  {e.status !== "REJEITADA" && (
                    <Button size="sm" variant="negative" onClick={() => void mod.moderate(e, "reject")} loading={busy} aria-label={`Rejeitar envio “${e.text}”`}>
                      <X /> Rejeitar
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {mod.list && mod.list.entries.length >= 2000 && <p className="mt-2 text-xs text-white/50">Mostrando os 2.000 envios mais recentes. A exportação CSV traz todos.</p>}

      <div className="mt-4 border-t border-white/10 pt-3">
        <h3 className="mb-2 text-xs font-black uppercase tracking-wider text-white/60">Termos ocultos e bloqueados</h3>
        {rules.length === 0 ? (
          <p className="text-sm text-white/50">Nenhum termo oculto ou bloqueado. Use os botões da tabela de termos para ocultar ou bloquear.</p>
        ) : (
          <ul className="space-y-1.5">
            {rules.map((r) => (
              <li key={r.termKey} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-1.5">
                {r.action === "BLOQUEADO" ? <Ban className="size-4 shrink-0 text-negative" /> : <EyeOff className="size-4 shrink-0 text-white/60" />}
                <span className="min-w-0 flex-1 truncate font-bold" title={r.label}>
                  {r.label}
                </span>
                <Badge tone={r.action === "BLOQUEADO" ? "negative" : "muted"}>{r.action === "BLOQUEADO" ? "Bloqueado" : "Oculto"}</Badge>
                <Button size="sm" variant="ghost" className="text-white/80 hover:bg-white/10" onClick={() => void mod.termAction(r.label, "restore")} loading={mod.busyTerm === r.label}>
                  <RotateCcw /> Restaurar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
