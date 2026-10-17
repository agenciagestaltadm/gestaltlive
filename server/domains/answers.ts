/**
 * Submissão de respostas — idempotente e à prova de concorrência.
 *
 * Garantias:
 * 1. A pergunta é travada com FOR SHARE; o fechamento usa FOR UPDATE. Uma resposta concorrente ao
 *    fechamento ou entra antes (e é pontuada) ou vê a pergunta FECHADA e é rejeitada.
 * 2. Prazo verificado com o relógio do servidor (tempo efetivo do cronômetro, descontando pausas).
 * 3. No máximo uma resposta ACEITA por participante e pergunta (índice único parcial).
 * 4. Reenvio com a mesma chave de idempotência devolve o mesmo resultado (sem duplicar).
 *    Reenvio idêntico com outra chave também é tratado como duplicata.
 * 5. Pontuação NÃO é calculada aqui: é calculada no fechamento, apenas no servidor.
 */
import { and, eq } from "drizzle-orm";
import type { AppContext } from "../context";
import type { Tx } from "../db/client";
import { answerOptionSelections, eventSessions, participantAnswers, sessionParticipants, sessionQuestions } from "../db/schema";
import { AppError, badRequest, conflict } from "../lib/errors";
import { answerInputSchema } from "@shared/schemas";
import { elapsedMs } from "@shared/scoring";
import type { ParticipantAuth } from "./participants";
import { getSnapshot } from "./snapshots";

export type AnswerOutcome = "ACEITA" | "DUPLICADA" | "ATUALIZADA";

export interface SubmitResult {
  outcome: AnswerOutcome;
  answerId: string;
  sessionQuestionId: string;
  optionIds: string[];
  value: number | null;
  revision: number;
  receivedAt: string;
  responseTimeMs: number;
}

const reject = (code: string, message: string, status = 409) => new AppError(status, code, message);

async function selectionsOf(tx: Tx, answerId: string) {
  const rows = await tx.select({ optionId: answerOptionSelections.optionId }).from(answerOptionSelections).where(eq(answerOptionSelections.answerId, answerId));
  return rows.map((r) => r.optionId).sort();
}

function sameAnswer(aOpts: string[], aVal: number | null, bOpts: string[], bVal: number | null) {
  return aVal === bVal && aOpts.length === bOpts.length && [...aOpts].sort().every((v, i) => v === [...bOpts].sort()[i]);
}

