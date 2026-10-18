/**
 * Construtor de perguntas: CRUD, versionamento, bloqueio estrutural, banco reutilizável,
 * duplicação, ordenação e importação/exportação.
 */
import { and, asc, count, eq, inArray, isNull, max, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import type { Tx } from "../db/client";
import { events, participantAnswers, questionOptions, questionVersions, questions, sessionQuestions } from "../db/schema";
import type { Actor } from "../auth/auth";
import { authorize } from "../auth/permissions";
import { badRequest, conflict, notFound } from "../lib/errors";
import { audit } from "./audit";
import {
  QUESTIONNAIRE_FORMAT,
  questionInputSchema,
  questionnaireExportSchema,
  scoringSchema,
  type QuestionInput,
  type QuestionnaireExport,
  type QuestionType,
  type ScoringConfig,
  type ChartConfig,
  type ResultsMode,
} from "@shared/schemas";
import { checkChart, chartContextForQuestion } from "@shared/charts/compat";

export type QuestionRow = typeof questions.$inferSelect;
export type OptionRow = typeof questionOptions.$inferSelect;

/** Snapshot imutável de uma versão da pergunta (usado pelas sessões). */
export interface QuestionSnapshot {
  questionId: string;
  version: number;
  type: QuestionType;
  title: string;
  description: string | null;
  imageUrl: string | null;
  category: string | null;
  minSelections: number;
  maxSelections: number;
  scaleMin: number | null;
  scaleMax: number | null;
  scaleMinLabel: string | null;
  scaleMaxLabel: string | null;
  timeLimitSec: number | null;
  allowEdit: boolean;
  scoring: ScoringConfig | null;
  chart: ChartConfig;
  resultsMode: ResultsMode;
  explanation: string | null;
  options: { id: string; position: number; label: string; imageUrl: string | null; isCorrect: boolean; color: string | null }[];
}

export function buildSnapshot(q: QuestionRow, opts: OptionRow[]): QuestionSnapshot {
  return {
    questionId: q.id,
    version: q.currentVersion,
    type: q.type,
    title: q.title,
    description: q.description,
    imageUrl: q.imageUrl,
    category: q.category,
    minSelections: q.minSelections,
    maxSelections: q.maxSelections,
    scaleMin: q.scaleMin,
    scaleMax: q.scaleMax,
    scaleMinLabel: q.scaleMinLabel,
    scaleMaxLabel: q.scaleMaxLabel,
    timeLimitSec: q.timeLimitSec,
    allowEdit: q.allowEdit,
    scoring: (q.scoring as ScoringConfig | null) ?? null,
    chart: q.chart as ChartConfig,
    resultsMode: q.resultsMode,
    explanation: q.explanation,
    options: [...opts]
      .sort((a, b) => a.position - b.position)
      .map((o) => ({ id: o.id, position: o.position, label: o.label, imageUrl: o.imageUrl, isCorrect: o.isCorrect, color: o.color })),
  };
}

export function rowToInput(q: QuestionRow, opts: OptionRow[]): QuestionInput {
  return {
    type: q.type,
    title: q.title,
    description: q.description,
    imageUrl: q.imageUrl,
    category: q.category,
    tags: q.tags,
    required: q.required,
    minSelections: q.minSelections,
    maxSelections: q.maxSelections,
    scaleMin: q.scaleMin,
    scaleMax: q.scaleMax,
    scaleMinLabel: q.scaleMinLabel,
    scaleMaxLabel: q.scaleMaxLabel,
    timeLimitSec: q.timeLimitSec,
    allowEdit: q.allowEdit,
    scoring: (q.scoring as ScoringConfig | null) ?? null,
    chart: q.chart as ChartConfig,
    resultsMode: q.resultsMode,
    explanation: q.explanation,
    options: [...opts]
      .sort((a, b) => a.position - b.position)
      .map((o) => ({ id: o.id, label: o.label, imageUrl: o.imageUrl, isCorrect: o.isCorrect, color: o.color })),
  };
}

/* ------------------------------------------------------------------ carregamento e autorização */
async function loadQuestion(ctx: AppContext, actor: Actor, id: string, perm: "event.read" | "event.write") {
  const [q] = await ctx.db.select().from(questions).where(eq(questions.id, id));
  if (!q) throw notFound("Pergunta não encontrada.");
  authorize(actor, q.orgId, perm);
  return q;
}

async function loadEventForQuestions(ctx: AppContext, actor: Actor, eventId: string, perm: "event.read" | "event.write") {
  const [ev] = await ctx.db.select().from(events).where(eq(events.id, eventId));
  if (!ev) throw notFound("Evento não encontrado.");
  authorize(actor, ev.orgId, perm);
  return ev;
}

async function optionsOf(tx: Tx, questionIds: string[]) {
  if (questionIds.length === 0) return new Map<string, OptionRow[]>();
  const rows = await tx.select().from(questionOptions).where(inArray(questionOptions.questionId, questionIds)).orderBy(asc(questionOptions.position));
  const map = new Map<string, OptionRow[]>();
  for (const r of rows) {
    const list = map.get(r.questionId) ?? [];
    list.push(r);
    map.set(r.questionId, list);
  }
  return map;
}

async function answerCounts(tx: Tx, questionIds: string[]) {
  const map = new Map<string, number>();
  if (questionIds.length === 0) return map;
  const rows = await tx
    .select({ questionId: sessionQuestions.questionId, n: count(participantAnswers.id) })
    .from(sessionQuestions)
    .innerJoin(participantAnswers, eq(participantAnswers.sessionQuestionId, sessionQuestions.id))
    .where(inArray(sessionQuestions.questionId, questionIds))
    .groupBy(sessionQuestions.questionId);
  for (const r of rows) map.set(r.questionId, Number(r.n));
  return map;
}

export async function isQuestionLocked(tx: Tx, questionId: string): Promise<boolean> {
  return ((await answerCounts(tx, [questionId])).get(questionId) ?? 0) > 0;
}

/* ------------------------------------------------------------------ validação de gráfico/cruzamento */
async function validateChart(tx: Tx, input: QuestionInput, eventId: string | null, selfId: string | null) {
  let hasCross = false;
  if (input.chart.crossQuestionId) {
    if (!eventId) throw badRequest("Cruzamentos só podem ser configurados em perguntas de um evento.");
    if (input.chart.crossQuestionId === selfId) throw badRequest("Uma pergunta não pode ser cruzada com ela mesma.");
    const [cq] = await tx.select().from(questions).where(eq(questions.id, input.chart.crossQuestionId));
    if (!cq || cq.eventId !== eventId) throw badRequest("A pergunta de cruzamento deve pertencer ao mesmo evento.");
    if (!["PERFIL", "OPINIAO", "SIM_NAO"].includes(cq.type) || cq.maxSelections !== 1) {
      throw badRequest("O cruzamento exige uma pergunta de escolha única (perfil, opinião ou sim/não).");
    }
    hasCross = true;
  }
  const ctx = chartContextForQuestion({
    type: input.type,
    optionCount: input.options.length,
    maxSelections: input.maxSelections,
    scaleMin: input.scaleMin,
    scaleMax: input.scaleMax,
    hasCross,
    hasTemporal: true,
  });
  const check = checkChart(input.chart.type, ctx);
  if (!check.compatible) throw badRequest(`Gráfico incompatível com esta pergunta: ${check.reason}`, undefined, "GRAFICO_INCOMPATIVEL");
}

function normalizeInput(raw: unknown): QuestionInput {
  const r = raw as Record<string, unknown>;
  // NPS tem escala fixa; Sim/Não e escalas têm regras próprias
  if (r && r.type === "NPS") {
    r.scaleMin = 0;
    r.scaleMax = 10;
    r.options = [];
  }
  if (r && (r.type === "ESCALA" || r.type === "NPS")) {
    r.minSelections = 1;
    r.maxSelections = 1;
  }
  if (r && (r.type === "CONHECIMENTO" || r.type === "SIM_NAO")) {
    r.minSelections = 1;
    r.maxSelections = 1;
  }
  return questionInputSchema.parse(r);
}

/* ------------------------------------------------------------------ escrita */
async function insertQuestion(tx: Tx, orgId: string, eventId: string | null, input: QuestionInput, position: number, status: "RASCUNHO" | "PRONTA" = "PRONTA") {
  const [q] = await tx
    .insert(questions)
    .values({
      orgId,
      eventId,
      position,
      type: input.type,
      status,
      title: input.title,
      description: input.description,
      imageUrl: input.imageUrl,
      category: input.category,
      tags: input.tags,
      required: input.required,
      minSelections: input.minSelections,
      maxSelections: input.maxSelections,
      scaleMin: input.scaleMin,
      scaleMax: input.scaleMax,
      scaleMinLabel: input.scaleMinLabel,
      scaleMaxLabel: input.scaleMaxLabel,
      timeLimitSec: input.timeLimitSec,
      allowEdit: input.allowEdit,
      scoring: input.scoring,
      chart: input.chart,
      resultsMode: input.resultsMode,
      explanation: input.explanation,
      currentVersion: 1,
    })
    .returning();
  const opts =
    input.options.length > 0
      ? await tx
          .insert(questionOptions)
          .values(input.options.map((o, i) => ({ questionId: q.id, position: i, label: o.label, imageUrl: o.imageUrl, isCorrect: o.isCorrect, color: o.color })))
          .returning()
      : [];
  await tx.insert(questionVersions).values({ questionId: q.id, version: 1, snapshot: buildSnapshot(q, opts) });
  return { question: q, options: opts };
}

async function nextPosition(tx: Tx, eventId: string | null, orgId: string) {
  const [r] = await tx
    .select({ m: max(questions.position) })
    .from(questions)
    .where(eventId ? eq(questions.eventId, eventId) : and(isNull(questions.eventId), eq(questions.orgId, orgId)));
  return (r?.m ?? -1) + 1;
}

export async function listQuestions(ctx: AppContext, actor: Actor, eventId: string) {
  const ev = await loadEventForQuestions(ctx, actor, eventId, "event.read");
  return listQuestionsRaw(ctx.db, ev.id);
}

export async function listQuestionsRaw(tx: Tx, eventId: string | null, orgId?: string) {
  const rows = await tx
    .select()
    .from(questions)
    .where(eventId ? eq(questions.eventId, eventId) : and(isNull(questions.eventId), eq(questions.orgId, orgId!)))
    .orderBy(asc(questions.position), asc(questions.createdAt));
  const ids = rows.map((r) => r.id);
  const opts = await optionsOf(tx, ids);
  const counts = await answerCounts(tx, ids);
  return rows.map((q) => ({
    ...rowToInput(q, opts.get(q.id) ?? []),
    id: q.id,
    eventId: q.eventId,
    position: q.position,
    status: q.status,
    version: q.currentVersion,
    answersCount: counts.get(q.id) ?? 0,
    locked: (counts.get(q.id) ?? 0) > 0,
    updatedAt: q.updatedAt,
  }));
}

export async function getQuestion(ctx: AppContext, actor: Actor, id: string) {
  const q = await loadQuestion(ctx, actor, id, "event.read");
  const list = await listQuestionsRaw(ctx.db, q.eventId, q.orgId);
  const found = list.find((x) => x.id === id);
  if (!found) throw notFound();
  return found;
}

export async function createQuestion(ctx: AppContext, actor: Actor, eventId: string, raw: unknown) {
  const ev = await loadEventForQuestions(ctx, actor, eventId, "event.write");
  const input = normalizeInput(raw);
  return ctx.db.transaction(async (tx) => {
    await validateChart(tx, input, ev.id, null);
    const pos = await nextPosition(tx, ev.id, ev.orgId);
    const { question } = await insertQuestion(tx, ev.orgId, ev.id, input, pos);
    await audit(tx, actor, ev.orgId, "question.create", "question", question.id, { eventId, title: input.title });
    return question;
  });
}

function structuralSignature(input: QuestionInput) {
  // o jsonb do Postgres não preserva a ordem das chaves: normaliza a pontuação campo a campo
  const s = input.scoring ? scoringSchema.parse(input.scoring) : null;
  return JSON.stringify({
    type: input.type,
    minSelections: input.minSelections,
    maxSelections: input.maxSelections,
    scaleMin: input.scaleMin,
    scaleMax: input.scaleMax,
    scoring: s && [s.basePoints, s.weight, s.speedBonusEnabled, s.speedBonusMax, s.wrongPenalty],
    options: input.options.map((o) => ({ id: o.id ?? null, isCorrect: o.isCorrect })),
  });
}

/**
 * Atualiza a pergunta e cria uma nova versão.
 * Se a pergunta já recebeu respostas, campos estruturais (tipo, alternativas, gabarito, seleções,
 * escala e pontuação) ficam bloqueados — apenas textos, imagens, gráfico e explicação podem mudar.
 */
export async function updateQuestion(ctx: AppContext, actor: Actor, id: string, raw: unknown, status?: "RASCUNHO" | "PRONTA") {
  const q = await loadQuestion(ctx, actor, id, "event.write");
  const input = normalizeInput(raw);
  return ctx.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(questions).where(eq(questions.id, id)).for("update");
    const currentOpts = (await optionsOf(tx, [id])).get(id) ?? [];
    const isLocked = await isQuestionLocked(tx, id);
    if (isLocked) {
      const before = structuralSignature(rowToInput(locked, currentOpts));
      const after = structuralSignature(input);
      if (before !== after) {
        throw conflict(
          "Esta pergunta já recebeu respostas. Tipo, alternativas, gabarito, seleções, escala e pontuação não podem ser alterados. Duplique a pergunta para criar uma variação.",
          "PERGUNTA_BLOQUEADA",
        );
      }
    }
    await validateChart(tx, input, q.eventId, q.id);
    // opções: atualiza existentes, cria novas e remove ausentes (somente se não bloqueada)
    const keepIds = new Set(input.options.filter((o) => o.id).map((o) => o.id!));
    const currentIds = new Set(currentOpts.map((o) => o.id));
    for (const o of input.options) if (o.id && !currentIds.has(o.id)) throw badRequest("Alternativa inválida.");
    const toDelete = currentOpts.filter((o) => !keepIds.has(o.id)).map((o) => o.id);
    if (toDelete.length > 0) {
      if (isLocked) throw conflict("Não é possível remover alternativas de uma pergunta com respostas.", "PERGUNTA_BLOQUEADA");
      await tx.delete(questionOptions).where(inArray(questionOptions.id, toDelete));
    }
    for (const [i, o] of input.options.entries()) {
      if (o.id) {
        await tx
          .update(questionOptions)
          .set({ position: i, label: o.label, imageUrl: o.imageUrl, isCorrect: o.isCorrect, color: o.color })
          .where(eq(questionOptions.id, o.id));
      } else {
        await tx.insert(questionOptions).values({ questionId: id, position: i, label: o.label, imageUrl: o.imageUrl, isCorrect: o.isCorrect, color: o.color });
      }
    }
    const nextVersion = locked.currentVersion + 1;
    const [updated] = await tx
      .update(questions)
      .set({
        type: input.type,
        status: status ?? locked.status,
        title: input.title,
        description: input.description,
        imageUrl: input.imageUrl,
        category: input.category,
        tags: input.tags,
        required: input.required,
        minSelections: input.minSelections,
        maxSelections: input.maxSelections,
        scaleMin: input.scaleMin,
        scaleMax: input.scaleMax,
        scaleMinLabel: input.scaleMinLabel,
        scaleMaxLabel: input.scaleMaxLabel,
        timeLimitSec: input.timeLimitSec,
        allowEdit: input.allowEdit,
        scoring: input.scoring,
        chart: input.chart,
        resultsMode: input.resultsMode,
        explanation: input.explanation,
        currentVersion: nextVersion,
        updatedAt: ctx.now(),
      })
      .where(eq(questions.id, id))
      .returning();
    const newOpts = (await optionsOf(tx, [id])).get(id) ?? [];
    await tx.insert(questionVersions).values({ questionId: id, version: nextVersion, snapshot: buildSnapshot(updated, newOpts) });
    await audit(tx, actor, q.orgId, "question.update", "question", id, { version: nextVersion, locked: isLocked });
    return updated;
  });
}

