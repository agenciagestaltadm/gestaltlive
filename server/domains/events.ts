/** Eventos, campos de cadastro, prêmios e templates de treinamento. */
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import { qc, type Tx } from "../db/client";
import {
  eventPrizes,
  eventSessions,
  events,
  organizationMembers,
  participantCustomFields,
  participantCustomValues,
  questions,
  trainingTemplates,
  users,
} from "../db/schema";
import type { Actor } from "../auth/auth";
import { authorize } from "../auth/permissions";
import { badRequest, conflict, notFound } from "../lib/errors";
import { audit } from "./audit";
import { copyEventQuestions, exportQuestionnaire, importQuestionsInto } from "./questions";
import { copyPresentationsForEvent } from "./presentations";
import {
  customFieldInputSchema,
  eventInputSchema,
  eventSettingsSchema,
  prizeInputSchema,
  registrationConfigSchema,
  type EventInput,
  type CustomFieldInput,
} from "@shared/schemas";
import { z } from "zod";

export type EventRow = typeof events.$inferSelect;

export async function loadEvent(ctx: AppContext | { db: Tx }, actor: Actor, id: string, perm: "event.read" | "event.write") {
  const [ev] = await ctx.db.select().from(events).where(eq(events.id, id));
  if (!ev) throw notFound("Evento não encontrado.");
  authorize(actor, ev.orgId, perm);
  return ev;
}

async function validateSpeaker(tx: Tx, orgId: string, speakerUserId: string | null) {
  if (!speakerUserId) return;
  const [m] = await tx
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, speakerUserId)))
    .limit(1);
  if (!m) throw badRequest("O palestrante precisa ser membro da organização.");
}

export async function listEvents(ctx: AppContext, actor: Actor, orgId: string, opts: { archived?: boolean } = {}) {
  authorize(actor, orgId, "event.read");
  const rows = await ctx.db
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      startsAt: events.startsAt,
      location: events.location,
      speakerName: events.speakerName,
      speakerUserId: events.speakerUserId,
      logoUrl: events.logoUrl,
      archivedAt: events.archivedAt,
      createdAt: events.createdAt,
      updatedAt: events.updatedAt,
      questionCount: sql<number>`(select count(*)::int from ${questions} where ${questions.eventId} = ${qc(events.id)})`,
      sessionCount: sql<number>`(select count(*)::int from ${eventSessions} where ${eventSessions.eventId} = ${qc(events.id)})`,
      liveCount: sql<number>`(select count(*)::int from ${eventSessions} where ${eventSessions.eventId} = ${qc(events.id)} and ${eventSessions.status} in ('AO_VIVO','PAUSADA','AGUARDANDO'))`,
    })
    .from(events)
    .where(and(eq(events.orgId, orgId), opts.archived ? sql`${events.archivedAt} is not null` : isNull(events.archivedAt)))
    .orderBy(desc(events.createdAt));
  return rows;
}

export async function getEvent(ctx: AppContext, actor: Actor, id: string) {
  const ev = await loadEvent(ctx, actor, id, "event.read");
  const customFields = await ctx.db
    .select()
    .from(participantCustomFields)
    .where(eq(participantCustomFields.eventId, id))
    .orderBy(asc(participantCustomFields.position));
  const prizes = await ctx.db.select().from(eventPrizes).where(eq(eventPrizes.eventId, id)).orderBy(asc(eventPrizes.rank));
  const [qc] = await ctx.db.select({ n: count() }).from(questions).where(eq(questions.eventId, id));
  let speaker: { id: string; name: string } | null = null;
  if (ev.speakerUserId) {
    const [u] = await ctx.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, ev.speakerUserId));
    speaker = u ?? null;
  }
  return { ...ev, customFields, prizes, questionCount: qc.n, speaker };
}

export async function createEvent(ctx: AppContext, actor: Actor, orgId: string, raw: unknown) {
  authorize(actor, orgId, "event.write");
  const input = eventInputSchema.parse(raw);
  return ctx.db.transaction(async (tx) => {
    await validateSpeaker(tx, orgId, input.speakerUserId);
    const [ev] = await tx
      .insert(events)
      .values({ ...eventValues(input), orgId, createdByUserId: actor.user.id })
      .returning();
    await audit(tx, actor, orgId, "event.create", "event", ev.id, { title: ev.title });
    return ev;
  });
}

