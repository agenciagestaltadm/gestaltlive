/**
 * Modo Vercel (serverless): tempo real pelo Supabase Realtime, temporizadores pelo "tick" da sessão e
 * arquivos no Supabase Storage. O Supabase é simulado: as mensagens publicadas são capturadas e os
 * arquivos ficam em memória — o restante (API, banco, regras) é o código real.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { RT } from "@shared/types";
import type { BroadcastMessage } from "@server/lib/supabase";
import type { BlobStore } from "@server/lib/storage";
import { expectHttpError, liveDemoSession, ParticipantClient, setup, type TestEnv } from "./helpers";

/** Armazenamento em memória com a mesma interface do Supabase Storage. */
class MemoryStore implements BlobStore {
  readonly kind = "supabase" as const;
  files = new Map<string, Buffer>();
  incoming = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.files.set(key, data);
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async exists(key: string) {
    return this.files.has(key);
  }
  async remove(keys: string[]) {
    keys.forEach((k) => this.files.delete(k));
  }
  publicUrl(key: string) {
    return `https://storage.teste/${key}`;
  }
  async createUpload(key: string) {
    return { uploadUrl: `https://upload.teste/${key}` };
  }
  async takeUpload(key: string) {
    const b = this.incoming.get(key) ?? null;
    this.incoming.delete(key);
    return b;
  }
}

const sent: BroadcastMessage[] = [];
const store = new MemoryStore();
let env: TestEnv;
let s: Awaited<ReturnType<typeof liveDemoSession>>;
let p: ParticipantClient;
let screenAuth: { role: string; code: string; token: string };