export async function setQuestionStatus(ctx: AppContext, actor: Actor, id: string, status: "RASCUNHO" | "PRONTA") {
  const q = await loadQuestion(ctx, actor, id, "event.write");
  await ctx.db.update(questions).set({ status, updatedAt: ctx.now() }).where(eq(questions.id, q.id));
}

export async function deleteQuestion(ctx: AppContext, actor: Actor, id: string) {
  const q = await loadQuestion(ctx, actor, id, "event.write");
  await ctx.db.transaction(async (tx) => {
    if (await isQuestionLocked(tx, id)) {
      throw conflict("Esta pergunta já recebeu respostas e não pode ser excluída. Marque-a como rascunho para retirá-la das próximas sessões.", "PERGUNTA_BLOQUEADA");
    }
    // limpa referências de cruzamento
    await tx.execute(
      sql`update ${questions} set chart = jsonb_set(chart, '{crossQuestionId}', 'null'::jsonb) where chart->>'crossQuestionId' = ${id}`,
    );
    await tx.delete(sessionQuestions).where(eq(sessionQuestions.questionId, id));
    await tx.delete(questionVersions).where(eq(questionVersions.questionId, id));
    await tx.delete(questions).where(eq(questions.id, id));
    await audit(tx, actor, q.orgId, "question.delete", "question", id, { title: q.title });
  });
}

