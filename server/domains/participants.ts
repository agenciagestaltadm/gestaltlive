/**
 * Cadastro e identidade dos participantes.
 *
 * - Sem senha: o participante recebe um token de participação (aleatório, 256 bits), vinculado à
 *   sessão. Apenas o hash é persistido. O token fica no aparelho (localStorage) e é enviado como
 *   Bearer em toda operação protegida.
 * - Unicidade configurável por sessão (e-mail, WhatsApp, ambos ou nenhum), com identificadores
 *   normalizados e índices únicos parciais no banco.
 * - Um cadastro duplicado NÃO devolve a credencial existente: e-mail e telefone não são verificados,
 *   então isso permitiria assumir a identidade de outra pessoa. A recuperação é feita com um código
 *   de 6 dígitos emitido pela equipe do evento.
 */
import { and, asc, count, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { AppContext } from "../context";
import type { Tx } from "../db/client";
import {
  consentRecords,
  eventSessions,
  participantAnswers,
  participantCustomFields,
  participantCustomValues,
  participants,
  sessionParticipants,
  sessionQuestions,
  questionVersions,
  answerOptionSelections,
} from "../db/schema";
import type { Actor } from "../auth/auth";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../lib/errors";
import { numericCode, randomToken, sha256 } from "../lib/crypto";
import { cleanText, firstName, firstNameInitial, normalizeEmail, normalizePhone } from "../lib/normalize";
import { audit } from "./audit";
import { JOINABLE_STATUSES, loadSession, sessionByCode, type SessionRow } from "./sessions";
import { eventSettingsSchema, joinInputSchema, registrationConfigSchema, type RegistrationConfig } from "@shared/schemas";
import type { QuestionSnapshot } from "./questions";

export type SessionParticipantRow = typeof sessionParticipants.$inferSelect;

export interface ParticipantAuth {
  sp: SessionParticipantRow;
  session: SessionRow;
}

/** Valida o token do participante para a sessão informada. Nunca confia em IDs vindos do cliente. */
export async function participantFromToken(tx: Tx, code: string, token: string | null | undefined): Promise<ParticipantAuth> {
  if (!token || token.length < 20 || token.length > 200) throw unauthorized("Credencial de participação ausente ou inválida.");
  const rows = await tx
    .select({ sp: sessionParticipants, session: eventSessions })
    .from(sessionParticipants)
    .innerJoin(eventSessions, eq(eventSessions.id, sessionParticipants.sessionId))
    .where(eq(sessionParticipants.tokenHash, sha256(token)))
    .limit(1);
  const row = rows[0];
  if (!row || row.session.code !== code.trim().toUpperCase()) throw unauthorized("Credencial de participação inválida para esta sessão.");
  return row;
}

export async function registrationForm(tx: Tx, session: SessionRow) {
  const reg = registrationConfigSchema.parse(session.registration);
  const fields = await tx
    .select()
    .from(participantCustomFields)
    .where(eq(participantCustomFields.eventId, session.eventId))
    .orderBy(asc(participantCustomFields.position));
  return {
    phone: reg.phone,
    email: reg.email,
    uniqueness: reg.uniqueness,
    rankingDisplay: reg.rankingDisplay,
    consentVersion: reg.consentVersion,
    consentParticipationText: reg.consentParticipationText,
    marketingEnabled: reg.marketingEnabled,
    consentMarketingText: reg.consentMarketingText,
    privacyPolicyUrl: reg.privacyPolicyUrl,
    customFields: fields.map((f) => ({ id: f.id, key: f.key, label: f.label, type: f.type, options: f.options, required: f.required })),
  };
}

function computeDisplayName(reg: RegistrationConfig, fullName: string, nickname: string | null): string {
  let name: string;
  if (reg.rankingDisplay === "APELIDO" && nickname) name = cleanText(nickname);
  else if (reg.rankingDisplay === "PRIMEIRO_NOME") name = firstName(fullName);
  else name = firstNameInitial(fullName);
  // nunca expor e-mail ou telefone no ranking público
  if (/@/.test(name) || name.replace(/\D/g, "").length >= 6) {
    name = firstNameInitial(fullName);
  }
  return name.slice(0, 30) || "Participante";
}

export interface JoinMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export async function joinSession(ctx: AppContext, code: string, raw: unknown, meta: JoinMeta) {
  const input = joinInputSchema.parse(raw);
  const session = await sessionByCode(ctx.db, code);
  if (!session) throw notFound("Sessão não encontrada. Confira o código.");
  if (!(JOINABLE_STATUSES as readonly string[]).includes(session.status)) {
    if (session.status === "ENCERRADA") throw conflict("Esta sessão já foi encerrada.", "SESSAO_ENCERRADA");
    if (session.status === "CANCELADA") throw conflict("Esta sessão foi cancelada.", "SESSAO_CANCELADA");
    throw conflict("As inscrições para esta sessão ainda não foram abertas.", "SESSAO_NAO_ABERTA");
  }
  const reg = registrationConfigSchema.parse(session.registration);
  const settings = eventSettingsSchema.parse(session.settings);
  const fullName = cleanText(input.fullName);

  const errors: { path: string; message: string }[] = [];
  const emailNorm = normalizeEmail(input.email);
  const phoneNorm = normalizePhone(input.phone);
  if (reg.email.enabled) {
    if (input.email && !emailNorm) errors.push({ path: "email", message: "E-mail inválido" });
    if (reg.email.required && !input.email) errors.push({ path: "email", message: "Informe seu e-mail" });
  }
  if (reg.phone.enabled) {
    if (input.phone && !phoneNorm) errors.push({ path: "phone", message: "WhatsApp inválido (inclua o DDD)" });
    if (reg.phone.required && !input.phone) errors.push({ path: "phone", message: "Informe seu WhatsApp" });
  }
  const fields = await ctx.db.select().from(participantCustomFields).where(eq(participantCustomFields.eventId, session.eventId));
  const customValues: { fieldId: string; value: string }[] = [];
  for (const f of fields) {
    const v = cleanText(input.custom[f.key] ?? "");
    if (!v) {
      if (f.required) errors.push({ path: `custom.${f.key}`, message: `Informe ${f.label.toLowerCase()}` });
      continue;
    }
    if (f.type === "SELECAO" && !f.options.includes(v)) errors.push({ path: `custom.${f.key}`, message: "Opção inválida" });
    else if (f.type === "NUMERO" && !/^-?\d+([.,]\d+)?$/.test(v)) errors.push({ path: `custom.${f.key}`, message: "Informe um número" });
    else if (f.type === "EMAIL" && !normalizeEmail(v)) errors.push({ path: `custom.${f.key}`, message: "E-mail inválido" });
    else customValues.push({ fieldId: f.id, value: v.slice(0, 500) });
  }
  if (errors.length) throw badRequest("Revise os dados do cadastro.", errors, "VALIDACAO");

  const uniqueEmail = reg.uniqueness === "EMAIL" || reg.uniqueness === "EMAIL_OR_PHONE" ? emailNorm : null;
  const uniquePhone = reg.uniqueness === "PHONE" || reg.uniqueness === "EMAIL_OR_PHONE" ? phoneNorm : null;
  const displayName = computeDisplayName(reg, fullName, input.displayName);
  const token = randomToken(32);

  const result = await ctx.db.transaction(async (tx) => {
    const [pc] = await tx.select({ n: count() }).from(sessionParticipants).where(eq(sessionParticipants.sessionId, session.id));
    if (pc.n >= settings.maxParticipants) throw conflict("A sessão atingiu o limite de participantes.", "SESSAO_LOTADA");

    // vínculo com a pessoa no CRM da organização (dados autodeclarados, não verificados)
    let person: typeof participants.$inferSelect | undefined;
    if (emailNorm) {
      [person] = await tx
        .select()
        .from(participants)
        .where(and(eq(participants.orgId, session.orgId), eq(participants.emailNorm, emailNorm), isNull(participants.anonymizedAt)))
        .orderBy(desc(participants.updatedAt))
        .limit(1);
    }
    if (!person && phoneNorm) {
      [person] = await tx
        .select()
        .from(participants)
        .where(and(eq(participants.orgId, session.orgId), eq(participants.phoneNorm, phoneNorm), isNull(participants.anonymizedAt)))
        .orderBy(desc(participants.updatedAt))
        .limit(1);
    }
    if (person) {
      [person] = await tx
        .update(participants)
        .set({
          fullName,
          email: input.email ?? person.email,
          emailNorm: emailNorm ?? person.emailNorm,
          phone: input.phone ?? person.phone,
          phoneNorm: phoneNorm ?? person.phoneNorm,
          updatedAt: ctx.now(),
        })
        .where(eq(participants.id, person.id))
        .returning();
    } else {
      [person] = await tx
        .insert(participants)
        .values({ orgId: session.orgId, fullName, email: input.email, emailNorm, phone: input.phone, phoneNorm })
        .returning();
    }

    const inserted = await tx
      .insert(sessionParticipants)
      .values({
        orgId: session.orgId,
        sessionId: session.id,
        participantId: person.id,
        displayName,
        tokenHash: sha256(token),
        uniqueEmail,
        uniquePhone,
        joinedAt: ctx.now(),
        lastSeenAt: ctx.now(),
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) {
      throw conflict(
        "Já existe uma inscrição nesta sessão com este e-mail ou WhatsApp. Se foi você em outro aparelho, peça à equipe do evento um código de recuperação.",
        "JA_INSCRITO",
      );
    }
    const sp = inserted[0];
    if (customValues.length) {
      await tx.insert(participantCustomValues).values(customValues.map((c) => ({ ...c, orgId: session.orgId, sessionParticipantId: sp.id })));
    }
    await tx.insert(consentRecords).values({
      orgId: session.orgId,
      participantId: person.id,
      sessionParticipantId: sp.id,
      purpose: "PARTICIPACAO",
      granted: true,
      textVersion: reg.consentVersion,
      textSnapshot: reg.consentParticipationText,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    });
    if (reg.marketingEnabled) {
      await tx.insert(consentRecords).values({
        orgId: session.orgId,
        participantId: person.id,
        sessionParticipantId: sp.id,
        purpose: "MARKETING",
        granted: input.consentMarketing,
        textVersion: reg.consentVersion,
        textSnapshot: reg.consentMarketingText,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      });
    }
    return sp;
  });

  ctx.rt.participantJoined(session.id, { id: result.id, displayName: result.displayName });
  return { token, sessionParticipantId: result.id, displayName: result.displayName, sessionId: session.id, code: session.code };
}

/* ------------------------------------------------------------------ recuperação de acesso */
export async function issueRecoveryCode(ctx: AppContext, actor: Actor, sessionId: string, spId: string) {
  const s = await loadSession(ctx, actor, sessionId, "session.control");
  const [sp] = await ctx.db
    .select()
    .from(sessionParticipants)
    .where(and(eq(sessionParticipants.id, spId), eq(sessionParticipants.sessionId, s.id)));
  if (!sp) throw notFound("Participante não encontrado.");
  const code = numericCode(6);
  const expiresAt = new Date(ctx.now().getTime() + 15 * 60_000);
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(sessionParticipants)
      .set({ recoveryCodeHash: sha256(`${s.id}:${code}`), recoveryCodeExpiresAt: expiresAt })
      .where(eq(sessionParticipants.id, spId));
    await audit(tx, actor, s.orgId, "participant.recovery_code", "session_participant", spId, {});
  });
  return { code, expiresAt };
}

