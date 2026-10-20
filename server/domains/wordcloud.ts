/**
 * Nuvem de Palavras — envios, moderação e agregação.
 *
 * Usa o mesmo ciclo de vida das demais perguntas (session_questions: abrir, cronômetro, fechar, exibir
 * resultado) e as mesmas garantias do envio de respostas:
 * 1. A pergunta é travada com FOR SHARE (o fechamento usa FOR UPDATE) e o participante com FOR UPDATE,
 *    então os limites de envio valem mesmo com toques repetidos ou várias abas.
 * 2. Prazo pelo relógio do servidor (tempo efetivo do cronômetro).
 * 3. Reenvio com a mesma chave de idempotência devolve o mesmo envio (sem duplicar).
 * 4. Moderação nunca apaga: muda o status do envio ou cria uma regra de termo (ocultar/bloquear), com auditoria.
 */
import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import type { Tx } from "../db/client";
import { eventSessions, questions, sessionParticipants, sessionQuestions, wordCloudEntries, wordCloudTermRules } from "../db/schema";
import type { Actor } from "../auth/auth";
import { AppError, badRequest, notFound } from "../lib/errors";
import { elapsedMs } from "@shared/scoring";
import { wordCloudConfigSchema, wordCloudDisplaySchema, wordCloudEntryInputSchema, type ChartConfig, type WordCloudConfig } from "@shared/schemas";
import { aggregateWordCloud, cleanText, fullFold, prepareEntry } from "@shared/wordcloud";
import { RT, type MyWordCloudDTO, type WordCloudResultsDTO } from "@shared/types";
import type { ParticipantAuth } from "./participants";
import type { SessionQuestionRow } from "./sessions";
import { getSnapshot } from "./snapshots";
import { loadSession } from "./sessions";
import { audit, logSessionEvent } from "./audit";

type EntryRow = typeof wordCloudEntries.$inferSelect;
export type EntryStatus = EntryRow["status"];

const reject = (code: string, message: string, status = 409) => new AppError(status, code, message);

export function rulesOf(snapWordCloud: WordCloudConfig | null | undefined): WordCloudConfig {
  return wordCloudConfigSchema.parse(snapWordCloud ?? {});
}

const entryDTO = (e: EntryRow) => ({ id: e.id, text: e.original, status: e.status, createdAt: e.createdAt.toISOString() });

async function activeCount(tx: Tx, spId: string, sqId: string) {
  const [r] = await tx
    .select({ n: count() })
    .from(wordCloudEntries)
    .where(and(eq(wordCloudEntries.sessionParticipantId, spId), eq(wordCloudEntries.sessionQuestionId, sqId), ne(wordCloudEntries.status, "REJEITADA")));
  return Number(r.n);
}

/* ------------------------------------------------------------------ envio */
export interface WordCloudSubmitResult {
  outcome: "ACEITA" | "PENDENTE" | "DUPLICADA";
  entry: MyWordCloudDTO["entries"][number];
  remaining: number;
}

