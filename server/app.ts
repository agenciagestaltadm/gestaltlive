/**
 * API HTTP (Hono). Toda regra de negócio, autenticação e autorização acontece aqui.
 *  /api/auth/*        autenticação de administradores/palestrantes (cookie httpOnly)
 *  /api/admin/*       administração e controle ao vivo (cookie + checagem de Origin)
 *  /api/public/*      dados públicos da sessão, cadastro e recuperação (rate limit por IP)
 *  /api/p/:code/*     operações do participante (Bearer token de participação)
 *  /api/screen/:code  estado do telão (token de exibição)
 */
import { Hono, type Context } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import QRCode from "qrcode";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppContext } from "./context";
import { eventSessions } from "./db/schema";
import { body, bearer, clientIp, errorResponse, q, requestOrigin, requireActor, requireOrgId, type Env } from "./http/helpers";
import { changePassword, login, logout, SESSION_COOKIE, SESSION_TTL_MS } from "./auth/auth";
import { authorize, can, permissionsFor } from "./auth/permissions";
import { AppError, badRequest, notFound, tooMany } from "./lib/errors";
import { authorizeRealtime } from "./realtime/auth";
import { tickSession } from "./realtime/tick";
import { runRetention } from "./domains/retention";
import { processOutbox } from "./domains/integrations";
import { log } from "./lib/logger";
import * as orgs from "./domains/orgs";
import * as eventsSvc from "./domains/events";
import * as questionsSvc from "./domains/questions";
import * as sessionsSvc from "./domains/sessions";
import * as live from "./domains/live";
import * as participantsSvc from "./domains/participants";
import { submitAnswer } from "./domains/answers";
import { vote } from "./domains/satisfaction";
import { controlState, participantState, presentationOf, screenState } from "./domains/views";
import { computeResults } from "./domains/results";
import { computeRanking, disqualify, invalidateRanking, listAwards, myStanding, reinstate } from "./domains/leaderboard";
import { adjustScore } from "./domains/scoring";
import * as reports from "./domains/reports";
import * as crm from "./domains/crm";
import * as integrations from "./domains/integrations";
import { audit, listAudit } from "./domains/audit";
import { saveUpload, readUpload } from "./domains/uploads";
import * as assets from "./domains/assets";
import * as pres from "./domains/presentations";
import * as wordcloud from "./domains/wordcloud";
import { RT } from "@shared/types";
import { presenterCommand, presenterSnapshot } from "./domains/presenter";
import { disqualifySchema, loginSchema, orgCreateSchema, registrationConfigSchema, scoreAdjustmentSchema, SCREENS, userCreateSchema } from "@shared/schemas";
import { prizeAwards, sessionParticipants, sessionQuestions, participants as participantsTable } from "./db/schema";
import { and, ilike, or, desc, sql } from "drizzle-orm";

const uuid = z.uuid();
const pid = (v: string) => uuid.parse(v);