/** Troca o código de recuperação por uma nova credencial (a anterior é invalidada). */
export async function recoverAccess(ctx: AppContext, code: string, recoveryCode: string) {
  const session = await sessionByCode(ctx.db, code);
  if (!session) throw notFound("Sessão não encontrada.");
  if (!/^\d{6}$/.test(recoveryCode)) throw badRequest("Código de recuperação inválido.");
  const [sp] = await ctx.db
    .select()
    .from(sessionParticipants)
    .where(
      and(
        eq(sessionParticipants.sessionId, session.id),
        eq(sessionParticipants.recoveryCodeHash, sha256(`${session.id}:${recoveryCode}`)),
        gt(sessionParticipants.recoveryCodeExpiresAt, ctx.now()),
      ),
    );
  if (!sp) throw badRequest("Código de recuperação inválido ou expirado.", undefined, "CODIGO_INVALIDO");
  const token = randomToken(32);
  await ctx.db
    .update(sessionParticipants)
    .set({ tokenHash: sha256(token), recoveryCodeHash: null, recoveryCodeExpiresAt: null })
    .where(eq(sessionParticipants.id, sp.id));
  ctx.rt.disconnectParticipant(sp.id);
  return { token, sessionParticipantId: sp.id, displayName: sp.displayName, sessionId: session.id, code: session.code };
}

