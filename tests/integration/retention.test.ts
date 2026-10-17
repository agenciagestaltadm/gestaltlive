/** Rotina automática de retenção (LGPD) com relógio controlado. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runRetention } from "@server/domains/retention";
import { setup, liveDemoSession, ParticipantClient, type TestEnv } from "./helpers";

const DAY = 86_400_000;
let env: TestEnv;

beforeAll(async () => {
  env = await setup();
});
afterAll(async () => env.close());

async function people() {
  const r = await env.admin.get(`/api/admin/participants?orgId=${env.orgId}&pageSize=200`);
  return new Map<string, any>(r.rows.map((p: any) => [p.id, p]));
}
/** Avança o relógio e renova o login (a sessão administrativa expira em 12 h). */
async function advance(ms: number) {
  env.clock.advance(ms);
  await env.admin.login("admin@teste.local", "SenhaForte123");
}
const byEmail = async (email: string) => {
  const r = await env.admin.get(`/api/admin/participants?orgId=${env.orgId}&q=${encodeURIComponent(email)}`);
  return r.rows[0];
};

describe("retenção automática", () => {
  const ids: Record<string, string> = {};

  it("sem prazo configurado, não altera nada", async () => {
    const s = await liveDemoSession(env, "Turma antiga");
    for (const i of [1, 2, 3]) await ParticipantClient.join(env.rt, s.code, i);
    await env.admin.post(`/api/admin/sessions/${s.sessionId}/end`);
    for (const i of [1, 2, 3]) ids[`p${i}`] = (await byEmail(`p${i}@teste.local`)).id;

    await advance(400 * DAY);
    const r = await runRetention(env.rt.ctx);
    expect(r).toEqual([]);
    const all = await people();
    expect([...all.values()].every((p) => p.anonymizedAt === null)).toBe(true);
    await advance(-400 * DAY);
  });

  it("anonimiza apenas quem tem a última participação anterior ao prazo", async () => {
    await env.admin.req("PATCH", `/api/admin/orgs/${env.orgId}`, { retentionDays: 30 });
    expect((await runRetention(env.rt.ctx))[0].anonymized).toBe(0);

    // 20 dias depois: p3 volta (mesma pessoa, pelo e-mail) e p4 participa pela primeira vez
    await advance(20 * DAY);
    const s2 = await liveDemoSession(env, "Turma recente");
    await ParticipantClient.join(env.rt, s2.code, 3);
    await ParticipantClient.join(env.rt, s2.code, 4);
    await env.admin.post(`/api/admin/sessions/${s2.sessionId}/end`);
    ids.p4 = (await byEmail("p4@teste.local")).id;
    expect((await byEmail("p3@teste.local")).id).toBe(ids.p3);

    // 35 dias após a primeira turma: corte em +5 dias → p1 e p2 vencidos
    await advance(15 * DAY);
    const [r] = await runRetention(env.rt.ctx);
    expect(r.anonymized).toBe(2);

    const all = await people();
    for (const k of ["p1", "p2"]) {
      const p = all.get(ids[k]);
      expect(p.fullName).toBe("Participante anonimizado");
      expect(p.email).toBeNull();
      expect(p.phone).toBeNull();
      expect(p.anonymizedAt).not.toBeNull();
    }
    for (const k of ["p3", "p4"]) expect(all.get(ids[k]).anonymizedAt).toBeNull();

    const d = await env.admin.get(`/api/admin/participants/${ids.p1}`);
    expect(d.sessions[0].displayName).toBe("Anônimo");
    expect(d.custom).toHaveLength(0);
    expect(d.consents[0]).toMatchObject({ purpose: "MARKETING", granted: false, textVersion: "anonimizacao", source: "SISTEMA" });
    // estatísticas da sessão preservadas
    expect(d.sessions[0].sessionId).toBeTruthy();
  });

  it("registra auditoria com ator de sistema", async () => {
    const logs = await env.admin.get(`/api/admin/audit?orgId=${env.orgId}`);
    const anon = logs.filter((l: any) => l.action === "participant.anonymize");
    expect(anon).toHaveLength(2);
    expect(new Set(anon.map((l: any) => l.entityId))).toEqual(new Set([ids.p1, ids.p2]));
    for (const l of anon) {
      expect(l.actorName).toBeNull();
      expect(l.data).toMatchObject({ system: "retencao", reason: "Prazo de retenção de 30 dias" });
    }
    const run = logs.find((l: any) => l.action === "retention.run");
    expect(run.data).toMatchObject({ system: "retencao", retentionDays: 30, anonymized: 2 });
  });

  it("é idempotente", async () => {
    const before = (await env.admin.get(`/api/admin/audit?orgId=${env.orgId}`)).length;
    const [r] = await runRetention(env.rt.ctx);
    expect(r.anonymized).toBe(0);
    expect((await env.admin.get(`/api/admin/audit?orgId=${env.orgId}`)).length).toBe(before);
  });

  it("não afeta quem está em sessão em andamento", async () => {
    const s3 = await liveDemoSession(env, "Turma longa");
    await ParticipantClient.join(env.rt, s3.code, 5);
    const p5 = (await byEmail("p5@teste.local")).id;
    await advance(60 * DAY);
    const [r] = await runRetention(env.rt.ctx);
    expect(r.anonymized).toBe(2); // p3 e p4
    const all = await people();
    expect(all.get(p5).anonymizedAt).toBeNull();
    expect(all.get(ids.p3).anonymizedAt).not.toBeNull();
    expect(all.get(ids.p4).anonymizedAt).not.toBeNull();

    await env.admin.post(`/api/admin/sessions/${s3.sessionId}/end`);
    await advance(31 * DAY);
    expect((await runRetention(env.rt.ctx))[0].anonymized).toBe(1);
  });
});
