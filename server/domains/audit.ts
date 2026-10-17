import { and, desc, eq, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import type { Tx } from "../db/client";
import { auditLogs, sessionEvents, users } from "../db/schema";
import type { Actor } from "../auth/auth";

export async function audit(
  tx: Tx,
  actor: Actor | null,
  orgId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  data: Record<string, unknown> = {},
  ip?: string | null,
) {
  await tx.insert(auditLogs).values({
    orgId,
    actorUserId: actor?.user.id ?? null,
    action,
    entityType,
    entityId,
    data,
    ip: ip ?? null,
  });
}

/** Linha do tempo da sessão (controle ao vivo) — base para indicadores temporais e atividade. */
export async function logSessionEvent(
  tx: Tx,
  orgId: string,
  sessionId: string,
  type: string,
  payload: Record<string, unknown> = {},
  actorUserId: string | null = null,
) {
  await tx.insert(sessionEvents).values({ orgId, sessionId, type, payload, actorUserId });
}

export async function listAudit(ctx: AppContext, orgId: string, limit = 200, entityType?: string) {
  const where = entityType ? and(eq(auditLogs.orgId, orgId), eq(auditLogs.entityType, entityType)) : eq(auditLogs.orgId, orgId);
  return ctx.db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      data: auditLogs.data,
      createdAt: auditLogs.createdAt,
      actorName: sql<string | null>`${users.name}`,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(Math.min(limit, 1000));
}
