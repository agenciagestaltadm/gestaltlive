/** Utilitários de teste: runtime com PGlite em memória, cliente HTTP admin/participante e relógio controlável. */
import crypto from "node:crypto";
import { io as ioClient, type Socket } from "socket.io-client";
import { createRuntime, startHttpServer, type Runtime, type RunningServer, type RuntimeOptions } from "@server/runtime";
import { seedDatabase } from "@server/db/seed";

export class Clock {
  constructor(public t = Date.now()) {}
  now = () => new Date(this.t);
  advance(ms: number) {
    this.t += ms;
  }
}

export interface TestEnv {
  rt: Runtime;
  clock: Clock;
  admin: AdminClient;
  orgId: string;
  close: () => Promise<void>;
}

export async function setup(opts: { realClock?: boolean; runtime?: Partial<RuntimeOptions> } = {}): Promise<TestEnv> {
  const clock = new Clock();
  const rt = await createRuntime({
    databaseUrl: "pglite:memory",
    now: opts.realClock ? undefined : clock.now,
    rateLimitMultiplier: 1000,
    config: { env: "test", publicUrl: "http://teste.local", appSecret: "segredo-de-teste" },
    ...opts.runtime,
  });
  const seeded = await seedDatabase(rt.ctx, { superadminEmail: "admin@teste.local", superadminPassword: "SenhaForte123", demo: true });
  const admin = new AdminClient(rt);
  await admin.login("admin@teste.local", "SenhaForte123");
  return { rt, clock, admin, orgId: seeded.orgId!, close: () => rt.close() };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: { error?: { code: string; message: string; details?: unknown } },
  ) {
    super(`${status} ${body?.error?.code}: ${body?.error?.message}`);
  }
}

async function call(rt: Runtime, method: string, path: string, data?: unknown, headers: Record<string, string> = {}) {
  const res = await rt.app.request(path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* corpo não-JSON (CSV etc.) */
  }
  return { res, json };
}

export class AdminClient {
  cookie = "";
  constructor(private rt: Runtime) {}
  async login(email: string, password: string) {
    const { res, json } = await call(this.rt, "POST", "/api/auth/login", { email, password });
    if (!res.ok) throw new HttpError(res.status, json as never);
    const setCookie = res.headers.get("set-cookie") ?? "";
    this.cookie = setCookie.split(";")[0];
  }
  async req<T = any>(method: string, path: string, data?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
    const { res, json } = await call(this.rt, method, path, data, { cookie: this.cookie, ...extraHeaders });
    if (!res.ok) throw new HttpError(res.status, json as never);
    return json as T;
  }
  get = <T = any>(p: string) => this.req<T>("GET", p);
  post = <T = any>(p: string, d: unknown = {}) => this.req<T>("POST", p, d);
  put = <T = any>(p: string, d: unknown) => this.req<T>("PUT", p, d);
}

export class ParticipantClient {
  token = "";
  spId = "";
  constructor(
    private rt: Runtime,
    public code: string,
  ) {}
  static async join(rt: Runtime, code: string, i: number, extra: Record<string, unknown> = {}) {
    const p = new ParticipantClient(rt, code);
    const { res, json } = await call(rt, "POST", `/api/public/sessions/${code}/join`, {
      fullName: `Participante Teste ${i}`,
      displayName: `Part${i}`,
      email: `p${i}@teste.local`,
      phone: `1199${String(1000000 + i).padStart(7, "0")}`,
      consentParticipation: true,
      consentMarketing: i % 2 === 0,
      custom: { segmento: i % 3 === 0 ? "Varejo" : "Serviços", cidade: "São Paulo" },
      ...extra,
    });
    if (!res.ok) throw new HttpError(res.status, json as never);
    const j = json as { token: string; sessionParticipantId: string };
    p.token = j.token;
    p.spId = j.sessionParticipantId;
    return p;
  }
  async req<T = any>(method: string, path: string, data?: unknown): Promise<T> {
    const { res, json } = await call(this.rt, method, `/api/p/${this.code}${path}`, data, { authorization: `Bearer ${this.token}` });
    if (!res.ok) throw new HttpError(res.status, json as never);
    return json as T;
  }
  state = () => this.req("GET", "/state");
  me = () => this.req("GET", "/me");
  answer(sessionQuestionId: string, optionIds: string[], value: number | null = null, key: string = crypto.randomUUID()) {
    return this.req("POST", "/answers", { sessionQuestionId, optionIds, value, idempotencyKey: key });
  }
  /** Envio de texto para a Nuvem de Palavras. */
  word(sessionQuestionId: string, text: string, key: string = crypto.randomUUID()) {
    return this.req("POST", "/wordcloud", { sessionQuestionId, text, idempotencyKey: key });
  }
  satisfaction(value: "POSITIVO" | "NEGATIVO") {
    return this.req("POST", "/satisfaction", { value });
  }
}

export async function expectHttpError(p: Promise<unknown>, status: number, code?: string) {
  try {
    await p;
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    if (e.status !== status) throw new Error(`esperado ${status}, recebido ${e.status} (${e.message})`);
    if (code && e.body?.error?.code !== code) throw new Error(`esperado código ${code}, recebido ${e.body?.error?.code}`);
    return e;
  }
  throw new Error(`esperado erro ${status}, mas a requisição foi bem-sucedida`);
}

/** Cria uma sessão do evento de demonstração e a coloca ao vivo. */
export async function liveDemoSession(env: TestEnv, name = "Turma teste") {
  const events = await env.admin.get(`/api/admin/events?orgId=${env.orgId}`);
  const ev = events.find((e: { title: string }) => e.title.startsWith("Vendas Inteligentes")) ?? events[events.length - 1];
  const s = await env.admin.post(`/api/admin/events/${ev.id}/sessions`, { name });
  await env.admin.post(`/api/admin/sessions/${s.id}/lobby`);
  const control = await env.admin.post(`/api/admin/sessions/${s.id}/start`);
  return { eventId: ev.id as string, sessionId: s.id as string, code: s.code as string, control };
}

export async function startServer(rt: Runtime): Promise<RunningServer> {
  return startHttpServer(rt, { port: 0, host: "127.0.0.1", withNext: false, schedulerIntervalMs: 100 });
}

export function connectSocket(port: number, auth: Record<string, unknown>, extraHeaders?: Record<string, string>): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(`http://127.0.0.1:${port}`, { path: "/socket.io", transports: ["websocket"], auth, extraHeaders, reconnection: false, forceNew: true });
    s.once("ready", () => resolve(s));
    s.once("connect_error", (e) => reject(e));
  });
}

export function waitFor<T = any>(s: Socket, event: string, pred: (d: T) => boolean = () => true, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      s.off(event, h);
      reject(new Error(`timeout aguardando ${event}`));
    }, timeoutMs);
    const h = (env: { data: T }) => {
      if (pred(env.data)) {
        clearTimeout(t);
        s.off(event, h);
        resolve(env.data);
      }
    };
    s.on(event, h);
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