export async function submitWordCloudEntry(ctx: AppContext, auth: ParticipantAuth, raw: unknown): Promise<WordCloudSubmitResult> {
  const input = wordCloudEntryInputSchema.parse(raw);
  type Out = { kind: "ok"; result: WordCloudSubmitResult; changed: boolean } | { kind: "filtrada"; message: string };

  const out: Out = await ctx.db.transaction(async (tx) => {
    const now = ctx.now();
    // idempotência antes de qualquer limite: o reenvio devolve o mesmo envio
    const [byKey] = await tx
      .select()
      .from(wordCloudEntries)
      .where(and(eq(wordCloudEntries.sessionParticipantId, auth.sp.id), eq(wordCloudEntries.idempotencyKey, input.idempotencyKey)));
    if (byKey) {
      if (byKey.sessionQuestionId !== input.sessionQuestionId) throw badRequest("Chave de idempotência reutilizada em outra pergunta.");
      if (byKey.status === "REJEITADA" && byKey.reason === "TERMO_NAO_PERMITIDO") {
        return { kind: "filtrada", message: "Sua resposta contém termos não permitidos. Tente outra palavra." };
      }
      const snap0 = await getSnapshot(tx, (await sqRow(tx, byKey.sessionQuestionId)).versionId);
      const remaining = Math.max(0, rulesOf(snap0.wordCloud).maxEntries - (await activeCount(tx, auth.sp.id, byKey.sessionQuestionId)));
      return { kind: "ok", result: { outcome: "DUPLICADA", entry: entryDTO(byKey), remaining }, changed: false };
    }

    // pergunta (travada para leitura), status da sessão e situação do participante — mesma ordem do envio de respostas
    const [row] = await tx
      .select({ sq: sessionQuestions, status: eventSessions.status, disqualifiedAt: sessionParticipants.disqualifiedAt })
      .from(sessionQuestions)
      .innerJoin(eventSessions, eq(eventSessions.id, sessionQuestions.sessionId))
      .innerJoin(sessionParticipants, eq(sessionParticipants.id, auth.sp.id))
      .where(eq(sessionQuestions.id, input.sessionQuestionId))
      .for("share", { of: sessionQuestions });
    const sq = row?.sq;
    if (!sq || sq.sessionId !== auth.session.id) throw reject("PERGUNTA_INVALIDA", "Pergunta não encontrada nesta sessão.", 404);
    if (row.status !== "AO_VIVO") throw reject("SESSAO_NAO_ATIVA", row.status === "PAUSADA" ? "A sessão está pausada." : "A sessão não está ao vivo.");
    if (row.disqualifiedAt) throw reject("PARTICIPACAO_SUSPENSA", "Sua participação foi suspensa pela organização.", 403);
    if (sq.state !== "ABERTA") throw reject("PERGUNTA_FECHADA", "Esta pergunta não está aceitando respostas.");
    const elapsed = elapsedMs({ limitMs: sq.timeLimitMs, accumulatedMs: sq.timerAccumulatedMs, runningSince: sq.timerRunningSince }, now);
    if (sq.timeLimitMs !== null && elapsed > sq.timeLimitMs) throw reject("TEMPO_ESGOTADO", "O tempo para responder terminou.");

    const snap = await getSnapshot(tx, sq.versionId);
    if (snap.type !== "NUVEM_PALAVRAS") throw reject("TIPO_INVALIDO", "Esta pergunta não aceita respostas em texto.", 400);
    const rules = rulesOf(snap.wordCloud);

    // trava o participante: limites de envio e repetição valem com toques simultâneos
    await tx.select({ id: sessionParticipants.id }).from(sessionParticipants).where(eq(sessionParticipants.id, auth.sp.id)).for("update");

    const blocked = await tx
      .select({ label: wordCloudTermRules.label })
      .from(wordCloudTermRules)
      .where(and(eq(wordCloudTermRules.sessionQuestionId, sq.id), eq(wordCloudTermRules.action, "BLOQUEADO")));
    const prepared = prepareEntry(input.text, rules, blocked.map((b) => b.label));
    if (!prepared.ok) {
      if (prepared.code !== "TERMO_NAO_PERMITIDO") throw reject(prepared.code, prepared.message, 422);
      // termo inadequado: recusado na hora, mas registrado para auditoria (não conta como envio)
      await tx
        .insert(wordCloudEntries)
        .values({
          orgId: auth.session.orgId,
          sessionId: auth.session.id,
          sessionQuestionId: sq.id,
          sessionParticipantId: auth.sp.id,
          idempotencyKey: input.idempotencyKey,
          original: prepared.original.slice(0, rules.maxChars + 50),
          normalized: fullFold(prepared.original),
          terms: [],
          status: "REJEITADA",
          reason: "TERMO_NAO_PERMITIDO",
          createdAt: now,
        })
        .onConflictDoNothing();
      return { kind: "filtrada", message: prepared.message };
    }

    const mine = await tx
      .select({ normalized: wordCloudEntries.normalized })
      .from(wordCloudEntries)
      .where(and(eq(wordCloudEntries.sessionParticipantId, auth.sp.id), eq(wordCloudEntries.sessionQuestionId, sq.id), ne(wordCloudEntries.status, "REJEITADA")));
    if (mine.length >= rules.maxEntries) {
      throw reject("LIMITE_DE_ENVIOS", rules.maxEntries === 1 ? "Você já enviou sua resposta para esta pergunta." : `Você já usou os ${rules.maxEntries} envios desta pergunta.`);
    }
    if (!rules.allowRepeat && mine.some((m) => m.normalized === prepared.normalized)) {
      throw reject("RESPOSTA_REPETIDA", "Você já enviou essa resposta. Tente outra palavra.");
    }

    const status: EntryStatus = rules.requireApproval ? "PENDENTE" : "APROVADA";
    const inserted = await tx
      .insert(wordCloudEntries)
      .values({
        orgId: auth.session.orgId,
        sessionId: auth.session.id,
        sessionQuestionId: sq.id,
        sessionParticipantId: auth.sp.id,
        idempotencyKey: input.idempotencyKey,
        original: prepared.original,
        normalized: prepared.normalized,
        terms: prepared.terms,
        status,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) {
      // envio concorrente com a mesma chave
      const [dup] = await tx
        .select()
        .from(wordCloudEntries)
        .where(and(eq(wordCloudEntries.sessionParticipantId, auth.sp.id), eq(wordCloudEntries.idempotencyKey, input.idempotencyKey)));
      return { kind: "ok", result: { outcome: "DUPLICADA", entry: entryDTO(dup), remaining: Math.max(0, rules.maxEntries - mine.length) }, changed: false };
    }
    const remaining = Math.max(0, rules.maxEntries - mine.length - 1);
    return { kind: "ok", result: { outcome: status === "PENDENTE" ? "PENDENTE" : "ACEITA", entry: entryDTO(inserted[0]), remaining }, changed: true };
  });

  if (out.kind === "filtrada") throw reject("TERMO_NAO_PERMITIDO", out.message, 422);
  if (out.changed) {
    if (out.result.entry.status === "APROVADA") ctx.rt.resultsDirty(auth.session.id, input.sessionQuestionId);
    else await notifyPending(ctx, auth.session.id, input.sessionQuestionId);
  }
  return out.result;
}

async function sqRow(tx: Tx, id: string) {
  const [sq] = await tx.select().from(sessionQuestions).where(eq(sessionQuestions.id, id));
  if (!sq) throw notFound("Pergunta não encontrada.");
  return sq;
}

/** Avisa o painel que há envios aguardando aprovação (sem conteúdo: a lista vem pela rota de moderação). */
async function notifyPending(ctx: AppContext, sessionId: string, sqId: string) {
  const [r] = await ctx.db
    .select({ n: count() })
    .from(wordCloudEntries)
    .where(and(eq(wordCloudEntries.sessionQuestionId, sqId), eq(wordCloudEntries.status, "PENDENTE")));
  ctx.rt.broadcast(sessionId, RT.wordCloudPending, { sessionQuestionId: sqId, pending: Number(r.n) }, ["control"]);
}

/** Envios do participante na pergunta (estado do celular). */
export async function myWordCloud(tx: Tx, spId: string, sq: SessionQuestionRow): Promise<MyWordCloudDTO> {
  const snap = await getSnapshot(tx, sq.versionId);
  const rules = rulesOf(snap.wordCloud);
  const rows = await tx
    .select()
    .from(wordCloudEntries)
    .where(and(eq(wordCloudEntries.sessionParticipantId, spId), eq(wordCloudEntries.sessionQuestionId, sq.id), ne(wordCloudEntries.status, "REJEITADA")))
    .orderBy(asc(wordCloudEntries.createdAt));
  return { entries: rows.map(entryDTO), remaining: Math.max(0, rules.maxEntries - rows.length) };
}

/* ------------------------------------------------------------------ agregação */
/**
 * Termos aprovados e visíveis da pergunta. Uma consulta indexada por janela de atualização (o tempo real
 * agrega as mudanças em intervalos curtos) — nunca um cálculo por resposta recebida.
 */
export async function wordCloudResults(
  tx: Tx,
  sq: SessionQuestionRow,
  rulesSnap: WordCloudConfig | null,
  chart: ChartConfig,
  opts: { only?: (spId: string) => boolean; maxTerms?: number } = {},
): Promise<WordCloudResultsDTO> {
  const rules = rulesOf(rulesSnap);
  const display = wordCloudDisplaySchema.parse(chart.wordCloud ?? {});
  const [entries, termRules] = await Promise.all([
    tx
      .select({ terms: wordCloudEntries.terms, participantId: wordCloudEntries.sessionParticipantId })
      .from(wordCloudEntries)
      .where(and(eq(wordCloudEntries.sessionQuestionId, sq.id), eq(wordCloudEntries.status, "APROVADA"))),
    tx.select({ termKey: wordCloudTermRules.termKey }).from(wordCloudTermRules).where(eq(wordCloudTermRules.sessionQuestionId, sq.id)),
  ]);
  const visible = opts.only ? entries.filter((e) => opts.only!(e.participantId)) : entries;
  const agg = aggregateWordCloud(visible, rules, { hidden: termRules.map((r) => r.termKey), maxTerms: opts.maxTerms ?? display.maxTerms });
  return { ...agg, mode: rules.mode };
}

/** Participantes com envio aprovado (contagem de "responderam"). */
export async function wordCloudRespondents(tx: Tx, sqIds: string[]) {
  const map = new Map<string, number>();
  if (!sqIds.length) return map;
  const rows = await tx
    .select({ sqId: wordCloudEntries.sessionQuestionId, n: sql<number>`count(distinct ${wordCloudEntries.sessionParticipantId})::int` })
    .from(wordCloudEntries)
    .where(and(inArray(wordCloudEntries.sessionQuestionId, sqIds), eq(wordCloudEntries.status, "APROVADA")))
    .groupBy(wordCloudEntries.sessionQuestionId);
  for (const r of rows) map.set(r.sqId, Number(r.n));
  return map;
}

/* ------------------------------------------------------------------ moderação (painel do palestrante) */
async function loadWordCloudQuestion(ctx: AppContext, actor: Actor, sessionId: string, sqId: string) {
  const session = await loadSession(ctx, actor, sessionId, "session.control");
  const sq = await sqRow(ctx.db, sqId);
  if (sq.sessionId !== session.id) throw notFound("Pergunta não encontrada nesta sessão.");
  const snap = await getSnapshot(ctx.db, sq.versionId);
  if (snap.type !== "NUVEM_PALAVRAS") throw badRequest("Esta pergunta não é uma nuvem de palavras.");
  return { session, sq, snap };
}

export async function listWordCloudEntries(ctx: AppContext, actor: Actor, sessionId: string, sqId: string, f: { status?: EntryStatus } = {}) {
  const { sq } = await loadWordCloudQuestion(ctx, actor, sessionId, sqId);
  const where = f.status ? and(eq(wordCloudEntries.sessionQuestionId, sq.id), eq(wordCloudEntries.status, f.status)) : eq(wordCloudEntries.sessionQuestionId, sq.id);
  const rows = await ctx.db
    .select({ e: wordCloudEntries, displayName: sessionParticipants.displayName })
    .from(wordCloudEntries)
    .innerJoin(sessionParticipants, eq(sessionParticipants.id, wordCloudEntries.sessionParticipantId))
    .where(where)
    .orderBy(desc(wordCloudEntries.createdAt))
    .limit(2000);
  const counts = await ctx.db
    .select({ status: wordCloudEntries.status, n: count() })
    .from(wordCloudEntries)
    .where(eq(wordCloudEntries.sessionQuestionId, sq.id))
    .groupBy(wordCloudEntries.status);
  const termRules = await ctx.db.select().from(wordCloudTermRules).where(eq(wordCloudTermRules.sessionQuestionId, sq.id)).orderBy(asc(wordCloudTermRules.createdAt));
  return {
    entries: rows.map(({ e, displayName }) => ({
      id: e.id,
      text: e.original,
      terms: e.terms,
      status: e.status,
      reason: e.reason,
      displayName,
      createdAt: e.createdAt.toISOString(),
      moderatedAt: e.moderatedAt?.toISOString() ?? null,
    })),
    counts: { APROVADA: 0, PENDENTE: 0, REJEITADA: 0, ...Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])) } as Record<EntryStatus, number>,
    termRules: termRules.map((r) => ({ termKey: r.termKey, label: r.label, action: r.action, createdAt: r.createdAt.toISOString() })),
  };
}

