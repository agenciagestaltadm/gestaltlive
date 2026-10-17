/**
 * Teste de carga: N participantes simultâneos (padrão 300) numa única sessão.
 *
 * Sobe um servidor real (API + Socket.IO, sem a interface Next) numa porta aleatória, com o banco
 * indicado em LOAD_DATABASE_URL (padrão: PGlite em memória) e executa o roteiro:
 *  1. cadastro concorrente de N participantes (HTTP);
 *  2. conexão de N sockets (WebSocket);
 *  3. para cada uma de Q perguntas: liberação → todos recebem → todos respondem em rajada →
 *     encerramento → revelação → publicação de pontos para todos;
 *  4. N votos de satisfação + N alterações;
 *  5. verificações de integridade (sem respostas duplicadas, livro-razão consistente).
 *
 * Uso: npm run load -- --participantes 300 --perguntas 3
 * Resultado: tests/load/results-<data>.json e resumo no console.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { io as ioClient, type Socket } from "socket.io-client";
import { createRuntime, startHttpServer } from "@server/runtime";
import { seedDatabase } from "@server/db/seed";
import { ledgerMismatches } from "@server/domains/scoring";
import { RT } from "@shared/types";
import { sql } from "drizzle-orm";
import { rowsOf } from "@server/db/client";

const args = process.argv.slice(2);
const arg = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const N = arg("participantes", 300);
const Q = arg("perguntas", 3);
const CONCURRENCY = arg("concorrencia", 50);
/** Espalha as respostas em uma janela (ms). 0 = rajada simultânea (pior caso). */
const SPREAD = arg("espalhar", 0);
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "warn";

function pct(values: number[], p: number) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
const summary = (v: number[]) => ({ n: v.length, p50: Math.round(pct(v, 50)), p95: Math.round(pct(v, 95)), p99: Math.round(pct(v, 99)), max: Math.round(Math.max(0, ...v)) });

async function pool<T>(items: T[], limit: number, fn: (t: T, i: number) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        await fn(items[k], k);
      }
    }),
  );
}

