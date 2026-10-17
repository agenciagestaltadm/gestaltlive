/** Outbox de integrações: enfileiramento, consumidor com webhook assinado (servidor HTTP falso) e novas tentativas. */
import http from "node:http";
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { integrationOutbox } from "@server/db/schema";
import { backoffMs, OUTBOX_MAX_ATTEMPTS, processOutbox, validateWebhookUrl } from "@server/domains/integrations";
import { setup, liveDemoSession, ParticipantClient, expectHttpError, type TestEnv } from "./helpers";

interface Received {
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Servidor de webhook falso: grava as requisições e responde com o status configurado. */
class FakeWebhook {
  received: Received[] = [];
  status = 200;
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      this.received.push({ headers: req.headers, body });
      res.statusCode = this.status;
      res.end("ok");
    });
  });
  url = "";
  async start() {
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    const a = this.server.address() as { port: number };
    this.url = `http://127.0.0.1:${a.port}/hook`;
  }
  stop() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }
}

let env: TestEnv;
const hook = new FakeWebhook();
let secret = "";

const outbox = () => env.rt.ctx.db.select().from(integrationOutbox).where(eq(integrationOutbox.orgId, env.orgId));
const integrations = () => env.admin.get(`/api/admin/orgs/${env.orgId}/integrations`);

