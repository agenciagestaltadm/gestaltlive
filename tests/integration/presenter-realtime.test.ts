/**
 * Sincronização em tempo real do modo apresentador (Socket.IO real):
 * palestrante avança → telão recebe o novo item; pergunta automática → celular recebe a pergunta;
 * slides comuns não interrompem nem encerram a pergunta aberta; telão reconectado recupera o item.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import type { Socket } from "socket.io-client";
import { setup, liveDemoSession, ParticipantClient, startServer, connectSocket, waitFor, sleep, HttpError, type TestEnv } from "./helpers";
import { RT } from "@shared/types";
import { eventSessions } from "@server/db/schema";
import { screenToken } from "@server/domains/sessions";
import type { RunningServer } from "@server/runtime";

let env: TestEnv;
let srv: RunningServer;
const sockets: Socket[] = [];

beforeAll(async () => {
  env = await setup({ realClock: true });
  srv = await startServer(env.rt);
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await srv.stop();
  await env.close();
});

async function uploadSlide(name: string) {
  const data = await sharp({ create: { width: 64, height: 36, channels: 3, background: { r: 200, g: 10, b: 90 } } }).png().toBuffer();
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(data)], name, { type: "image/png" }));
  const res = await env.rt.app.request(`/api/admin/assets?orgId=${env.orgId}`, { method: "POST", body: fd, headers: { cookie: env.admin.cookie } });
  const json = await res.json();
  if (!res.ok) throw new HttpError(res.status, json);
  return json.asset.id as string;
}

describe("modo apresentador em tempo real", () => {
  it("telão, painel e celular sincronizados durante slides e perguntas", async () => {
    const s = await liveDemoSession(env, "RT apresentação");
    const qs = await env.admin.get(`/api/admin/events/${s.eventId}/questions`);
    const pres = await env.admin.post(`/api/admin/presentations?orgId=${env.orgId}`, { title: "RT", eventId: s.eventId });
    const a1 = await uploadSlide("a-1.png");
    const a2 = await uploadSlide("a-2.png");
    const a3 = await uploadSlide("a-3.png");
    const saved = await env.admin.put(`/api/admin/presentations/${pres.id}/items`, [
      { type: "IMAGE_SLIDE", assetId: a1 },
      { type: "QUIZ", questionId: qs[3].id, settings: { openMode: "AUTOMATICO" } },
      { type: "IMAGE_SLIDE", assetId: a2 },
      { type: "CHART", questionId: qs[3].id },
      { type: "IMAGE_SLIDE", assetId: a3 },
    ]);
    await env.admin.put(`/api/admin/sessions/${s.sessionId}`, { name: "RT apresentação", presentationId: pres.id });
    const [row] = await env.rt.ctx.db.select().from(eventSessions).where(eq(eventSessions.id, s.sessionId));
    const token = screenToken(env.rt.ctx, row);
    const p = await ParticipantClient.join(env.rt, s.code, 1);
    const phone = await connectSocket(srv.port, { role: "participant", code: s.code, token: p.token });
    let tv = await connectSocket(srv.port, { role: "screen", code: s.code, token });
    const panel = await connectSocket(srv.port, { role: "control", sessionId: s.sessionId }, { cookie: env.admin.cookie });
    sockets.push(phone, tv, panel);
    let phoneGotSlide = false;
    phone.on(RT.presenterChanged, () => (phoneGotSlide = true));

    // início: telão e painel recebem o item atual
    const tvItem = waitFor(tv, RT.presenterChanged, (d: any) => d.currentItemId === saved.items[0].id);
    const panelItem = waitFor(panel, RT.presenterChanged, (d: any) => d.currentItemId === saved.items[0].id);
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/presenter`, { action: "start" });
    await Promise.all([tvItem, panelItem]);

    // próximo: quiz automático → o celular recebe a pergunta liberada
    const opened = waitFor(phone, RT.questionOpened);
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/presenter`, { action: "next", fromItemId: saved.items[0].id });
    const q = await opened;
    await p.answer(q.sessionQuestionId, [q.options[0].id]);

    // volta a um slide: a pergunta continua aberta e o telão mostra a imagem
    let closed = false;
    phone.on(RT.questionClosed, () => (closed = true));
    const tvSlide = waitFor(tv, RT.presenterChanged, (d: any) => d.currentItemId === saved.items[2].id);
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/presenter`, { action: "next", fromItemId: saved.items[1].id });
    await tvSlide;
    await sleep(300);
    expect(closed).toBe(false);
    expect((await p.state()).activeQuestion.state).toBe("ABERTA");
    // slides comuns não são enviados ao celular (só ao telão e ao painel)
    expect(phoneGotSlide).toBe(false);

    // telão cai e volta: recupera o item atual pelo estado
    tv.disconnect();
    tv = await connectSocket(srv.port, { role: "screen", code: s.code, token });
    sockets.push(tv);
    const screen = await (await env.rt.app.request(`/api/screen/${s.code}/state?t=${token}`)).json();
    expect(screen.presenter.itemId).toBe(saved.items[2].id);
    expect(screen.presentation.screen).toBe("SLIDE");

    // fecha a pergunta e vai ao gráfico: resultados públicos chegam ao telão
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/questions/${q.sessionQuestionId}/close`);
    const results = waitFor(tv, RT.resultsUpdated, (d: any) => d.sessionQuestionId === q.sessionQuestionId, 8000);
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/presenter`, { action: "next", fromItemId: saved.items[2].id });
    const r = await results;
    expect(r.totals.respondents).toBe(1);
  });
});
