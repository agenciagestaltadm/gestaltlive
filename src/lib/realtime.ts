"use client";
/**
 * Conexão em tempo real (Socket.IO) com reconexão automática e ressincronização.
 * O estado oficial vem sempre da API; eventos aplicam atualizações incrementais e, ao reconectar,
 * o snapshot completo é recarregado.
 */
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { RealtimeEnvelope } from "@shared/types";

export type ConnectionStatus = "conectando" | "conectado" | "reconectando" | "desconectado" | "negado";

export interface RealtimeOptions {
  auth: Record<string, unknown> | null;
  handlers: Record<string, (data: any, env: RealtimeEnvelope) => void>;
  /** Chamado após (re)conectar — deve recarregar o snapshot de estado pela API. */
  onSync?: () => void;
  heartbeat?: boolean;
}

export function useRealtime({ auth, handlers, onSync, heartbeat }: RealtimeOptions) {
  const [status, setStatus] = useState<ConnectionStatus>("conectando");
  const handlersRef = useRef(handlers);
  const syncRef = useRef(onSync);
  handlersRef.current = handlers;
  syncRef.current = onSync;
  const authKey = auth ? JSON.stringify(auth) : null;

  useEffect(() => {
    if (!authKey) return;
    const socket: Socket = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: JSON.parse(authKey),
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: 10000,
    });
    let everConnected = false;
    socket.on("connect", () => {
      setStatus("conectado");
      if (everConnected) syncRef.current?.();
      everConnected = true;
    });
    socket.on("ready", () => syncRef.current?.());
    socket.on("disconnect", (reason) => setStatus(reason === "io client disconnect" ? "desconectado" : "reconectando"));
    socket.on("connect_error", (err) => {
      if (err.message === "NAO_AUTORIZADO" || err.message === "NAO_AUTENTICADO") {
        setStatus("negado");
        socket.disconnect();
      } else setStatus("reconectando");
    });
    socket.onAny((event: string, env: RealtimeEnvelope) => {
      const h = handlersRef.current[event];
      if (h && env && typeof env === "object" && "data" in env) h(env.data, env);
    });
    const onOnline = () => {
      if (!socket.connected) socket.connect();
    };
    window.addEventListener("online", onOnline);
    let hb: ReturnType<typeof setInterval> | null = null;
    if (heartbeat) hb = setInterval(() => socket.connected && socket.emit("hb"), 20_000);
    // ao voltar para a aba, garante dados atualizados
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (!socket.connected) socket.connect();
        else syncRef.current?.();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      if (hb) clearInterval(hb);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [authKey, heartbeat]);

  return status;
}

/** Diferença entre o relógio do servidor e o do aparelho (para cronômetros fiéis ao servidor). */
export function useServerClock() {
  const offset = useRef(0);
  return {
    sync(serverNow: number) {
      offset.current = serverNow - Date.now();
    },
    now() {
      return Date.now() + offset.current;
    },
  };
}