export async function duplicateQuestion(ctx: AppContext, actor: Actor, id: string) {
  const q = await loadQuestion(ctx, actor, id, "event.write");
  return ctx.db.transaction(async (tx) => {
    const opts = (await optionsOf(tx, [id])).get(id) ?? [];
    const input = rowToInput(q, opts);
    input.title = `${input.title} (cópia)`.slice(0, 300);
    input.options = input.options.map((o) => ({ ...o, id: undefined }));
    // abre espaço logo após a original
    if (q.eventId) {
      await tx.execute(sql`update ${questions} set position = position + 1 where event_id = ${q.eventId} and position > ${q.position}`);
    }
    const { question } = await insertQuestion(tx, q.orgId, q.eventId, input, q.position + 1, q.status);
    await audit(tx, actor, q.orgId, "question.duplicate", "question", question.id, { from: id });
    return question;
  });
}

export async function reorderQuestions(ctx: AppContext, actor: Actor, eventId: string, orderedIds: string[]) {
  const ev = await loadEventForQuestions(ctx, actor, eventId, "event.write");
  await ctx.db.transaction(async (tx) => {
    const rows = await tx.select({ id: questions.id }).from(questions).where(eq(questions.eventId, ev.id));
    const existing = new Set(rows.map((r) => r.id));
    if (orderedIds.length !== existing.size || !orderedIds.every((i) => existing.has(i))) {
      throw badRequest("A lista de ordenação deve conter todas as perguntas do evento.");
    }
    for (const [i, qid] of orderedIds.entries()) {
      await tx.update(questions).set({ position: i }).where(eq(questions.id, qid));
    }
  });
}

