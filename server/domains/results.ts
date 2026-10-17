/**
 * Agregação de resultados por pergunta (sempre no backend).
 * Distingue participantes inscritos, respondentes e total de seleções (múltipla escolha).
 */
import { and, count, eq, inArray } from "drizzle-orm";
import type { Tx } from "../db/client";
import { answerOptionSelections, participantAnswers, questions, sessionParticipants, sessionQuestions } from "../db/schema";
import { npsSummary } from "@shared/scoring";
import type { ResultsDTO, ResultCategory } from "@shared/types";
import type { ChartConfig } from "@shared/schemas";
import { getSnapshot } from "./snapshots";
import type { SessionQuestionRow } from "./sessions";

interface AnswerRow {
  id: string;
  spId: string;
  rt: number;
  receivedAt: Date;
  value: number | null;
  options: string[];
}

async function loadAnswers(tx: Tx, sqId: string): Promise<AnswerRow[]> {
  const rows = await tx
    .select({
      id: participantAnswers.id,
      spId: participantAnswers.sessionParticipantId,
      rt: participantAnswers.responseTimeMs,
      receivedAt: participantAnswers.receivedAt,
      value: participantAnswers.numericValue,
    })
    .from(participantAnswers)
    .innerJoin(sessionParticipants, eq(sessionParticipants.id, participantAnswers.sessionParticipantId))
    .where(and(eq(participantAnswers.sessionQuestionId, sqId), eq(participantAnswers.status, "ACCEPTED")));
  if (rows.length === 0) return [];
  const sels = await tx
    .select({ answerId: answerOptionSelections.answerId, optionId: answerOptionSelections.optionId })
    .from(answerOptionSelections)
    .where(inArray(answerOptionSelections.answerId, rows.map((r) => r.id)));
  const map = new Map<string, string[]>();
  for (const s of sels) map.set(s.answerId, [...(map.get(s.answerId) ?? []), s.optionId]);
  return rows.map((r) => ({ ...r, options: map.get(r.id) ?? [] }));
}

function pickBucket(spanMs: number): number {
  const candidates = [5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];
  return candidates.find((c) => spanMs / c <= 30) ?? 900_000;
}

export interface ResultsOptions {
  /** Inclui marcação de alternativas corretas mesmo antes da revelação (somente painel do palestrante). */
  includeCorrect: boolean;
  /** Sobrepõe a pergunta de cruzamento configurada (id de questions). */
  crossQuestionId?: string | null;
}