/** Aprovar ou rejeitar um envio. Não apaga: muda o status, registra quem moderou e mantém o texto para auditoria. */
export async function moderateWordCloudEntry(ctx: AppContext, actor: Actor, sessionId: string, sqId: string, entryId: string, action: "approve" | "reject") {
  const { session, sq } = await loadWordCloudQuestion(ctx, actor, sessionId, sqId);
  const status: EntryStatus = action === "approve" ? "APROVADA" : "REJEITADA";
  const updated = await ctx.db.transaction(async (tx) => {
    const [e] = await tx.select().from(wordCloudEntries).where(and(eq(wordCloudEntries.id, entryId), eq(wordCloudEntries.sessionQuestionId, sq.id))).for("update");
    if (!e) throw notFound("Envio não encontrado.");
    if (e.reason === "TERMO_NAO_PERMITIDO" && status === "APROVADA") throw badRequest("Envios recusados pelo filtro de termos não podem ser aprovados.");
    if (e.status === status) return e;
    const [u] = await tx
      .update(wordCloudEntries)
      .set({ status, moderatedByUserId: actor.user.id, moderatedAt: ctx.now(), reason: status === "REJEITADA" ? "MODERACAO" : null })
      .where(eq(wordCloudEntries.id, e.id))
      .returning();
    await logSessionEvent(tx, session.orgId, session.id, action === "approve" ? "wordcloud.entry_approved" : "wordcloud.entry_rejected", { sessionQuestionId: sq.id, entryId: e.id, from: e.status }, actor.user.id);
    await audit(tx, actor, session.orgId, action === "approve" ? "wordcloud.approve" : "wordcloud.reject", "word_cloud_entry", e.id, { sessionQuestionId: sq.id, from: e.status });
    return u;
  });
  ctx.rt.resultsDirty(session.id, sq.id);
  ctx.rt.toParticipant(session.id, updated.sessionParticipantId, RT.wordCloudEntry, { sessionQuestionId: sq.id, entry: entryDTO(updated) });
  await notifyPending(ctx, session.id, sq.id);
  return { id: updated.id, status: updated.status };
}

