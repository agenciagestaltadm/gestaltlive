/** Sessões (execuções ao vivo de um evento): criação, código curto, QR, token do telão. */
import crypto from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import { qc, type Tx } from "../db/client";
import {
  eventSessions,
  events,
  organizations,
  presentationStates,
  questionVersions,
  questions,
  sessionParticipants,
  sessionQuestions,
} from "../db/schema";
import type { Actor } from "../auth/auth";
import { authorize, type Permission } from "../auth/permissions";
import { badRequest, conflict, notFound } from "../lib/errors";
import { randomToken, safeEqual, shortCode } from "../lib/crypto";
import { audit } from "./audit";
import { loadEvent } from "./events";
import { assertPresentationForSession } from "./presentations";
import { eventSettingsSchema, registrationConfigSchema, sessionInputSchema } from "@shared/schemas";
import type { PublicSessionDTO } from "@shared/types";

export type SessionRow = typeof eventSessions.$inferSelect;
export type SessionQuestionRow = typeof sessionQuestions.$inferSelect;

export const JOINABLE_STATUSES = ["AGUARDANDO", "AO_VIVO", "PAUSADA"] as const;
export const ACTIVE_STATUSES = ["AGUARDANDO", "AO_VIVO", "PAUSADA"] as const;

export function baseUrl(ctx: AppContext, origin?: string | null) {
  return ctx.config.publicUrl ?? origin ?? "http://localhost:3000";
}
export function joinUrl(ctx: AppContext, code: string, origin?: string | null) {
  return `${baseUrl(ctx, origin)}/entrar/${code}`;
}

export function screenToken(ctx: AppContext, s: Pick<SessionRow, "id" | "screenTokenNonce">) {
  return crypto.createHmac("sha256", ctx.config.appSecret).update(`screen:${s.id}:${s.screenTokenNonce}`).digest("base64url").slice(0, 32);
}
export function verifyScreenToken(ctx: AppContext, s: Pick<SessionRow, "id" | "screenTokenNonce">, token: string | null | undefined) {
  if (!token) return false;
  return safeEqual(screenToken(ctx, s), token);
}
export function screenUrl(ctx: AppContext, s: SessionRow, origin?: string | null) {
  return `${baseUrl(ctx, origin)}/apresentacao/${s.code}?t=${screenToken(ctx, s)}`;
}

export async function loadSession(ctx: AppContext, actor: Actor, id: string, perm: Permission) {
  const [s] = await ctx.db.select().from(eventSessions).where(eq(eventSessions.id, id));
  if (!s) throw notFound("Sessão não encontrada.");
  authorize(actor, s.orgId, perm);
  return s;
}

export async function sessionByCode(tx: Tx, code: string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(normalized)) return null;
  const [s] = await tx.select().from(eventSessions).where(eq(eventSessions.code, normalized));
  return s ?? null;
}

async function uniqueCode(tx: Tx): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = shortCode(6);
    const [exists] = await tx.select({ id: eventSessions.id }).from(eventSessions).where(eq(eventSessions.code, code));
    if (!exists) return code;
  }
  throw new Error("Não foi possível gerar um código único");
}

/** Sincroniza as perguntas da sessão com as perguntas PRONTAS do evento (apenas as ainda não abertas). */
export async function syncSessionQuestions(tx: Tx, session: SessionRow) {
  const qs = await tx
    .select()
    .from(questions)
    .where(and(eq(questions.eventId, session.eventId), eq(questions.status, "PRONTA")))
    .orderBy(asc(questions.position));
  const existing = await tx.select().from(sessionQuestions).where(eq(sessionQuestions.sessionId, session.id));
  const byQuestion = new Map(existing.map((e) => [e.questionId, e]));
  const readyIds = new Set(qs.map((q) => q.id));
  // remove perguntas nunca abertas que deixaram de estar prontas
  const stale = existing.filter((e) => !readyIds.has(e.questionId) && e.openCount === 0);
  if (stale.length) {
    await tx.delete(sessionQuestions).where(inArray(sessionQuestions.id, stale.map((s) => s.id)));
  }
  for (const [i, q] of qs.entries()) {
    const [ver] = await tx
      .select({ id: questionVersions.id })
      .from(questionVersions)
      .where(and(eq(questionVersions.questionId, q.id), eq(questionVersions.version, q.currentVersion)));
    const cur = byQuestion.get(q.id);
    if (!cur) {
      await tx.insert(sessionQuestions).values({
        orgId: session.orgId,
        sessionId: session.id,
        questionId: q.id,
        versionId: ver.id,
        position: i,
        resultsMode: q.resultsMode,
        timeLimitMs: q.timeLimitSec ? q.timeLimitSec * 1000 : null,
      });
    } else if (cur.openCount === 0) {
      // ainda não aberta: acompanha a versão e as configurações atuais da pergunta
      await tx
        .update(sessionQuestions)
        .set({ versionId: ver.id, position: i, resultsMode: q.resultsMode, timeLimitMs: q.timeLimitSec ? q.timeLimitSec * 1000 : null })
        .where(eq(sessionQuestions.id, cur.id));
    } else {
      await tx.update(sessionQuestions).set({ position: i }).where(eq(sessionQuestions.id, cur.id));
    }
  }
  // perguntas abertas que não estão mais prontas ficam no fim, preservando seus dados
  const orphans = existing.filter((e) => !readyIds.has(e.questionId) && e.openCount > 0);
  for (const [j, o] of orphans.entries()) {
    await tx.update(sessionQuestions).set({ position: qs.length + j }).where(eq(sessionQuestions.id, o.id));
  }
}

