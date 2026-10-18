/**
 * Gerenciador de Apresentações: biblioteca de slides, linha do tempo, modo apresentador e a
 * integração entre slides de imagem e a engine de perguntas ao vivo.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { setup, liveDemoSession, ParticipantClient, expectHttpError, AdminClient, HttpError, type TestEnv } from "./helpers";
import { advanceTimedItems } from "@server/domains/presenter";
import { eventSessions } from "@server/db/schema";
import { screenToken } from "@server/domains/sessions";
import { eq } from "drizzle-orm";

let env: TestEnv;
let demoEventId: string;

async function png(w = 320, h = 180, color = { r: 255, g: 0, b: 104 }) {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
}
async function jpg(w = 320, h = 180) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 11, g: 23, b: 54 } } }).jpeg().toBuffer();
}

async function upload(admin: AdminClient, name: string, data: Buffer, type = "image/png") {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(data)], name, { type }));
  const res = await env.rt.app.request(`/api/admin/assets?orgId=${env.orgId}`, { method: "POST", body: fd, headers: { cookie: admin.cookie } });
  const json = await res.json();
  if (!res.ok) throw new HttpError(res.status, json);
  return { status: res.status, ...(json as { asset: { id: string; originalName: string; urls: { mini: string; tela: string } }; reused: boolean }) };
}

async function screenState(sessionId: string, code: string) {
  const [row] = await env.rt.ctx.db.select().from(eventSessions).where(eq(eventSessions.id, sessionId));
  const res = await env.rt.app.request(`/api/screen/${code}/state?t=${screenToken(env.rt.ctx, row)}`);
  return res.json();
}

beforeAll(async () => {
  env = await setup();
  const events = await env.admin.get(`/api/admin/events?orgId=${env.orgId}`);
  demoEventId = events.find((e: any) => e.title.startsWith("Vendas Inteligentes")).id;
});
afterAll(async () => env.close());

describe("biblioteca de slides", () => {
  it("aceita PNG e JPG reais, deduplica e serve as variantes", async () => {
    const a = await upload(env.admin, "capa.png", await png());
    expect(a.status).toBe(201);
    const again = await upload(env.admin, "capa-copia.png", await png());
    expect(again.status).toBe(200);
    expect(again.reused).toBe(true);
    expect(again.asset.id).toBe(a.asset.id);
    const j = await upload(env.admin, "foto.jpg", await jpg(), "image/jpeg");
    expect(j.status).toBe(201);
    for (const url of [a.asset.urls.mini, a.asset.urls.tela]) {
      const r = await env.rt.app.request(url);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/webp");
      const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
      expect(meta.width).toBeLessThanOrEqual(480 === meta.width ? 480 : 2560);
    }
  });

  it("rejeita arquivo disfarçado e imagem corrompida", async () => {
    await expectHttpError(upload(env.admin, "malicioso.png", Buffer.from("<script>alert(1)</script>")), 400, "FORMATO_INVALIDO");
    const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
    await expectHttpError(upload(env.admin, "quebrado.png", header), 400, "IMAGEM_INVALIDA");
    const gif = Buffer.from("GIF89a" + "x".repeat(40));
    await expectHttpError(upload(env.admin, "anim.gif", gif, "image/gif"), 400, "FORMATO_INVALIDO");
  });
});

describe("apresentação e linha do tempo", () => {
  let presentationId: string;
  let s: Awaited<ReturnType<typeof liveDemoSession>>;
  let qs: any[];
  let p: ParticipantClient;

  it("50 slides em lote ficam na ordem natural (slide-2 antes de slide-10)", async () => {
    const created = await env.admin.post(`/api/admin/presentations?orgId=${env.orgId}`, { title: "Palestra Vendas", eventId: demoEventId });
    presentationId = created.id;
    const order = Array.from({ length: 50 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    const ids: string[] = [];
    for (const n of order) {
      const a = await upload(env.admin, `slide-${n}.png`, await png(160, 90, { r: n * 5, g: 255 - n * 4, b: 100 }));
      ids.push(a.asset.id);
    }
    const pres = await env.admin.post(`/api/admin/presentations/${presentationId}/slides`, { assetIds: ids });
    expect(pres.items).toHaveLength(50);
    expect(pres.items.slice(0, 11).map((i: any) => i.title)).toEqual(["slide-1", "slide-2", "slide-3", "slide-4", "slide-5", "slide-6", "slide-7", "slide-8", "slide-9", "slide-10", "slide-11"]);
    const lib = await env.admin.get(`/api/admin/assets?orgId=${env.orgId}&q=slide-1`);
    expect(lib.rows.every((r: any) => r.usage === 1)).toBe(true);

    // seleção manual na biblioteca: mantém a ordem pedida; a capa da lista é o 1º slide
    const manual = await env.admin.post(`/api/admin/presentations?orgId=${env.orgId}`, { title: "Ordem manual" });
    const pick = ids.slice(0, 3);
    const mp = await env.admin.post(`/api/admin/presentations/${manual.id}/slides`, { assetIds: [...pick].reverse(), order: "pedida" });
    expect(mp.items.map((i: any) => i.assetId)).toEqual([...pick].reverse());
    const list = await env.admin.get(`/api/admin/presentations?orgId=${env.orgId}`);
    const row = list.find((r: any) => r.id === manual.id);
    expect(row.slideCount).toBe(3);
    expect(row.coverUrl).toBe(mp.items[0].asset.urls.mini);
    await env.admin.req("DELETE", `/api/admin/presentations/${manual.id}`);
  });

  it("intercala pergunta, gráfico, ranking, satisfação, QR, tela personalizada e premiação; salva e reordena mantendo ids", async () => {
    qs = await env.admin.get(`/api/admin/events/${demoEventId}/questions`);
    const q1 = qs[0]; // perfil
    const quiz = qs[3]; // conhecimento
    const pres = await env.admin.get(`/api/admin/presentations/${presentationId}`);
    const slides = pres.items.slice(0, 6).map((i: any) => ({ id: i.id, type: i.type, title: i.title, assetId: i.assetId, settings: i.settings }));
    slides[0].notes = "Cumprimentar o público. Contar a história da Gestalt.";
    const items = [
      slides[0],
      { type: "QR_CODE", title: "Entre agora" },
      slides[1],
      { type: "POLL", questionId: q1.id, settings: { openMode: "MANUAL" } },
      { type: "CHART", questionId: q1.id, settings: { chartType: "pie" } },
      slides[2],
      { type: "QUIZ", questionId: quiz.id, settings: { openMode: "AUTOMATICO", advanceAfterClose: true } },
      { type: "CHART", questionId: quiz.id },
      { type: "LEADERBOARD" },
      slides[3],
      { type: "SATISFACTION" },
      { type: "CUSTOM_SCREEN", settings: { heading: "Intervalo", message: "Voltamos em 10 minutos" } },
      slides[4],
      { type: "AWARDS" },
      slides[5],
    ];
    const saved = await env.admin.put(`/api/admin/presentations/${presentationId}/items`, items);
    expect(saved.items).toHaveLength(15);
    expect(saved.items[0].id).toBe(slides[0].id);
    expect(saved.items[0].notes).toContain("Cumprimentar");
    // reordena (move o último slide para o início) mantendo ids
    const reordered = [saved.items[14], ...saved.items.slice(0, 14)].map((i: any) => ({ ...i, asset: undefined, question: undefined }));
    const again = await env.admin.put(`/api/admin/presentations/${presentationId}/items`, reordered);
    expect(again.items[0].id).toBe(saved.items[14].id);
    // desfaz a reordenação
    await env.admin.put(`/api/admin/presentations/${presentationId}/items`, saved.items.map((i: any) => ({ ...i, asset: undefined, question: undefined })));
  });

  it("recusa pergunta de outro evento e quiz sem pontuação", async () => {
    const other = await env.admin.post(`/api/admin/events?orgId=${env.orgId}`, { title: "Outro evento" });
    const q = await env.admin.post(`/api/admin/events/${other.id}/questions`, {
      type: "OPINIAO",
      title: "Q",
      chart: { type: "bar_vertical" },
      options: [{ label: "a" }, { label: "b" }],
    });
    await expectHttpError(env.admin.put(`/api/admin/presentations/${presentationId}/items`, [{ type: "QUESTION", questionId: q.id }]), 400, "PERGUNTA_DE_OUTRO_EVENTO");
    await expectHttpError(env.admin.put(`/api/admin/presentations/${presentationId}/items`, [{ type: "QUIZ", questionId: qs[0].id }]), 400, "QUIZ_SEM_PONTUACAO");
  });

  it("sessão real: slides, pergunta manual, voltar ao slide sem fechar a pergunta, gráfico", async () => {
    s = await liveDemoSession(env, "Turma com slides");
    await env.admin.put(`/api/admin/sessions/${s.sessionId}`, { name: "Turma com slides", presentationId });
    p = await ParticipantClient.join(env.rt, s.code, 1);
    const P = (cmd: object) => env.admin.post(`/api/admin/sessions/${s.sessionId}/presenter`, cmd);
    let r = await P({ action: "start" });
    expect(r.presenter.status).toBe("APRESENTANDO");
    expect(r.presenter.currentIndex).toBe(0);
    // telão mostra a imagem do slide; nada de notas no telão ou no participante
    let screen = await screenState(s.sessionId, s.code);
    expect(screen.presentation.screen).toBe("SLIDE");
    expect(screen.presenter.slide.imageUrl).toContain("-tela.webp");
    expect(screen.presenter.preload.length).toBeGreaterThan(0);
    expect(JSON.stringify(screen)).not.toContain("Cumprimentar");
    expect(JSON.stringify(await p.state())).not.toContain("Cumprimentar");
    expect(r.presenter.items[0].notes).toContain("Cumprimentar");

    // QR → slide → enquete (manual: não abre sozinha)
    r = await P({ action: "next", fromItemId: r.presenter.currentItemId });
    screen = await screenState(s.sessionId, s.code);
    expect(screen.presentation.screen).toBe("BOAS_VINDAS");
    r = await P({ action: "next", fromItemId: r.presenter.currentItemId });
    // comando duplicado (passador clicou duas vezes com o mesmo item de origem) não avança de novo
    const stale = await P({ action: "next", fromItemId: r.presenter.items[1].id });
    expect(stale.result.stale).toBe(true);
    expect(stale.presenter.currentIndex).toBe(2);
    r = await P({ action: "next", fromItemId: r.presenter.currentItemId });
    expect(r.presenter.currentIndex).toBe(3);
    const pollSq = r.presenter.sessionQuestionIds[qs[0].id];
    screen = await screenState(s.sessionId, s.code);
    expect(screen.presentation.screen).toBe("PERGUNTA");
    expect(screen.question.sessionQuestionId).toBe(pollSq);
    expect(screen.question.state).toBe("PRONTA");
    expect((await p.state()).activeQuestion).toBeNull();

    // liberar manualmente (controle existente) → celular recebe e responde
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${pollSq}/open`);
    const st = await p.state();
    expect(st.activeQuestion.state).toBe("ABERTA");
    await p.answer(pollSq, [st.activeQuestion.options[1].id]);

    // voltar para um slide NÃO encerra a pergunta
    r = await P({ action: "prev", fromItemId: r.presenter.currentItemId });
    screen = await screenState(s.sessionId, s.code);
    expect(screen.presentation.screen).toBe("SLIDE");
    const stillOpen = await p.state();
    expect(stillOpen.activeQuestion.sessionQuestionId).toBe(pollSq);
    expect(stillOpen.activeQuestion.state).toBe("ABERTA");

    // avança de novo à enquete e ao gráfico → resultados no telão
    r = await P({ action: "goto", toItemId: r.presenter.items[4].id });
    screen = await screenState(s.sessionId, s.code);
    expect(screen.presentation.screen).toBe("RESULTADO");
    expect(screen.results.totals.respondents).toBe(1);
    expect(screen.presenter.chartType).toBe("pie");
  });

  it("quiz automático abre ao chegar, fecha e avança sozinho; ranking, satisfação, telas e premiação", async () => {
    const P = (cmd: object) => env.admin.post(`/api/admin/sessions/${s.sessionId}/presenter`, cmd);
    let r = await P({ action: "goto", toItemId: (await P({ action: "start" })).presenter.items[5].id });
    r = await P({ action: "next", fromItemId: r.presenter.currentItemId }); // quiz automático
    const quizSq = r.presenter.sessionQuestionIds[qs[3].id];
    const st = await p.state();
    expect(st.activeQuestion.sessionQuestionId).toBe(quizSq);
    expect(st.activeQuestion.state).toBe("ABERTA");
    const ctrl = await env.admin.get(`/api/admin/sessions/${s.sessionId}/control`);
    const quiz = ctrl.questions.find((q: any) => q.sessionQuestionId === quizSq);
    await p.answer(quizSq, [quiz.correctOptionIdsAdmin[0]]);
    // a enquete aberta antes foi substituída (regra existente: uma pergunta aberta por vez)
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${quizSq}/close`);
    r = await env.admin.get(`/api/admin/sessions/${s.sessionId}/presenter`);
    expect(r.presenter.items[r.presenter.currentIndex].type).toBe("CHART"); // avançou após encerrar
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${quizSq}/reveal`);
    r = await P({ action: "next", fromItemId: r.presenter.currentItemId }); // ranking
    let screen = await screenState(s.sessionId, s.code);
    expect(screen.presentation.screen).toBe("RANKING");
    expect(screen.leaderboard.entries[0].score).toBeGreaterThan(0);
    expect((await p.me()).score).toBeGreaterThan(0);
    r = await P({ action: "next", fromItemId: r.presenter.currentItemId }); // slide
    r = await P({ action: "next", fromItemId: r.presenter.currentItemId }); // satisfação
    expect((await screenState(s.sessionId, s.code)).presentation.screen).toBe("SATISFACAO");
    r = await P({ action: "next", fromItemId: r.presenter.currentItemId }); // tela personalizada
    screen = await screenState(s.sessionId, s.code);
    expect(screen.presentation.screen).toBe("TELA_PERSONALIZADA");
    expect(screen.presenter.slide.heading).toBe("Intervalo");
    // tela preta e pausa
    r = await P({ action: "override", override: "TELA_PRETA" });
    expect((await screenState(s.sessionId, s.code)).presenter.override).toBe("TELA_PRETA");
    r = await P({ action: "next", fromItemId: r.presenter.currentItemId }); // navegar limpa a sobreposição
    expect((await screenState(s.sessionId, s.code)).presenter.override).toBe("NENHUM");
    r = await P({ action: "next", fromItemId: r.presenter.currentItemId }); // premiação
    screen = await screenState(s.sessionId, s.code);
    expect(screen.presentation.screen).toBe("PREMIACAO");
    expect(screen.podium.revealed).toBe(true);
    // participante continua com a interface própria (sem slides), com ranking e prêmios
    const ps = await p.state();
    expect(ps.leaderboard).not.toBeNull();
    expect(ps.prizes.length).toBe(3);
  });

  it("recupera a posição após recarregar e respeita limites", async () => {
    const r1 = await env.admin.get(`/api/admin/sessions/${s.sessionId}/presenter`);
    const r2 = await env.admin.post(`/api/admin/sessions/${s.sessionId}/presenter`, { action: "start" });
    expect(r2.presenter.currentItemId).toBe(r1.presenter.currentItemId); // "start" retoma a posição
    const last = r1.presenter.items[r1.presenter.items.length - 1];
    const atEnd = await env.admin.post(`/api/admin/sessions/${s.sessionId}/presenter`, { action: "goto", toItemId: last.id });
    const edge = await env.admin.post(`/api/admin/sessions/${s.sessionId}/presenter`, { action: "next", fromItemId: atEnd.presenter.currentItemId });
    expect(edge.result.edge).toBe(true);
  });

  it("slide com tempo de permanência avança sozinho", async () => {
    const pres = await env.admin.get(`/api/admin/presentations/${presentationId}`);
    const items = pres.items.map((i: any) => ({ ...i, asset: undefined, question: undefined }));
    items[0].settings = { ...items[0].settings, durationSec: 5 };
    await env.admin.put(`/api/admin/presentations/${presentationId}/items`, items);
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/presenter`, { action: "goto", toItemId: items[0].id });
    env.clock.advance(4000);
    expect(await advanceTimedItems(env.rt.ctx)).toBe(0);
    env.clock.advance(2000);
    expect(await advanceTimedItems(env.rt.ctx)).toBe(1);
    const r = await env.admin.get(`/api/admin/sessions/${s.sessionId}/presenter`);
    expect(r.presenter.currentIndex).toBe(1);
  });

  it("duplicar para outro evento copia as perguntas usadas e reutiliza os mesmos arquivos", async () => {
    const ev2 = await env.admin.post(`/api/admin/events?orgId=${env.orgId}`, { title: "Turma de dezembro" });
    const copy = await env.admin.post(`/api/admin/presentations/${presentationId}/duplicate`, { targetEventId: ev2.id, title: "Palestra Vendas — dezembro" });
    expect(copy.eventId).toBe(ev2.id);
    const original = await env.admin.get(`/api/admin/presentations/${presentationId}`);
    expect(copy.items).toHaveLength(original.items.length);
    const ev2Questions = await env.admin.get(`/api/admin/events/${ev2.id}/questions`);
    const qItems = copy.items.filter((i: any) => i.questionId);
    expect(qItems.every((i: any) => ev2Questions.some((q: any) => q.id === i.questionId))).toBe(true);
    expect(new Set(qItems.map((i: any) => i.questionId)).size).toBe(2); // perguntas reaproveitadas uma vez cada
    expect(copy.items.filter((i: any) => i.assetId).every((i: any) => original.items.some((o: any) => o.assetId === i.assetId))).toBe(true);
    expect(copy.items[0].notes).toContain("Cumprimentar");
  });

  it("duplicar o evento leva as apresentações junto", async () => {
    const dup = await env.admin.post(`/api/admin/events/${demoEventId}/duplicate`);
    const list = await env.admin.get(`/api/admin/presentations?orgId=${env.orgId}&eventId=${dup.id}`);
    expect(list).toHaveLength(1);
    expect(list[0].itemCount).toBe(15);
    expect(list[0].slideCount).toBe(6);
  });

  it("biblioteca: arquivo em uso não pode ser excluído; remover o slide não apaga o arquivo", async () => {
    const pres = await env.admin.get(`/api/admin/presentations/${presentationId}`);
    const slide = pres.items.find((i: any) => i.type === "IMAGE_SLIDE");
    await expectHttpError(env.admin.req("DELETE", `/api/admin/assets/${slide.assetId}`), 409, "ARQUIVO_EM_USO");
    const usage = await env.admin.get(`/api/admin/assets/${slide.assetId}/usage`);
    expect(usage.length).toBeGreaterThanOrEqual(2);
    const r = await env.rt.app.request(slide.asset.urls.tela);
    expect(r.status).toBe(200);
  });

  it("permissões: outra organização não vê; palestrante apresenta mas não edita", async () => {
    const org = await env.admin.post(`/api/admin/orgs`, { name: "Org B", slug: "org-b-pres" });
    await env.admin.post(`/api/admin/orgs/${org.id}/members`, { name: "B", email: "b@pres.local", password: "SenhaB123456", role: "ORG_ADMIN" });
    const other = new AdminClient(env.rt);
    await other.login("b@pres.local", "SenhaB123456");
    await expectHttpError(other.get(`/api/admin/presentations/${presentationId}`), 404);
    await expectHttpError(other.post(`/api/admin/sessions/${s.sessionId}/presenter`, { action: "next" }), 404);
    await env.admin.post(`/api/admin/orgs/${env.orgId}/members`, { name: "Pal", email: "pal@pres.local", password: "Palestra12345", role: "SPEAKER" });
    const speaker = new AdminClient(env.rt);
    await speaker.login("pal@pres.local", "Palestra12345");
    const r = await speaker.get(`/api/admin/sessions/${s.sessionId}/presenter`);
    await speaker.post(`/api/admin/sessions/${s.sessionId}/presenter`, { action: "next", fromItemId: r.presenter.currentItemId });
    await expectHttpError(speaker.put(`/api/admin/presentations/${presentationId}/items`, []), 403);
  });
});

describe("sessão ↔ apresentação", () => {
  it("trocar a apresentação não apaga o agendamento, aparece no estado e tela preta funciona antes de iniciar", async () => {
    const when = new Date(Date.now() + 86_400_000).toISOString();
    const sess = await env.admin.post(`/api/admin/events/${demoEventId}/sessions`, { name: "Agendada", scheduledAt: when });
    const a = await env.admin.post(`/api/admin/presentations?orgId=${env.orgId}`, { title: "A", eventId: demoEventId });
    const b = await env.admin.post(`/api/admin/presentations?orgId=${env.orgId}`, { title: "B", eventId: demoEventId });
    await env.admin.put(`/api/admin/presentations/${a.id}/items`, [{ type: "QR_CODE" }]);
    await env.admin.put(`/api/admin/presentations/${b.id}/items`, [{ type: "LEADERBOARD" }, { type: "AWARDS" }]);
    await env.admin.put(`/api/admin/sessions/${sess.id}`, { name: "Agendada", presentationId: a.id });
    const info = await env.admin.get(`/api/admin/sessions/${sess.id}`);
    expect(new Date(info.scheduledAt).toISOString()).toBe(when);
    expect(info.presentationId).toBe(a.id);
    const list = await env.admin.get(`/api/admin/events/${demoEventId}/sessions`);
    expect(list.find((x: any) => x.id === sess.id).presentationId).toBe(a.id);
    await env.admin.post(`/api/admin/sessions/${sess.id}/lobby`);
    await env.admin.post(`/api/admin/sessions/${sess.id}/presenter`, { action: "start" });
    await env.admin.put(`/api/admin/sessions/${sess.id}`, { name: "Agendada", presentationId: b.id });
    const r = await env.admin.get(`/api/admin/sessions/${sess.id}/presenter`);
    expect(r.presenter.presentationId).toBe(b.id);
    expect(r.presenter.status).toBe("PRONTA");
    expect(r.presenter.settings.defaultTransition).toBe("FADE");
    // tela preta antes de iniciar a nova apresentação
    await env.admin.post(`/api/admin/sessions/${sess.id}/presenter`, { action: "override", override: "TELA_PRETA" });
    const screen = await screenState(sess.id, sess.code);
    expect(screen.presenter.override).toBe("TELA_PRETA");
  });
});