export async function computeResults(tx: Tx, sq: SessionQuestionRow, opts: ResultsOptions): Promise<ResultsDTO> {
  const snap = await getSnapshot(tx, sq.versionId);
  const [qRow] = await tx.select({ chart: questions.chart }).from(questions).where(eq(questions.id, sq.questionId));
  const chart = (qRow?.chart ?? snap.chart) as ChartConfig;
  const [pc] = await tx.select({ n: count() }).from(sessionParticipants).where(eq(sessionParticipants.sessionId, sq.sessionId));
  const answers = await loadAnswers(tx, sq.id);
  const numeric = snap.type === "ESCALA" || snap.type === "NPS";
  const revealed = !!sq.correctRevealedAt;
  const showCorrect = opts.includeCorrect || revealed;

  // categorias
  let categories: ResultCategory[];
  let catIndexOf: (a: AnswerRow) => number[];
  if (numeric) {
    const min = snap.scaleMin ?? 0;
    const max = snap.scaleMax ?? 10;
    const vals = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    categories = vals.map((v) => ({ id: String(v), label: String(v), color: null, count: 0, pct: 0, isCorrect: null, avgResponseMs: null }));
    catIndexOf = (a) => (a.value === null ? [] : [a.value - min]);
  } else {
    categories = snap.options.map((o) => ({
      id: o.id,
      label: o.label,
      color: o.color,
      count: 0,
      pct: 0,
      isCorrect: snap.scoring && showCorrect ? o.isCorrect : null,
      avgResponseMs: null,
    }));
    const idx = new Map(snap.options.map((o, i) => [o.id, i]));
    catIndexOf = (a) => a.options.map((id) => idx.get(id)).filter((i): i is number => i !== undefined);
  }
  const rtSum = categories.map(() => 0);
  let selections = 0;
  for (const a of answers) {
    for (const i of catIndexOf(a)) {
      if (!categories[i]) continue;
      categories[i].count++;
      rtSum[i] += a.rt;
      selections++;
    }
  }
  const respondents = answers.length;
  for (const [i, c] of categories.entries()) {
    c.pct = respondents > 0 ? (c.count / respondents) * 100 : 0;
    c.avgResponseMs = c.count > 0 ? Math.round(rtSum[i] / c.count) : null;
  }

  // numéricos
  let numericBlock: ResultsDTO["numeric"] = null;
  if (numeric) {
    const values = answers.map((a) => a.value).filter((v): v is number => v !== null).sort((x, y) => x - y);
    const mean = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
    const median = values.length
      ? values.length % 2
        ? values[(values.length - 1) / 2]
        : (values[values.length / 2 - 1] + values[values.length / 2]) / 2
      : null;
    numericBlock = { min: snap.scaleMin ?? 0, max: snap.scaleMax ?? 10, mean, median, nps: snap.type === "NPS" ? npsSummary(values) : null };
  }

  // acurácia (apenas quando permitido)
  let accuracyPct: number | null = null;
  if (snap.scoring && showCorrect && respondents > 0) {
    const correctIds = snap.options.filter((o) => o.isCorrect).map((o) => o.id).sort();
    const correctCount = answers.filter((a) => {
      const s = [...a.options].sort();
      return s.length === correctIds.length && s.every((v, i) => v === correctIds[i]);
    }).length;
    accuracyPct = (correctCount / respondents) * 100;
  }

  // linha do tempo (respondentes acumulados por intervalo desde a abertura)
  const openedAt = sq.openedAt?.getTime() ?? (answers[0]?.receivedAt.getTime() ?? Date.now());
  const sorted = [...answers].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const lastT = sorted.length ? sorted[sorted.length - 1].receivedAt.getTime() - openedAt : 0;
  const endT = Math.max(lastT, (sq.closedAt?.getTime() ?? Date.now()) - openedAt, 0);
  const bucketMs = pickBucket(endT);
  const points: ResultsDTO["timeline"]["points"] = [];
  if (sorted.length) {
    let k = 0;
    let resp = 0;
    const byCat = categories.map(() => 0);
    const nBuckets = Math.min(60, Math.max(1, Math.ceil(endT / bucketMs)));
    for (let b = 1; b <= nBuckets; b++) {
      const limit = b * bucketMs;
      while (k < sorted.length && sorted[k].receivedAt.getTime() - openedAt <= limit) {
        resp++;
        for (const i of catIndexOf(sorted[k])) byCat[i]++;
        k++;
      }
      points.push({ t: limit, respondents: resp, byCategory: [...byCat] });
    }
    if (k < sorted.length) {
      // respostas além do último intervalo (limite de pontos): consolida no último ponto
      while (k < sorted.length) {
        resp++;
        for (const i of catIndexOf(sorted[k])) byCat[i]++;
        k++;
      }
      points[points.length - 1] = { t: points[points.length - 1].t, respondents: resp, byCategory: [...byCat] };
    }
  }

  // dispersão (nota × tempo) — apenas escalas
  const scatter = numeric ? answers.slice(0, 1000).map((a) => ({ rtMs: a.rt, value: a.value ?? 0 })) : null;

  // cruzamento com pergunta de perfil (mesmos participantes, mesma sessão)
  let cross: ResultsDTO["cross"] = null;
  const crossQ = opts.crossQuestionId !== undefined ? opts.crossQuestionId : chart.crossQuestionId;
  if (crossQ && answers.length) {
    const [csq] = await tx
      .select()
      .from(sessionQuestions)
      .where(and(eq(sessionQuestions.sessionId, sq.sessionId), eq(sessionQuestions.questionId, crossQ)));
    if (csq && csq.id !== sq.id) {
      const csnap = await getSnapshot(tx, csq.versionId);
      if (csnap.maxSelections === 1 && csnap.options.length > 0) {
        const cAnswers = await loadAnswers(tx, csq.id);
        const segOf = new Map<string, number>();
        const segIdx = new Map(csnap.options.map((o, i) => [o.id, i]));
        for (const a of cAnswers) {
          const i = segIdx.get(a.options[0]);
          if (i !== undefined) segOf.set(a.spId, i);
        }
        const matrix = csnap.options.map(() => categories.map(() => 0));
        for (const a of answers) {
          const s = segOf.get(a.spId);
          if (s === undefined) continue;
          for (const i of catIndexOf(a)) matrix[s][i]++;
        }
        cross = { questionTitle: csnap.title, segments: csnap.options.map((o) => o.label), matrix };
      }
    }
  }

  return {
    sessionQuestionId: sq.id,
    questionType: snap.type,
    title: snap.title,
    multiSelect: !numeric && snap.maxSelections > 1,
    totals: { participants: Number(pc.n), respondents, selections },
    categories,
    numeric: numericBlock,
    correctRevealed: revealed,
    accuracyPct,
    timeline: { bucketMs, points },
    scatter,
    cross,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Visibilidade pública (participantes e telão). `resultsShownAt` é definido:
 *  - AO_VIVO: na abertura da pergunta;
 *  - APOS_ENCERRAMENTO: no fechamento;
 *  - MANUAL: quando o palestrante manda exibir.
 * "Ocultar resultados" limpa o campo em qualquer modo.
 */
export function resultsPublic(sq: SessionQuestionRow): boolean {
  return sq.state !== "PRONTA" && !!sq.resultsShownAt;
}

export async function answeredCount(tx: Tx, sqId: string) {
  const [r] = await tx
    .select({ n: count() })
    .from(participantAnswers)
    .where(and(eq(participantAnswers.sessionQuestionId, sqId), eq(participantAnswers.status, "ACCEPTED")));
  return Number(r.n);
}
