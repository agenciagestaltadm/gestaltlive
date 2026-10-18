/**
 * Autorização para receber eventos em tempo real — mesma regra para o gateway Socket.IO e para o
 * "ticket" do Supabase Realtime:
 *  { role: "participant", code, token }  → participante inscrito (token do participante)
 *  { role: "screen", code, token }       → telão (token de exibição da sessão)
 *  { role: "control", sessionId }        → painel (cookie de sessão administrativa + permissão session.control)
 */
import { eq } from "drizzle-orm";
import type { AppContext } from "../context";
import { eventSessions } from "../db/schema";
import { actorFromToken } from "../auth/auth";
import { can } from "../auth/permissions";
import { participantFromToken } from "../domains/participants";
import { sessionByCode, verifyScreenToken } from "../domains/sessions";
import type { RealtimeIdentity } from "./realtime";

export async function authorizeRealtime(ctx: AppContext, auth: Record<string, unknown>, adminToken: string | undefined): Promise<RealtimeIdentity | null> {
  try {
    const role = auth.role;
    if (role === "participant") {
      const { sp, session } = await participantFromToken(ctx.db, String(auth.code ?? ""), String(auth.token ?? ""));
      return { role, sessionId: session.id, spId: sp.id };
    }
    if (role === "screen") {
      const s = await sessionByCode(ctx.db, String(auth.code ?? ""));
      if (!s || !verifyScreenToken(ctx, s, String(auth.token ?? ""))) return null;
      return { role, sessionId: s.id, screenNonce: s.screenTokenNonce };
    }
    if (role === "control") {
      const actor = await actorFromToken(ctx, adminToken);
      if (!actor) return null;
      const sessionId = String(auth.sessionId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
      const [s] = await ctx.db.select({ id: eventSessions.id, orgId: eventSessions.orgId }).from(eventSessions).where(eq(eventSessions.id, sessionId));
      if (!s || !can(actor, s.orgId, "session.control")) return null;
      return { role, sessionId: s.id };
    }
    return null;
  } catch {
    return null;
  }
}