export async function createSession(ctx: AppContext, actor: Actor, eventId: string, raw: unknown) {
  const ev = await loadEvent(ctx, actor, eventId, "event.read");
  authorize(actor, ev.orgId, "session.create");
  if (ev.archivedAt) throw badRequest("Evento arquivado. Desarquive para criar novas sessões.");
  const input = sessionInputSchema.parse(raw);
  return ctx.db.transaction(async (tx) => {
    await assertPresentationForSession(tx, input.presentationId ?? null, { orgId: ev.orgId, eventId: ev.id });
    const code = await uniqueCode(tx);
    const [s] = await tx
      .insert(eventSessions)
      .values({
        orgId: ev.orgId,
        eventId: ev.id,
        name: input.name,
        code,
        status: input.scheduledAt ? "AGENDADA" : "RASCUNHO",
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        presentationId: input.presentationId ?? null,
        screenTokenNonce: randomToken(12),
        registration: registrationConfigSchema.parse(ev.registration),
        settings: eventSettingsSchema.parse(ev.settings),
        createdByUserId: actor.user.id,
      })
      .returning();
    await tx.insert(presentationStates).values({ sessionId: s.id, orgId: s.orgId });
    await syncSessionQuestions(tx, s);
    await audit(tx, actor, ev.orgId, "session.create", "session", s.id, { code, name: s.name, eventId });
    return sanitizeSession(s);
  });
}

export async function listSessions(ctx: AppContext, actor: Actor, eventId: string) {
  const ev = await loadEvent(ctx, actor, eventId, "event.read");
  return ctx.db
    .select({
      id: eventSessions.id,
      name: eventSessions.name,
      code: eventSessions.code,
      status: eventSessions.status,
      scheduledAt: eventSessions.scheduledAt,
      startedAt: eventSessions.startedAt,
      endedAt: eventSessions.endedAt,
      finalizedAt: eventSessions.finalizedAt,
      presentationId: eventSessions.presentationId,
      createdAt: eventSessions.createdAt,
      participants: sql<number>`(select count(*)::int from ${sessionParticipants} where ${sessionParticipants.sessionId} = ${qc(eventSessions.id)})`,
    })
    .from(eventSessions)
    .where(eq(eventSessions.eventId, ev.id))
    .orderBy(desc(eventSessions.createdAt));
}

export async function listOrgSessions(ctx: AppContext, actor: Actor, orgId: string, statuses?: string[]) {
  authorize(actor, orgId, "event.read");
  const where = statuses?.length
    ? and(eq(eventSessions.orgId, orgId), inArray(eventSessions.status, statuses as SessionRow["status"][]))
    : eq(eventSessions.orgId, orgId);
  return ctx.db
    .select({
      id: eventSessions.id,
      name: eventSessions.name,
      code: eventSessions.code,
      status: eventSessions.status,
      startedAt: eventSessions.startedAt,
      endedAt: eventSessions.endedAt,
      scheduledAt: eventSessions.scheduledAt,
      createdAt: eventSessions.createdAt,
      eventId: events.id,
      eventTitle: events.title,
      speakerName: events.speakerName,
      speakerUserId: events.speakerUserId,
      participants: sql<number>`(select count(*)::int from ${sessionParticipants} where ${sessionParticipants.sessionId} = ${qc(eventSessions.id)})`,
    })
    .from(eventSessions)
    .innerJoin(events, eq(events.id, eventSessions.eventId))
    .where(where)
    .orderBy(desc(eventSessions.createdAt))
    .limit(500);
}

export async function getSessionAdmin(ctx: AppContext, actor: Actor, id: string, origin?: string | null) {
  const s = await loadSession(ctx, actor, id, "event.read");
  const [ev] = await ctx.db.select().from(events).where(eq(events.id, s.eventId));
  const [pc] = await ctx.db.select({ n: count() }).from(sessionParticipants).where(eq(sessionParticipants.sessionId, id));
  const [qc] = await ctx.db.select({ n: count() }).from(sessionQuestions).where(eq(sessionQuestions.sessionId, id));
  return {
    ...sanitizeSession(s),
    event: { id: ev.id, title: ev.title, speakerName: ev.speakerName },
    participants: pc.n,
    questionCount: qc.n,
    joinUrl: joinUrl(ctx, s.code, origin),
    screenUrl: screenUrl(ctx, s, origin),
  };
}