/**
 * Ocultar (deixa de contar), bloquear (oculta e recusa novos envios com o termo) ou restaurar um termo.
 * Os envios continuam registrados; a regra fica na pergunta da sessão e no histórico.
 */
export async function setWordCloudTermRule(ctx: AppContext, actor: Actor, sessionId: string, sqId: string, input: { term: string; action: "hide" | "block" | "restore" }) {
  const { session, sq } = await loadWordCloudQuestion(ctx, actor, sessionId, sqId);
  const label = cleanText(input.term).slice(0, 200);
  const termKey = fullFold(label);
  if (!termKey) throw badRequest("Informe o termo.");
  await ctx.db.transaction(async (tx) => {
    if (input.action === "restore") {
      await tx.delete(wordCloudTermRules).where(and(eq(wordCloudTermRules.sessionQuestionId, sq.id), eq(wordCloudTermRules.termKey, termKey)));
    } else {
      const action = input.action === "block" ? "BLOQUEADO" : "OCULTO";
      await tx
        .insert(wordCloudTermRules)
        .values({ sessionQuestionId: sq.id, termKey, label, action, createdByUserId: actor.user.id })
        .onConflictDoUpdate({ target: [wordCloudTermRules.sessionQuestionId, wordCloudTermRules.termKey], set: { action, label, createdByUserId: actor.user.id, createdAt: ctx.now() } });
    }
    const type = input.action === "restore" ? "wordcloud.term_restored" : input.action === "block" ? "wordcloud.term_blocked" : "wordcloud.term_hidden";
    await logSessionEvent(tx, session.orgId, session.id, type, { sessionQuestionId: sq.id, term: label }, actor.user.id);
    await audit(tx, actor, session.orgId, type, "session_question", sq.id, { term: label });
  });
  ctx.rt.resultsDirty(session.id, sq.id);
  ctx.rt.controlResync(session.id);
  return listWordCloudEntries(ctx, actor, sessionId, sqId);
}