function verify(r: Received) {
  const ts = String(r.headers["x-gestalt-timestamp"]);
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${r.body}`).digest("hex");
  return r.headers["x-gestalt-signature"] === expected;
}

beforeAll(async () => {
  env = await setup();
  await hook.start();
});
afterAll(async () => {
  await hook.stop();
  await env.close();
});

describe("integrações", () => {
  it("sem webhook configurado nada é enfileirado nem enviado", async () => {
    const s = await liveDemoSession(env, "Sem integração");
    await ParticipantClient.join(env.rt, s.code, 2); // com consentimento de marketing
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/end`);
    expect(await outbox()).toHaveLength(0);
    expect(await processOutbox(env.rt.ctx)).toEqual({ sent: 0, retried: 0, failed: 0 });
    expect(hook.received).toHaveLength(0);
    const cfg = await integrations();
    expect(cfg.webhook).toBeNull();
    expect(cfg.topics.map((t: any) => t.key)).toEqual(["participant.joined", "session.ended"]);
  });

  it("configura o webhook (segredo exibido uma única vez) e audita", async () => {
    await expectHttpError(env.admin.put(`/api/admin/orgs/${env.orgId}/integrations/webhook`, { url: "ftp://x", topics: ["session.ended"] }), 400);
    await expectHttpError(env.admin.put(`/api/admin/orgs/${env.orgId}/integrations/webhook`, { url: hook.url, topics: [] }), 400);
    const r = await env.admin.put(`/api/admin/orgs/${env.orgId}/integrations/webhook`, {
      url: hook.url,
      enabled: true,
      topics: ["participant.joined", "session.ended"],
    });
    expect(r.secret).toMatch(/^whsec_/);
    secret = r.secret;
    expect(r.webhook.secretHint.endsWith(secret.slice(-4))).toBe(true);
    const cfg = await integrations();
    expect(JSON.stringify(cfg)).not.toContain(secret);
    const logs = await env.admin.get(`/api/admin/audit?orgId=${env.orgId}`);
    expect(logs.some((l: any) => l.action === "integration.webhook.create")).toBe(true);
  });

  it("enfileira participant.joined só com consentimento de marketing e session.ended no encerramento", async () => {
    const s = await liveDemoSession(env, "Com integração");
    for (const i of [11, 12, 13, 14]) await ParticipantClient.join(env.rt, s.code, i); // pares consentem
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/end`);
    const rows = await outbox();
    expect(rows.map((r) => r.topic).sort()).toEqual(["participant.joined", "participant.joined", "session.ended"]);
    expect(rows.every((r) => r.status === "PENDENTE")).toBe(true);
    const joined = rows.filter((r) => r.topic === "participant.joined").map((r) => r.payload as any);
    expect(joined.map((p) => p.participant.email).sort()).toEqual(["p12@teste.local", "p14@teste.local"]);
    expect(joined[0].customFields).toHaveProperty("cidade", "São Paulo");
    const ended = rows.find((r) => r.topic === "session.ended")!.payload as any;
    expect(ended.totals.participants).toBe(4);
    expect(JSON.stringify(ended)).not.toMatch(/@teste\.local/);
  });

  it("entrega com assinatura HMAC e marca ENVIADO", async () => {
    const r = await processOutbox(env.rt.ctx);
    expect(r).toEqual({ sent: 3, retried: 0, failed: 0 });
    expect(hook.received).toHaveLength(3);
    for (const req of hook.received) {
      expect(verify(req)).toBe(true);
      expect(req.headers["content-type"]).toBe("application/json");
      const body = JSON.parse(req.body);
      expect(body.topic).toBe(req.headers["x-gestalt-event"]);
      expect(body.id).toBe(req.headers["x-gestalt-delivery"]);
      expect(body.orgId).toBe(env.orgId);
    }
    expect((await outbox()).every((o) => o.status === "ENVIADO" && o.attempts === 1 && o.processedAt)).toBe(true);
    // nada mais a enviar
    expect((await processOutbox(env.rt.ctx)).sent).toBe(0);
    expect((await integrations()).counts).toMatchObject({ ENVIADO: 3, PENDENTE: 0, FALHOU: 0 });
  });

  it("falhas são reagendadas com backoff e desistidas após o limite (FALHOU)", async () => {
    hook.received = [];
    hook.status = 500;
    const s = await liveDemoSession(env, "Falha");
    await ParticipantClient.join(env.rt, s.code, 22);
    const [item] = (await outbox()).filter((o) => o.status === "PENDENTE");

    expect(await processOutbox(env.rt.ctx)).toEqual({ sent: 0, retried: 1, failed: 0 });
    let [row] = await env.rt.ctx.db.select().from(integrationOutbox).where(eq(integrationOutbox.id, item.id));
    expect(row).toMatchObject({ status: "PENDENTE", attempts: 1, lastError: "HTTP 500" });
    expect(row.nextAttemptAt!.getTime()).toBe(env.clock.t + backoffMs(1));

    // antes do prazo do backoff, não tenta de novo
    expect((await processOutbox(env.rt.ctx)).retried).toBe(0);
    expect(hook.received).toHaveLength(1);

    for (let a = 2; a <= OUTBOX_MAX_ATTEMPTS; a++) {
      env.clock.advance(backoffMs(a - 1));
      await processOutbox(env.rt.ctx);
    }
    [row] = await env.rt.ctx.db.select().from(integrationOutbox).where(eq(integrationOutbox.id, item.id));
    expect(row).toMatchObject({ status: "FALHOU", attempts: OUTBOX_MAX_ATTEMPTS, lastError: "HTTP 500" });
    expect(hook.received).toHaveLength(OUTBOX_MAX_ATTEMPTS);
    env.clock.advance(MAX_WAIT);
    expect((await processOutbox(env.rt.ctx)).retried).toBe(0);

    // reenvio manual (auditado) após o destino voltar
    await env.admin.login("admin@teste.local", "SenhaForte123");
    hook.status = 204;
    await env.admin.post(`/api/admin/orgs/${env.orgId}/integrations/outbox/${item.id}/retry`);
    expect((await processOutbox(env.rt.ctx)).sent).toBe(1);
    [row] = await env.rt.ctx.db.select().from(integrationOutbox).where(eq(integrationOutbox.id, item.id));
    expect(row).toMatchObject({ status: "ENVIADO", attempts: 1, lastError: null });
  });

  it("erro de rede conta como tentativa", async () => {
    await env.admin.put(`/api/admin/orgs/${env.orgId}/integrations/webhook`, { url: "http://127.0.0.1:1/fechado", enabled: true, topics: ["participant.joined"] });
    const s = await liveDemoSession(env, "Rede");
    await ParticipantClient.join(env.rt, s.code, 24);
    const r = await processOutbox(env.rt.ctx);
    expect(r.retried).toBe(1);
    const pending = (await outbox()).find((o) => o.status === "PENDENTE")!;
    expect(pending.lastError).toBeTruthy();
  });

  it("webhook desativado retém a fila; remoção cancela pendentes", async () => {
    await env.admin.put(`/api/admin/orgs/${env.orgId}/integrations/webhook`, { url: hook.url, enabled: false, topics: ["participant.joined"] });
    env.clock.advance(MAX_WAIT);
    expect(await processOutbox(env.rt.ctx)).toEqual({ sent: 0, retried: 0, failed: 0 });
    await env.admin.req("DELETE", `/api/admin/orgs/${env.orgId}/integrations/webhook`);
    const rows = await outbox();
    expect(rows.some((o) => o.status === "PENDENTE")).toBe(false);
    expect(rows.find((o) => o.lastError === "Webhook removido")).toBeTruthy();
  });

  it("anonimização remove os eventos do participante do outbox", async () => {
    const withPerson = (await outbox()).filter((o) => o.participantId);
    expect(withPerson.length).toBeGreaterThan(0);
    const pid = withPerson[0].participantId!;
    await env.admin.post(`/api/admin/participants/${pid}/anonymize`, { reason: "Pedido do titular" });
    expect((await outbox()).some((o) => o.participantId === pid)).toBe(false);
  });

  it("valida a URL em produção (HTTPS e sem rede interna)", () => {
    expect(() => validateWebhookUrl("http://crm.exemplo.com/hook", "production")).toThrow();
    expect(() => validateWebhookUrl("https://127.0.0.1/hook", "production")).toThrow();
    expect(() => validateWebhookUrl("https://10.0.0.5/hook", "production")).toThrow();
    expect(() => validateWebhookUrl("https://localhost/hook", "production")).toThrow();
    expect(validateWebhookUrl("https://crm.exemplo.com/hook", "production")).toBe("https://crm.exemplo.com/hook");
  });
});

const MAX_WAIT = 7 * 3_600_000;