export async function submitAnswer(ctx: AppContext, auth: ParticipantAuth, raw: unknown): Promise<SubmitResult> {
  const input = answerInputSchema.parse(raw);
  const optionIds = [...new Set(input.optionIds)];

  const run = () =>
    ctx.db.transaction(async (tx) => {
      const now = ctx.now();
      // idempotência: mesma chave → mesmo resultado
      const [byKey] = await tx
        .select()
        .from(participantAnswers)
        .where(and(eq(participantAnswers.sessionParticipantId, auth.sp.id), eq(participantAnswers.idempotencyKey, input.idempotencyKey)));
      if (byKey) {
        if (byKey.sessionQuestionId !== input.sessionQuestionId) throw badRequest("Chave de idempotência reutilizada em outra pergunta.");
        return { result: await toResult(tx, byKey, "DUPLICADA"), changed: false };
      }

      const [sq] = await tx.select().from(sessionQuestions).where(eq(sessionQuestions.id, input.sessionQuestionId)).for("share");
      // a pergunta precisa pertencer à MESMA sessão da credencial (impede respostas cruzadas entre sessões)
      if (!sq || sq.sessionId !== auth.session.id) throw reject("PERGUNTA_INVALIDA", "Pergunta não encontrada nesta sessão.", 404);
      const [session] = await tx.select({ status: eventSessions.status }).from(eventSessions).where(eq(eventSessions.id, sq.sessionId));
      const [sp] = await tx.select({ disqualifiedAt: sessionParticipants.disqualifiedAt }).from(sessionParticipants).where(eq(sessionParticipants.id, auth.sp.id));
      if (session.status !== "AO_VIVO") throw reject("SESSAO_NAO_ATIVA", session.status === "PAUSADA" ? "A sessão está pausada." : "A sessão não está ao vivo.");
      if (sp.disqualifiedAt) throw reject("PARTICIPACAO_SUSPENSA", "Sua participação foi suspensa pela organização.", 403);
      if (sq.state !== "ABERTA") throw reject("PERGUNTA_FECHADA", "Esta pergunta não está aceitando respostas.");
      const elapsed = elapsedMs({ limitMs: sq.timeLimitMs, accumulatedMs: sq.timerAccumulatedMs, runningSince: sq.timerRunningSince }, now);
      if (sq.timeLimitMs !== null && elapsed > sq.timeLimitMs) throw reject("TEMPO_ESGOTADO", "O tempo para responder terminou.");

      const snap = await getSnapshot(tx, sq.versionId);
      const numeric = snap.type === "ESCALA" || snap.type === "NPS";
      let value: number | null = null;
      if (numeric) {
        if (optionIds.length) throw badRequest("Esta pergunta não usa alternativas.");
        if (input.value === null || input.value < (snap.scaleMin ?? 0) || input.value > (snap.scaleMax ?? 10)) {
          throw badRequest(`Escolha um valor entre ${snap.scaleMin} e ${snap.scaleMax}.`);
        }
        value = input.value;
      } else {
        const valid = new Set(snap.options.map((o) => o.id));
        if (!optionIds.every((id) => valid.has(id))) throw badRequest("Alternativa inválida.");
        if (optionIds.length < snap.minSelections) {
          throw badRequest(snap.minSelections === 1 ? "Selecione uma alternativa." : `Selecione pelo menos ${snap.minSelections} alternativas.`);
        }
        if (optionIds.length > snap.maxSelections) {
          throw badRequest(snap.maxSelections === 1 ? "Selecione apenas uma alternativa." : `Selecione no máximo ${snap.maxSelections} alternativas.`);
        }
      }

      const [current] = await tx
        .select()
        .from(participantAnswers)
        .where(
          and(
            eq(participantAnswers.sessionQuestionId, sq.id),
            eq(participantAnswers.sessionParticipantId, auth.sp.id),
            eq(participantAnswers.status, "ACCEPTED"),
          ),
        )
        .for("update");
      let revision = 1;
      if (current) {
        const curOpts = await selectionsOf(tx, current.id);
        if (sameAnswer(curOpts, current.numericValue, optionIds, value)) {
          return { result: await toResult(tx, current, "DUPLICADA"), changed: false };
        }
        if (!snap.allowEdit) throw reject("JA_RESPONDIDA", "Você já respondeu esta pergunta.");
        await tx.update(participantAnswers).set({ status: "SUPERSEDED" }).where(eq(participantAnswers.id, current.id));
        revision = current.revision + 1;
      }

      const inserted = await tx
        .insert(participantAnswers)
        .values({
          orgId: auth.session.orgId,
          sessionId: auth.session.id,
          sessionQuestionId: sq.id,
          sessionParticipantId: auth.sp.id,
          idempotencyKey: input.idempotencyKey,
          status: "ACCEPTED",
          revision,
          numericValue: value,
          receivedAt: now,
          responseTimeMs: Math.round(elapsed),
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) return null; // corrida com outra requisição do mesmo participante
      const ans = inserted[0];
      if (optionIds.length) await tx.insert(answerOptionSelections).values(optionIds.map((optionId) => ({ answerId: ans.id, optionId })));
      return { result: await toResult(tx, ans, current ? "ATUALIZADA" : "ACEITA"), changed: true };
    });

  let out = await run();
  if (out === null) {
    // outra requisição concorrente venceu: devolve a resposta vigente (idempotente)
    const [existing] = await ctx.db
      .select()
      .from(participantAnswers)
      .where(
        and(
          eq(participantAnswers.sessionQuestionId, input.sessionQuestionId),
          eq(participantAnswers.sessionParticipantId, auth.sp.id),
          eq(participantAnswers.status, "ACCEPTED"),
        ),
      );
    if (!existing) throw conflict("Não foi possível registrar a resposta. Tente novamente.", "CONCORRENCIA");
    const [byKey] = await ctx.db
      .select()
      .from(participantAnswers)
      .where(and(eq(participantAnswers.sessionParticipantId, auth.sp.id), eq(participantAnswers.idempotencyKey, input.idempotencyKey)));
    out = { result: await toResult(ctx.db, byKey ?? existing, "DUPLICADA"), changed: false };
  }
  if (out.changed) ctx.rt.resultsDirty(auth.session.id, input.sessionQuestionId);
  return out.result;
}

async function toResult(tx: Tx, a: typeof participantAnswers.$inferSelect, outcome: AnswerOutcome): Promise<SubmitResult> {
  return {
    outcome,
    answerId: a.id,
    sessionQuestionId: a.sessionQuestionId,
    optionIds: await selectionsOf(tx, a.id),
    value: a.numericValue,
    revision: a.revision,
    receivedAt: a.receivedAt.toISOString(),
    responseTimeMs: a.responseTimeMs,
  };
}

export async function myAnswerFor(tx: Tx, spId: string, sqId: string) {
  const [a] = await tx
    .select()
    .from(participantAnswers)
    .where(and(eq(participantAnswers.sessionQuestionId, sqId), eq(participantAnswers.sessionParticipantId, spId), eq(participantAnswers.status, "ACCEPTED")));
  if (!a) return null;
  return { answer: a, optionIds: await selectionsOf(tx, a.id) };
}
