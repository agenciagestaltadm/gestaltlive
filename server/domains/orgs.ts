/** Organizações, membros e indicadores gerais. */
import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { AppContext } from "../context";
import { eventSessions, events, organizationMembers, organizations, participants, sessionParticipants, users } from "../db/schema";
import type { Actor, Role } from "../auth/auth";
import { authorize, requireSuperadmin } from "../auth/permissions";
import { badRequest, conflict, notFound } from "../lib/errors";
import { hashPassword } from "../lib/crypto";
import { audit } from "./audit";
import type { orgCreateSchema, userCreateSchema } from "@shared/schemas";

export async function listOrgs(ctx: AppContext, actor: Actor) {
  if (actor.user.isSuperadmin) {
    return ctx.db.select().from(organizations).orderBy(organizations.name);
  }
  const ids = actor.memberships.map((m) => m.orgId);
  if (ids.length === 0) return [];
  return ctx.db.select().from(organizations).where(inArray(organizations.id, ids)).orderBy(organizations.name);
}

export async function createOrg(ctx: AppContext, actor: Actor, input: z.infer<typeof orgCreateSchema>) {
  requireSuperadmin(actor);
  const [exists] = await ctx.db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, input.slug));
  if (exists) throw conflict("Já existe uma organização com este identificador.");
  return ctx.db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: input.name, slug: input.slug, brand: input.brand, logoUrl: input.logoUrl, retentionDays: input.retentionDays })
      .returning();
    await audit(tx, actor, org.id, "org.create", "organization", org.id, { name: org.name });
    return org;
  });
}

export async function updateOrg(ctx: AppContext, actor: Actor, orgId: string, input: Partial<z.infer<typeof orgCreateSchema>> & { isActive?: boolean }) {
  authorize(actor, orgId, "members.manage");
  if (input.isActive !== undefined || input.slug !== undefined) requireSuperadmin(actor);
  return ctx.db.transaction(async (tx) => {
    const [org] = await tx
      .update(organizations)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.slug !== undefined && { slug: input.slug }),
        ...(input.brand !== undefined && { brand: input.brand }),
        ...(input.logoUrl !== undefined && { logoUrl: input.logoUrl }),
        ...(input.retentionDays !== undefined && { retentionDays: input.retentionDays }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        updatedAt: ctx.now(),
      })
      .where(eq(organizations.id, orgId))
      .returning();
    if (!org) throw notFound();
    await audit(tx, actor, orgId, "org.update", "organization", orgId, input as Record<string, unknown>);
    return org;
  });
}

export async function getOrg(ctx: AppContext, actor: Actor, orgId: string) {
  authorize(actor, orgId, "event.read");
  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw notFound();
  return org;
}

export async function listMembers(ctx: AppContext, actor: Actor, orgId: string) {
  authorize(actor, orgId, "event.read");
  return ctx.db
    .select({
      id: organizationMembers.id,
      role: organizationMembers.role,
      userId: users.id,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      lastLoginAt: users.lastLoginAt,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.orgId, orgId))
    .orderBy(users.name);
}

/** Adiciona um membro. Se o e-mail já existir, apenas vincula o usuário à organização (a senha não é alterada). */
export async function addMember(ctx: AppContext, actor: Actor, orgId: string, input: z.infer<typeof userCreateSchema>) {
  authorize(actor, orgId, "members.manage");
  const email = input.email.trim().toLowerCase();
  return ctx.db.transaction(async (tx) => {
    let [user] = await tx.select().from(users).where(eq(users.email, email));
    if (!user) {
      [user] = await tx
        .insert(users)
        .values({ email, name: input.name, passwordHash: await hashPassword(input.password) })
        .returning();
    }
    const [existing] = await tx
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, user.id)));
    if (existing) throw conflict("Este usuário já é membro da organização.");
    const [m] = await tx.insert(organizationMembers).values({ orgId, userId: user.id, role: input.role }).returning();
    await audit(tx, actor, orgId, "member.add", "user", user.id, { email, role: input.role });
    return m;
  });
}

export async function updateMemberRole(ctx: AppContext, actor: Actor, orgId: string, memberId: string, role: Role) {
  authorize(actor, orgId, "members.manage");
  return ctx.db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.id, memberId), eq(organizationMembers.orgId, orgId)));
    if (!m) throw notFound();
    if (m.userId === actor.user.id && role !== "ORG_ADMIN" && !actor.user.isSuperadmin) {
      throw badRequest("Você não pode remover seu próprio perfil de administrador.");
    }
    await tx.update(organizationMembers).set({ role }).where(eq(organizationMembers.id, memberId));
    await audit(tx, actor, orgId, "member.role", "user", m.userId, { role });
  });
}

export async function removeMember(ctx: AppContext, actor: Actor, orgId: string, memberId: string) {
  authorize(actor, orgId, "members.manage");
  return ctx.db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.id, memberId), eq(organizationMembers.orgId, orgId)));
    if (!m) throw notFound();
    if (m.userId === actor.user.id) throw badRequest("Você não pode remover a si mesmo.");
    await tx.delete(organizationMembers).where(eq(organizationMembers.id, memberId));
    await audit(tx, actor, orgId, "member.remove", "user", m.userId, {});
  });
}

/** Indicadores gerais (superadmin). */
export async function globalOverview(ctx: AppContext, actor: Actor) {
  requireSuperadmin(actor);
  const [o] = await ctx.db.select({ n: count() }).from(organizations);
  const [u] = await ctx.db.select({ n: count() }).from(users);
  const [e] = await ctx.db.select({ n: count() }).from(events);
  const [s] = await ctx.db.select({ n: count() }).from(eventSessions);
  const [live] = await ctx.db.select({ n: count() }).from(eventSessions).where(eq(eventSessions.status, "AO_VIVO"));
  const [p] = await ctx.db.select({ n: count() }).from(participants);
  const [sp] = await ctx.db.select({ n: count() }).from(sessionParticipants);
  const perOrg = await ctx.db
    .select({
      orgId: organizations.id,
      name: organizations.name,
      events: sql<number>`(select count(*)::int from ${events} where ${events.orgId} = ${organizations.id})`,
      sessions: sql<number>`(select count(*)::int from ${eventSessions} where ${eventSessions.orgId} = ${organizations.id})`,
      participants: sql<number>`(select count(*)::int from ${participants} where ${participants.orgId} = ${organizations.id})`,
    })
    .from(organizations)
    .orderBy(organizations.name);
  return {
    organizations: o.n,
    users: u.n,
    events: e.n,
    sessions: s.n,
    liveSessions: live.n,
    participants: p.n,
    participations: sp.n,
    perOrg,
  };
}