function eventValues(input: EventInput) {
  return {
    title: input.title,
    description: input.description,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    location: input.location,
    speakerUserId: input.speakerUserId,
    speakerName: input.speakerName,
    logoUrl: input.logoUrl,
    welcomeMessage: input.welcomeMessage,
    closingMessage: input.closingMessage,
    theme: input.theme,
    registration: input.registration,
    settings: input.settings,
  };
}

export async function updateEvent(ctx: AppContext, actor: Actor, id: string, raw: unknown) {
  const ev = await loadEvent(ctx, actor, id, "event.write");
  const input = eventInputSchema.parse(raw);
  return ctx.db.transaction(async (tx) => {
    await validateSpeaker(tx, ev.orgId, input.speakerUserId);
    const prevReg = registrationConfigSchema.parse(ev.registration);
    const reg = input.registration;
    // mudança no texto de consentimento sem mudança de versão → incrementa automaticamente
    if (
      (prevReg.consentParticipationText !== reg.consentParticipationText || prevReg.consentMarketingText !== reg.consentMarketingText) &&
      prevReg.consentVersion === reg.consentVersion
    ) {
      reg.consentVersion = bumpVersion(prevReg.consentVersion);
    }
    const [updated] = await tx
      .update(events)
      .set({ ...eventValues({ ...input, registration: reg }), updatedAt: ctx.now() })
      .where(eq(events.id, id))
      .returning();
    // sessões ainda não iniciadas herdam a configuração atualizada
    await tx
      .update(eventSessions)
      .set({ registration: reg, settings: input.settings, updatedAt: ctx.now() })
      .where(and(eq(eventSessions.eventId, id), inArray(eventSessions.status, ["RASCUNHO", "AGENDADA"])));
    await audit(tx, actor, ev.orgId, "event.update", "event", id, { title: updated.title });
    return updated;
  });
}

function bumpVersion(v: string) {
  const m = v.match(/^(\d+)\.(\d+)$/);
  if (m) return `${m[1]}.${Number(m[2]) + 1}`;
  return `${v}.1`;
}

export async function setEventArchived(ctx: AppContext, actor: Actor, id: string, archived: boolean) {
  const ev = await loadEvent(ctx, actor, id, "event.write");
  await ctx.db.transaction(async (tx) => {
    await tx.update(events).set({ archivedAt: archived ? ctx.now() : null, updatedAt: ctx.now() }).where(eq(events.id, id));
    await audit(tx, actor, ev.orgId, archived ? "event.archive" : "event.unarchive", "event", id);
  });
}

export async function deleteEvent(ctx: AppContext, actor: Actor, id: string) {
  const ev = await loadEvent(ctx, actor, id, "event.write");
  const [s] = await ctx.db.select({ n: count() }).from(eventSessions).where(eq(eventSessions.eventId, id));
  if (s.n > 0) throw conflict("Eventos com sessões não podem ser excluídos (os dados são preservados). Arquive o evento.", "EVENTO_COM_SESSOES");
  await ctx.db.transaction(async (tx) => {
    await tx.delete(events).where(eq(events.id, id));
    await audit(tx, actor, ev.orgId, "event.delete", "event", id, { title: ev.title });
  });
}

export async function duplicateEvent(ctx: AppContext, actor: Actor, id: string) {
  const ev = await loadEvent(ctx, actor, id, "event.write");
  return ctx.db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(events)
      .values({
        orgId: ev.orgId,
        title: `${ev.title} (cópia)`.slice(0, 160),
        description: ev.description,
        startsAt: null,
        location: ev.location,
        speakerUserId: ev.speakerUserId,
        speakerName: ev.speakerName,
        logoUrl: ev.logoUrl,
        welcomeMessage: ev.welcomeMessage,
        closingMessage: ev.closingMessage,
        theme: ev.theme,
        registration: ev.registration,
        settings: ev.settings,
        templateId: ev.templateId,
        createdByUserId: actor.user.id,
      })
      .returning();
    const questionMap = await copyEventQuestions(tx, ev.id, copy.id, ev.orgId);
    await copyPresentationsForEvent(tx, ev.id, copy.id, ev.orgId, questionMap, actor.user.id);
    const prizes = await tx.select().from(eventPrizes).where(eq(eventPrizes.eventId, ev.id));
    if (prizes.length) {
      await tx.insert(eventPrizes).values(
        prizes.map((p) => ({
          orgId: p.orgId,
          eventId: copy.id,
          rank: p.rank,
          name: p.name,
          description: p.description,
          imageUrl: p.imageUrl,
          estimatedValueCents: p.estimatedValueCents,
          eligibility: p.eligibility,
          pickupInfo: p.pickupInfo,
        })),
      );
    }
    const fields = await tx.select().from(participantCustomFields).where(eq(participantCustomFields.eventId, ev.id));
    if (fields.length) {
      await tx.insert(participantCustomFields).values(
        fields.map((f) => ({ orgId: f.orgId, eventId: copy.id, key: f.key, label: f.label, type: f.type, options: f.options, required: f.required, position: f.position })),
      );
    }
    await audit(tx, actor, ev.orgId, "event.duplicate", "event", copy.id, { from: ev.id });
    return copy;
  });
}