/* ------------------------------------------------------------------ banco de questões */
export async function listBank(ctx: AppContext, actor: Actor, orgId: string) {
  authorize(actor, orgId, "event.read");
  return listQuestionsRaw(ctx.db, null, orgId);
}

export async function saveToBank(ctx: AppContext, actor: Actor, id: string) {
  const q = await loadQuestion(ctx, actor, id, "event.write");
  return ctx.db.transaction(async (tx) => {
    const opts = (await optionsOf(tx, [id])).get(id) ?? [];
    const input = rowToInput(q, opts);
    input.options = input.options.map((o) => ({ ...o, id: undefined }));
    input.chart = { ...input.chart, crossQuestionId: null };
    const pos = await nextPosition(tx, null, q.orgId);
    const { question } = await insertQuestion(tx, q.orgId, null, input, pos);
    await audit(tx, actor, q.orgId, "bank.add", "question", question.id, { from: id });
    return question;
  });
}

export async function createBankQuestion(ctx: AppContext, actor: Actor, orgId: string, raw: unknown) {
  authorize(actor, orgId, "event.write");
  const input = normalizeInput(raw);
  input.chart = { ...input.chart, crossQuestionId: null };
  return ctx.db.transaction(async (tx) => {
    await validateChart(tx, input, null, null);
    const pos = await nextPosition(tx, null, orgId);
    const { question } = await insertQuestion(tx, orgId, null, input, pos);
    return question;
  });
}

