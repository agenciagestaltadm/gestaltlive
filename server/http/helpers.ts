import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { ZodError, type ZodType } from "zod";
import type { AppContext } from "../context";
import { actorFromToken, SESSION_COOKIE, type Actor } from "../auth/auth";
import { AppError, badRequest, forbidden, unauthorized } from "../lib/errors";

export type Env = {
  Variables: { actor: Actor; ctx: AppContext; requestId: string };
  Bindings: { incoming?: { socket?: { remoteAddress?: string } } };
};

export function clientIp(c: Context<Env>, ctx: AppContext): string {
  if (ctx.config.trustProxy) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }
  return c.env?.incoming?.socket?.remoteAddress ?? "desconhecido";
}

/** Origem usada para montar links/QR quando PUBLIC_URL não está definida. */
export function requestOrigin(c: Context<Env>, ctx: AppContext): string {
  if (ctx.config.publicUrl) return ctx.config.publicUrl;
  const proto = (ctx.config.trustProxy && c.req.header("x-forwarded-proto")) || new URL(c.req.url).protocol.replace(":", "");
  const host = (ctx.config.trustProxy && c.req.header("x-forwarded-host")) || c.req.header("host") || new URL(c.req.url).host;
  return `${proto}://${host}`;
}

export async function body<T>(c: Context<Env>, schema?: ZodType<T>): Promise<T> {
  let data: unknown;
  try {
    data = await c.req.json();
  } catch {
    throw badRequest("Corpo da requisição inválido (JSON esperado).");
  }
  return schema ? schema.parse(data) : (data as T);
}

export function errorResponse(err: unknown, c: Context<Env>) {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status as 400);
  }
  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: "VALIDACAO",
          message: err.issues[0]?.message ?? "Dados inválidos.",
          details: err.issues.slice(0, 30).map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      400,
    );
  }
  return null;
}

/** Exige usuário administrativo autenticado (cookie httpOnly) e valida Origin nas mutações (CSRF). */
export function requireActor(ctx: AppContext): MiddlewareHandler<Env> {
  return async (c, next) => {
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const origin = c.req.header("origin");
      if (origin) {
        const allowed = new Set([requestOrigin(c, ctx)]);
        if (ctx.config.publicUrl) allowed.add(ctx.config.publicUrl);
        try {
          const host = c.req.header("host");
          if (host) allowed.add(`${new URL(origin).protocol}//${host}`);
        } catch {
          /* origem malformada */
        }
        if (!allowed.has(origin)) throw forbidden("Origem da requisição não permitida.");
      }
    }
    const actor = await actorFromToken(ctx, getCookie(c, SESSION_COOKIE));
    if (!actor) throw unauthorized();
    ctx.limits.admin.enforce(`u:${actor.user.id}`);
    c.set("actor", actor);
    await next();
  };
}

export function bearer(c: Context<Env>): string | null {
  const h = c.req.header("authorization");
  if (!h || !h.startsWith("Bearer ")) return null;
  return h.slice(7).trim();
}

export function q(c: Context<Env>, name: string): string | undefined {
  const v = c.req.query(name);
  return v === undefined || v === "" ? undefined : v;
}

export function requireOrgId(c: Context<Env>): string {
  const orgId = q(c, "orgId");
  if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) throw badRequest("Informe a organização (orgId).");
  return orgId;
}
