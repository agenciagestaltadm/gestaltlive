/**
 * Montagem do runtime (banco, contexto, API, gateway de tempo real, agendador).
 * Usado pelo servidor (server/index.ts) e pelos testes de integração.
 */
import http from "node:http";
import path from "node:path";
import { Server as IOServer } from "socket.io";
import { getRequestListener } from "@hono/node-server";
import { createDatabase, type Database } from "./db/client";
import { loadConfig, type AppConfig, type AppContext } from "./context";
import { closeRateLimits, createRateLimits } from "./lib/rate-limit";
import { Realtime } from "./realtime/realtime";
import { attachGateway } from "./realtime/gateway";
import { createApp } from "./app";
import { closeExpiredQuestions } from "./domains/live";
import { log } from "./lib/logger";

export interface RuntimeOptions {
  databaseUrl: string;
  config?: Partial<AppConfig>;
  now?: () => Date;
  rateLimitMultiplier?: number;
}

export interface Runtime {
  ctx: AppContext;
  app: ReturnType<typeof createApp>;
  database: Database;
  close: () => Promise<void>;
}

export async function createRuntime(opts: RuntimeOptions): Promise<Runtime> {
  const database = await createDatabase(opts.databaseUrl);
  const config = { ...loadConfig(), ...opts.config };
  const rt = new Realtime();
  const limits = createRateLimits(opts.rateLimitMultiplier ?? 1);
  const ctx: AppContext = { db: database.db, config, limits, rt, now: opts.now ?? (() => new Date()) };
  rt.bind(ctx);
  const app = createApp(ctx);
  return {
    ctx,
    app,
    database,
    close: async () => {
      rt.stop();
      closeRateLimits(limits);
      await database.close();
    },
  };
}

export interface HttpServerOptions {
  port: number;
  host?: string;
  /** Serve a interface Next.js no mesmo processo. */
  withNext?: boolean;
  dev?: boolean;
  schedulerIntervalMs?: number;
}

export interface RunningServer {
  server: http.Server;
  io: IOServer;
  port: number;
  stop: () => Promise<void>;
}

export async function startHttpServer(runtime: Runtime, opts: HttpServerOptions): Promise<RunningServer> {
  const { ctx, app } = runtime;
  const apiListener = getRequestListener(app.fetch);
  type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
  type Upgrade = (req: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => Promise<void>;
  let nextHandler: Handler | null = null;
  let nextUpgrade: Upgrade | null = null;

  if (opts.withNext) {
    const { default: next } = await import("next");
    const nextApp = next({ dev: !!opts.dev, dir: path.resolve(process.cwd()), hostname: opts.host ?? "localhost", port: opts.port });
    await nextApp.prepare();
    nextHandler = nextApp.getRequestHandler() as unknown as Handler;
    nextUpgrade = nextApp.getUpgradeHandler() as unknown as Upgrade;
  }

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/api/")) return void apiListener(req, res);
    if (nextHandler) return void nextHandler(req, res);
    res.statusCode = 404;
    res.end("Not found");
  });

  const io = new IOServer(server, {
    path: "/socket.io",
    serveClient: false,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 10_000,
    destroyUpgrade: false,
    transports: ["websocket", "polling"],
    connectionStateRecovery: undefined,
  });

  if (process.env.REDIS_URL) {
    try {
      // adapter opcional para múltiplas instâncias (pacotes @socket.io/redis-adapter e redis)
      const adapterMod = "@socket.io/redis-adapter";
      const redisMod = "redis";
      const { createAdapter } = await import(adapterMod);
      const { createClient } = await import(redisMod);
      const pub = createClient({ url: process.env.REDIS_URL });
      const sub = pub.duplicate();
      await Promise.all([pub.connect(), sub.connect()]);
      io.adapter(createAdapter(pub, sub));
      log.info("adapter Redis do Socket.IO habilitado");
    } catch (err) {
      log.warn("REDIS_URL definido, mas o adapter Redis não pôde ser carregado; seguindo com instância única", { err });
    }
  }

  if (nextUpgrade) {
    server.on("upgrade", (req, socket, head) => {
      if (!req.url?.startsWith("/socket.io")) void nextUpgrade!(req, socket, head);
    });
  }

  attachGateway(io, ctx);
  ctx.rt.io = io;
  ctx.rt.start();

  let ticking = false;
  const scheduler = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      await closeExpiredQuestions(ctx);
    } catch (err) {
      log.error("falha no agendador", { err });
    } finally {
      ticking = false;
    }
  }, opts.schedulerIntervalMs ?? 250);
  scheduler.unref();

  // backlog alto: rajadas de centenas de conexões simultâneas (todos respondendo ao mesmo tempo)
  await new Promise<void>((resolve) => server.listen({ port: opts.port, host: opts.host ?? "0.0.0.0", backlog: 4096 }, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : opts.port;

  return {
    server,
    io,
    port,
    stop: async () => {
      clearInterval(scheduler);
      ctx.rt.stop();
      io.disconnectSockets(true);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