export async function useBankQuestion(ctx: AppContext, actor: Actor, bankId: string, eventId: string) {
  const bq = await loadQuestion(ctx, actor, bankId, "event.read");
  if (bq.eventId !== null) throw badRequest("A pergunta informada não pertence ao banco.");
  const ev = await loadEventForQuestions(ctx, actor, eventId, "event.write");
  if (ev.orgId !== bq.orgId) throw notFound();
  return ctx.db.transaction(async (tx) => {
    const opts = (await optionsOf(tx, [bankId])).get(bankId) ?? [];
    const input = rowToInput(bq, opts);
    input.options = input.options.map((o) => ({ ...o, id: undefined }));
    const pos = await nextPosition(tx, ev.id, ev.orgId);
    const { question } = await insertQuestion(tx, ev.orgId, ev.id, input, pos);
    await audit(tx, actor, ev.orgId, "bank.use", "question", question.id, { from: bankId, eventId });
    return question;
  });
}

/* ------------------------------------------------------------------ importação/exportação */
export async function exportQuestionnaire(tx: Tx, eventId: string, name: string, description: string | null): Promise<QuestionnaireExport> {
  const list = await listQuestionsRaw(tx, eventId);
  return {
    format: QUESTIONNAIRE_FORMAT,
    version: 1,
    name,
    description,
    questions: list.map((q) => ({
      type: q.type,
      title: q.title,
      description: q.description,
      imageUrl: q.imageUrl,
      category: q.category,
      tags: q.tags,
      required: q.required,
      minSelections: q.minSelections,
      maxSelections: q.maxSelections,
      scaleMin: q.scaleMin,
      scaleMax: q.scaleMax,
      scaleMinLabel: q.scaleMinLabel,
      scaleMaxLabel: q.scaleMaxLabel,
      timeLimitSec: q.timeLimitSec,
      allowEdit: q.allowEdit,
      scoring: q.scoring,
      // referências de cruzamento são locais ao evento e não são exportadas
      chart: { ...q.chart, crossQuestionId: null },
      resultsMode: q.resultsMode,
      explanation: q.explanation,
      options: q.options.map((o) => ({ label: o.label, imageUrl: o.imageUrl, isCorrect: o.isCorrect, color: o.color })),
    })),
  };
}