export function createApp(ctx: AppContext) {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    const started = Date.now();
    try {
      await next();
    } finally {
      // modo serverless: publica no Supabase Realtime os eventos gerados por esta requisição antes de responder
      await ctx.rt.drain();
    }
    c.header("Cache-Control", c.res.headers.get("Cache-Control") ?? "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    const ms = Date.now() - started;
    if (ms > 1000) log.warn("requisição lenta", { method: c.req.method, path: c.req.path, ms, status: c.res.status });
    else log.debug("requisição", { method: c.req.method, path: c.req.path, ms, status: c.res.status });
  });

  app.onError((err, c) => {
    const handled = errorResponse(err, c);
    if (handled) return handled;
    log.error("erro não tratado", { err, path: c.req.path });
    return c.json({ error: { code: "ERRO_INTERNO", message: "Erro interno. Tente novamente." } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: "NAO_ENCONTRADO", message: "Rota não encontrada." } }, 404));

  const tooLarge = bodyLimit({ maxSize: 6 * 1024 * 1024, onError: (c) => c.json({ error: { code: "MUITO_GRANDE", message: "Requisição muito grande." } }, 413) });
  const slideLimit = bodyLimit({ maxSize: assets.MAX_SLIDE_BYTES + 512 * 1024, onError: (c) => c.json({ error: { code: "MUITO_GRANDE", message: "Slide maior que o limite de 20 MB." } }, 413) });
  // slides do Canva podem ser grandes: limite próprio para o envio de slides
  app.use("/api/*", (c, next) => (c.req.method === "POST" && c.req.path === "/api/admin/assets" ? slideLimit(c, next) : tooLarge(c, next)));

  app.get("/api/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

  /* ============================================================ tempo real (ticket, tick, sinal de vida) */
  const rtIdentity = async (c: Context<Env>) => {
    ctx.limits.join.enforce(`rt:${clientIp(c, ctx)}`);
    const auth = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = await authorizeRealtime(ctx, auth ?? {}, getCookie(c, SESSION_COOKIE));
    if (!id) throw new AppError(403, "NAO_AUTORIZADO", "Acesso ao tempo real negado.");
    return id;
  };
  /** Informa ao cliente como se conectar: Socket.IO (servidor próprio) ou canais do Supabase Realtime. */
  app.post("/api/realtime/ticket", async (c) => {
    const id = await rtIdentity(c);
    if (ctx.rt.mode !== "supabase") return c.json({ transport: "socket", serverNow: Date.now() });
    return c.json({
      transport: "supabase",
      url: ctx.rt.supabase?.url ?? "",
      anonKey: ctx.rt.supabase?.anonKey ?? "",
      topics: ctx.rt.topicsFor(id),
      tick: id.role !== "participant",
      heartbeat: id.role === "participant",
      serverNow: Date.now(),
    });
  });
  app.post("/api/realtime/tick", async (c) => {
    const id = await rtIdentity(c);
    if (id.role === "participant") throw new AppError(403, "NAO_AUTORIZADO", "Apenas o telão e o painel executam o tick.");
    const r = ctx.rt.mode === "supabase" ? await tickSession(ctx, id.sessionId) : { ran: false };
    return c.json({ ...r, serverNow: Date.now() });
  });
  app.post("/api/realtime/heartbeat", async (c) => {
    const id = await rtIdentity(c);
    if (id.role === "participant" && id.spId) {
      ctx.limits.participant.enforce(`hb:${id.spId}`);
      if (ctx.rt.mode === "supabase") await ctx.rt.touch(id.spId);
      else ctx.rt.heartbeat(id.spId);
    }
    return c.json({ ok: true, serverNow: Date.now() });
  });

  /** Manutenção diária (Vercel Cron): retenção LGPD e webhooks pendentes. Protegida por CRON_SECRET. */
  app.get("/api/cron/maintenance", async (c) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || c.req.header("authorization") !== `Bearer ${secret}`) throw new AppError(401, "NAO_AUTENTICADO", "Não autorizado.");
    const retention = await runRetention(ctx);
    await processOutbox(ctx);
    return c.json({ ok: true, anonymized: retention.reduce((n, o) => n + o.anonymized, 0) });
  });

  /* ============================================================ autenticação */
  app.post("/api/auth/login", async (c) => {
    const input = await body(c, loginSchema);
    const ip = clientIp(c, ctx);
    if (!ctx.limits.login.take(`ip:${ip}`) || !ctx.limits.login.take(`e:${input.email.toLowerCase()}`)) throw tooMany("Muitas tentativas. Aguarde um minuto.");
    const { token } = await login(ctx, input.email, input.password, { ip, userAgent: c.req.header("user-agent") });
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: ctx.config.cookieSecure,
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return c.json({ ok: true });
  });

  app.post("/api/auth/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await logout(ctx, token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  const admin = new Hono<Env>();
  admin.use("*", requireActor(ctx));

  admin.get("/me", (c) => {
    const actor = c.get("actor");
    return c.json({
      user: actor.user,
      memberships: actor.memberships.map((m) => ({ ...m, permissions: permissionsFor(actor, m.orgId) })),
    });
  });
  admin.post("/me/password", async (c) => {
    const { current, next } = await body(c, z.object({ current: z.string().min(1), next: z.string() }));
    await changePassword(ctx, c.get("actor"), current, next);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  /* ============================================================ organizações e membros */
  admin.get("/orgs", async (c) => c.json(await orgs.listOrgs(ctx, c.get("actor"))));
  admin.post("/orgs", async (c) => c.json(await orgs.createOrg(ctx, c.get("actor"), await body(c, orgCreateSchema)), 201));
  admin.get("/orgs/:orgId", async (c) => c.json(await orgs.getOrg(ctx, c.get("actor"), pid(c.req.param("orgId")))));
  admin.patch("/orgs/:orgId", async (c) =>
    c.json(await orgs.updateOrg(ctx, c.get("actor"), pid(c.req.param("orgId")), await body(c, orgCreateSchema.partial().extend({ isActive: z.boolean().optional() })))),
  );
  admin.get("/orgs/:orgId/members", async (c) => c.json(await orgs.listMembers(ctx, c.get("actor"), pid(c.req.param("orgId")))));
  admin.post("/orgs/:orgId/members", async (c) => c.json(await orgs.addMember(ctx, c.get("actor"), pid(c.req.param("orgId")), await body(c, userCreateSchema)), 201));
  admin.patch("/orgs/:orgId/members/:memberId", async (c) => {
    const { role } = await body(c, z.object({ role: z.enum(["ORG_ADMIN", "SPEAKER"]) }));
    await orgs.updateMemberRole(ctx, c.get("actor"), pid(c.req.param("orgId")), pid(c.req.param("memberId")), role);
    return c.json({ ok: true });
  });
  admin.delete("/orgs/:orgId/members/:memberId", async (c) => {
    await orgs.removeMember(ctx, c.get("actor"), pid(c.req.param("orgId")), pid(c.req.param("memberId")));
    return c.json({ ok: true });
  });
  /* ============================================================ integrações (webhook opcional) */
  admin.get("/orgs/:orgId/integrations", async (c) => c.json(await integrations.getIntegrations(ctx, c.get("actor"), pid(c.req.param("orgId")))));
  admin.put("/orgs/:orgId/integrations/webhook", async (c) =>
    c.json(await integrations.saveWebhook(ctx, c.get("actor"), pid(c.req.param("orgId")), await body(c))),
  );
  admin.delete("/orgs/:orgId/integrations/webhook", async (c) => {
    await integrations.deleteWebhook(ctx, c.get("actor"), pid(c.req.param("orgId")));
    return c.json({ ok: true });
  });
  admin.post("/orgs/:orgId/integrations/webhook/rotate-secret", async (c) =>
    c.json(await integrations.rotateWebhookSecret(ctx, c.get("actor"), pid(c.req.param("orgId")))),
  );
  admin.post("/orgs/:orgId/integrations/webhook/test", async (c) => c.json(await integrations.testWebhook(ctx, c.get("actor"), pid(c.req.param("orgId")))));
  admin.post("/orgs/:orgId/integrations/outbox/:id/retry", async (c) => {
    await integrations.retryOutboxItem(ctx, c.get("actor"), pid(c.req.param("orgId")), pid(c.req.param("id")));
    return c.json({ ok: true });
  });
  admin.get("/global", async (c) => c.json(await orgs.globalOverview(ctx, c.get("actor"))));
  admin.get("/audit", async (c) => {
    const orgId = requireOrgId(c);
    authorize(c.get("actor"), orgId, "audit.read");
    return c.json(await listAudit(ctx, orgId, Number(q(c, "limit") ?? 200), q(c, "entityType")));
  });

  /* ============================================================ eventos */
  admin.get("/events", async (c) => c.json(await eventsSvc.listEvents(ctx, c.get("actor"), requireOrgId(c), { archived: q(c, "archived") === "1" })));
  admin.post("/events", async (c) => c.json(await eventsSvc.createEvent(ctx, c.get("actor"), requireOrgId(c), await body(c)), 201));
  admin.get("/events/:id", async (c) => c.json(await eventsSvc.getEvent(ctx, c.get("actor"), pid(c.req.param("id")))));
  admin.put("/events/:id", async (c) => c.json(await eventsSvc.updateEvent(ctx, c.get("actor"), pid(c.req.param("id")), await body(c))));
  admin.delete("/events/:id", async (c) => {
    await eventsSvc.deleteEvent(ctx, c.get("actor"), pid(c.req.param("id")));
    return c.json({ ok: true });
  });
  admin.post("/events/:id/archive", async (c) => {
    const { archived } = await body(c, z.object({ archived: z.boolean() }));
    await eventsSvc.setEventArchived(ctx, c.get("actor"), pid(c.req.param("id")), archived);
    return c.json({ ok: true });
  });
  admin.post("/events/:id/duplicate", async (c) => c.json(await eventsSvc.duplicateEvent(ctx, c.get("actor"), pid(c.req.param("id"))), 201));
  admin.put("/events/:id/custom-fields", async (c) => c.json(await eventsSvc.setCustomFields(ctx, c.get("actor"), pid(c.req.param("id")), await body(c))));
  admin.get("/events/:id/prizes", async (c) => c.json(await eventsSvc.listPrizes(ctx, c.get("actor"), pid(c.req.param("id")))));
  admin.put("/events/:id/prizes", async (c) => c.json(await eventsSvc.setPrizes(ctx, c.get("actor"), pid(c.req.param("id")), await body(c))));
  admin.post("/events/:id/save-template", async (c) => {
    const { name, description } = await body(c, z.object({ name: z.string().trim().min(1).max(160), description: z.string().max(2000).nullable().optional() }));
    return c.json(await eventsSvc.saveEventAsTemplate(ctx, c.get("actor"), pid(c.req.param("id")), name, description ?? null), 201);
  });

  /* ============================================================ perguntas */
  admin.get("/events/:id/questions", async (c) => c.json(await questionsSvc.listQuestions(ctx, c.get("actor"), pid(c.req.param("id")))));
  admin.post("/events/:id/questions", async (c) => c.json(await questionsSvc.createQuestion(ctx, c.get("actor"), pid(c.req.param("id")), await body(c)), 201));
  admin.put("/events/:id/questions/order", async (c) => {
    const { ids } = await body(c, z.object({ ids: z.array(z.uuid()).max(500) }));
    await questionsSvc.reorderQuestions(ctx, c.get("actor"), pid(c.req.param("id")), ids);
    return c.json({ ok: true });
  });
  admin.get("/events/:id/questions/export", async (c) => {
    const data = await questionsSvc.exportEventQuestions(ctx, c.get("actor"), pid(c.req.param("id")));
    c.header("Content-Disposition", `attachment; filename="questionario.json"`);
    return c.json(data);
  });
  admin.post("/events/:id/questions/import", async (c) => c.json(await questionsSvc.importEventQuestions(ctx, c.get("actor"), pid(c.req.param("id")), await body(c))));
  admin.get("/questions/:id", async (c) => c.json(await questionsSvc.getQuestion(ctx, c.get("actor"), pid(c.req.param("id")))));
  admin.put("/questions/:id", async (c) => {
    const raw = await body<Record<string, unknown>>(c);
    const status = raw.status === "RASCUNHO" || raw.status === "PRONTA" ? raw.status : undefined;
    delete raw.status;
    return c.json(await questionsSvc.updateQuestion(ctx, c.get("actor"), pid(c.req.param("id")), raw, status));
  });
  admin.post("/questions/:id/status", async (c) => {
    const { status } = await body(c, z.object({ status: z.enum(["RASCUNHO", "PRONTA"]) }));
    await questionsSvc.setQuestionStatus(ctx, c.get("actor"), pid(c.req.param("id")), status);
    return c.json({ ok: true });
  });
  admin.delete("/questions/:id", async (c) => {
    await questionsSvc.deleteQuestion(ctx, c.get("actor"), pid(c.req.param("id")));
    return c.json({ ok: true });
  });
  admin.post("/questions/:id/duplicate", async (c) => c.json(await questionsSvc.duplicateQuestion(ctx, c.get("actor"), pid(c.req.param("id"))), 201));
  admin.post("/questions/:id/bank", async (c) => c.json(await questionsSvc.saveToBank(ctx, c.get("actor"), pid(c.req.param("id"))), 201));
  admin.get("/bank", async (c) => c.json(await questionsSvc.listBank(ctx, c.get("actor"), requireOrgId(c))));
  admin.post("/bank", async (c) => c.json(await questionsSvc.createBankQuestion(ctx, c.get("actor"), requireOrgId(c), await body(c)), 201));
  admin.post("/bank/:id/use", async (c) => {
    const { eventId } = await body(c, z.object({ eventId: z.uuid() }));
    return c.json(await questionsSvc.useBankQuestion(ctx, c.get("actor"), pid(c.req.param("id")), eventId), 201);
  });

  /* ============================================================ templates */
  admin.get("/templates", async (c) => c.json(await eventsSvc.listTemplates(ctx, c.get("actor"), requireOrgId(c))));
  admin.post("/templates/import", async (c) => c.json(await eventsSvc.importTemplate(ctx, c.get("actor"), requireOrgId(c), await body(c)), 201));
  admin.get("/templates/:id", async (c) => c.json(await eventsSvc.getTemplate(ctx, c.get("actor"), pid(c.req.param("id")))));
  admin.delete("/templates/:id", async (c) => {
    await eventsSvc.deleteTemplate(ctx, c.get("actor"), pid(c.req.param("id")));
    return c.json({ ok: true });
  });
  admin.post("/templates/:id/create-event", async (c) => c.json(await eventsSvc.createEventFromTemplate(ctx, c.get("actor"), pid(c.req.param("id")), await body(c)), 201));

  /* ============================================================ sessões */
  admin.get("/sessions", async (c) => {
    const statuses = q(c, "status")?.split(",");
    return c.json(await sessionsSvc.listOrgSessions(ctx, c.get("actor"), requireOrgId(c), statuses));
  });
  admin.get("/events/:id/sessions", async (c) => c.json(await sessionsSvc.listSessions(ctx, c.get("actor"), pid(c.req.param("id")))));
  admin.post("/events/:id/sessions", async (c) => c.json(await sessionsSvc.createSession(ctx, c.get("actor"), pid(c.req.param("id")), await body(c)), 201));
  admin.get("/sessions/:id", async (c) => c.json(await sessionsSvc.getSessionAdmin(ctx, c.get("actor"), pid(c.req.param("id")), requestOrigin(c, ctx))));
  admin.put("/sessions/:id", async (c) => c.json(await sessionsSvc.updateSession(ctx, c.get("actor"), pid(c.req.param("id")), await body(c))));
  admin.delete("/sessions/:id", async (c) => {
    await sessionsSvc.deleteSession(ctx, c.get("actor"), pid(c.req.param("id")));
    return c.json({ ok: true });
  });
  admin.post("/sessions/:id/screen-token", async (c) => c.json(await sessionsSvc.regenerateScreenToken(ctx, c.get("actor"), pid(c.req.param("id")), requestOrigin(c, ctx))));

  /* ============================================================ controle ao vivo */
  const controlResponse = async (c: Context<Env>, id: string) => {
    const s = await sessionsSvc.loadSession(ctx, c.get("actor"), id, "session.control");
    return c.json(await controlState(ctx, s, requestOrigin(c, ctx)));
  };
  admin.get("/sessions/:id/control", async (c) => controlResponse(c, pid(c.req.param("id"))));
  for (const action of ["lobby", "start", "pause", "resume", "end", "cancel"] as const) {
    admin.post(`/sessions/:id/${action}`, async (c) => {
      const id = pid(c.req.param("id"));
      await live.sessionAction(ctx, c.get("actor"), id, action);
      return controlResponse(c, id);
    });
  }
  admin.post("/sessions/:id/next", async (c) => {
    const id = pid(c.req.param("id"));
    await live.nextQuestion(ctx, c.get("actor"), id);
    return controlResponse(c, id);
  });
  /* ------------------------------------------------------------ nuvem de palavras: moderação */
  admin.get("/sessions/:id/questions/:sqId/wordcloud", async (c) => {
    const status = z.enum(["APROVADA", "PENDENTE", "REJEITADA"]).optional().parse(q(c, "status"));
    return c.json(await wordcloud.listWordCloudEntries(ctx, c.get("actor"), pid(c.req.param("id")), pid(c.req.param("sqId")), { status }));
  });
  admin.post("/sessions/:id/questions/:sqId/wordcloud/entries/:entryId/:decision", async (c) => {
    const decision = z.enum(["approve", "reject"]).parse(c.req.param("decision"));
    return c.json(await wordcloud.moderateWordCloudEntry(ctx, c.get("actor"), pid(c.req.param("id")), pid(c.req.param("sqId")), pid(c.req.param("entryId")), decision));
  });
  admin.post("/sessions/:id/questions/:sqId/wordcloud/terms", async (c) => {
    const input = await body(c, z.object({ term: z.string().trim().min(1).max(200), action: z.enum(["hide", "block", "restore"]) }));
    return c.json(await wordcloud.setWordCloudTermRule(ctx, c.get("actor"), pid(c.req.param("id")), pid(c.req.param("sqId")), input));
  });
  admin.post("/sessions/:id/questions/:sqId/:action", async (c) => {
    const id = pid(c.req.param("id"));
    const sqId = pid(c.req.param("sqId"));
    const action = c.req.param("action");
    const actor = c.get("actor");
    switch (action) {
      case "open":
        await live.openQuestion(ctx, actor, id, sqId);
        break;
      case "close":
        await live.closeQuestion(ctx, actor, id, sqId);
        break;
      case "timer-pause":
        await live.timerAction(ctx, actor, id, sqId, "pause");
        break;
      case "timer-start":
        await live.timerAction(ctx, actor, id, sqId, "start");
        break;
      case "timer-add": {
        const { seconds } = await body(c, z.object({ seconds: z.number().int() }));
        await live.timerAction(ctx, actor, id, sqId, "add", seconds);
        break;
      }
      case "show-results":
        await live.resultsAction(ctx, actor, id, sqId, "show");
        break;
      case "hide-results":
        await live.resultsAction(ctx, actor, id, sqId, "hide");
        break;
      case "reveal":
        await live.revealCorrect(ctx, actor, id, sqId);
        break;
      default:
        throw notFound();
    }
    return controlResponse(c, id);
  });
  admin.post("/sessions/:id/presentation", async (c) => {
    const id = pid(c.req.param("id"));
    const input = await body(
      c,
      z.object({
        screen: z.enum(SCREENS).optional(),
        sessionQuestionId: z.uuid().nullable().optional(),
        back: z.boolean().optional(),
        showSatisfactionToScreen: z.boolean().optional(),
      }),
    );
    await live.presentationAction(ctx, c.get("actor"), id, input);
    return controlResponse(c, id);
  });
  admin.post("/sessions/:id/leaderboard", async (c) => {
    const id = pid(c.req.param("id"));
    const input = await body(c, z.object({ hidden: z.boolean().optional(), frozen: z.boolean().optional() }));
    await live.leaderboardAction(ctx, c.get("actor"), id, input);
    return controlResponse(c, id);
  });
  admin.get("/sessions/:id/results/:sqId", async (c) => {
    const s = await sessionsSvc.loadSession(ctx, c.get("actor"), pid(c.req.param("id")), "session.control");
    const [sq] = await ctx.db.select().from(sessionQuestions).where(eq(sessionQuestions.id, pid(c.req.param("sqId"))));
    if (!sq || sq.sessionId !== s.id) throw notFound();
    const cross = q(c, "cross");
    return c.json(await computeResults(ctx.db, sq, { includeCorrect: true, crossQuestionId: cross === undefined ? undefined : cross === "none" ? null : pid(cross) }));
  });
  admin.get("/sessions/:id/leaderboard", async (c) => {
    const s = await sessionsSvc.loadSession(ctx, c.get("actor"), pid(c.req.param("id")), "session.control");
    return c.json(await computeRanking(ctx.db, s.id, false));
  });
  admin.get("/sessions/:id/participants", async (c) => {
    const s = await sessionsSvc.loadSession(ctx, c.get("actor"), pid(c.req.param("id")), "session.control");
    const search = q(c, "q");
    const canSeeContacts = can(c.get("actor"), s.orgId, "participants.read");
    const rows = await ctx.db
      .select({
        id: sessionParticipants.id,
        displayName: sessionParticipants.displayName,
        fullName: participantsTable.fullName,
        email: participantsTable.email,
        phone: participantsTable.phone,
        score: sessionParticipants.score,
        correctCount: sessionParticipants.correctCount,
        joinedAt: sessionParticipants.joinedAt,
        lastSeenAt: sessionParticipants.lastSeenAt,
        disqualifiedAt: sessionParticipants.disqualifiedAt,
      })
      .from(sessionParticipants)
      .innerJoin(participantsTable, eq(participantsTable.id, sessionParticipants.participantId))
      .where(
        and(
          eq(sessionParticipants.sessionId, s.id),
          search
            ? or(ilike(sessionParticipants.displayName, `%${search}%`), ilike(participantsTable.fullName, `%${search}%`), ilike(participantsTable.email, `%${search}%`))
            : sql`true`,
        ),
      )
      .orderBy(desc(sessionParticipants.joinedAt))
      .limit(500);
    const online = new Set(await ctx.rt.connectedIds(s.id));
    // palestrantes veem apenas o nome; contatos ficam restritos a administradores
    return c.json(rows.map((r) => ({ ...r, email: canSeeContacts ? r.email : null, phone: canSeeContacts ? r.phone : null, online: online.has(r.id) })));
  });
  admin.post("/sessions/:id/participants/:spId/recovery-code", async (c) =>
    c.json(await participantsSvc.issueRecoveryCode(ctx, c.get("actor"), pid(c.req.param("id")), pid(c.req.param("spId")))),
  );

  /* ============================================================ revisão de resultados e prêmios */
  admin.post("/sessions/:id/disqualify", async (c) => {
    const s = await sessionsSvc.loadSession(ctx, c.get("actor"), pid(c.req.param("id")), "results.review");
    const input = await body(c, disqualifySchema);
    await ctx.db.transaction((tx) => disqualify(ctx, tx, c.get("actor"), s, input.sessionParticipantId, input.reason));
    ctx.rt.leaderboardDirty(s.id, true);
    return c.json({ ok: true });
  });
  admin.post("/sessions/:id/reinstate", async (c) => {
    const s = await sessionsSvc.loadSession(ctx, c.get("actor"), pid(c.req.param("id")), "results.review");
    const input = await body(c, disqualifySchema);
    await ctx.db.transaction((tx) => reinstate(ctx, tx, c.get("actor"), s, input.sessionParticipantId, input.reason));
    ctx.rt.leaderboardDirty(s.id, true);
    return c.json({ ok: true });
  });
  admin.post("/sessions/:id/adjust-score", async (c) => {
    const s = await sessionsSvc.loadSession(ctx, c.get("actor"), pid(c.req.param("id")), "results.review");
    if (s.finalizedAt) throw badRequest("O resultado oficial já foi finalizado. Use a desclassificação justificada para revisar o pódio.");
    const input = await body(c, scoreAdjustmentSchema);
    const [sp] = await ctx.db.select().from(sessionParticipants).where(and(eq(sessionParticipants.id, input.sessionParticipantId), eq(sessionParticipants.sessionId, s.id)));
    if (!sp) throw notFound("Participante não encontrado.");
    await ctx.db.transaction((tx) => adjustScore(tx, c.get("actor"), s.orgId, s.id, sp.id, input.points, input.reason));
    invalidateRanking(s.id);
    ctx.rt.leaderboardDirty(s.id, true);
    return c.json({ ok: true });
  });
  admin.get("/sessions/:id/awards", async (c) => {
    const s = await sessionsSvc.loadSession(ctx, c.get("actor"), pid(c.req.param("id")), "prizes.deliver");
    return c.json(await listAwards(ctx.db, s.id));
  });
  admin.post("/awards/:id/deliver", async (c) => {
    const id = pid(c.req.param("id"));
    const { notes } = await body(c, z.object({ notes: z.string().max(1000).nullable().optional() }));
    const [a] = await ctx.db.select().from(prizeAwards).where(eq(prizeAwards.id, id));
    if (!a) throw notFound();
    authorize(c.get("actor"), a.orgId, "prizes.deliver");
    if (a.status !== "PENDENTE") throw badRequest("Este prêmio não está pendente de entrega.");
    await ctx.db.transaction(async (tx) => {
      await tx.update(prizeAwards).set({ status: "ENTREGUE", deliveredAt: ctx.now(), deliveredByUserId: c.get("actor").user.id, notes: notes ?? null }).where(eq(prizeAwards.id, id));
      await audit(tx, c.get("actor"), a.orgId, "prize.deliver", "prize_award", id, { notes });
    });
    return c.json({ ok: true });
  });

  /* ============================================================ relatórios */
  admin.get("/sessions/:id/report", async (c) =>
    c.json(
      await reports.sessionReport(ctx, c.get("actor"), pid(c.req.param("id")), {
        fieldKey: q(c, "fieldKey"),
        fieldValue: q(c, "fieldValue"),
        profileSqId: q(c, "profileSqId"),
        profileOptionId: q(c, "profileOptionId"),
      }),
    ),
  );
  admin.get("/sessions/:id/export.csv", async (c) => {
    const kind = z.enum(["ranking", "respostas", "participantes", "nuvem"]).parse(q(c, "kind") ?? "ranking");
    const csv = await reports.exportSessionCsv(ctx, c.get("actor"), pid(c.req.param("id")), kind);
    return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${kind}.csv"` });
  });
  admin.get("/sessions/:id/export.xlsx", async (c) => {
    const buf = await reports.exportSessionXlsx(ctx, c.get("actor"), pid(c.req.param("id")));
    return c.body(new Uint8Array(buf), 200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="relatorio-sessao.xlsx"`,
    });
  });
  admin.get("/reports/sessions", async (c) =>
    c.json(
      await reports.sessionsOverview(ctx, c.get("actor"), requireOrgId(c), {
        eventId: q(c, "eventId"),
        from: q(c, "from"),
        to: q(c, "to"),
        speakerUserId: q(c, "speakerUserId"),
      }),
    ),
  );
  admin.get("/reports/compare", async (c) => c.json(await reports.compareSessions(ctx, c.get("actor"), pid(q(c, "eventId") ?? ""))));

  /* ============================================================ CRM */
  const crmFilter = (c: Context<Env>): crm.ParticipantFilter => ({
    q: q(c, "q"),
    eventId: q(c, "eventId"),
    sessionId: q(c, "sessionId"),
    marketing: q(c, "marketing") as "sim" | "nao" | undefined,
    fieldKey: q(c, "fieldKey"),
    fieldValue: q(c, "fieldValue"),
    questionId: q(c, "questionId"),
    optionId: q(c, "optionId"),
    page: Number(q(c, "page") ?? 1),
    pageSize: Number(q(c, "pageSize") ?? 50),
  });
  admin.get("/participants", async (c) => c.json(await crm.listParticipants(ctx, c.get("actor"), requireOrgId(c), crmFilter(c))));
  admin.get("/participants/export.csv", async (c) => {
    const csv = await crm.exportParticipantsCsv(ctx, c.get("actor"), requireOrgId(c), crmFilter(c));
    return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="participantes.csv"` });
  });
  admin.get("/participants/:id", async (c) => c.json(await crm.participantDetail(ctx, c.get("actor"), pid(c.req.param("id")))));
  admin.post("/participants/:id/revoke-marketing", async (c) => {
    const { reason } = await body(c, z.object({ reason: z.string().trim().min(5).max(500) }));
    await crm.adminSetMarketing(ctx, c.get("actor"), pid(c.req.param("id")), false, reason);
    return c.json({ ok: true });
  });
  admin.post("/participants/:id/anonymize", async (c) => {
    const { reason } = await body(c, z.object({ reason: z.string().trim().min(5).max(500) }));
    await crm.anonymizeParticipant(ctx, c.get("actor"), pid(c.req.param("id")), reason);
    return c.json({ ok: true });
  });

  /* ============================================================ uploads */
  admin.post("/uploads", async (c) => {
    const orgId = requireOrgId(c);
    authorize(c.get("actor"), orgId, "event.write");
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("Envie um arquivo no campo 'file'.");
    return c.json(await saveUpload(ctx, orgId, file), 201);
  });

  /* ============================================================ gerenciador de apresentações */
  admin.get("/assets", async (c) =>
    c.json(await assets.listAssets(ctx, c.get("actor"), requireOrgId(c), { q: q(c, "q"), folder: q(c, "folder"), page: Number(q(c, "page") ?? 1), pageSize: Number(q(c, "pageSize") ?? 60) })),
  );
  admin.post("/assets", async (c) => {
    const orgId = requireOrgId(c);
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("Envie um arquivo no campo 'file'.");
    const folder = typeof form.get("folder") === "string" ? (form.get("folder") as string) : null;
    const r = await assets.uploadAsset(ctx, c.get("actor"), orgId, file, folder);
    return c.json(r, r.reused ? 200 : 201);
  });
  // envio direto ao Supabase Storage (Vercel): prepara a URL assinada e depois processa o arquivo recebido
  admin.get("/assets/upload-config", (c) => c.json(assets.uploadConfig(ctx)));
  admin.post("/assets/direct", async (c) => {
    const input = await body(c, z.object({ name: z.string().trim().min(1).max(255), size: z.number().int().min(0), type: z.string().max(100) }));
    return c.json(await assets.createDirectUpload(ctx, c.get("actor"), requireOrgId(c), input), 201);
  });
  admin.post("/assets/direct/complete", async (c) => {
    const input = await body(c, z.object({ key: z.string().max(200), name: z.string().trim().min(1).max(255), folder: z.string().trim().max(80).nullable().optional() }));
    const r = await assets.importDirectUpload(ctx, c.get("actor"), requireOrgId(c), { key: input.key, name: input.name, folder: input.folder ?? null });
    return c.json(r, r.reused ? 200 : 201);
  });
  admin.patch("/assets/:id", async (c) =>
    c.json(await assets.updateAsset(ctx, c.get("actor"), pid(c.req.param("id")), await body(c, z.object({ folder: z.string().max(80).nullable().optional(), originalName: z.string().min(1).max(200).optional() })))),
  );
  admin.get("/assets/:id/usage", async (c) => c.json(await assets.assetUsage(ctx, c.get("actor"), pid(c.req.param("id")))));
  admin.delete("/assets/:id", async (c) => {
    await assets.deleteAsset(ctx, c.get("actor"), pid(c.req.param("id")));
    return c.json({ ok: true });
  });
  admin.get("/presentations", async (c) => c.json(await pres.listPresentations(ctx, c.get("actor"), requireOrgId(c), { eventId: q(c, "eventId") })));
  admin.post("/presentations", async (c) => c.json(await pres.createPresentation(ctx, c.get("actor"), requireOrgId(c), await body(c)), 201));
  admin.get("/presentations/:id", async (c) => c.json(await pres.getPresentation(ctx, c.get("actor"), pid(c.req.param("id")))));
  admin.put("/presentations/:id", async (c) => c.json(await pres.updatePresentation(ctx, c.get("actor"), pid(c.req.param("id")), await body(c))));
  admin.delete("/presentations/:id", async (c) => {
    await pres.deletePresentation(ctx, c.get("actor"), pid(c.req.param("id")));
    return c.json({ ok: true });
  });
  admin.put("/presentations/:id/items", async (c) => c.json(await pres.replaceItems(ctx, c.get("actor"), pid(c.req.param("id")), await body(c))));
  admin.post("/presentations/:id/slides", async (c) => {
    const input = await body(c, z.object({ assetIds: z.array(z.uuid()).min(1).max(1000), insertAt: z.number().int().min(0).nullable().optional(), order: z.enum(["natural", "pedida"]).optional() }));
    return c.json(await pres.addSlides(ctx, c.get("actor"), pid(c.req.param("id")), input.assetIds, input.insertAt, input.order));
  });
  admin.post("/presentations/:id/duplicate", async (c) => {
    const input = await body(c, z.object({ targetEventId: z.uuid().nullable().optional(), title: z.string().max(160).nullable().optional() }));
    return c.json(await pres.duplicatePresentation(ctx, c.get("actor"), pid(c.req.param("id")), input), 201);
  });
  const presenterResponse = async (c: Context<Env>, id: string) => {
    const s = await sessionsSvc.loadSession(ctx, c.get("actor"), id, "session.control");
    return c.json({ control: await controlState(ctx, s, requestOrigin(c, ctx)), presenter: await presenterSnapshot(ctx, s.id) });
  };
  admin.get("/sessions/:id/presenter", async (c) => presenterResponse(c, pid(c.req.param("id"))));
  admin.post("/sessions/:id/presenter", async (c) => {
    const id = pid(c.req.param("id"));
    const cmd = await body(
      c,
      z.discriminatedUnion("action", [
        z.object({ action: z.literal("start") }),
        z.object({ action: z.enum(["next", "prev"]), fromItemId: z.uuid().nullable().optional() }),
        z.object({ action: z.literal("goto"), toItemId: z.uuid() }),
        z.object({ action: z.literal("override"), override: z.enum(["NENHUM", "TELA_PRETA", "PAUSA"]) }),
        z.object({ action: z.literal("finish") }),
      ]),
    );
    const r = await presenterCommand(ctx, c.get("actor"), id, cmd);
    const res = await presenterResponse(c, id);
    const data = (await res.json()) as Record<string, unknown>;
    return c.json({ ...data, result: r });
  });

  app.route("/api/admin", admin);

  // arquivos imutáveis: servidos do disco ou redirecionados para o Supabase Storage (cache na CDN da Vercel)
  const serveFile = (c: Context<Env>, r: { redirect: string } | { data: Buffer; mime: string }) =>
    "redirect" in r
      ? c.body(null, 302, { Location: r.redirect, "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable" })
      : c.body(new Uint8Array(r.data), 200, { "Content-Type": r.mime, "Cache-Control": "public, max-age=31536000, immutable", "Content-Security-Policy": "default-src 'none'" });
  app.get("/api/assets/:orgId/:file", async (c) => serveFile(c, await assets.readAsset(ctx, c.req.param("orgId"), c.req.param("file"))));
  app.get("/api/uploads/:orgId/:name", async (c) => serveFile(c, await readUpload(ctx, c.req.param("orgId"), c.req.param("name"))));

  /* ============================================================ público */
  const lookup = (c: Context<Env>) => {
    if (!ctx.limits.lookup.take(`ip:${clientIp(c, ctx)}`)) throw tooMany();
  };
  const publicSession = async (code: string) => {
    const s = await sessionsSvc.sessionByCode(ctx.db, code);
    // sessões em rascunho não são expostas (dificulta enumeração e vazamento antecipado)
    if (!s || s.status === "RASCUNHO") throw notFound("Sessão não encontrada. Confira o código.");
    return s;
  };
  app.get("/api/public/sessions/:code", async (c) => {
    lookup(c);
    const s = await publicSession(c.req.param("code"));
    return c.json(await sessionsSvc.publicSessionDTO(ctx.db, ctx, s, requestOrigin(c, ctx)));
  });
  app.get("/api/public/sessions/:code/registration", async (c) => {
    lookup(c);
    const s = await publicSession(c.req.param("code"));
    return c.json(await participantsSvc.registrationForm(ctx.db, s));
  });
  app.get("/api/public/sessions/:code/qr.svg", async (c) => {
    lookup(c);
    const s = await publicSession(c.req.param("code"));
    const svg = await QRCode.toString(sessionsSvc.joinUrl(ctx, s.code, requestOrigin(c, ctx)), {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0B1736", light: "#FFFFFF" },
    });
    return c.body(svg, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=300" });
  });
  app.post("/api/public/sessions/:code/join", async (c) => {
    const ip = clientIp(c, ctx);
    if (!ctx.limits.join.take(`ip:${ip}`)) throw tooMany();
    const result = await participantsSvc.joinSession(ctx, c.req.param("code"), await body(c), { ip, userAgent: c.req.header("user-agent") });
    return c.json(result, 201);
  });
  app.post("/api/public/sessions/:code/recover", async (c) => {
    const ip = clientIp(c, ctx);
    const code = c.req.param("code").toUpperCase();
    // anti força-bruta: limites por IP e por sessão
    if (!ctx.limits.login.take(`rec:${ip}`) || !ctx.limits.login.take(`recs:${code}`)) throw tooMany("Muitas tentativas. Aguarde um minuto.");
    const { recoveryCode } = await body(c, z.object({ recoveryCode: z.string().trim() }));
    return c.json(await participantsSvc.recoverAccess(ctx, code, recoveryCode));
  });

  /* ============================================================ participante */
  const part = new Hono<Env>();
  const auth = async (c: Context<Env>) => {
    const a = await participantsSvc.participantFromToken(ctx.db, c.req.param("code") ?? "", bearer(c));
    ctx.limits.participant.enforce(`sp:${a.sp.id}`);
    return a;
  };
  part.get("/:code/state", async (c) => c.json(await participantState(ctx, await auth(c), requestOrigin(c, ctx))));
  part.get("/:code/me", async (c) => {
    const a = await auth(c);
    const pres = await presentationOf(ctx.db, a.session.id);
    const [s] = await ctx.db.select().from(eventSessions).where(eq(eventSessions.id, a.session.id));
    return c.json(await myStanding(ctx.db, s, pres, a.sp.id));
  });
  part.post("/:code/answers", async (c) => {
    const a = await auth(c);
    ctx.limits.answer.enforce(`sp:${a.sp.id}`);
    try {
      const r = await submitAnswer(ctx, a, await body(c));
      ctx.rt.toParticipant(a.session.id, a.sp.id, "answer:accepted", r);
      return c.json(r, r.outcome === "DUPLICADA" ? 200 : 201);
    } catch (err) {
      const handled = errorResponse(err, c);
      if (handled) ctx.rt.toParticipant(a.session.id, a.sp.id, "answer:rejected", { message: (err as Error).message });
      throw err;
    }
  });
  part.post("/:code/wordcloud", async (c) => {
    const a = await auth(c);
    ctx.limits.wordcloud.enforce(`sp:${a.sp.id}`);
    const input = (await body(c)) as { sessionQuestionId?: string };
    const r = await wordcloud.submitWordCloudEntry(ctx, a, input);
    // outras abas do mesmo participante atualizam a lista de envios
    ctx.rt.toParticipant(a.session.id, a.sp.id, RT.wordCloudEntry, { sessionQuestionId: input.sessionQuestionId, entry: r.entry, remaining: r.remaining });
    return c.json(r, r.outcome === "DUPLICADA" ? 200 : 201);
  });
  part.post("/:code/satisfaction", async (c) => {
    const a = await auth(c);
    ctx.limits.satisfaction.enforce(`sp:${a.sp.id}`);
    return c.json(await vote(ctx, a, await body(c)));
  });
  part.get("/:code/profile", async (c) => c.json(await participantsSvc.participantProfile(ctx, await auth(c))));
  part.patch("/:code/profile", async (c) => {
    const a = await auth(c);
    const { displayName } = await body(c, z.object({ displayName: z.string().trim().min(2).max(30) }));
    return c.json(await participantsSvc.updateDisplayName(ctx, a, displayName));
  });
  part.post("/:code/consent/marketing", async (c) => {
    const a = await auth(c);
    const { granted } = await body(c, z.object({ granted: z.boolean() }));
    const reg = registrationConfigSchema.parse(a.session.registration);
    await participantsSvc.setMarketingConsent(
      ctx,
      a.sp.participantId,
      a.session.orgId,
      granted,
      "PARTICIPANTE",
      { version: reg.consentVersion, snapshot: reg.consentMarketingText },
      { ip: clientIp(c, ctx), userAgent: c.req.header("user-agent") },
      a.sp.id,
    );
    return c.json({ ok: true, granted });
  });
  part.get("/:code/history", async (c) => c.json(await participantsSvc.participantHistory(ctx, await auth(c))));
  app.route("/api/p", part);

  /* ============================================================ telão */
  app.get("/api/screen/:code/state", async (c) => {
    lookup(c);
    const s = await sessionsSvc.sessionByCode(ctx.db, c.req.param("code"));
    if (!s || !sessionsSvc.verifyScreenToken(ctx, s, q(c, "t"))) throw notFound("Link do telão inválido ou expirado.");
    return c.json(await screenState(ctx, s, requestOrigin(c, ctx)));
  });

  return app;
}
