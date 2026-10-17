/**
 * Rotina automática de retenção (LGPD).
 *
 * Para cada organização com `retention_days` definido, anonimiza os participantes cuja última
 * participação (entrada na sessão ou encerramento dela, o que for mais recente) é anterior ao prazo.
 * Participantes com sessão ainda em andamento nunca são afetados. Também remove itens já processados
 * do outbox de integrações mais antigos que o prazo.
 *
 * Idempotente e segura com várias instâncias: a anonimização só altera quem ainda não foi anonimizado.
 * Cada anonimização é auditada com ator de sistema (actor_user_id nulo, data.system = "retencao").
 */
import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import { qc } from "../db/client";
import { eventSessions, integrationOutbox, organizations, participants, sessionParticipants } from "../db/schema";
import { audit } from "./audit";
import { anonymizeParticipantData } from "./crm";

const DAY_MS = 86_400_000;
const BATCH = 200;
/** Limite por organização em cada execução — o restante fica para a próxima (a rotina é periódica). */
const MAX_PER_ORG_RUN = 5_000;
const ACTIVE_STATUSES = ["AGUARDANDO", "AO_VIVO", "PAUSADA"] as const;

export interface RetentionResult {
  orgId: string;
  retentionDays: number;
  cutoff: Date;
  anonymized: number;
  outboxPurged: number;
}

/** Participantes vencidos de uma organização (última participação anterior ao corte). */
async function expiredParticipants(ctx: AppContext, orgId: string, cutoff: Date, limit: number) {
  // greatest() ignora nulos: sessão sem encerramento conta pela data de entrada
  const lastActivity = sql`(select max(greatest(sp.joined_at, es.ended_at)) from ${sessionParticipants} sp
      join ${eventSessions} es on es.id = sp.session_id
     where sp.participant_id = ${qc(participants.id)})`;
  const hasActiveSession = sql`exists (select 1 from ${sessionParticipants} sp
      join ${eventSessions} es on es.id = sp.session_id
     where sp.participant_id = ${qc(participants.id)} and es.status in (${sql.join(
       ACTIVE_STATUSES.map((s) => sql`${s}`),
       sql`, `,
     )}))`;
  return ctx.db
    .select({ id: participants.id, orgId: participants.orgId })
    .from(participants)
    .where(
      and(
        eq(participants.orgId, orgId),
        isNull(participants.anonymizedAt),
        sql`coalesce(${lastActivity}, ${qc(participants.createdAt)}) < ${cutoff.toISOString()}::timestamptz`,
        sql`not ${hasActiveSession}`,
      ),
    )
    .limit(limit);
}

export async function runRetention(ctx: AppContext): Promise<RetentionResult[]> {
  const now = ctx.now();
  const orgs = await ctx.db
    .select({ id: organizations.id, retentionDays: organizations.retentionDays })
    .from(organizations)
    .where(and(isNotNull(organizations.retentionDays), sql`${organizations.retentionDays} > 0`));
  const results: RetentionResult[] = [];
  for (const org of orgs) {
    const days = org.retentionDays!;
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    let anonymized = 0;
    let seen = 0;
    while (seen < MAX_PER_ORG_RUN) {
      const batch = await expiredParticipants(ctx, org.id, cutoff, BATCH);
      if (!batch.length) break;
      seen += batch.length;
      let changed = 0;
      for (const p of batch) {
        await ctx.db.transaction(async (tx) => {
          const done = await anonymizeParticipantData(tx, now, p, {
            source: "SISTEMA",
            note: `Dados anonimizados automaticamente ao fim do prazo de retenção (${days} dias).`,
          });
          if (!done) return;
          changed++;
          await audit(tx, null, org.id, "participant.anonymize", "participant", p.id, {
            system: "retencao",
            reason: `Prazo de retenção de ${days} dias`,
            cutoff: cutoff.toISOString(),
          });
        });
      }
      anonymized += changed;
      // outra instância pode ter processado o mesmo lote; sem progresso, encerra
      if (batch.length < BATCH || changed === 0) break;
    }

    const purged = await ctx.db
      .delete(integrationOutbox)
      .where(
        and(
          eq(integrationOutbox.orgId, org.id),
          inArray(integrationOutbox.status, ["ENVIADO", "FALHOU"]),
          lt(integrationOutbox.createdAt, cutoff),
        ),
      )
      .returning({ id: integrationOutbox.id });

    if (anonymized > 0 || purged.length > 0) {
      await audit(ctx.db, null, org.id, "retention.run", "organization", org.id, {
        system: "retencao",
        retentionDays: days,
        cutoff: cutoff.toISOString(),
        anonymized,
        outboxPurged: purged.length,
      });
    }
    results.push({ orgId: org.id, retentionDays: days, cutoff, anonymized, outboxPurged: purged.length });
  }
  return results;
}