/* ------------------------------------------------------------------ campos de cadastro */
export async function setCustomFields(ctx: AppContext, actor: Actor, eventId: string, raw: unknown) {
  const ev = await loadEvent(ctx, actor, eventId, "event.write");
  const fields = z.array(customFieldInputSchema).max(30).parse(raw);
  const keys = new Set<string>();
  for (const f of fields) {
    if (keys.has(f.key)) throw badRequest(`Campo duplicado: ${f.key}`);
    keys.add(f.key);
  }
  return ctx.db.transaction(async (tx) => {
    const current = await tx.select().from(participantCustomFields).where(eq(participantCustomFields.eventId, eventId));
    const removed = current.filter((c) => !keys.has(c.key));
    if (removed.length) {
      const [used] = await tx
        .select({ n: count() })
        .from(participantCustomValues)
        .where(inArray(participantCustomValues.fieldId, removed.map((r) => r.id)));
      if (used.n > 0) {
        throw conflict(
          `Os campos ${removed.map((r) => r.label).join(", ")} já possuem respostas e não podem ser removidos.`,
          "CAMPO_EM_USO",
        );
      }
      await tx.delete(participantCustomFields).where(inArray(participantCustomFields.id, removed.map((r) => r.id)));
    }
    for (const [i, f] of fields.entries()) {
      const existing = current.find((c) => c.key === f.key);
      if (existing) {
        await tx
          .update(participantCustomFields)
          .set({ label: f.label, type: f.type, options: f.options, required: f.required, position: i })
          .where(eq(participantCustomFields.id, existing.id));
      } else {
        await tx.insert(participantCustomFields).values({ orgId: ev.orgId, eventId, key: f.key, label: f.label, type: f.type, options: f.options, required: f.required, position: i });
      }
    }
    await audit(tx, actor, ev.orgId, "event.custom_fields", "event", eventId, { keys: [...keys] });
    return tx.select().from(participantCustomFields).where(eq(participantCustomFields.eventId, eventId)).orderBy(asc(participantCustomFields.position));
  });
}

/* ------------------------------------------------------------------ prêmios */
export async function listPrizes(ctx: AppContext, actor: Actor, eventId: string) {
  await loadEvent(ctx, actor, eventId, "event.read");
  return ctx.db.select().from(eventPrizes).where(eq(eventPrizes.eventId, eventId)).orderBy(asc(eventPrizes.rank));
}

/** Define os prêmios do 1º, 2º e 3º lugares (substitui a lista). */
export async function setPrizes(ctx: AppContext, actor: Actor, eventId: string, raw: unknown) {
  const ev = await loadEvent(ctx, actor, eventId, "event.write");
  const prizes = z.array(prizeInputSchema).max(3).parse(raw);
  const ranks = new Set(prizes.map((p) => p.rank));
  if (ranks.size !== prizes.length) throw badRequest("Cada colocação pode ter apenas um prêmio.");
  return ctx.db.transaction(async (tx) => {
    const current = await tx.select().from(eventPrizes).where(eq(eventPrizes.eventId, eventId));
    for (const c of current) if (!ranks.has(c.rank)) await tx.delete(eventPrizes).where(eq(eventPrizes.id, c.id));
    for (const p of prizes) {
      const existing = current.find((c) => c.rank === p.rank);
      const values = {
        name: p.name,
        description: p.description,
        imageUrl: p.imageUrl,
        estimatedValueCents: p.estimatedValueCents,
        eligibility: p.eligibility,
        pickupInfo: p.pickupInfo,
        updatedAt: ctx.now(),
      };
      if (existing) await tx.update(eventPrizes).set(values).where(eq(eventPrizes.id, existing.id));
      else await tx.insert(eventPrizes).values({ ...values, orgId: ev.orgId, eventId, rank: p.rank });
    }
    await audit(tx, actor, ev.orgId, "event.prizes", "event", eventId, { ranks: [...ranks] });
    return tx.select().from(eventPrizes).where(eq(eventPrizes.eventId, eventId)).orderBy(asc(eventPrizes.rank));
  });
}

