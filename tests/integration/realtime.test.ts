/**
 * Tempo real e segurança (cenários 6, 7, 12, 13 e 17): Socket.IO real numa porta aleatória.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";
import {
  AdminClient,
  connectSocket,
  expectHttpError,
  liveDemoSession,
  ParticipantClient,
  setup,
  sleep,
  startServer,
  waitFor,
  type TestEnv,
} from "./helpers";
import { RT } from "@shared/types";
import { screenToken } from "@server/domains/sessions";
import { eventSessions, sessionQuestions } from "@server/db/schema";
import { eq } from "drizzle-orm";
import type { RunningServer } from "@server/runtime";

let env: TestEnv;
let srv: RunningServer;
const sockets: Socket[] = [];
const track = (s: Socket) => (sockets.push(s), s);

beforeAll(async () => {
  env = await setup({ realClock: true });
  srv = await startServer(env.rt);
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await srv.stop();
  await env.close();
});

const controlSocket = (sessionId: string) => connectSocket(srv.port, { role: "control", sessionId }, { cookie: env.admin.cookie });

describe("entrega em tempo real", () => {
  it("todos os participantes conectados recebem a pergunta liberada (cenário 6) e o gráfico atualiza sem recarregar (cenário 7)", async () => {
    const s = await liveDemoSession(env, "RT 1");
    const people: ParticipantClient[] = [];
    for (let i = 1; i <= 15; i++) people.push(await ParticipantClient.join(env.rt, s.code, i));
    const socks = await Promise.all(people.map((p) => connectSocket(srv.port, { role: "participant", code: s.code, token: p.token }).then(track)));
    const ctl = track(await controlSocket(s.sessionId));
    await sleep(200);
    const ctrl = await env.admin.get(`/api/admin/sessions/${s.sessionId}/control`);
    expect(ctrl.counts.connected).toBe(15);
    const q1 = ctrl.questions[0];
    const received = Promise.all(socks.map((sk) => waitFor(sk, RT.questionOpened, (d: any) => d.sessionQuestionId === q1.sessionQuestionId)));
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q1.sessionQuestionId}/open`);
    const payloads = await received;
    expect(payloads).toHaveLength(15);
    expect(payloads[0].title).toBe(q1.title);
    // respostas → resultados agregados chegam ao painel do palestrante
    const update = waitFor(ctl, RT.resultsUpdated, (d: any) => d.sessionQuestionId === q1.sessionQuestionId && d.totals.respondents === 5, 8000);
    for (let i = 0; i < 5; i++) await people[i].answer(q1.sessionQuestionId, [q1.options[i % q1.options.length].id]);
    const r = await update;
    expect(r.totals.participants).toBe(15);
    // pergunta em modo AO_VIVO: o público também recebe o gráfico
    const pub = await waitFor(socks[10], RT.resultsUpdated, (d: any) => d.totals.respondents >= 5, 8000);
    expect(pub.categories.every((c: any) => c.isCorrect === null)).toBe(true);
  });

  it("várias abas do mesmo participante contam como uma pessoa conectada", async () => {
    const s = await liveDemoSession(env, "RT abas");
    const p = await ParticipantClient.join(env.rt, s.code, 1);
    for (let i = 0; i < 3; i++) track(await connectSocket(srv.port, { role: "participant", code: s.code, token: p.token }));
    await sleep(100);
    expect(await env.rt.ctx.rt.connectedCount(s.sessionId)).toBe(1);
  });

  it("participante desconecta, retorna e recupera o estado sem refazer o cadastro (cenário 12)", async () => {
    const s = await liveDemoSession(env, "RT reconexão");
    const p = await ParticipantClient.join(env.rt, s.code, 1);
    const sock = track(await connectSocket(srv.port, { role: "participant", code: s.code, token: p.token }));
    const ctrl = await env.admin.get(`/api/admin/sessions/${s.sessionId}/control`);
    const q4 = ctrl.questions[3];
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q4.sessionQuestionId}/open`);
    const opt = q4.options[1].id;
    await p.answer(q4.sessionQuestionId, [opt]);
    sock.disconnect();
    await sleep(100);
    expect(await env.rt.ctx.rt.connectedCount(s.sessionId)).toBe(0);
    // reconecta com o mesmo token persistido no aparelho
    track(await connectSocket(srv.port, { role: "participant", code: s.code, token: p.token }));
    const st = await p.state();
    expect(st.activeQuestion.sessionQuestionId).toBe(q4.sessionQuestionId);
    expect(st.myAnswer.optionIds).toEqual([opt]);
    expect(st.activeQuestion.timer.limitMs).toBe(30_000);
    expect(st.me.displayName).toBe("Part1");
  });

  it("cronômetro autoritativo fecha a pergunta automaticamente no servidor", async () => {
    const s = await liveDemoSession(env, "RT cronômetro");
    const p = await ParticipantClient.join(env.rt, s.code, 1);
    const sock = track(await connectSocket(srv.port, { role: "participant", code: s.code, token: p.token }));
    const ctrl = await env.admin.get(`/api/admin/sessions/${s.sessionId}/control`);
    const q4 = ctrl.questions[3];
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q4.sessionQuestionId}/open`);
    // encurta o prazo (30s → 600ms) diretamente no banco para o teste
    await env.rt.ctx.db.update(sessionQuestions).set({ timeLimitMs: 600 }).where(eq(sessionQuestions.id, q4.sessionQuestionId));
    const closed = await waitFor(sock, RT.questionClosed, (d: any) => d.sessionQuestionId === q4.sessionQuestionId, 5000);
    expect(closed.state).toBe("FECHADA");
    await expectHttpError(p.answer(q4.sessionQuestionId, [q4.options[0].id]), 409, "PERGUNTA_FECHADA");
  });
});

describe("isolamento e autorização (cenários 13 e 17)", () => {
  it("duas sessões simultâneas não compartilham perguntas, eventos ou rankings", async () => {
    const a = await liveDemoSession(env, "Turma A");
    const b = await liveDemoSession(env, "Turma B");
    const pa = await ParticipantClient.join(env.rt, a.code, 1);
    const pb = await ParticipantClient.join(env.rt, b.code, 1); // mesmo e-mail é permitido em outra sessão
    const sa = track(await connectSocket(srv.port, { role: "participant", code: a.code, token: pa.token }));
    const sb = track(await connectSocket(srv.port, { role: "participant", code: b.code, token: pb.token }));
    let leaked = false;
    sb.on(RT.questionOpened, () => (leaked = true));
    const ctrlA = await env.admin.get(`/api/admin/sessions/${a.sessionId}/control`);
    const qa = ctrlA.questions[3];
    const got = waitFor(sa, RT.questionOpened);
    await env.admin.post(`/api/admin/sessions/${a.sessionId}/questions/${qa.sessionQuestionId}/open`);
    await got;
    await sleep(300);
    expect(leaked).toBe(false);
    // token da sessão B não responde perguntas da sessão A, nem com o código da A
    await expectHttpError(pb.answer(qa.sessionQuestionId, [qa.options[0].id]), 404, "PERGUNTA_INVALIDA");
    const forged = new ParticipantClient(env.rt, a.code);
    forged.token = pb.token;
    await expectHttpError(forged.state(), 401);
    await pa.answer(qa.sessionQuestionId, [qa.correctOptionIdsAdmin[0]]);
    await env.admin.post(`/api/admin/sessions/${a.sessionId}/questions/${qa.sessionQuestionId}/close`);
    await env.admin.post(`/api/admin/sessions/${a.sessionId}/questions/${qa.sessionQuestionId}/reveal`);
    expect((await pa.me()).score).toBeGreaterThan(0);
    expect((await pb.me()).score).toBe(0);
    const lbB = await env.admin.get(`/api/admin/sessions/${b.sessionId}/leaderboard`);
    expect(lbB.every((r: any) => r.score === 0)).toBe(true);
  });

  it("administrador de outra organização não acessa dados da Gestalt", async () => {
    const org = await env.admin.post(`/api/admin/orgs`, { name: "Outra Empresa", slug: "outra-empresa" });
    await env.admin.post(`/api/admin/orgs/${org.id}/members`, { name: "Admin Outra", email: "admin@outra.local", password: "SenhaOutra123", role: "ORG_ADMIN" });
    const other = new AdminClient(env.rt);
    await other.login("admin@outra.local", "SenhaOutra123");
    const s = await liveDemoSession(env, "Privada");
    await expectHttpError(other.get(`/api/admin/events?orgId=${env.orgId}`), 404);
    await expectHttpError(other.get(`/api/admin/sessions/${s.sessionId}/control`), 404);
    await expectHttpError(other.post(`/api/admin/sessions/${s.sessionId}/end`), 404);
    await expectHttpError(other.get(`/api/admin/sessions/${s.sessionId}/report`), 404);
    await expectHttpError(other.get(`/api/admin/participants?orgId=${env.orgId}`), 404);
    await expectHttpError(other.post(`/api/admin/orgs`, { name: "X", slug: "x-y" }), 403);
    // canal de controle via socket também é negado
    await expect(connectSocket(srv.port, { role: "control", sessionId: s.sessionId }, { cookie: other.cookie })).rejects.toThrow();
    const own = await other.get(`/api/admin/events?orgId=${org.id}`);
    expect(own).toEqual([]);
  });

  it("palestrante controla a sessão, mas não acessa relatórios, CRM nem edição de perguntas", async () => {
    await env.admin.post(`/api/admin/orgs/${env.orgId}/members`, { name: "Palestrante", email: "palestra@teste.local", password: "Palestra12345", role: "SPEAKER" });
    const speaker = new AdminClient(env.rt);
    await speaker.login("palestra@teste.local", "Palestra12345");
    const s = await liveDemoSession(env, "Do palestrante");
    const ctrl = await speaker.get(`/api/admin/sessions/${s.sessionId}/control`);
    await speaker.post(`/api/admin/sessions/${s.sessionId}/questions/${ctrl.questions[0].sessionQuestionId}/open`);
    await expectHttpError(speaker.get(`/api/admin/sessions/${s.sessionId}/report`), 403);
    await expectHttpError(speaker.get(`/api/admin/participants?orgId=${env.orgId}`), 403);
    await expectHttpError(speaker.post(`/api/admin/events/${s.eventId}/questions`, {}), 403);
    const parts = await speaker.get(`/api/admin/sessions/${s.sessionId}/participants`);
    expect(parts.every((p: any) => p.email === null)).toBe(true);
  });

  it("acessos sem credencial são negados (API, socket e telão)", async () => {
    const s = await liveDemoSession(env, "Sem credencial");
    const anon = new AdminClient(env.rt);
    await expectHttpError(anon.get(`/api/admin/sessions/${s.sessionId}/control`), 401);
    await expectHttpError(anon.post(`/api/admin/sessions/${s.sessionId}/end`), 401);
    await expect(connectSocket(srv.port, { role: "control", sessionId: s.sessionId })).rejects.toThrow();
    await expect(connectSocket(srv.port, { role: "participant", code: s.code, token: "x".repeat(43) })).rejects.toThrow();
    await expect(connectSocket(srv.port, { role: "screen", code: s.code, token: "invalido" })).rejects.toThrow();
    const res = await env.rt.app.request(`/api/screen/${s.code}/state?t=invalido`);
    expect(res.status).toBe(404);
    const [row] = await env.rt.ctx.db.select().from(eventSessions).where(eq(eventSessions.id, s.sessionId));
    const ok = await env.rt.app.request(`/api/screen/${s.code}/state?t=${screenToken(env.rt.ctx, row)}`);
    expect(ok.status).toBe(200);
    const screen = await ok.json();
    expect(JSON.stringify(screen)).not.toContain("@teste.local");
    // mutações administrativas com Origin de outro site são recusadas (CSRF)
    await expectHttpError(env.admin.req("POST", `/api/admin/sessions/${s.sessionId}/pause`, {}, { origin: "https://site-malicioso.example" }), 403);
  });
});