/* ------------------------------------------------------------------ exportação */
/** Envios da sessão para CSV/XLSX (apelido do participante — nunca contato). */
export async function wordCloudExportRows(tx: Tx, sessionId: string) {
  const rows = await tx
    .select({
      e: wordCloudEntries,
      displayName: sessionParticipants.displayName,
      position: sessionQuestions.position,
      title: questions.title,
    })
    .from(wordCloudEntries)
    .innerJoin(sessionParticipants, eq(sessionParticipants.id, wordCloudEntries.sessionParticipantId))
    .innerJoin(sessionQuestions, eq(sessionQuestions.id, wordCloudEntries.sessionQuestionId))
    .innerJoin(questions, eq(questions.id, sessionQuestions.questionId))
    .where(eq(wordCloudEntries.sessionId, sessionId))
    .orderBy(asc(sessionQuestions.position), asc(wordCloudEntries.createdAt));
  return rows.map(({ e, displayName, position, title }) => ({
    pergunta: position,
    enunciado: title,
    horario: e.createdAt.toISOString(),
    participante: displayName,
    texto_original: e.original,
    texto_normalizado: e.normalized,
    termos: e.terms.join(" | "),
    status: e.status,
    motivo: e.reason ?? "",
    moderado_em: e.moderatedAt?.toISOString() ?? "",
  }));
}
