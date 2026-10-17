/** Construtor, versionamento, bloqueio, import/export, templates e duplicação (cenários 1–3). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, liveDemoSession, ParticipantClient, expectHttpError, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => env.close());

const strip = (q: any) => {
  const { id, eventId, position, status, version, answersCount, locked, updatedAt, ...input } = q;
  void id, eventId, position, status, version, answersCount, locked, updatedAt;
  return input;
};

describe("construtor de perguntas", () => {
  it("cria um treinamento com dez perguntas de tipos e gráficos diferentes", async () => {
    const ev = await env.admin.post(`/api/admin/events?orgId=${env.orgId}`, { title: "Treinamento novo" });
    const base = { chart: { type: "bar_vertical" }, resultsMode: "MANUAL" };
    const qs = [
      { type: "PERFIL", title: "Segmento", options: [{ label: "A" }, { label: "B" }, { label: "C" }], chart: { type: "donut" } },
      { type: "OPINIAO", title: "Desafio", maxSelections: 2, options: [{ label: "X" }, { label: "Y" }, { label: "Z" }], chart: { type: "bar_horizontal" } },
      { type: "SIM_NAO", title: "Usa CRM?", options: [{ label: "Sim" }, { label: "Não" }], chart: { type: "semicircle" } },
      { type: "CONHECIMENTO", title: "Q1", scoring: {}, options: [{ label: "a", isCorrect: true }, { label: "b" }], chart: { type: "pie" } },
      { type: "CONHECIMENTO", title: "Q2", scoring: { speedBonusEnabled: true }, timeLimitSec: 20, options: [{ label: "a" }, { label: "b", isCorrect: true }], chart: { type: "treemap" } },
      { type: "MULTIPLA_CORRETA", title: "Q3", scoring: {}, minSelections: 2, maxSelections: 3, options: [{ label: "a", isCorrect: true }, { label: "b", isCorrect: true }, { label: "c" }], chart: { type: "lollipop" } },
      { type: "ESCALA", title: "Nota", scaleMin: 1, scaleMax: 5, chart: { type: "column" } },
      { type: "NPS", title: "Recomendaria?", chart: { type: "gauge" } },
      { type: "OPINIAO", title: "Canal", options: [{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }], chart: { type: "pareto" } },
      { type: "OPINIAO", title: "Formato", options: [{ label: "a" }, { label: "b" }, { label: "c" }], chart: { type: "radar" } },
    ];
    for (const q of qs) await env.admin.post(`/api/admin/events/${ev.id}/questions`, { ...base, ...q });
    const list = await env.admin.get(`/api/admin/events/${ev.id}/questions`);
    expect(list).toHaveLength(10);
    expect(new Set(list.map((q: any) => q.chart.type)).size).toBe(10);
    // reordenação
    const ids = list.map((q: any) => q.id).reverse();
    await env.admin.put(`/api/admin/events/${ev.id}/questions/order`, { ids });
    const after = await env.admin.get(`/api/admin/events/${ev.id}/questions`);
    expect(after.map((q: any) => q.id)).toEqual(ids);
    // exportação → importação em outro evento
    const exported = await env.admin.get(`/api/admin/events/${ev.id}/questions/export`);
    const ev2 = await env.admin.post(`/api/admin/events?orgId=${env.orgId}`, { title: "Cópia por importação" });
    const imp = await env.admin.post(`/api/admin/events/${ev2.id}/questions/import`, exported);
    expect(imp.imported).toBe(10);
    // template e evento a partir do template
    const t = await env.admin.post(`/api/admin/events/${ev.id}/save-template`, { name: "Modelo padrão" });
    const ev3 = await env.admin.post(`/api/admin/templates/${t.id}/create-event`, { title: "Turma de julho" });
    expect(await env.admin.get(`/api/admin/events/${ev3.id}/questions`)).toHaveLength(10);
    // importação inválida não grava nada
    await expectHttpError(env.admin.post(`/api/admin/events/${ev2.id}/questions/import`, { ...exported, questions: [{ type: "CONHECIMENTO", title: "x", chart: { type: "pie" }, options: [] }] }), 400);
    expect(await env.admin.get(`/api/admin/events/${ev2.id}/questions`)).toHaveLength(10);
  });

  it("pergunta respondida: permite editar textos, bloqueia mudanças estruturais", async () => {
    const s = await liveDemoSession(env, "Bloqueio");
    const ctrl = await env.admin.get(`/api/admin/sessions/${s.sessionId}/control`);
    const q4 = ctrl.questions[3];
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q4.sessionQuestionId}/open`);
    const p = await ParticipantClient.join(env.rt, s.code, 1);
    await p.answer(q4.sessionQuestionId, [q4.correctOptionIdsAdmin[0]]);
    const q = await env.admin.get(`/api/admin/questions/${q4.questionId}`);
    expect(q.locked).toBe(true);
    // edição de texto (regressão: jsonb reordena as chaves da pontuação)
    const edited = await env.admin.put(`/api/admin/questions/${q.id}`, { ...strip(q), title: `${q.title} (revisada)` });
    expect(edited.currentVersion).toBe(q.version + 1);
    // mudança estrutural
    const moved = strip(q);
    // troca o gabarito para outra alternativa (estrutura válida, mas proibida após respostas)
    const wasCorrect = moved.options.findIndex((o: any) => o.isCorrect);
    const target = wasCorrect === 0 ? 1 : 0;
    moved.options = moved.options.map((o: any, i: number) => ({ ...o, isCorrect: i === target }));
    await expectHttpError(env.admin.put(`/api/admin/questions/${q.id}`, moved), 409, "PERGUNTA_BLOQUEADA");
    await expectHttpError(env.admin.put(`/api/admin/questions/${q.id}`, { ...strip(q), scoring: { ...q.scoring, basePoints: 999 } }), 409, "PERGUNTA_BLOQUEADA");
    await expectHttpError(env.admin.req("DELETE", `/api/admin/questions/${q.id}`), 409, "PERGUNTA_BLOQUEADA");
    // a sessão continua usando a versão congelada no momento da abertura
    const st = await p.state();
    expect(st.activeQuestion.title).toBe(q4.title);
  });

  it("duplicação de evento copia perguntas, prêmios e campos", async () => {
    const events = await env.admin.get(`/api/admin/events?orgId=${env.orgId}`);
    const demo = events.find((e: any) => e.title.startsWith("Vendas Inteligentes"));
    const copy = await env.admin.post(`/api/admin/events/${demo.id}/duplicate`);
    const full = await env.admin.get(`/api/admin/events/${copy.id}`);
    expect(full.questionCount).toBe(10);
    expect(full.prizes).toHaveLength(3);
    expect(full.customFields.length).toBeGreaterThanOrEqual(4);
  });

  it("respostas de API não expõem segredos do telão", async () => {
    const events = await env.admin.get(`/api/admin/events?orgId=${env.orgId}`);
    const s = await env.admin.post(`/api/admin/events/${events[0].id}/sessions`, { name: "Segredo" });
    expect(s.screenTokenNonce).toBeUndefined();
    const info = await env.admin.get(`/api/admin/sessions/${s.id}`);
    expect(info.screenTokenNonce).toBeUndefined();
  });
});