export async function updateSession(ctx: AppContext, actor: Actor, id: string, raw: unknown) {
  const s = await loadSession(ctx, actor, id, "session.create");
  const input = sessionInputSchema.parse(raw);
  if (input.presentationId !== undefined) await assertPresentationForSession(ctx.db, input.presentationId, s);
  // campos omitidos no corpo mantêm o valor atual (ex.: trocar só a apresentação não apaga o agendamento)
  const hasSchedule = typeof raw === "object" && raw !== null && "scheduledAt" in raw;
  const scheduledAt = hasSchedule ? (input.scheduledAt ? new Date(input.scheduledAt) : null) : s.scheduledAt;
  const status = s.status === "RASCUNHO" || s.status === "AGENDADA" ? (scheduledAt ? "AGENDADA" : "RASCUNHO") : s.status;
  const [u] = await ctx.db
    .update(eventSessions)
    .set({
      name: input.name,
      scheduledAt,
      status,
      ...(input.presentationId !== undefined && { presentationId: input.presentationId }),
      updatedAt: ctx.now(),
    })
    .where(eq(eventSessions.id, id))
    .returning();
  return sanitizeSession(u);
}

export async function deleteSession(ctx: AppContext, actor: Actor, id: string) {
  const s = await loadSession(ctx, actor, id, "session.create");
  const [pc] = await ctx.db.select({ n: count() }).from(sessionParticipants).where(eq(sessionParticipants.sessionId, id));
  if (pc.n > 0) throw conflict("Sessões com participantes não podem ser excluídas (os dados são preservados). Cancele a sessão.", "SESSAO_COM_PARTICIPANTES");
  await ctx.db.transaction(async (tx) => {
    await tx.delete(eventSessions).where(eq(eventSessions.id, id));
    await audit(tx, actor, s.orgId, "session.delete", "session", id, { code: s.code });
  });
}

export async function regenerateScreenToken(ctx: AppContext, actor: Actor, id: string, origin?: string | null) {
  const s = await loadSession(ctx, actor, id, "session.control");
  const [u] = await ctx.db.update(eventSessions).set({ screenTokenNonce: randomToken(12) }).where(eq(eventSessions.id, id)).returning();
  await audit(ctx.db, actor, s.orgId, "session.screen_token", "session", id);
  // telões abertos com o token antigo são desconectados
  ctx.rt.disconnectScreens(id, s.screenTokenNonce);
  return { screenUrl: screenUrl(ctx, u, origin) };
}

export async function publicSessionDTO(tx: Tx, ctx: AppContext, s: SessionRow, origin?: string | null): Promise<PublicSessionDTO> {
  const [ev] = await tx.select().from(events).where(eq(events.id, s.eventId));
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, s.orgId));
  const [qc] = await tx.select({ n: count() }).from(sessionQuestions).where(eq(sessionQuestions.sessionId, s.id));
  const settings = eventSettingsSchema.parse(s.settings);
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    status: s.status,
    startedAt: s.startedAt?.toISOString() ?? null,
    endedAt: s.endedAt?.toISOString() ?? null,
    event: {
      title: ev.title,
      description: ev.description,
      speakerName: ev.speakerName,
      logoUrl: ev.logoUrl ?? org.logoUrl,
      welcomeMessage: ev.welcomeMessage,
      closingMessage: ev.closingMessage,
      location: ev.location,
      startsAt: (s.scheduledAt ?? ev.startsAt)?.toISOString() ?? null,
      theme: ev.theme,
    },
    organization: { name: org.name, logoUrl: org.logoUrl },
    settings: {
      showLeaderboardToParticipants: settings.showLeaderboardToParticipants,
      showPrizesToParticipants: settings.showPrizesToParticipants,
      soundEffects: settings.soundEffects,
    },
    questionCount: qc.n,
    joinUrl: joinUrl(ctx, s.code, origin),
  };
}

export async function sessionQuestionList(tx: Tx, sessionId: string) {
  return tx.select().from(sessionQuestions).where(eq(sessionQuestions.sessionId, sessionId)).orderBy(asc(sessionQuestions.position));
}

/** Remove segredos antes de devolver a sessão pela API (o nonce do telão nunca sai do servidor). */
export function sanitizeSession<T extends { screenTokenNonce?: string }>(s: T): Omit<T, "screenTokenNonce"> {
  const { screenTokenNonce: _nonce, ...rest } = s;
  void _nonce;
  return rest;
}
