/**
 * Fluxo ao vivo completo (cenários 1–11, 14 e 15 dos critérios de aceitação), via API HTTP real
 * sobre PostgreSQL embutido (PGlite) e relógio controlado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, liveDemoSession, ParticipantClient, expectHttpError, type TestEnv } from "./helpers";
import { ledgerMismatches } from "@server/domains/scoring";

let env: TestEnv;
let s: Awaited<ReturnType<typeof liveDemoSession>>;
let people: ParticipantClient[] = [];

beforeAll(async () => {
  env = await setup();
  s = await liveDemoSession(env);
});
afterAll(async () => env.close());

const control = () => env.admin.get(`/api/admin/sessions/${s.sessionId}/control`);
const q = (ctrl: any, pos: number) => ctrl.questions.find((x: any) => x.position === pos);

describe("preparação (cenários 1–4)", () => {
  it("evento de demonstração tem 11 perguntas (inclui nuvem de palavras), gráficos diferentes e 3 prêmios", async () => {
    const qs = await env.admin.get(`/api/admin/events/${s.eventId}/questions`);
    expect(qs).toHaveLength(11);
    expect(new Set(qs.map((x: any) => x.chart.type)).size).toBeGreaterThanOrEqual(8);
    const prizes = await env.admin.get(`/api/admin/events/${s.eventId}/prizes`);
    expect(prizes.map((p: any) => p.rank)).toEqual([1, 2, 3]);
  });

  it("sessão ao vivo tem código curto, link e QR Code", async () => {
    const info = await env.admin.get(`/api/admin/sessions/${s.sessionId}`);
    expect(info.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(info.joinUrl).toBe(`http://teste.local/entrar/${info.code}`);
    expect(info.screenUrl).toContain(`/apresentacao/${info.code}?t=`);
    const res = await env.rt.app.request(`/api/public/sessions/${info.code}/qr.svg`);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(await res.text()).toContain("<svg");
    expect(info.status).toBe("AO_VIVO");
  });

  it("rejeita gráfico incompatível com a pergunta (pizza em múltipla seleção)", async () => {
    const qs = await env.admin.get(`/api/admin/events/${s.eventId}/questions`);
    const multi = qs.find((x: any) => x.maxSelections > 1 && x.type === "OPINIAO");
    const { id, eventId, position, status, version, answersCount, locked, updatedAt, ...input } = multi;
    await expectHttpError(env.admin.put(`/api/admin/questions/${id}`, { ...input, chart: { ...input.chart, type: "pie" } }), 400, "GRAFICO_INCOMPATIVEL");
  });
});

describe("cadastro (cenário 5)", () => {
  it("30 participantes se cadastram", async () => {
    people = [];
    for (let i = 1; i <= 30; i++) people.push(await ParticipantClient.join(env.rt, s.code, i));
    const ctrl = await control();
    expect(ctrl.counts.registered).toBe(30);
  });

  it("impede cadastro duplicado pelo mesmo e-mail sem devolver a credencial existente", async () => {
    const e = await expectHttpError(ParticipantClient.join(env.rt, s.code, 1, { phone: "11977776666" }), 409, "JA_INSCRITO");
    expect(JSON.stringify(e.body)).not.toContain("token");
  });

  it("valida campos obrigatórios e consentimento", async () => {
    await expectHttpError(ParticipantClient.join(env.rt, s.code, 99, { email: null }), 400, "VALIDACAO");
    await expectHttpError(ParticipantClient.join(env.rt, s.code, 98, { consentParticipation: false }), 400);
  });
});

describe("perguntas e pontuação (cenários 6–8, 11)", () => {
  it("pergunta liberada aparece no estado do participante, sem gabarito", async () => {
    const ctrl = await control();
    const q4 = q(ctrl, 4); // conhecimento, 30s, bônus de velocidade
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q4.sessionQuestionId}/open`);
    const st = await people[0].state();
    expect(st.activeQuestion.sessionQuestionId).toBe(q4.sessionQuestionId);
    expect(st.activeQuestion.state).toBe("ABERTA");
    expect(st.activeQuestion.correctOptionIds).toBeNull();
    expect(JSON.stringify(st.activeQuestion)).not.toContain("isCorrect");
  });

  it("respostas atualizam os resultados e o servidor calcula a pontuação no fechamento", async () => {
    const ctrl = await control();
    const q4 = q(ctrl, 4);
    const correct = q4.correctOptionIdsAdmin[0];
    const wrong = q4.options.find((o: any) => o.id !== correct).id;
    // participantes 1..10 acertam em tempos diferentes; 11..20 erram; 21..30 não respondem
    for (let i = 0; i < 10; i++) {
      env.clock.advance(1000);
      await people[i].answer(q4.sessionQuestionId, [correct]);
    }
    for (let i = 10; i < 20; i++) await people[i].answer(q4.sessionQuestionId, [wrong]);
    const res = await env.admin.get(`/api/admin/sessions/${s.sessionId}/results/${q4.sessionQuestionId}`);
    expect(res.totals.respondents).toBe(20);
    expect(res.totals.participants).toBe(30);
    expect(res.categories.find((c: any) => c.id === correct).count).toBe(10);

    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q4.sessionQuestionId}/close`);
    // pontuação calculada, mas ainda não publicada (não denuncia o gabarito)
    expect((await people[0].me()).score).toBe(0);
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q4.sessionQuestionId}/reveal`);
    // participante 1 respondeu em 1s de 30s: 100 + floor(50 * (1 - 1/30)) = 148
    const me1 = await people[0].me();
    expect(me1.score).toBe(148);
    // participante 10 respondeu em 10s: 100 + floor(50 * (1 - 10/30)) = 133
    expect((await people[9].me()).score).toBe(133);
    expect((await people[10].me()).score).toBe(0);
    expect((await people[25].me()).score).toBe(0);
    expect(await ledgerMismatches(env.rt.ctx.db, s.sessionId)).toEqual([]);
  });

  it("resposta após o fechamento é rejeitada e não pontua", async () => {
    const ctrl = await control();
    const q4 = q(ctrl, 4);
    await expectHttpError(people[25].answer(q4.sessionQuestionId, [q4.correctOptionIdsAdmin[0]]), 409, "PERGUNTA_FECHADA");
  });

  it("reenvios (mesma chave, chave nova e concorrentes) não duplicam a resposta nem os pontos", async () => {
    const ctrl = await control();
    const q5 = q(ctrl, 5);
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q5.sessionQuestionId}/open`);
    const correct = q5.correctOptionIdsAdmin[0];
    const p = people[2];
    const first = await p.answer(q5.sessionQuestionId, [correct], null, "chave-fixa-123");
    const again = await p.answer(q5.sessionQuestionId, [correct], null, "chave-fixa-123");
    expect(again.outcome).toBe("DUPLICADA");
    expect(again.answerId).toBe(first.answerId);
    const fresh = await p.answer(q5.sessionQuestionId, [correct]);
    expect(fresh.outcome).toBe("DUPLICADA");
    // tentativa de mudar a resposta sem edição permitida
    const other = q5.options.find((o: any) => o.id !== correct).id;
    await expectHttpError(p.answer(q5.sessionQuestionId, [other]), 409, "JA_RESPONDIDA");
    // 10 envios simultâneos do mesmo participante
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => people[3].answer(q5.sessionQuestionId, [correct])));
    const ok = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<any>).value);
    expect(new Set(ok.map((r) => r.answerId)).size).toBe(1);
    const resq = await env.admin.get(`/api/admin/sessions/${s.sessionId}/results/${q5.sessionQuestionId}`);
    expect(resq.totals.respondents).toBe(2);
    const before = (await p.me()).score;
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q5.sessionQuestionId}/close`);
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q5.sessionQuestionId}/reveal`);
    // revelar de novo não publica outra vez
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q5.sessionQuestionId}/reveal`);
    const after = (await p.me()).score;
    expect(after - before).toBe(150); // 100 + floor(50*(1-0/25)) com relógio parado
    expect(await ledgerMismatches(env.rt.ctx.db, s.sessionId)).toEqual([]);
  });

  it("não aceita pontuação nem participante informados pelo cliente", async () => {
    const ctrl = await control();
    const q7 = q(ctrl, 7);
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q7.sessionQuestionId}/open`);
    const r = await people[4].req("POST", "/answers", {
      sessionQuestionId: q7.sessionQuestionId,
      optionIds: [q7.correctOptionIdsAdmin[0]],
      idempotencyKey: "tentativa-fraude-1",
      points: 99999,
      score: 99999,
      sessionParticipantId: people[5].spId,
    });
    expect(r.outcome).toBe("ACEITA");
    const res = await env.admin.get(`/api/admin/sessions/${s.sessionId}/results/${q7.sessionQuestionId}`);
    expect(res.totals.respondents).toBe(1);
    // a resposta foi registrada para o dono do token, não para o id enviado
    await expectHttpError(people[4].answer(q7.sessionQuestionId, [q7.options[0].id]), 409, "JA_RESPONDIDA");
    const p5 = await people[5].answer(q7.sessionQuestionId, [q7.correctOptionIdsAdmin[0]]);
    expect(p5.outcome).toBe("ACEITA");
  });

  it("respeita o prazo do cronômetro do servidor (último segundo e após o prazo)", async () => {
    const ctrl = await control();
    const q7 = q(ctrl, 7); // 20s
    env.clock.advance(19_999);
    expect((await people[6].answer(q7.sessionQuestionId, [q7.correctOptionIdsAdmin[0]])).outcome).toBe("ACEITA");
    env.clock.advance(2);
    await expectHttpError(people[7].answer(q7.sessionQuestionId, [q7.correctOptionIdsAdmin[0]]), 409, "TEMPO_ESGOTADO");
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q7.sessionQuestionId}/close`);
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q7.sessionQuestionId}/reveal`);
    // resposta no último instante: bônus = floor(50 * (1 - 19999/20000)) = 0
    const hist = await people[6].req("GET", "/history");
    expect(hist.find((h: any) => h.sessionQuestionId === q7.sessionQuestionId).points).toBe(100);
  });
});

describe("ranking (cenário 9)", () => {
  it("top 10 com desempate determinístico e posição individual fora do top 10", async () => {
    const ctrl = await control();
    expect(ctrl.leaderboard.entries).toHaveLength(10);
    const scores = ctrl.leaderboard.entries.map((e: any) => e.score);
    expect([...scores].sort((a: number, b: number) => b - a)).toEqual(scores);
    const st = await people[29].state();
    expect(st.me.position).toBeGreaterThan(10);
    expect(st.me.totalRanked).toBe(30);
    expect(st.leaderboard.entries).toHaveLength(10);
    // dados pessoais nunca aparecem no ranking público
    expect(JSON.stringify(st.leaderboard)).not.toMatch(/@teste\.local|11991/);
  });

  it("congelar o ranking mantém a exibição, mas o cálculo oficial continua", async () => {
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/leaderboard`, { frozen: true });
    const frozenBefore = (await people[0].state()).leaderboard;
    expect(frozenBefore.frozen).toBe(true);
    const ctrl = await control();
    const q9 = q(ctrl, 9);
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q9.sessionQuestionId}/open`);
    await people[29].answer(q9.sessionQuestionId, [q9.correctOptionIdsAdmin[0]]);
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q9.sessionQuestionId}/close`);
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q9.sessionQuestionId}/reveal`);
    const frozenAfter = (await people[0].state()).leaderboard;
    expect(frozenAfter.entries).toEqual(frozenBefore.entries);
    const live = await env.admin.get(`/api/admin/sessions/${s.sessionId}/leaderboard`);
    expect(live.find((r: any) => r.id === people[29].spId).score).toBe(225); // floor((100+50)*1.5)
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/leaderboard`, { frozen: false });
    const revealed = (await people[0].state()).leaderboard;
    expect(revealed.frozen).toBe(false);
    expect(revealed.entries.some((e: any) => e.sessionParticipantId === people[29].spId)).toBe(true);
  });
});

describe("satisfação (cenário 10)", () => {
  it("mudar de Insatisfeito para Valeu a pena conta apenas a avaliação atual", async () => {
    await people[0].satisfaction("NEGATIVO");
    await people[1].satisfaction("POSITIVO");
    let sat = (await control()).satisfaction;
    expect(sat.summary).toMatchObject({ positive: 1, negative: 1, total: 2 });
    await people[0].satisfaction("POSITIVO");
    await people[0].satisfaction("POSITIVO");
    sat = (await control()).satisfaction;
    expect(sat.summary).toMatchObject({ positive: 2, negative: 0, total: 2, positivePct: 100 });
    expect(sat.notVoted).toBe(28);
    expect(sat.registered).toBe(30);
  });

  it("sem avaliações → percentuais nulos (não presume satisfação)", async () => {
    const { satisfactionData } = await import("@server/domains/satisfaction");
    const other = await liveDemoSession(env, "Turma vazia");
    const data = await satisfactionData(env.rt.ctx.db, other.sessionId);
    expect(data.summary.total).toBe(0);
    expect(data.summary.positivePct).toBeNull();
  });
});

describe("encerramento, pódio e relatórios (cenários 14–15)", () => {
  it("encerrar gera resultado final oficial, pódio com prêmios e premiações", async () => {
    const ctrl = await env.admin.post(`/api/admin/sessions/${s.sessionId}/end`);
    expect(ctrl.session.status).toBe("ENCERRADA");
    expect(ctrl.session.finalizedAt).not.toBeNull();
    expect(ctrl.presentation.screen).toBe("PREMIACAO");
    const st = await people[0].state();
    expect(st.podium.final).toBe(true);
    expect(st.podium.revealed).toBe(true);
    expect(st.podium.winners).toHaveLength(3);
    expect(st.podium.winners[0].prize.name).toBe("Mentoria individual de 1 hora");
    const awards = await env.admin.get(`/api/admin/sessions/${s.sessionId}/awards`);
    expect(awards).toHaveLength(3);
    await env.admin.post(`/api/admin/awards/${awards[0].id}/deliver`, { notes: "Entregue no palco" });
    const after = await env.admin.get(`/api/admin/sessions/${s.sessionId}/awards`);
    expect(after.find((a: any) => a.id === awards[0].id).status).toBe("ENTREGUE");
  });

  it("após o encerramento, respostas e alterações silenciosas de pontuação são bloqueadas", async () => {
    const ctrl = await control();
    const q8 = q(ctrl, 8);
    await expectHttpError(people[0].answer(q8.sessionQuestionId, [], 3), 409, "SESSAO_NAO_ATIVA");
    await expectHttpError(
      env.admin.post(`/api/admin/sessions/${s.sessionId}/adjust-score`, { sessionParticipantId: people[0].spId, points: 10, reason: "teste de ajuste" }),
      400,
    );
  });

  it("desclassificação justificada gera nova revisão do pódio e auditoria", async () => {
    const before = (await people[0].state()).podium.winners;
    const leader = (await env.admin.get(`/api/admin/sessions/${s.sessionId}/leaderboard`))[0];
    await expectHttpError(env.admin.post(`/api/admin/sessions/${s.sessionId}/disqualify`, { sessionParticipantId: leader.id, reason: "curto" }), 400);
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/disqualify`, { sessionParticipantId: leader.id, reason: "Respostas enviadas por terceiros" });
    const after = (await people[1].state()).podium.winners;
    expect(after[0].displayName).not.toBe(before[0].displayName);
    const awards = await env.admin.get(`/api/admin/sessions/${s.sessionId}/awards`);
    expect(awards.some((a: any) => a.status === "REVOGADO")).toBe(true);
    const auditLog = await env.admin.get(`/api/admin/audit?orgId=${env.orgId}`);
    expect(auditLog.some((a: any) => a.action === "participant.disqualify")).toBe(true);
  });

  it("relatório da sessão e exportações CSV/XLSX", async () => {
    const report = await env.admin.get(`/api/admin/sessions/${s.sessionId}/report`);
    expect(report.totals.registered).toBe(30);
    expect(report.totals.interacted).toBeGreaterThan(0);
    expect(report.questions).toHaveLength(11);
    expect(report.top10.length).toBe(10);
    const filtered = await env.admin.get(`/api/admin/sessions/${s.sessionId}/report?fieldKey=segmento&fieldValue=Varejo`);
    expect(filtered.totals.registered).toBe(10);
    for (const kind of ["ranking", "respostas", "participantes"]) {
      const res = await env.rt.app.request(`/api/admin/sessions/${s.sessionId}/export.csv?kind=${kind}`, { headers: { cookie: env.admin.cookie } });
      expect(res.status).toBe(200);
      const csv = await res.text();
      expect(csv.split("\r\n").length).toBeGreaterThan(1);
      if (kind === "participantes") {
        // contato apenas com consentimento de marketing (participantes pares consentiram)
        expect(csv).toContain("p2@teste.local");
        expect(csv).not.toContain("p1@teste.local");
      }
    }
    const x = await env.rt.app.request(`/api/admin/sessions/${s.sessionId}/export.xlsx`, { headers: { cookie: env.admin.cookie } });
    expect(x.status).toBe(200);
    const buf = Buffer.from(await x.arrayBuffer());
    expect(buf.subarray(0, 2).toString()).toBe("PK");
  });
});
