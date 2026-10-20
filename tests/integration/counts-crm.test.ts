/** Contagens agregadas (subconsultas correlacionadas) e CRM/LGPD. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, liveDemoSession, ParticipantClient, type TestEnv } from "./helpers";

let env: TestEnv;
let s: Awaited<ReturnType<typeof liveDemoSession>>;
const people: ParticipantClient[] = [];

beforeAll(async () => {
  env = await setup();
  s = await liveDemoSession(env, "Contagens");
  for (let i = 1; i <= 4; i++) people.push(await ParticipantClient.join(env.rt, s.code, i));
});
afterAll(async () => env.close());

describe("contagens em listas", () => {
  it("lista de eventos traz perguntas, sessões e sessões ativas", async () => {
    const list = await env.admin.get(`/api/admin/events?orgId=${env.orgId}`);
    const demo = list.find((e: any) => e.id === s.eventId);
    expect(demo.questionCount).toBe(11);
    expect(demo.sessionCount).toBe(1);
    expect(demo.liveCount).toBe(1);
  });
  it("sessões do evento e da organização trazem participantes", async () => {
    const byEvent = await env.admin.get(`/api/admin/events/${s.eventId}/sessions`);
    expect(byEvent[0].participants).toBe(4);
    const byOrg = await env.admin.get(`/api/admin/sessions?orgId=${env.orgId}`);
    expect(byOrg[0].participants).toBe(4);
  });
  it("indicadores gerais por organização", async () => {
    const g = await env.admin.get(`/api/admin/global`);
    const org = g.perOrg.find((o: any) => o.orgId === env.orgId);
    expect(org).toMatchObject({ events: 1, sessions: 1, participants: 4 });
  });
  it("visão geral de relatórios", async () => {
    const ctrl = await env.admin.get(`/api/admin/sessions/${s.sessionId}/control`);
    const q1 = ctrl.questions[0];
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q1.sessionQuestionId}/open`);
    await people[0].answer(q1.sessionQuestionId, [q1.options[0].id]);
    await people[1].answer(q1.sessionQuestionId, [q1.options[1].id]);
    const rows = await env.admin.get(`/api/admin/reports/sessions?orgId=${env.orgId}`);
    expect(rows[0]).toMatchObject({ registered: 4, interacted: 2, answers: 2 });
  });
});

describe("CRM", () => {
  it("lista, filtro de marketing, segmentação por resposta e perfil", async () => {
    const all = await env.admin.get(`/api/admin/participants?orgId=${env.orgId}`);
    expect(all.total).toBe(4);
    expect(all.rows.every((r: any) => r.sessions === 1)).toBe(true);
    // participantes pares consentiram marketing (helper)
    const mk = await env.admin.get(`/api/admin/participants?orgId=${env.orgId}&marketing=sim`);
    expect(mk.total).toBe(2);
    const ctrl = await env.admin.get(`/api/admin/sessions/${s.sessionId}/control`);
    const q1 = ctrl.questions[0];
    const seg = await env.admin.get(`/api/admin/participants?orgId=${env.orgId}&questionId=${q1.questionId}&optionId=${q1.options[0].id}`);
    expect(seg.total).toBe(1);
    const field = await env.admin.get(`/api/admin/participants?orgId=${env.orgId}&fieldKey=segmento&fieldValue=Varejo`);
    expect(field.total).toBe(1); // i % 3 === 0 → participante 3
    const detail = await env.admin.get(`/api/admin/participants/${all.rows[0].id}`);
    expect(detail.sessions[0].position).toBeGreaterThanOrEqual(1);
    expect(detail.consents.length).toBeGreaterThanOrEqual(1);
  });

  it("revogação de marketing e anonimização", async () => {
    const mk = await env.admin.get(`/api/admin/participants?orgId=${env.orgId}&marketing=sim`);
    const id = mk.rows[0].id;
    await env.admin.post(`/api/admin/participants/${id}/revoke-marketing`, { reason: "Pedido do titular" });
    expect((await env.admin.get(`/api/admin/participants?orgId=${env.orgId}&marketing=sim`)).total).toBe(1);
    await env.admin.post(`/api/admin/participants/${id}/anonymize`, { reason: "Pedido de exclusão (LGPD)" });
    const d = await env.admin.get(`/api/admin/participants/${id}`);
    expect(d.participant.fullName).toBe("Participante anonimizado");
    expect(d.participant.email).toBeNull();
    expect(d.sessions[0].displayName).toBe("Anônimo");
  });
});