export async function exportEventQuestions(ctx: AppContext, actor: Actor, eventId: string) {
  const ev = await loadEventForQuestions(ctx, actor, eventId, "event.read");
  return exportQuestionnaire(ctx.db, ev.id, ev.title, ev.description);
}

/** Importa perguntas (anexa ao final). Valida o arquivo inteiro antes de gravar qualquer coisa. */
export async function importQuestionsInto(tx: Tx, orgId: string, eventId: string, data: unknown) {
  const parsed = questionnaireExportSchema.safeParse(data);
  if (!parsed.success) {
    throw badRequest("Arquivo de questionário inválido.", parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  let pos = await nextPosition(tx, eventId, orgId);
  const created: string[] = [];
  for (const q of parsed.data.questions) {
    const input = normalizeInput({ ...q, chart: { ...q.chart, crossQuestionId: null } });
    await validateChart(tx, input, eventId, null);
    const { question } = await insertQuestion(tx, orgId, eventId, input, pos++);
    created.push(question.id);
  }
  return { imported: created.length, data: parsed.data };
}

export async function importEventQuestions(ctx: AppContext, actor: Actor, eventId: string, data: unknown) {
  const ev = await loadEventForQuestions(ctx, actor, eventId, "event.write");
  return ctx.db.transaction(async (tx) => {
    const r = await importQuestionsInto(tx, ev.orgId, ev.id, data);
    await audit(tx, actor, ev.orgId, "question.import", "event", ev.id, { imported: r.imported });
    return { imported: r.imported };
  });
}

/** Copia todas as perguntas de um evento para outro (usado na duplicação de eventos). */
export async function copyEventQuestions(tx: Tx, fromEventId: string, toEventId: string, orgId: string) {
  const list = await listQuestionsRaw(tx, fromEventId);
  const idMap = new Map<string, string>();
  for (const q of list) {
    const input: QuestionInput = { ...q, options: q.options.map((o) => ({ ...o, id: undefined })), chart: { ...q.chart, crossQuestionId: null } };
    const { question } = await insertQuestion(tx, orgId, toEventId, input, q.position, q.status);
    idMap.set(q.id, question.id);
  }
  // remapeia os cruzamentos para as novas perguntas
  for (const q of list) {
    if (q.chart.crossQuestionId && idMap.has(q.chart.crossQuestionId)) {
      const newId = idMap.get(q.id)!;
      await tx
        .update(questions)
        .set({ chart: { ...q.chart, crossQuestionId: idMap.get(q.chart.crossQuestionId)! } })
        .where(eq(questions.id, newId));
    }
  }
  return idMap;
}

/** Copia uma pergunta (com alternativas) para outro evento, ao final da lista. Usado ao reutilizar apresentações. */
export async function copyQuestionToEvent(tx: Tx, questionId: string, targetEventId: string, orgId: string) {
  const [q] = await tx.select().from(questions).where(eq(questions.id, questionId));
  if (!q || q.orgId !== orgId) throw notFound("Pergunta não encontrada.");
  const opts = (await optionsOf(tx, [questionId])).get(questionId) ?? [];
  const input = rowToInput(q, opts);
  input.options = input.options.map((o) => ({ ...o, id: undefined }));
  input.chart = { ...input.chart, crossQuestionId: null };
  const pos = await nextPosition(tx, targetEventId, orgId);
  const { question } = await insertQuestion(tx, orgId, targetEventId, input, pos, q.status);
  return question.id;
}
