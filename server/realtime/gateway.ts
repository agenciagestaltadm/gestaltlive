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
import type { AppContext } from "../context";
import { SESSION_COOKIE } from "../auth/auth";
import { log } from "../lib/logger";
import { authorizeRealtime } from "./auth";
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
    const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;
    const token = parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE];
    const id = await authorizeRealtime(ctx, auth, auth.role === "control" ? token : undefined);
    if (!id) return next(new Error(auth.role === "control" && !token ? "NAO_AUTENTICADO" : "NAO_AUTORIZADO"));
    (socket.data as SocketData) = { role: id.role, sessionId: id.sessionId, spId: id.spId };
    return next();
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
