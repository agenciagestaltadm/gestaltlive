/**
 * Motor de pontuação (somente servidor).
 *
 * Fluxo em duas fases:
 *  1. CÁLCULO no fechamento da pergunta: cada resposta aceita recebe isCorrect, pontos e bônus.
 *  2. PUBLICAÇÃO: os pontos entram no livro-razão (score_transactions) e nos agregados do ranking.
 *     Ocorre na revelação do gabarito, ao abrir a próxima pergunta, ao exibir o ranking ou ao
 *     encerrar a sessão — o que vier primeiro. Assim o placar não denuncia o gabarito antes da hora.
 *
 * A publicação é idempotente: o índice único (answer_id, kind) impede lançamentos duplicados e os
 * agregados são atualizados na MESMA instrução SQL que insere as transações.
 */
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { rowsOf, type Tx } from "../db/client";
import { answerOptionSelections, participantAnswers, scoreTransactions, sessionParticipants, sessionQuestions } from "../db/schema";
import { isSelectionCorrect, scoreAnswer } from "@shared/scoring";
import type { ScoringConfig } from "@shared/schemas";
import { getSnapshot } from "./snapshots";
import type { SessionQuestionRow } from "./sessions";
import type { Actor } from "../auth/auth";
import { audit } from "./audit";

/** Fase 1 — calcula a correção e os pontos de todas as respostas aceitas (idempotente). */
export async function scoreQuestion(tx: Tx, sq: SessionQuestionRow, now: Date): Promise<boolean> {
  if (sq.scoredAt) return false;
  const snap = await getSnapshot(tx, sq.versionId);
  if (!snap.scoring) {
    await tx.update(sessionQuestions).set({ scoredAt: now }).where(eq(sessionQuestions.id, sq.id));
    return false;
  }
  const cfg = snap.scoring as ScoringConfig;
  const correctIds = snap.options.filter((o) => o.isCorrect).map((o) => o.id);
  const answers = await tx
    .select({ id: participantAnswers.id, rt: participantAnswers.responseTimeMs })
    .from(participantAnswers)
    .where(and(eq(participantAnswers.sessionQuestionId, sq.id), eq(participantAnswers.status, "ACCEPTED")));
  if (answers.length) {
    const sels = await tx
      .select({ answerId: answerOptionSelections.answerId, optionId: answerOptionSelections.optionId })
      .from(answerOptionSelections)
      .innerJoin(participantAnswers, eq(participantAnswers.id, answerOptionSelections.answerId))
      .where(and(eq(participantAnswers.sessionQuestionId, sq.id), eq(participantAnswers.status, "ACCEPTED")));
    const byAnswer = new Map<string, string[]>();
    for (const s of sels) byAnswer.set(s.answerId, [...(byAnswer.get(s.answerId) ?? []), s.optionId]);
    for (const a of answers) {
      const correct = isSelectionCorrect(byAnswer.get(a.id) ?? [], correctIds);
      // respostas foram aceitas dentro do prazo (validado na submissão com o relógio do servidor)
      const { points, bonus } = scoreAnswer(cfg, correct, a.rt, sq.timeLimitMs);
      await tx.update(participantAnswers).set({ isCorrect: correct, points, speedBonus: bonus }).where(eq(participantAnswers.id, a.id));
    }
  }
  await tx.update(sessionQuestions).set({ scoredAt: now }).where(eq(sessionQuestions.id, sq.id));
  return true;
}

/** Fase 2 — lança os pontos no livro-razão e atualiza os agregados de forma atômica (idempotente). */
export async function publishScores(tx: Tx, sq: SessionQuestionRow, now: Date): Promise<boolean> {
  if (!sq.scoredAt || sq.scoresPublishedAt) return false;
  await tx.execute(sql`
    with ins as (
      insert into ${scoreTransactions}
        (org_id, session_id, session_participant_id, session_question_id, answer_id, kind, points, correct_delta, answered_delta, correct_time_ms_delta)
      select pa.org_id, pa.session_id, pa.session_participant_id, pa.session_question_id, pa.id, 'ANSWER',
             pa.points,
             case when pa.is_correct then 1 else 0 end,
             1,
             case when pa.is_correct then pa.response_time_ms else 0 end
        from ${participantAnswers} pa
       where pa.session_question_id = ${sq.id}
         and pa.status = 'ACCEPTED'
         and pa.points is not null
      on conflict do nothing
      returning session_participant_id, points, correct_delta, answered_delta, correct_time_ms_delta
    )
    update ${sessionParticipants} sp
       set score = sp.score + ins.points,
           correct_count = sp.correct_count + ins.correct_delta,
           answered_count = sp.answered_count + ins.answered_delta,
           correct_time_ms = sp.correct_time_ms + ins.correct_time_ms_delta
      from ins
     where sp.id = ins.session_participant_id
  `);
  await tx.update(sessionQuestions).set({ scoresPublishedAt: now }).where(eq(sessionQuestions.id, sq.id));
  return true;
}

/** Publica todas as perguntas já calculadas e ainda não publicadas da sessão. */
export async function publishPendingScores(tx: Tx, sessionId: string, now: Date): Promise<string[]> {
  const pending = await tx
    .select()
    .from(sessionQuestions)
    .where(and(eq(sessionQuestions.sessionId, sessionId), isNotNull(sessionQuestions.scoredAt), isNull(sessionQuestions.scoresPublishedAt)));
  const published: string[] = [];
  for (const sq of pending) {
    if (await publishScores(tx, sq, now)) published.push(sq.id);
  }
  return published;
}

/** Ajuste manual auditado (ex.: correção de erro de gabarito). Exige justificativa. */
export async function adjustScore(tx: Tx, actor: Actor, orgId: string, sessionId: string, spId: string, points: number, reason: string) {
  await tx.insert(scoreTransactions).values({
    orgId,
    sessionId,
    sessionParticipantId: spId,
    kind: "ADJUSTMENT",
    points,
    reason,
    createdByUserId: actor.user.id,
  });
  await tx
    .update(sessionParticipants)
    .set({ score: sql`${sessionParticipants.score} + ${points}` })
    .where(eq(sessionParticipants.id, spId));
  await audit(tx, actor, orgId, "score.adjust", "session_participant", spId, { points, reason, sessionId });
}

/** Verificação de consistência: agregados == soma do livro-razão (usado em testes e no relatório). */
export async function ledgerMismatches(tx: Tx, sessionId: string) {
  const rows = await tx.execute(sql`
    select sp.id, sp.score, coalesce(sum(st.points), 0)::int as ledger
      from ${sessionParticipants} sp
      left join ${scoreTransactions} st on st.session_participant_id = sp.id
     where sp.session_id = ${sessionId}
     group by sp.id, sp.score
    having sp.score <> coalesce(sum(st.points), 0)
  `);
  return rowsOf<{ id: string; score: number; ledger: number }>(rows);
}
