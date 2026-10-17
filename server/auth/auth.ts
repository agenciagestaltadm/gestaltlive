/** Autenticação de administradores e palestrantes (sessões em banco, cookie httpOnly). */
import { and, eq, gt, lt } from "drizzle-orm";
import type { AppContext } from "../context";
import { authSessions, organizationMembers, organizations, users } from "../db/schema";
import { hashPassword, randomToken, sha256, verifyPassword } from "../lib/crypto";
import { badRequest, unauthorized } from "../lib/errors";
import { passwordSchema } from "@shared/schemas";

export const SESSION_COOKIE = "gl_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas (um dia de evento)

export type Role = "ORG_ADMIN" | "SPEAKER";

export interface Actor {
  user: { id: string; email: string; name: string; isSuperadmin: boolean };
  memberships: { orgId: string; orgName: string; orgSlug: string; role: Role }[];
}

// hash fictício usado para equalizar o tempo de resposta quando o e-mail não existe
let dummyHash: string | null = null;

export async function login(ctx: AppContext, email: string, password: string, meta: { ip?: string; userAgent?: string }) {
  const normalized = email.trim().toLowerCase();
  const [user] = await ctx.db.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (!user || !user.isActive) {
    dummyHash ??= await hashPassword("senha-ficticia-para-tempo-constante");
    await verifyPassword(password, dummyHash);
    throw unauthorized("E-mail ou senha incorretos.");
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw unauthorized("E-mail ou senha incorretos.");
  const token = randomToken();
  const now = ctx.now();
  await ctx.db.insert(authSessions).values({
    userId: user.id,
    tokenHash: sha256(token),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  await ctx.db.update(users).set({ lastLoginAt: now }).where(eq(users.id, user.id));
  // limpeza oportunista de sessões expiradas
  await ctx.db.delete(authSessions).where(lt(authSessions.expiresAt, now));
  return { token, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) };
}

export async function logout(ctx: AppContext, token: string) {
  await ctx.db.delete(authSessions).where(eq(authSessions.tokenHash, sha256(token)));
}

export async function actorFromToken(ctx: AppContext, token: string | undefined | null): Promise<Actor | null> {
  if (!token || token.length > 200) return null;
  const rows = await ctx.db
    .select({ user: users, expiresAt: authSessions.expiresAt })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(and(eq(authSessions.tokenHash, sha256(token)), gt(authSessions.expiresAt, ctx.now())))
    .limit(1);
  const row = rows[0];
  if (!row || !row.user.isActive) return null;
  return loadActor(ctx, row.user.id);
}

export async function loadActor(ctx: AppContext, userId: string): Promise<Actor | null> {
  const [u] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return null;
  const memberships = await ctx.db
    .select({
      orgId: organizationMembers.orgId,
      role: organizationMembers.role,
      orgName: organizations.name,
      orgSlug: organizations.slug,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
    .where(and(eq(organizationMembers.userId, userId), eq(organizations.isActive, true)));
  return {
    user: { id: u.id, email: u.email, name: u.name, isSuperadmin: u.isSuperadmin },
    memberships,
  };
}

export async function changePassword(ctx: AppContext, actor: Actor, current: string, next: string) {
  const parsed = passwordSchema.safeParse(next);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Senha inválida");
  const [u] = await ctx.db.select().from(users).where(eq(users.id, actor.user.id)).limit(1);
  if (!u || !(await verifyPassword(current, u.passwordHash))) throw badRequest("Senha atual incorreta.");
  await ctx.db
    .update(users)
    .set({ passwordHash: await hashPassword(next), updatedAt: ctx.now() })
    .where(eq(users.id, u.id));
  // encerra as demais sessões do usuário
  await ctx.db.delete(authSessions).where(eq(authSessions.userId, u.id));
}