/* ------------------------------------------------------------------ perfil do participante */
export async function participantProfile(ctx: AppContext, auth: ParticipantAuth) {
  const [person] = await ctx.db.select().from(participants).where(eq(participants.id, auth.sp.participantId));
  const values = await ctx.db
    .select({ key: participantCustomFields.key, label: participantCustomFields.label, value: participantCustomValues.value })
    .from(participantCustomValues)
    .innerJoin(participantCustomFields, eq(participantCustomFields.id, participantCustomValues.fieldId))
    .where(eq(participantCustomValues.sessionParticipantId, auth.sp.id));
  const marketing = await currentConsent(ctx.db, person.id, "MARKETING");
  const reg = registrationConfigSchema.parse(auth.session.registration);
  return {
    displayName: auth.sp.displayName,
    fullName: person.fullName,
    email: person.email,
    phone: person.phone,
    custom: values,
    canEditDisplayName: reg.rankingDisplay === "APELIDO",
    marketingEnabled: reg.marketingEnabled,
    marketingConsent: marketing?.granted ?? false,
    consentMarketingText: reg.consentMarketingText,
    joinedAt: auth.sp.joinedAt,
  };
}

export async function updateDisplayName(ctx: AppContext, auth: ParticipantAuth, displayName: string) {
  const reg = registrationConfigSchema.parse(auth.session.registration);
  if (reg.rankingDisplay !== "APELIDO") throw forbidden("Este evento não permite apelidos no ranking.");
  const [person] = await ctx.db.select().from(participants).where(eq(participants.id, auth.sp.participantId));
  const name = computeDisplayName(reg, person.fullName, displayName);
  await ctx.db.update(sessionParticipants).set({ displayName: name }).where(eq(sessionParticipants.id, auth.sp.id));
  ctx.rt.leaderboardDirty(auth.session.id);
  return { displayName: name };
}

