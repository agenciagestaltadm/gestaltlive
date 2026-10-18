"use client";
/**
 * Conexão em tempo real com reconexão automática e ressincronização.
 * O estado oficial vem sempre da API; eventos aplicam atualizações incrementais e, ao reconectar,
 * o snapshot completo é recarregado.
 *
 * O servidor decide o transporte no "ticket" (POST /api/realtime/ticket):
 *  - "socket": Socket.IO no servidor próprio (local, Docker);
 *  - "supabase": canais privados do Supabase Realtime (Vercel). Nesse modo o telão e o painel também
 *    chamam o "tick" da sessão a cada segundo (temporizadores e atualizações agregadas) e o celular
 *    envia sinal de vida pelo HTTP.
 */
import { useEffect, useRef, useState } from "react";
import type { RealtimeEnvelope } from "@shared/types";

export type ConnectionStatus = "conectando" | "conectado" | "reconectando" | "desconectado" | "negado";

export interface RealtimeOptions {
  auth: Record<string, unknown> | null;
  handlers: Record<string, (data: any, env: RealtimeEnvelope) => void>;
  /** Chamado após (re)conectar — deve recarregar o snapshot de estado pela API. */
  onSync?: () => void;
  heartbeat?: boolean;
}

type Ticket =
  | { transport: "socket"; serverNow: number }
  | { transport: "supabase"; url: string; anonKey: string; topics: string[]; tick: boolean; heartbeat: boolean; serverNow: number };

/** Evento enviado pelo servidor quando o acesso ao canal é revogado. */
const REVOKED = "rt:revoked";
const TICK_MS = 1000;
const HEARTBEAT_MS = 25_000;

interface Bridge {
  setStatus: (s: ConnectionStatus) => void;
  dispatch: (event: string, env: unknown) => void;
  sync: () => void;
}

const post = (path: string, body: string) =>
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body, credentials: "same-origin", cache: "no-store" });

export function useRealtime({ auth, handlers, onSync, heartbeat }: RealtimeOptions) {
  const [status, setStatus] = useState<ConnectionStatus>("conectando");
  const handlersRef = useRef(handlers);
  const syncRef = useRef(onSync);
  handlersRef.current = handlers;
  syncRef.current = onSync;
  const authKey = auth ? JSON.stringify(auth) : null;

  useEffect(() => {
    if (!authKey) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const bridge: Bridge = {
      setStatus: (s) => !disposed && setStatus(s),
      dispatch: (event, env) => {
        const h = handlersRef.current[event];
        if (h && env && typeof env === "object" && "data" in env) h((env as RealtimeEnvelope).data, env as RealtimeEnvelope);
      },
      sync: () => !disposed && syncRef.current?.(),
    };

    const connect = async () => {
      try {
        const res = await post("/api/realtime/ticket", authKey);
        if (disposed) return;
        if (res.status === 401 || res.status === 403) {
          setStatus("negado");
          return;
        }
        if (!res.ok) throw new Error(`ticket ${res.status}`);
        const t = (await res.json()) as Ticket;
        if (disposed) return;
        attempt = 0;
        if (t.transport === "supabase") {
          const stop = await connectSupabase(t, authKey, bridge);
          if (disposed) stop();
          else cleanup = stop;
        } else {
          cleanup = connectSocket(authKey, !!heartbeat, bridge);
        }
      } catch {
        if (disposed) return;
        setStatus("reconectando");
        attempt++;
        retry = setTimeout(() => void connect(), Math.min(10_000, 500 * 2 ** attempt));
      }
    };
    void connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      cleanup?.();
    };
  }, [authKey, heartbeat]);

  return status;
}

/* ------------------------------------------------------------------ Socket.IO (servidor próprio) */
function connectSocket(authKey: string, heartbeat: boolean, b: Bridge) {
  let socket: import("socket.io-client").Socket | null = null;
  let closed = false;
  let hb: ReturnType<typeof setInterval> | null = null;
  const onOnline = () => socket && !socket.connected && socket.connect();
  // ao voltar para a aba, garante dados atualizados
  const onVisible = () => {
    if (document.visibilityState !== "visible" || !socket) return;
    if (!socket.connected) socket.connect();
    else b.sync();
  };
  void import("socket.io-client").then(({ io }) => {
    if (closed) return;
    const s = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: JSON.parse(authKey),
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: 10000,
    });
    socket = s;
    let everConnected = false;
    s.on("connect", () => {
      b.setStatus("conectado");
      if (everConnected) b.sync();
      everConnected = true;
    });
    s.on("ready", () => b.sync());
    s.on("disconnect", (reason) => b.setStatus(reason === "io client disconnect" ? "desconectado" : "reconectando"));
    s.on("connect_error", (err) => {
      if (err.message === "NAO_AUTORIZADO" || err.message === "NAO_AUTENTICADO") {
        b.setStatus("negado");
        s.disconnect();
      } else b.setStatus("reconectando");
    });
    s.onAny((event: string, env: RealtimeEnvelope) => b.dispatch(event, env));
    if (heartbeat) hb = setInterval(() => s.connected && s.emit("hb"), 20_000);
  });
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    closed = true;
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    if (hb) clearInterval(hb);
    socket?.removeAllListeners();
    socket?.disconnect();
  };
}

/* ------------------------------------------------------------------ Supabase Realtime (Vercel) */
async function connectSupabase(t: Extract<Ticket, { transport: "supabase" }>, authKey: string, b: Bridge) {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(t.url, t.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let closed = false;
  let revoked = false;
  const subscribed = new Set<string>();
  const timers: ReturnType<typeof setTimeout>[] = [];

  const stopAll = () => {
    closed = true;
    timers.forEach(clearTimeout);
    document.removeEventListener("visibilitychange", onVisible);
    void sb.removeAllChannels();
    sb.realtime.disconnect();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible" && subscribed.size === t.topics.length) b.sync();
  };

  for (const topic of t.topics) {
    sb.channel(topic, { config: { private: true } })
      .on("broadcast", { event: "*" }, (msg: { event: string; payload?: unknown }) => {
        if (msg.event === REVOKED) {
          revoked = true;
          b.setStatus("negado");
          stopAll();
          return;
        }
        b.dispatch(msg.event, msg.payload);
      })
      .subscribe((state) => {
        if (closed || revoked) return;
        if (state === "SUBSCRIBED") {
          subscribed.add(topic);
          // todos os canais prontos (inclusive após reconexão): recarrega o snapshot
          if (subscribed.size === t.topics.length) {
            b.setStatus("conectado");
            b.sync();
          }
        } else {
          subscribed.delete(topic);
          b.setStatus("reconectando");
        }
      });
  }
  document.addEventListener("visibilitychange", onVisible);

  // telão e painel: tick da sessão (temporizadores e atualizações agregadas), um por vez
  if (t.tick) {
    const loop = async () => {
      if (closed) return;
      try {
        const res = await post("/api/realtime/tick", authKey);
        if (res.status === 401 || res.status === 403) {
          b.setStatus("negado");
          stopAll();
          return;
        }
      } catch {
        /* sem rede: tenta no próximo ciclo */
      }
      if (!closed) timers.push(setTimeout(() => void loop(), TICK_MS));
    };
    void loop();
  }
  // celular: sinal de vida (contagem de conectados)
  if (t.heartbeat) {
    const beat = () => {
      if (closed) return;
      void post("/api/realtime/heartbeat", authKey).catch(() => undefined);
      timers.push(setTimeout(beat, HEARTBEAT_MS));
    };
    beat();
  }
  return stopAll;
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