const http = (method: string, path: string, data?: unknown, headers: Record<string, string> = {}) =>
  env.rt.app.request(path, { method, headers: { "content-type": "application/json", ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
const ticket = async (auth: Record<string, unknown>, cookie = "") => {
  const res = await http("POST", "/api/realtime/ticket", auth, cookie ? { cookie } : {});
  return { status: res.status, json: (await res.json()) as any };
};
const tick = async () => (await (await http("POST", "/api/realtime/tick", screenAuth)).json()) as { ran: boolean };
/** Espera a janela do tick (a atualização condicional usa o relógio do banco). */
const nextWindow = () => new Promise((r) => setTimeout(r, 750));
const topicsOf = (events: string[], since = 0) => sent.slice(since).filter((m) => events.includes(m.event));

beforeAll(async () => {
  env = await setup({ runtime: { realtime: "supabase", realtimeSend: async (m) => void sent.push(...m), storage: store } });
  s = await liveDemoSession(env, "Turma serverless");
  p = await ParticipantClient.join(env.rt, s.code, 1);
  const info = await env.admin.get(`/api/admin/sessions/${s.sessionId}`);
  screenAuth = { role: "screen", code: s.code, token: new URL(info.screenUrl).searchParams.get("t")! };
});
afterAll(() => env.close());

describe("ticket do tempo real", () => {
  it("entrega canais privados distintos por público e nega acessos inválidos", async () => {
    const part = await ticket({ role: "participant", code: s.code, token: p.token });
    expect(part.status).toBe(200);
    expect(part.json.transport).toBe("supabase");
    expect(part.json.topics).toHaveLength(2);
    expect(part.json.heartbeat).toBe(true);
    expect(part.json.tick).toBe(false);
    const screen = await ticket(screenAuth);
    expect(screen.json.topics).toHaveLength(1);
    expect(screen.json.tick).toBe(true);
    const control = await ticket({ role: "control", sessionId: s.sessionId }, env.admin.cookie);
    expect(control.json.topics).toHaveLength(1);
    const all = [...part.json.topics, ...screen.json.topics, ...control.json.topics];
    expect(new Set(all).size).toBe(4);
    expect(all.every((t: string) => /^gl-[0-9a-f]{40}$/.test(t))).toBe(true);
    // a chave pública do Supabase vai ao cliente; a service_role nunca
    expect(JSON.stringify(part.json)).not.toMatch(/service/i);

    expect((await ticket({ role: "participant", code: s.code, token: "invalido" })).status).toBe(403);
    expect((await ticket({ ...screenAuth, token: "x".repeat(20) })).status).toBe(403);
    expect((await ticket({ role: "control", sessionId: s.sessionId })).status).toBe(403);
    // participante não executa o tick
    expect((await http("POST", "/api/realtime/tick", { role: "participant", code: s.code, token: p.token })).status).toBe(403);
  });
});

describe("eventos publicados no Supabase", () => {
  it("abrir pergunta publica para participantes, telão e painel ao fim da requisição", async () => {
    const part = (await ticket({ role: "participant", code: s.code, token: p.token })).json.topics[0];
    const screen = (await ticket(screenAuth)).json.topics[0];
    const ctrl = await env.admin.get(`/api/admin/sessions/${s.sessionId}/control`);
    const q1 = ctrl.questions[0];
    const mark = sent.length;
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q1.sessionQuestionId}/open`);
    const opened = topicsOf([RT.questionOpened], mark).map((m) => m.topic);
    expect(opened).toContain(part);
    expect(opened).toContain(screen);
    // envelope igual ao do Socket.IO
    const env0 = sent.slice(mark).find((m) => m.event === RT.questionOpened)!.payload as any;
    expect(env0.sessionId).toBe(s.sessionId);
    expect(typeof env0.v).toBe("number");
  });

  it("respostas não disparam envios; o tick publica resultados e contagens só quando mudam", async () => {
    const ctrl = await env.admin.get(`/api/admin/sessions/${s.sessionId}/control`);
    const q1 = ctrl.questions[0];
    const controlTopic = (await ticket({ role: "control", sessionId: s.sessionId }, env.admin.cookie)).json.topics[0];
    const partTopic = (await ticket({ role: "participant", code: s.code, token: p.token })).json.topics[0];
    await nextWindow();
    await tick();
    const mark = sent.length;
    await p.answer(q1.sessionQuestionId, [q1.options[0].id]);
    // a resposta só confirma ao próprio participante
    expect(sent.slice(mark).every((m) => m.event === "answer:accepted")).toBe(true);

    await nextWindow();
    expect((await tick()).ran).toBe(true);
    const results = topicsOf([RT.resultsUpdated], mark);
    expect(results.some((m) => m.topic === controlTopic)).toBe(true);
    const counts = topicsOf([RT.answersCount], mark);
    expect(counts.some((m) => (m.payload as any).data.answered === 1)).toBe(true);
    // resultados com gabarito vão apenas ao painel
    for (const m of results.filter((r) => r.topic === partTopic)) {
      expect((m.payload as any).data.categories.every((c: any) => c.isCorrect === null)).toBe(true);
    }

    // várias janelas chamando ao mesmo tempo: só uma executa
    await nextWindow();
    const together = await Promise.all([tick(), tick(), tick()]);
    expect(together.filter((t) => t.ran)).toHaveLength(1);
    // tick seguinte sem mudanças: executa, mas não repete mensagens ao painel/telão
    await nextWindow();
    const mark2 = sent.length;
    expect((await tick()).ran).toBe(true);
    expect(topicsOf([RT.resultsUpdated, RT.answersCount, RT.leaderboardUpdated], mark2).filter((m) => m.topic !== partTopic)).toHaveLength(0);
    // o canal dos participantes recebe a contagem atualizada (no máximo a cada 3 s)
    await new Promise((r) => setTimeout(r, 3100));
    await tick();
    expect(topicsOf([RT.answersCount]).some((m) => m.topic === partTopic && (m.payload as any).data.answered === 1)).toBe(true);
  });

  it("o tick fecha a pergunta quando o cronômetro do servidor termina", async () => {
    const ctrl = await env.admin.get(`/api/admin/sessions/${s.sessionId}/control`);
    const q7 = ctrl.questions[6]; // 20 s
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q7.sessionQuestionId}/open`);
    env.clock.advance(21_000);
    await nextWindow();
    const mark = sent.length;
    await tick();
    expect(topicsOf([RT.questionClosed], mark).length).toBeGreaterThan(0);
    const after = await env.admin.get(`/api/admin/sessions/${s.sessionId}/control`);
    expect(after.questions[6].state).toBe("FECHADA");
  });

  it("sinal de vida pelo HTTP conta o participante como conectado", async () => {
    const res = await http("POST", "/api/realtime/heartbeat", { role: "participant", code: s.code, token: p.token });
    expect(res.status).toBe(200);
    expect(await env.rt.ctx.rt.connectedCount(s.sessionId)).toBe(1);
    const ctrl = await env.admin.get(`/api/admin/sessions/${s.sessionId}/control`);
    expect(ctrl.counts.connected).toBe(1);
  });

  it("trocar o token do telão revoga o canal antigo", async () => {
    const before = (await ticket(screenAuth)).json.topics[0];
    const mark = sent.length;
    const { screenUrl } = await env.admin.post(`/api/admin/sessions/${s.sessionId}/screen-token`);
    expect(sent.slice(mark).some((m) => m.topic === before && m.event === "rt:revoked")).toBe(true);
    expect((await ticket(screenAuth)).status).toBe(403);
    screenAuth = { ...screenAuth, token: new URL(screenUrl).searchParams.get("t")! };
    const after = (await ticket(screenAuth)).json.topics[0];
    expect(after).not.toBe(before);
  });
});

describe("arquivos no Supabase Storage", () => {
  it("envio direto de slide: URL assinada, processamento e leitura por redirecionamento", async () => {
    const cfg = await env.admin.get("/api/admin/assets/upload-config");
    expect(cfg.direct).toBe(true);
    const png = await sharp({ create: { width: 320, height: 180, channels: 3, background: "#0B1736" } }).png().toBuffer();
    const prep = await env.admin.post(`/api/admin/assets/direct?orgId=${env.orgId}`, { name: "slide-1.png", size: png.length, type: "image/png" });
    expect(prep.uploadUrl).toBe(`https://upload.teste/${prep.key}`);
    store.incoming.set(prep.key, png); // o navegador envia direto ao Storage
    const done = await env.admin.post(`/api/admin/assets/direct/complete?orgId=${env.orgId}`, { key: prep.key, name: "slide-1.png" });
    expect(done.asset.width).toBe(320);
    expect(store.incoming.size).toBe(0);
    expect([...store.files.keys()].filter((k) => k.includes("/slides/"))).toHaveLength(3);
    const res = await http("GET", done.asset.urls.tela);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^https:\/\/storage\.teste\/.+-tela\.webp$/);

    // chave de outra organização e envio inexistente são recusados
    await expectHttpError(env.admin.post(`/api/admin/assets/direct/complete?orgId=${env.orgId}`, { key: `00000000-0000-4000-8000-000000000000/${crypto.randomUUID()}`, name: "x.png" }), 400);
    await expectHttpError(env.admin.post(`/api/admin/assets/direct/complete?orgId=${env.orgId}`, { key: `${env.orgId}/${crypto.randomUUID()}`, name: "x.png" }), 400, "ENVIO_NAO_ENCONTRADO");
    await expectHttpError(env.admin.post(`/api/admin/assets/direct?orgId=${env.orgId}`, { name: "grande.png", size: 30 * 1024 * 1024, type: "image/png" }), 400, "ARQUIVO_GRANDE");
  });
});

describe("rotina diária (Vercel Cron)", () => {
  it("exige o CRON_SECRET", async () => {
    process.env.CRON_SECRET = "segredo-cron-teste";
    expect((await http("GET", "/api/cron/maintenance")).status).toBe(401);
    expect((await http("GET", "/api/cron/maintenance", undefined, { authorization: "Bearer errado" })).status).toBe(401);
    const ok = await http("GET", "/api/cron/maintenance", undefined, { authorization: "Bearer segredo-cron-teste" });
    expect(ok.status).toBe(200);
    delete process.env.CRON_SECRET;
  });
});