async function main() {
  const dbUrl = process.env.LOAD_DATABASE_URL ?? "pglite:memory";
  console.log(`\n▶ Gestalt Live — teste de carga: ${N} participantes, ${Q} perguntas, banco ${dbUrl.split(":")[0]}\n`);
  const rt = await createRuntime({ databaseUrl: dbUrl, rateLimitMultiplier: 1000, config: { env: "test", publicUrl: "http://carga.local", appSecret: "carga" } });
  const adminEmail = `carga-${Date.now()}@teste.local`;
  const seeded = await seedDatabase(rt.ctx, { superadminEmail: adminEmail, superadminPassword: "SenhaCarga123", demo: true });
  const srv = await startHttpServer(rt, { port: 0, host: "127.0.0.1", withNext: false, schedulerIntervalMs: 250 });
  const base = `http://127.0.0.1:${srv.port}`;
  // simula o cliente real (src/lib/api.ts): repete em falha de rede com espera exponencial
  let retries = 0;
  const http = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const t0 = performance.now();
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
        const json = await res.json().catch(() => null);
        return { status: res.status, json, ms: performance.now() - t0, headers: res.headers };
      } catch (e) {
        if (attempt >= 4) throw e;
        retries++;
        await new Promise((r) => setTimeout(r, 300 * 2 ** attempt + Math.random() * 400));
      }
    }
  };

  // login admin
  const lg = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail, password: "SenhaCarga123" }) });
  const cookie = (lg.headers.get("set-cookie") ?? "").split(";")[0];
  const A = (method: string, path: string, body?: unknown) => http(method, `/api/admin${path}`, body, { cookie });
  const events = (await A("GET", `/events?orgId=${seeded.orgId}`)).json;
  const session = (await A("POST", `/events/${events[0].id}/sessions`, { name: "Carga" })).json;
  await A("POST", `/sessions/${session.id}/lobby`);
  await A("POST", `/sessions/${session.id}/start`);
  const code = session.code as string;

  const result: Record<string, unknown> = { participantes: N, perguntas: Q, janelaRespostasMs: SPREAD, banco: dbUrl.split(":")[0], node: process.version, inicio: new Date().toISOString() };
  const errors: string[] = [];

  // 1. cadastro
  const tokens: { token: string; spId: string }[] = new Array(N);
  const joinMs: number[] = [];
  const tJoin = performance.now();
  await pool([...Array(N).keys()], CONCURRENCY, async (i) => {
    const r = await http("POST", `/api/public/sessions/${code}/join`, {
      fullName: `Participante Carga ${i}`,
      displayName: `P${i}`,
      email: `carga${i}@teste.local`,
      phone: `1198${String(1000000 + i).padStart(7, "0")}`,
      consentParticipation: true,
      consentMarketing: false,
      custom: {},
    });
    joinMs.push(r.ms);
    if (r.status !== 201) errors.push(`cadastro ${i}: ${r.status} ${JSON.stringify(r.json)}`);
    else tokens[i] = { token: r.json.token, spId: r.json.sessionParticipantId };
  });
  result.cadastro = { ...summary(joinMs), totalMs: Math.round(performance.now() - tJoin) };
  console.log("cadastro", result.cadastro);

  // 2. conexões
  const sockets: Socket[] = [];
  const connectMs: number[] = [];
  await pool([...Array(N).keys()], CONCURRENCY, async (i) => {
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const s = ioClient(base, { path: "/socket.io", transports: ["websocket"], auth: { role: "participant", code, token: tokens[i]?.token }, reconnection: false, forceNew: true });
      s.once("ready", () => {
        connectMs.push(performance.now() - t0);
        sockets[i] = s;
        resolve();
      });
      s.once("connect_error", (e) => {
        errors.push(`socket ${i}: ${e.message}`);
        resolve();
      });
    });
  });
  await new Promise((r) => setTimeout(r, 1200));
  const ctrl0 = (await A("GET", `/sessions/${session.id}/control`)).json;
  result.conexoes = { ...summary(connectMs), conectadosNoServidor: ctrl0.counts.connected };
  console.log("conexões", result.conexoes);

  const scored = ctrl0.questions.filter((q: { scored: boolean }) => q.scored).slice(0, Q);
  const perQuestion: unknown[] = [];
  const allAnswerMs: number[] = [];
  const allDeliveryMs: number[] = [];

  for (const q of scored) {
    // liberação → entrega a todos
    const received: number[] = [];
    const delivered = Promise.all(
      sockets.map(
        (s) =>
          new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 10_000);
            s.once(RT.questionOpened, (env: { at: string }) => {
              received.push(Date.now() - new Date(env.at).getTime());
              clearTimeout(t);
              resolve();
            });
          }),
      ),
    );
    const tOpen = performance.now();
    const open = await A("POST", `/sessions/${session.id}/questions/${q.sessionQuestionId}/open`);
    const openMs = performance.now() - tOpen;
    await delivered;
    allDeliveryMs.push(...received);

    // rajada de respostas (todos ao mesmo tempo) + reenvios duplicados de 10%
    const answerMs: number[] = [];
    const correct = q.correctOptionIdsAdmin[0];
    const wrong = q.options.find((o: { id: string }) => o.id !== correct).id;
    const statuses: Record<string, number> = {};
    await Promise.all(
      tokens.map(async (t, i) => {
        if (!t) return;
        const key = crypto.randomUUID();
        // respeita o mínimo de seleções (múltiplas corretas exige 2+)
        const allCorrect: string[] = q.correctOptionIdsAdmin;
        const pick = q.minSelections > 1 ? (i % 3 === 0 ? [wrong, ...allCorrect].slice(0, q.minSelections) : allCorrect) : [i % 3 === 0 ? wrong : correct];
        const body = { sessionQuestionId: q.sessionQuestionId, optionIds: pick, idempotencyKey: key };
        if (SPREAD > 0) await new Promise((r) => setTimeout(r, Math.random() * SPREAD));
        const r = await http("POST", `/api/p/${code}/answers`, body, { authorization: `Bearer ${t.token}` });
        answerMs.push(r.ms);
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
        if (i % 10 === 0) {
          const d = await http("POST", `/api/p/${code}/answers`, body, { authorization: `Bearer ${t.token}` });
          statuses[`dup-${d.status}`] = (statuses[`dup-${d.status}`] ?? 0) + 1;
        }
      }),
    );
    allAnswerMs.push(...answerMs);
    // resultado agregado no painel
    await new Promise((r) => setTimeout(r, 600));
    const res = (await A("GET", `/sessions/${session.id}/results/${q.sessionQuestionId}`)).json;
    // encerrar e revelar → publicação de pontos para todos
    const scoreReceived: number[] = [];
    const scorePromise = Promise.all(
      sockets.map(
        (s) =>
          new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 10_000);
            s.once(RT.scoreUpdated, (env: { at: string }) => {
              scoreReceived.push(Date.now() - new Date(env.at).getTime());
              clearTimeout(t);
              resolve();
            });
          }),
      ),
    );
    const tClose = performance.now();
    await A("POST", `/sessions/${session.id}/questions/${q.sessionQuestionId}/close`);
    const closeMs = performance.now() - tClose;
    const tReveal = performance.now();
    await A("POST", `/sessions/${session.id}/questions/${q.sessionQuestionId}/reveal`);
    const revealMs = performance.now() - tReveal;
    await scorePromise;
    const entry = {
      pergunta: q.title,
      liberarMs: Math.round(openMs),
      entregaPerguntaMs: summary(received),
      recebidaPor: received.length,
      respostaHttpMs: summary(answerMs),
      statusRespostas: statuses,
      respondentesNoServidor: res.totals.respondents,
      encerrarMs: Math.round(closeMs),
      revelarEPublicarMs: Math.round(revealMs),
      pontosRecebidosPor: scoreReceived.length,
      entregaPontosMs: summary(scoreReceived),
    };
    if (open.status !== 200) errors.push(`abrir: ${open.status}`);
    if (res.totals.respondents !== tokens.filter(Boolean).length) errors.push(`respondentes ${res.totals.respondents} != ${N}`);
    perQuestion.push(entry);
    console.log("pergunta", entry);
  }
  result.perguntas_ = perQuestion;
  result.respostaHttpMsGeral = summary(allAnswerMs);
  result.entregaPerguntaMsGeral = summary(allDeliveryMs);

  // satisfação: voto + troca
  const satMs: number[] = [];
  await Promise.all(
    tokens.map(async (t, i) => {
      if (!t) return;
      const r = await http("POST", `/api/p/${code}/satisfaction`, { value: i % 4 === 0 ? "NEGATIVO" : "POSITIVO" }, { authorization: `Bearer ${t.token}` });
      satMs.push(r.ms);
    }),
  );
  await Promise.all(
    tokens.map(async (t, i) => {
      if (!t || i % 4 !== 0) return;
      const r = await http("POST", `/api/p/${code}/satisfaction`, { value: "POSITIVO" }, { authorization: `Bearer ${t.token}` });
      satMs.push(r.ms);
    }),
  );
  const ctrl = (await A("GET", `/sessions/${session.id}/control`)).json;
  result.satisfacao = { httpMs: summary(satMs), resumo: ctrl.satisfaction.summary };
  if (ctrl.satisfaction.summary.total !== N || ctrl.satisfaction.summary.positive !== N) errors.push(`satisfação inconsistente: ${JSON.stringify(ctrl.satisfaction.summary)}`);

  // integridade
  const mism = await ledgerMismatches(rt.ctx.db, session.id);
  const dupRows = { rows: rowsOf(await rt.ctx.db.execute(sql`select session_question_id, session_participant_id, count(*) from participant_answers where session_id = ${session.id} and status = 'ACCEPTED' group by 1,2 having count(*) > 1`)) };
  result.retentativasDeRede = retries;
  result.integridade = { divergenciasLivroRazao: mism.length, respostasDuplicadas: dupRows.rows?.length ?? 0, emitidos: rt.ctx.rt.stats.emitted, falhasFlush: rt.ctx.rt.stats.flushErrors };
  if (mism.length) errors.push("livro-razão divergente");
  if (dupRows.rows?.length) errors.push("respostas duplicadas");
  const mem = process.memoryUsage();
  result.memoriaMB = { rss: Math.round(mem.rss / 1e6), heap: Math.round(mem.heapUsed / 1e6) };
  result.erros = errors.slice(0, 50);
  result.aprovado = errors.length === 0;
  result.fim = new Date().toISOString();

  console.log("\nsatisfação", result.satisfacao);
  console.log("integridade", result.integridade);
  console.log(result.aprovado ? "\n✅ APROVADO" : `\n❌ FALHAS (${errors.length}): ${errors.slice(0, 5).join(" | ")}`);
  const file = `tests/load/results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`\nresultado salvo em ${file}`);

  sockets.forEach((s) => s?.disconnect());
  await srv.stop();
  await rt.close();
  process.exit(result.aprovado ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