/* ------------------------------------------------------------------ templates */
export async function listTemplates(ctx: AppContext, actor: Actor, orgId: string) {
  authorize(actor, orgId, "event.read");
  const rows = await ctx.db
    .select()
    .from(trainingTemplates)
    .where(eq(trainingTemplates.orgId, orgId))
    .orderBy(desc(trainingTemplates.createdAt));
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    questionCount: Array.isArray((t.content as { questions?: unknown[] }).questions) ? (t.content as { questions: unknown[] }).questions.length : 0,
    createdAt: t.createdAt,
  }));
}

export async function saveEventAsTemplate(ctx: AppContext, actor: Actor, eventId: string, name: string, description: string | null) {
  const ev = await loadEvent(ctx, actor, eventId, "event.write");
  return ctx.db.transaction(async (tx) => {
    const content = await exportQuestionnaire(tx, eventId, name, description);
    const fields = await tx.select().from(participantCustomFields).where(eq(participantCustomFields.eventId, eventId)).orderBy(asc(participantCustomFields.position));
    const full = {
      ...content,
      registration: registrationConfigSchema.parse(ev.registration),
      settings: eventSettingsSchema.parse(ev.settings),
      customFields: fields.map((f): CustomFieldInput => ({ key: f.key, label: f.label, type: f.type, options: f.options, required: f.required })),
    };
    const [t] = await tx
      .insert(trainingTemplates)
      .values({ orgId: ev.orgId, name, description, content: full, createdByUserId: actor.user.id })
      .returning();
    await tx.update(events).set({ templateId: t.id }).where(eq(events.id, eventId));
    await audit(tx, actor, ev.orgId, "template.create", "template", t.id, { fromEvent: eventId });
    return t;
  });
}

export async function getTemplate(ctx: AppContext, actor: Actor, id: string) {
  const [t] = await ctx.db.select().from(trainingTemplates).where(eq(trainingTemplates.id, id));
  if (!t) throw notFound("Template não encontrado.");
  authorize(actor, t.orgId, "event.read");
  return t;
}

export async function deleteTemplate(ctx: AppContext, actor: Actor, id: string) {
  const t = await getTemplate(ctx, actor, id);
  authorize(actor, t.orgId, "event.write");
  await ctx.db.transaction(async (tx) => {
    await tx.update(events).set({ templateId: null }).where(eq(events.templateId, id));
    await tx.delete(trainingTemplates).where(eq(trainingTemplates.id, id));
    await audit(tx, actor, t.orgId, "template.delete", "template", id, { name: t.name });
  });
}

export async function importTemplate(ctx: AppContext, actor: Actor, orgId: string, data: unknown) {
  authorize(actor, orgId, "event.write");
  const { questionnaireExportSchema } = await import("@shared/schemas");
  const parsed = questionnaireExportSchema.safeParse(data);
  if (!parsed.success) {
    throw badRequest("Arquivo de questionário inválido.", parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const [t] = await ctx.db
    .insert(trainingTemplates)
    .values({ orgId, name: parsed.data.name, description: parsed.data.description, content: parsed.data, createdByUserId: actor.user.id })
    .returning();
  return t;
}

/** Cria um evento a partir de um template (copia perguntas, cadastro, campos e configurações). */
export async function createEventFromTemplate(ctx: AppContext, actor: Actor, templateId: string, raw: unknown) {
  const t = await getTemplate(ctx, actor, templateId);
  authorize(actor, t.orgId, "event.write");
  const content = t.content as { registration?: unknown; settings?: unknown; customFields?: CustomFieldInput[] };
  const base = (raw ?? {}) as Record<string, unknown>;
  const input = eventInputSchema.parse({
    ...base,
    registration: base.registration ?? content.registration,
    settings: base.settings ?? content.settings,
  });
  return ctx.db.transaction(async (tx) => {
    const [ev] = await tx
      .insert(events)
      .values({ ...eventValues(input), orgId: t.orgId, templateId: t.id, createdByUserId: actor.user.id })
      .returning();
    await importQuestionsInto(tx, t.orgId, ev.id, t.content);
    if (content.customFields?.length) {
      await tx.insert(participantCustomFields).values(
        content.customFields.map((f, i) => ({ orgId: t.orgId, eventId: ev.id, key: f.key, label: f.label, type: f.type, options: f.options, required: f.required, position: i })),
      );
    }
    await audit(tx, actor, t.orgId, "event.create_from_template", "event", ev.id, { templateId });
    return ev;
  });
}