export async function currentConsent(tx: Tx, participantId: string, purpose: "PARTICIPACAO" | "MARKETING") {
  const [c] = await tx
    .select()
    .from(consentRecords)
    .where(and(eq(consentRecords.participantId, participantId), eq(consentRecords.purpose, purpose)))
    .orderBy(desc(consentRecords.createdAt))
    .limit(1);
  return c ?? null;
}

/** Concede ou revoga o consentimento de marketing (registro append-only). */
export async function setMarketingConsent(
  ctx: AppContext,
  participantId: string,
  orgId: string,
  granted: boolean,
  source: string,
  text: { version: string; snapshot: string },
  meta: JoinMeta = {},
  spId: string | null = null,
) {
  await ctx.db.insert(consentRecords).values({
    orgId,
    participantId,
    sessionParticipantId: spId,
    purpose: "MARKETING",
    granted,
    textVersion: text.version,
    textSnapshot: text.snapshot,
    source,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
}

/** Histórico individual: respostas do participante, com correção apenas após a revelação. */
export async function participantHistory(ctx: AppContext, auth: ParticipantAuth) {
  const rows = await ctx.db
    .select({
      answerId: participantAnswers.id,
      sessionQuestionId: participantAnswers.sessionQuestionId,
      receivedAt: participantAnswers.receivedAt,
      numericValue: participantAnswers.numericValue,
      isCorrect: participantAnswers.isCorrect,
      points: participantAnswers.points,
      position: sessionQuestions.position,
      correctRevealedAt: sessionQuestions.correctRevealedAt,
      scoresPublishedAt: sessionQuestions.scoresPublishedAt,
      snapshot: questionVersions.snapshot,
    })
    .from(participantAnswers)
    .innerJoin(sessionQuestions, eq(sessionQuestions.id, participantAnswers.sessionQuestionId))
    .innerJoin(questionVersions, eq(questionVersions.id, sessionQuestions.versionId))
    .where(and(eq(participantAnswers.sessionParticipantId, auth.sp.id), eq(participantAnswers.status, "ACCEPTED")))
    .orderBy(asc(sessionQuestions.position));
  const ids = rows.map((r) => r.answerId);
  const sels = ids.length
    ? await ctx.db.select().from(answerOptionSelections).where(inArray(answerOptionSelections.answerId, ids))
    : [];
  return rows.map((r) => {
    const snap = r.snapshot as QuestionSnapshot;
    const selected = sels.filter((s) => s.answerId === r.answerId).map((s) => s.optionId);
    const visible = !!(r.correctRevealedAt || r.scoresPublishedAt);
    return {
      sessionQuestionId: r.sessionQuestionId,
      position: r.position,
      title: snap.title,
      type: snap.type,
      answer: snap.type === "ESCALA" || snap.type === "NPS" ? String(r.numericValue) : snap.options.filter((o) => selected.includes(o.id)).map((o) => o.label).join(", "),
      scored: !!snap.scoring,
      isCorrect: visible ? r.isCorrect : null,
      points: visible ? r.points : null,
      correctAnswer: r.correctRevealedAt ? snap.options.filter((o) => o.isCorrect).map((o) => o.label).join(", ") : null,
      explanation: r.correctRevealedAt ? snap.explanation : null,
      receivedAt: r.receivedAt,
    };
  });
}

export async function totalAnswered(tx: Tx, spId: string) {
  const [r] = await tx
    .select({ n: count() })
    .from(participantAnswers)
    .where(and(eq(participantAnswers.sessionParticipantId, spId), eq(participantAnswers.status, "ACCEPTED")));
  return r.n;
}
