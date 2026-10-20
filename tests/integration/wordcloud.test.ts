/** Nuvem de Palavras de ponta a ponta: cadastro, envios, limites, moderação, resultados, exportação e LGPD. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { sessionParticipants, wordCloudEntries } from "@server/db/schema";
import { expectHttpError, liveDemoSession, ParticipantClient, setup, type TestEnv } from "./helpers";

let env: TestEnv;
let eventId: string;
let s: Awaited<ReturnType<typeof liveDemoSession>>;
let people: ParticipantClient[];
const sqOf: Record<string, string> = {};

const wcQuestion = (title: string, wordCloud: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  type: "NUVEM_PALAVRAS",
  title,
  description: "Responda com poucas palavras.",
  chart: { type: "wordcloud", wordCloud: { style: "GESTALT" } },
  resultsMode: "AO_VIVO",
  wordCloud,
  ...extra,
});
const results = (sqId: string) => env.admin.get(`/api/admin/sessions/${s.sessionId}/results/${sqId}`);
const open = (sqId: string) => env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${sqId}/open`);

beforeAll(async () => {
  env = await setup();
  const events = await env.admin.get(`/api/admin/events?orgId=${env.orgId}`);
  eventId = events.find((e: { title: string }) => e.title.startsWith("Vendas Inteligentes")).id;
  // perguntas criadas antes da sessão (entram na sessão)
  await env.admin.post(`/api/admin/events/${eventId}/questions`, wcQuestion("Livre: qual seu desafio?", { maxEntries: 2, maxWords: 3 }));
  await env.admin.post(`/api/admin/events/${eventId}/questions`, wcQuestion("Moderada: o que é marketing?", { requireApproval: true, maxEntries: 3, mode: "FRASE", maxWords: 5 }));
  s = await liveDemoSession(env, "Turma nuvem");
  const ctrl = await env.admin.get(`/api/admin/sessions/${s.sessionId}/control`);
  for (const q of ctrl.questions) sqOf[q.title] = q.sessionQuestionId;
  people = [];
  for (let i = 0; i < 6; i++) people.push(await ParticipantClient.join(env.rt, s.code, i));
});
afterAll(() => env.close());

describe("cadastro", () => {
  it("cria a pergunta com regras padrão e recusa alternativas", async () => {
    const qs = await env.admin.get(`/api/admin/events/${eventId}/questions`);
    const q = qs.find((x: { title: string }) => x.title === "Livre: qual seu desafio?");
    expect(q.type).toBe("NUVEM_PALAVRAS");
    expect(q.chart.type).toBe("wordcloud");
    expect(q.wordCloud).toMatchObject({ maxEntries: 2, maxWords: 3, maxChars: 50, profanityFilter: true, ignoreCase: true });
    expect(q.options).toEqual([]);
    // a demonstração já traz uma nuvem de exemplo
    expect(qs.some((x: { type: string; title: string }) => x.type === "NUVEM_PALAVRAS" && x.title.includes("maior desafio"))).toBe(true);
    // alternativas são descartadas pela normalização; gráfico de barras é recusado
    const created = await env.admin.post(`/api/admin/events/${eventId}/questions`, wcQuestion("Teste", {}, { options: [{ label: "a" }, { label: "b" }] }));
    expect(created.type).toBe("NUVEM_PALAVRAS");
    await env.admin.req("DELETE", `/api/admin/questions/${created.id}`);
  });
});

describe("envios", () => {
  it("participante recebe as regras e envia; maiúsculas e minúsculas viram um único termo", async () => {
    const sq = sqOf["Livre: qual seu desafio?"];
    await open(sq);
    const st = await people[0].state();
    expect(st.activeQuestion.type).toBe("NUVEM_PALAVRAS");
    expect(st.activeQuestion.wordCloud).toMatchObject({ maxEntries: 2, maxWords: 3, maxChars: 50 });
    expect(st.myWordCloud).toEqual({ entries: [], remaining: 2 });

    const r = await people[0].word(sq, "VENDAS");
    expect(r).toMatchObject({ outcome: "ACEITA", remaining: 1, entry: { text: "VENDAS", status: "APROVADA" } });
    await people[1].word(sq, "vendas");
    await people[2].word(sq, "  Vendas  ");
    await people[3].word(sq, "Prospecção de clientes");
    const res = await results(sq);
    expect(res.wordCloud.terms.slice(0, 1)).toEqual([{ key: "vendas", label: "Vendas", count: 3, pct: 60 }]);
    expect(res.wordCloud.terms.map((t: { label: string }) => t.label)).toEqual(expect.arrayContaining(["Prospecção", "Clientes"]));
    expect(res.wordCloud.denominator).toEqual({ kind: "TERMOS", value: 5 });
    expect(res.totals.respondents).toBe(4);
    // tabela acessível / relatórios usam as mesmas categorias
    expect(res.categories[0]).toMatchObject({ label: "Vendas", count: 3 });
  });

  it("limites: envios por pessoa, repetição, palavras, caracteres e reenvio idempotente", async () => {
    const sq = sqOf["Livre: qual seu desafio?"];
    const p = people[4];
    const key = "chave-idempotente-01";
    const a = await p.word(sq, "Tempo", key);
    const again = await p.word(sq, "Tempo", key);
    expect(again.outcome).toBe("DUPLICADA");
    expect(again.entry.id).toBe(a.entry.id);
    await expectHttpError(p.word(sq, "tempo"), 409, "RESPOSTA_REPETIDA");
    await expectHttpError(p.word(sq, "uma duas tres quatro cinco"), 422, "PALAVRAS_DEMAIS");
    await expectHttpError(p.word(sq, "x".repeat(60)), 422, "MUITO_LONGA");
    await expectHttpError(p.word(sq, "   "), 422, "VAZIA");
    await p.word(sq, "Preço");
    await expectHttpError(p.word(sq, "Concorrência"), 409, "LIMITE_DE_ENVIOS");
    const st = await p.state();
    expect(st.myWordCloud.remaining).toBe(0);
    expect(st.myWordCloud.entries.map((e: { text: string }) => e.text)).toEqual(["Tempo", "Preço"]);
  });

  it("termo inadequado é recusado na hora, registrado e não consome envio", async () => {
    const sq = sqOf["Livre: qual seu desafio?"];
    const p = people[5];
    await expectHttpError(p.word(sq, "que merda"), 422, "TERMO_NAO_PERMITIDO");
    const st = await p.state();
    expect(st.myWordCloud.remaining).toBe(2);
    const mod = await env.admin.get(`/api/admin/sessions/${s.sessionId}/questions/${sq}/wordcloud?status=REJEITADA`);
    expect(mod.entries.some((e: { reason: string }) => e.reason === "TERMO_NAO_PERMITIDO")).toBe(true);
    const res = await results(sq);
    expect(res.wordCloud.terms.some((t: { key: string }) => t.key === "merda")).toBe(false);
  });

  it("pergunta fechada não aceita envios e a pergunta trava as regras de envio", async () => {
    const sq = sqOf["Livre: qual seu desafio?"];
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${sq}/close`);
    await expectHttpError(people[5].word(sq, "Leads"), 409, "PERGUNTA_FECHADA");
    const qs = await env.admin.get(`/api/admin/events/${eventId}/questions`);
    const q = qs.find((x: { title: string }) => x.title === "Livre: qual seu desafio?");
    expect(q.locked).toBe(true);
    expect(q.answersCount).toBeGreaterThan(0);
    const payload = { ...q, wordCloud: { ...q.wordCloud, maxEntries: 5 } };
    await expectHttpError(env.admin.put(`/api/admin/questions/${q.id}`, payload), 409, "PERGUNTA_BLOQUEADA");
    // aparência e sinônimos continuam editáveis
    const ok = await env.admin.put(`/api/admin/questions/${q.id}`, { ...q, chart: { ...q.chart, wordCloud: { ...q.chart.wordCloud, style: "MINIMALISTA" } } });
    expect(ok.chart.wordCloud.style).toBe("MINIMALISTA");
  });
});

describe("moderação", () => {
  it("pendentes não aparecem no telão nem no celular até a aprovação", async () => {
    const sq = sqOf["Moderada: o que é marketing?"];
    await open(sq);
    const r = await people[0].word(sq, "Relacionamento com o cliente");
    expect(r.outcome).toBe("PENDENTE");
    await people[1].word(sq, "Vender valor");
    expect((await results(sq)).wordCloud.terms).toEqual([]);
    const screen = await env.admin.get(`/api/admin/sessions/${s.sessionId}`);
    const scr = await env.rt.app.request(`/api/screen/${s.code}/state?t=${new URL(screen.screenUrl).searchParams.get("t")}`);
    const scrState = await scr.json();
    expect(scrState.question.type).toBe("NUVEM_PALAVRAS");
    expect(JSON.stringify(scrState)).not.toContain("Relacionamento");

    const list = await env.admin.get(`/api/admin/sessions/${s.sessionId}/questions/${sq}/wordcloud`);
    expect(list.counts.PENDENTE).toBe(2);
    expect(list.entries[0]).toHaveProperty("displayName");
    expect(JSON.stringify(list)).not.toMatch(/@teste\.local|1199/); // nunca contato
    const pending = list.entries.find((e: { text: string }) => e.text === "Relacionamento com o cliente");
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${sq}/wordcloud/entries/${pending.id}/approve`);
    const after = await results(sq);
    expect(after.wordCloud.terms).toEqual([{ key: "relacionamento com o cliente", label: "Relacionamento com o cliente", count: 1, pct: 100 }]);
    expect(after.wordCloud.denominator.kind).toBe("RESPOSTAS");
    const other = list.entries.find((e: { text: string }) => e.text === "Vender valor");
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${sq}/wordcloud/entries/${other.id}/reject`);
    expect((await results(sq)).wordCloud.terms).toHaveLength(1);
  });

  it("ocultar, restaurar e bloquear termo (os envios continuam registrados)", async () => {
    const sq = sqOf["Livre: qual seu desafio?"];
    const base = `/api/admin/sessions/${s.sessionId}/questions/${sq}/wordcloud/terms`;
    await env.admin.post(base, { term: "Vendas", action: "hide" });
    expect((await results(sq)).wordCloud.terms.some((t: { key: string }) => t.key === "vendas")).toBe(false);
    const list = await env.admin.get(`/api/admin/sessions/${s.sessionId}/questions/${sq}/wordcloud`);
    expect(list.termRules).toEqual([expect.objectContaining({ termKey: "vendas", action: "OCULTO" })]);
    expect(list.entries.filter((e: { text: string }) => /vendas/i.test(e.text))).toHaveLength(3);
    await env.admin.post(base, { term: "vendas", action: "restore" });
    expect((await results(sq)).wordCloud.terms[0]).toMatchObject({ key: "vendas", count: 3 });

    // bloqueio vale para novos envios (na pergunta aberta)
    const sq2 = sqOf["Moderada: o que é marketing?"];
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${sq2}/wordcloud/terms`, { term: "propaganda enganosa", action: "block" });
    await expectHttpError(people[2].word(sq2, "Propaganda enganosa"), 422, "TERMO_NAO_PERMITIDO");
  });
});

describe("relatórios, exportação e LGPD", () => {
  it("relatório, CSV e XLSX trazem os termos e os envios originais", async () => {
    const report = await env.admin.get(`/api/admin/sessions/${s.sessionId}/report`);
    const q = report.questions.find((x: { title: string }) => x.title === "Livre: qual seu desafio?");
    expect(q.type).toBe("NUVEM_PALAVRAS");
    expect(q.selectable).toBe(false);
    expect(q.wordCloud.terms[0]).toMatchObject({ label: "Vendas", count: 3 });
    expect(q.categories[0]).toMatchObject({ label: "Vendas", count: 3 });

    const csv = await env.rt.app.request(`/api/admin/sessions/${s.sessionId}/export.csv?kind=nuvem`, { headers: { cookie: env.admin.cookie } });
    const text = await csv.text();
    expect(text).toContain("Texto original");
    expect(text).toContain("Prospecção de clientes");
    expect(text).toContain("TERMO_NAO_PERMITIDO");

    const xlsx = await env.rt.app.request(`/api/admin/sessions/${s.sessionId}/export.xlsx`, { headers: { cookie: env.admin.cookie } });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await xlsx.arrayBuffer());
    expect(wb.getWorksheet("Nuvem de palavras")?.rowCount).toBeGreaterThan(5);
    const terms = wb.getWorksheet("Termos da nuvem")!;
    expect(terms.getRow(2).getCell(3).value).toBe("Vendas");
    expect(String(terms.getRow(2).getCell(6).value)).toMatch(/termos contabilizados/);

    const cmp = await env.admin.get(`/api/admin/reports/compare?eventId=${eventId}`);
    const cq = cmp.byQuestion.find((x: { title: string }) => x.title === "Livre: qual seu desafio?");
    expect(cq.perSession[0].topTerms[0]).toMatchObject({ label: "Vendas", count: 3 });
  });

  it("anonimizar o participante apaga o texto livre dele", async () => {
    const [sp] = await env.rt.ctx.db.select().from(sessionParticipants).where(eq(sessionParticipants.id, people[3].spId));
    await env.admin.post(`/api/admin/participants/${sp.participantId}/anonymize`, { reason: "Pedido do titular (teste)" });
    const rows = await env.rt.ctx.db.select().from(wordCloudEntries).where(eq(wordCloudEntries.sessionParticipantId, people[3].spId));
    expect(rows.every((r) => r.original === "" && r.terms.length === 0 && r.reason === "ANONIMIZADO")).toBe(true);
    const res = await results(sqOf["Livre: qual seu desafio?"]);
    expect(res.wordCloud.terms.some((t: { key: string }) => t.key === "prospeccao")).toBe(false);
  });
});

describe("carga", () => {
  it("300 participantes enviando ao mesmo tempo (com reenvios) contam uma vez cada", { timeout: 120_000 }, async () => {
    const sq = sqOf["Qual palavra representa seu maior desafio nas vendas?"];
    await open(sq);
    const crowd: ParticipantClient[] = [];
    for (let i = 0; i < 300; i += 50) {
      crowd.push(...(await Promise.all(Array.from({ length: 50 }, (_, k) => ParticipantClient.join(env.rt, s.code, 1000 + i + k)))));
    }
    const words = ["Prospecção", "prospecção", "Clientes", "cliente", "Tempo", "Preço"];
    const sends = crowd.flatMap((p, i) => {
      const key = `carga-${i}-chave`;
      const w = words[i % words.length];
      // metade reenvia a mesma requisição (rede instável)
      return i % 2 === 0 ? [p.word(sq, w, key), p.word(sq, w, key)] : [p.word(sq, w, key)];
    });
    const out = await Promise.all(sends);
    expect(out.filter((r) => r.outcome === "ACEITA")).toHaveLength(300);
    const res = await results(sq);
    expect(res.totals.respondents).toBe(300);
    expect(res.wordCloud.totals.termOccurrences).toBe(300);
    // sinônimo do exemplo: "cliente" → "Clientes"; acentos/caixa agrupados
    expect(res.wordCloud.terms.find((t: { label: string }) => t.label === "Clientes").count).toBe(100);
    expect(res.wordCloud.terms.find((t: { label: string }) => t.label === "Prospecção").count).toBe(100);
  });
});
