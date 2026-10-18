/**
 * "Tick" da sessão no modo serverless (Vercel): substitui o agendador e a agregação em memória do
 * servidor residente. O telão e o painel chamam POST /api/realtime/tick a cada segundo; a atualização
 * condicional em realtime_ticks garante que apenas uma chamada por janela faça o trabalho, mesmo com
 * várias janelas abertas e várias instâncias da função:
 *  1. fecha perguntas com tempo esgotado e avança slides com tempo de permanência;
 *  2. publica resultados, contagens, ranking, satisfação, presença e novas inscrições que mudaram.
 */
import { eq, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import { realtimeTicks } from "../db/schema";
import { rowsOf } from "../db/client";
import { closeExpiredQuestions } from "../domains/live";
import { advanceTimedItems } from "../domains/presenter";
import { processOutbox } from "../domains/integrations";
import { log } from "../lib/logger";
import { aggregateSession } from "./realtime";

/** Janela mínima entre dois ticks efetivos da mesma sessão. */
export const TICK_WINDOW_MS = 700;
let lastOutbox = 0;

export async function tickSession(ctx: AppContext, sessionId: string): Promise<{ ran: boolean }> {
  const lease = rowsOf<{ sent: Record<string, string | number> }>(
    await ctx.db.execute(sql`
      insert into realtime_ticks (session_id, at, sent) values (${sessionId}, now(), '{}'::jsonb)
      on conflict (session_id) do update set at = now()
      where realtime_ticks.at < now() - (${TICK_WINDOW_MS} * interval '1 millisecond')
      returning sent
    `),
  );
  if (lease.length === 0) return { ran: false };
  const prev = lease[0].sent ?? {};
  const next = { ...prev };
  try {
    await closeExpiredQuestions(ctx, sessionId);
    await advanceTimedItems(ctx, sessionId);
    await aggregateSession(ctx.rt, ctx, sessionId, prev, next);
  } finally {
    await ctx.db.update(realtimeTicks).set({ sent: next }).where(eq(realtimeTicks.sessionId, sessionId));
  }
  // webhooks pendentes: aproveita o tick (a rotina diária da Vercel cobre o restante)
  if (Date.now() - lastOutbox > 15_000) {
    lastOutbox = Date.now();
    await processOutbox(ctx).catch((err) => log.warn("falha ao processar o outbox no tick", { err }));
  }
  return { ran: true };
}
