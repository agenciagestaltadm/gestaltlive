/**
 * Gateway Socket.IO: autenticação e autorização da inscrição nos canais.
 *
 * handshake.auth:
 *  { role: "participant", code, token }  → salas s:{id}:participants e sp:{spId}
 *  { role: "screen", code, token }       → sala s:{id}:screen (token de exibição do telão)
 *  { role: "control", sessionId }        → sala s:{id}:control (cookie de sessão administrativa)
 *
 * O cliente só pode emitir "hb" (heartbeat). Qualquer outro evento é ignorado.
 */
import type { Server, Socket } from "socket.io";
import { eq } from "drizzle-orm";
import type { AppContext } from "../context";
import { eventSessions } from "../db/schema";
import { actorFromToken, SESSION_COOKIE } from "../auth/auth";
import { can } from "../auth/permissions";
import { participantFromToken } from "../domains/participants";
import { sessionByCode, verifyScreenToken } from "../domains/sessions";
import { log } from "../lib/logger";
import { personalRoom, room } from "./realtime";

interface SocketData {
  role: "participant" | "screen" | "control";
  sessionId: string;
  spId?: string;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function attachGateway(io: Server, ctx: AppContext) {
  io.use(async (socket, next) => {
    try {
      const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;
      const role = auth.role;
      if (role === "participant") {
        const { sp, session } = await participantFromToken(ctx.db, String(auth.code ?? ""), String(auth.token ?? ""));
        (socket.data as SocketData) = { role, sessionId: session.id, spId: sp.id };
        return next();
      }
      if (role === "screen") {
        const s = await sessionByCode(ctx.db, String(auth.code ?? ""));
        if (!s || !verifyScreenToken(ctx, s, String(auth.token ?? ""))) return next(new Error("NAO_AUTORIZADO"));
        (socket.data as SocketData) = { role, sessionId: s.id };
        return next();
      }
      if (role === "control") {
        const token = parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE];
        const actor = await actorFromToken(ctx, token);
        if (!actor) return next(new Error("NAO_AUTENTICADO"));
        const sessionId = String(auth.sessionId ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return next(new Error("NAO_AUTORIZADO"));
        const [s] = await ctx.db.select({ id: eventSessions.id, orgId: eventSessions.orgId }).from(eventSessions).where(eq(eventSessions.id, sessionId));
        if (!s || !can(actor, s.orgId, "session.control")) return next(new Error("NAO_AUTORIZADO"));
        (socket.data as SocketData) = { role, sessionId: s.id };
        return next();
      }
      return next(new Error("NAO_AUTORIZADO"));
    } catch {
      return next(new Error("NAO_AUTORIZADO"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const data = socket.data as SocketData;
    if (data.role === "participant" && data.spId) {
      void socket.join([room(data.sessionId, "participants"), personalRoom(data.spId)]);
      ctx.rt.addPresence(data.sessionId, data.spId, socket.id);
      socket.on("hb", () => ctx.rt.heartbeat(data.spId!));
      socket.on("disconnect", () => ctx.rt.removePresence(data.sessionId, data.spId!, socket.id));
    } else if (data.role === "screen") {
      void socket.join(room(data.sessionId, "screen"));
    } else if (data.role === "control") {
      void socket.join(room(data.sessionId, "control"));
    }
    socket.emit("ready", { role: data.role, serverNow: Date.now() });
    // eventos de clientes não são aceitos (exceto heartbeat)
    socket.onAny((event) => {
      if (event !== "hb") log.debug("evento de cliente ignorado", { event, role: data.role });
    });
  });
}
