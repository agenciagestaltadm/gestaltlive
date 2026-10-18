/**
 * Publicador de eventos em tempo real.
 *
 * - Apenas o servidor publica eventos oficiais (clientes não emitem nada além de heartbeat).
 * - Canais isolados por sessão e por público: participantes, telão, controle e sala pessoal.
 * - Atualizações frequentes (resultados, ranking, satisfação, presença) são marcadas como "sujas"
 *   e agregadas em janelas curtas, evitando uma transmissão por resposta.
 * - Presença conta PESSOAS distintas (várias abas do mesmo participante contam uma vez).
 *
 * Dois transportes:
 *  - "socket": Socket.IO no servidor próprio (local, Docker). Agregação por temporizador em memória.
 *  - "supabase": Supabase Realtime (Vercel/serverless). Mensagens vão para uma fila publicada ao fim de
 *    cada requisição (`drain`); as atualizações frequentes (resultados, ranking, satisfação, presença)
 *    são calculadas pelo "tick" da sessão (ver ./tick.ts), chamado pelo telão e pelo painel.
 *    Os canais são privados e têm nomes derivados do APP_SECRET (só quem recebe o "ticket" os conhece).
 */
import crypto from "node:crypto";
import type { Server } from "socket.io";
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import { eventSessions, sessionParticipants, sessionQuestions } from "../db/schema";
import { broadcastMessages, TOPIC_PREFIX, type BroadcastMessage, type SupabaseConfig } from "../lib/supabase";
import { RT, type RealtimeEnvelope, type ResultsDTO } from "@shared/types";
import { eventSettingsSchema } from "@shared/schemas";
import { log } from "../lib/logger";
import { computeResults, resultsPublic } from "../domains/results";
import { controlLeaderboard, podium, publicLeaderboard, rowsForStanding, standingFrom } from "../domains/leaderboard";
import { satisfactionData } from "../domains/satisfaction";
import { presentationDTO, presentationOf, registeredCount } from "../domains/views";

export type Audience = "participants" | "screen" | "control";
export const ALL: Audience[] = ["participants", "screen", "control"];
export const room = (sessionId: string, a: Audience) => `s:${sessionId}:${a}`;
export const personalRoom = (spId: string) => `sp:${spId}`;

const INTERVALS = {
  resultsControl: 300,
  resultsPublic: 700,
  leaderboard: 1000,
  satisfaction: 500,
  presence: 1000,
  control: 250,
  joined: 1000,
};

export type RealtimeMode = "socket" | "supabase";

/** Identidade autorizada a receber eventos (ver ./auth.ts). */
export interface RealtimeIdentity {
  role: "participant" | "screen" | "control";
  sessionId: string;
  spId?: string;
  screenNonce?: string;
}

interface Queued {
  sessionId: string;
  audience?: Audience;
  topic?: string;
  event: string;
  payload: unknown;
}

/** Participante é considerado conectado se deu sinal de vida nos últimos 75 s (modo supabase). */
const PRESENCE_WINDOW_SEC = 75;

export class Realtime {
  io: Server | null = null;
  readonly mode: RealtimeMode;
  readonly supabase: SupabaseConfig | null;
  private send: (messages: BroadcastMessage[]) => Promise<void>;
  private queue: Queued[] = [];
  private ctx!: AppContext;
  private versions = new Map<string, number>();
  private presence = new Map<string, Map<string, Set<string>>>();
  private lastSeen = new Map<string, number>();
  private dirtyResults = new Map<string, Set<string>>();
  private dirtyLeaderboard = new Map<string, boolean>();
  private dirtySatisfaction = new Set<string>();
  private dirtyPresence = new Set<string>();
  private dirtyControl = new Set<string>();
  private joined = new Map<string, { id: string; displayName: string }[]>();
  private last = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private seenTimer: NodeJS.Timeout | null = null;
  private flushing = false;
  /** Métricas simples para os testes de carga. */
  stats = { emitted: 0, flushes: 0, flushErrors: 0 };

  constructor(opts: { mode?: RealtimeMode; supabase?: SupabaseConfig | null; send?: (messages: BroadcastMessage[]) => Promise<void> } = {}) {
    this.mode = opts.mode ?? "socket";
    this.supabase = opts.supabase ?? null;
    if (this.mode === "supabase" && !this.supabase && !opts.send) {
      throw new Error("Tempo real via Supabase exige SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.");
    }
    this.send = opts.send ?? ((m) => broadcastMessages(this.supabase!, m));
  }

  bind(ctx: AppContext) {
    this.ctx = ctx;
  }

  start() {
    if (this.mode === "supabase") {
      // servidor residente no modo supabase: publica a fila periodicamente (efeitos do agendador)
      this.timer = setInterval(() => void this.drain(), 100);
      this.timer.unref();
      return;
    }
    this.timer = setInterval(() => void this.flush(), 100);
    this.seenTimer = setInterval(() => void this.persistLastSeen(), 30_000);
    this.timer.unref();
    this.seenTimer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.seenTimer) clearInterval(this.seenTimer);
  }

  /** Versão monotônica do estado da sessão (sobrevive a reinícios por usar o relógio como piso). */
  version(sessionId: string): number {
    return this.versions.get(sessionId) ?? 0;
  }
  private bump(sessionId: string) {
    const v = Math.max((this.versions.get(sessionId) ?? 0) + 1, Date.now());
    this.versions.set(sessionId, v);
    return v;
  }

  private envelope<T>(sessionId: string, data: T): RealtimeEnvelope<T> {
    return { sessionId, v: this.bump(sessionId), at: new Date().toISOString(), data };
  }

  broadcast(sessionId: string, event: string, data: unknown, audiences: Audience[] = ALL) {
    if (this.mode === "supabase") {
      const payload = this.envelope(sessionId, data);
      for (const audience of audiences) this.queue.push({ sessionId, audience, event, payload });
      this.stats.emitted++;
      return;
    }
    if (!this.io) return;
    const env = this.envelope(sessionId, data);
    let target = this.io.to(room(sessionId, audiences[0]));
    for (const a of audiences.slice(1)) target = target.to(room(sessionId, a));
    target.emit(event, env);
    this.stats.emitted++;
  }

  toParticipant(sessionId: string, spId: string, event: string, data: unknown) {
    if (this.mode === "supabase") {
      this.queue.push({ sessionId, topic: this.personalTopic(spId), event, payload: this.envelope(sessionId, data) });
      this.stats.emitted++;
      return;
    }
    if (!this.io) return;
    this.io.to(personalRoom(spId)).emit(event, this.envelope(sessionId, data));
    this.stats.emitted++;
  }

  /* ---------------------------------------------------------------- marcações */
  resultsDirty(sessionId: string, sqId: string) {
    if (this.mode === "supabase") return; // calculado pelo tick
    const set = this.dirtyResults.get(sessionId) ?? new Set();
    set.add(sqId);
    this.dirtyResults.set(sessionId, set);
  }
  leaderboardDirty(sessionId: string, personal = false) {
    // supabase: o ranking geral sai pelo tick; a publicação de pontos (pessoal) sai ao fim da requisição
    if (this.mode === "supabase" && !personal) return;
    this.dirtyLeaderboard.set(sessionId, (this.dirtyLeaderboard.get(sessionId) ?? false) || personal);
  }
  satisfactionDirty(sessionId: string) {
    if (this.mode === "supabase") return;
    this.dirtySatisfaction.add(sessionId);
  }
  presenceDirty(sessionId: string) {
    if (this.mode === "supabase") return;
    this.dirtyPresence.add(sessionId);
  }
  controlResync(sessionId: string) {
    this.dirtyControl.add(sessionId);
  }
  participantJoined(sessionId: string, sp: { id: string; displayName: string }) {
    if (this.mode === "supabase") return; // o tick anuncia as novas inscrições
    const list = this.joined.get(sessionId) ?? [];
    list.push(sp);
    this.joined.set(sessionId, list);
    this.presenceDirty(sessionId);
    this.leaderboardDirty(sessionId);
  }

  async presentationChanged(sessionId: string) {
    const pres = await presentationOf(this.ctx.db, sessionId);
    this.broadcast(sessionId, RT.presentationChanged, presentationDTO(pres));
    this.leaderboardDirty(sessionId, true);
    this.satisfactionDirty(sessionId);
  }

  async prizesRevealed(sessionId: string) {
    const [s] = await this.ctx.db.select().from(eventSessions).where(eq(eventSessions.id, sessionId));
    if (!s) return;
    this.broadcast(sessionId, RT.prizesRevealed, { podium: await podium(this.ctx.db, s) });
  }

  /** Revoga telões abertos (troca do token). No modo supabase o canal do telão muda junto com o token. */
  disconnectScreens(sessionId: string, previousNonce?: string) {
    if (this.mode === "supabase") {
      if (previousNonce) this.queue.push({ sessionId, topic: this.topic(sessionId, "screen", previousNonce), event: RT_REVOKED, payload: {} });
      return;
    }
    this.io?.in(room(sessionId, "screen")).disconnectSockets(true);
  }
  disconnectParticipant(spId: string) {
    if (this.mode === "supabase") {
      this.queue.push({ sessionId: "", topic: this.personalTopic(spId), event: RT_REVOKED, payload: {} });
      return;
    }
    this.io?.in(personalRoom(spId)).disconnectSockets(true);
  }

  /* ---------------------------------------------------------------- canais (modo supabase) */
  private hmac(s: string) {
    return crypto.createHmac("sha256", this.ctx.config.appSecret).update(`rt:${s}`).digest("hex").slice(0, 40);
  }
  topic(sessionId: string, a: Audience, screenNonce?: string) {
    return TOPIC_PREFIX + this.hmac(a === "screen" ? `${sessionId}:screen:${screenNonce ?? ""}` : `${sessionId}:${a}`);
  }
  personalTopic(spId: string) {
    return TOPIC_PREFIX + this.hmac(`sp:${spId}`);
  }
  topicsFor(id: RealtimeIdentity): string[] {
    if (id.role === "participant") return [this.topic(id.sessionId, "participants"), this.personalTopic(id.spId!)];
    if (id.role === "screen") return [this.topic(id.sessionId, "screen", id.screenNonce)];
    return [this.topic(id.sessionId, "control")];
  }

  /**
   * Publica a fila (modo supabase). Chamado ao fim de cada requisição da API e pelo agendador residente.
   * Antes, resolve as pendências imediatas: ranking pessoal após publicação de pontos e ressincronização do painel.
   */
  async drain() {
    if (this.mode !== "supabase") return;
    try {
      for (const [sessionId, personal] of [...this.dirtyLeaderboard]) {
        this.dirtyLeaderboard.delete(sessionId);
        if (personal) await this.flushLeaderboard(sessionId, true);
      }
      for (const sessionId of [...this.dirtyControl]) {
        this.dirtyControl.delete(sessionId);
        this.broadcast(sessionId, RT.resync, { reason: "control" }, ["control", "screen"]);
      }
    } catch (err) {
      log.error("falha ao preparar atualizações em tempo real", { err });
    }
    if (this.queue.length === 0) return;
    const items = this.queue.splice(0);
    try {
      const screenSessions = [...new Set(items.filter((i) => i.audience === "screen").map((i) => i.sessionId))];
      const nonces = new Map<string, string>();
      if (screenSessions.length) {
        const rows = await this.ctx.db
          .select({ id: eventSessions.id, nonce: eventSessions.screenTokenNonce })
          .from(eventSessions)
          .where(inArray(eventSessions.id, screenSessions));
        for (const r of rows) nonces.set(r.id, r.nonce);
      }
      const messages: BroadcastMessage[] = items.map((i) => ({
        topic: i.topic ?? this.topic(i.sessionId, i.audience!, nonces.get(i.sessionId)),
        event: i.event,
        payload: i.payload,
      }));
      this.stats.flushes++;
      await this.send(messages);
    } catch (err) {
      this.stats.flushErrors++;
      log.error("falha ao publicar no Supabase Realtime", { err });
    }
  }

  /* ---------------------------------------------------------------- presença */
  addPresence(sessionId: string, spId: string, socketId: string) {
    const bySp = this.presence.get(sessionId) ?? new Map<string, Set<string>>();
    const sockets = bySp.get(spId) ?? new Set<string>();
    const wasOnline = sockets.size > 0;
    sockets.add(socketId);
    bySp.set(spId, sockets);
    this.presence.set(sessionId, bySp);
    this.lastSeen.set(spId, Date.now());
    if (!wasOnline) this.presenceDirty(sessionId);
  }
  removePresence(sessionId: string, spId: string, socketId: string) {
    const bySp = this.presence.get(sessionId);
    const sockets = bySp?.get(spId);
    if (!bySp || !sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) {
      bySp.delete(spId);
      this.presenceDirty(sessionId);
    }
  }
  heartbeat(spId: string) {
    this.lastSeen.set(spId, Date.now());
  }
  /** Sinal de vida pelo HTTP (modo supabase): grava no máximo a cada 15 s por participante. */
  async touch(spId: string) {
    const limit = new Date(Date.now() - 15_000);
    await this.ctx.db
      .update(sessionParticipants)
      .set({ lastSeenAt: new Date() })
      .where(and(eq(sessionParticipants.id, spId), or(isNull(sessionParticipants.lastSeenAt), lt(sessionParticipants.lastSeenAt, limit))));
  }
  async connectedCount(sessionId: string): Promise<number> {
    if (this.mode === "supabase") {
      const [r] = await this.ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(sessionParticipants)
        .where(and(eq(sessionParticipants.sessionId, sessionId), gt(sessionParticipants.lastSeenAt, this.presenceSince())));
      return Number(r?.n ?? 0);
    }
    return this.presence.get(sessionId)?.size ?? 0;
  }
  async connectedIds(sessionId: string): Promise<string[]> {
    if (this.mode === "supabase") {
      const rows = await this.ctx.db
        .select({ id: sessionParticipants.id })
        .from(sessionParticipants)
        .where(and(eq(sessionParticipants.sessionId, sessionId), gt(sessionParticipants.lastSeenAt, this.presenceSince())));
      return rows.map((r) => r.id);
    }
    return [...(this.presence.get(sessionId)?.keys() ?? [])];
  }
  private presenceSince() {
    return new Date(Date.now() - PRESENCE_WINDOW_SEC * 1000);
  }

  private async persistLastSeen() {
    if (this.lastSeen.size === 0) return;
    const entries = [...this.lastSeen.entries()];
    this.lastSeen.clear();
    const ids = entries.map(([id]) => id);
    try {
      for (let i = 0; i < ids.length; i += 500) {
        await this.ctx.db.update(sessionParticipants).set({ lastSeenAt: new Date() }).where(inArray(sessionParticipants.id, ids.slice(i, i + 500)));
      }
    } catch (err) {
      log.warn("falha ao registrar presença", { err });
    }
  }

  /* ---------------------------------------------------------------- agregação e envio */
  private due(key: string, interval: number) {
    const now = Date.now();
    const last = this.last.get(key) ?? 0;
    if (now - last < interval) return false;
    this.last.set(key, now);
    return true;
  }

  async flush() {
    if (this.flushing || !this.io) return;
    this.flushing = true;
    this.stats.flushes++;
    try {
      for (const [sessionId, sqIds] of [...this.dirtyResults]) {
        if (!this.due(`r:${sessionId}`, INTERVALS.resultsControl)) continue;
        this.dirtyResults.delete(sessionId);
        for (const sqId of sqIds) await this.flushResults(sessionId, sqId);
      }
      for (const [sessionId, personal] of [...this.dirtyLeaderboard]) {
        if (!this.due(`l:${sessionId}`, INTERVALS.leaderboard)) continue;
        this.dirtyLeaderboard.delete(sessionId);
        await this.flushLeaderboard(sessionId, personal);
      }
      for (const sessionId of [...this.dirtySatisfaction]) {
        if (!this.due(`s:${sessionId}`, INTERVALS.satisfaction)) continue;
        this.dirtySatisfaction.delete(sessionId);
        await this.flushSatisfaction(sessionId);
      }
      for (const sessionId of [...this.dirtyPresence]) {
        if (!this.due(`p:${sessionId}`, INTERVALS.presence)) continue;
        this.dirtyPresence.delete(sessionId);
        const registered = await registeredCount(this.ctx.db, sessionId);
        this.broadcast(sessionId, RT.presenceChanged, { registered, connected: await this.connectedCount(sessionId) }, ["control", "screen"]);
      }
      for (const [sessionId, list] of [...this.joined]) {
        if (!this.due(`j:${sessionId}`, INTERVALS.joined)) continue;
        this.joined.delete(sessionId);
        this.broadcast(sessionId, RT.participantJoined, { participants: list.slice(-50), count: list.length }, ["control"]);
        this.broadcast(sessionId, RT.participantJoined, { count: list.length }, ["screen"]);
      }
      for (const sessionId of [...this.dirtyControl]) {
        if (!this.due(`c:${sessionId}`, INTERVALS.control)) continue;
        this.dirtyControl.delete(sessionId);
        this.broadcast(sessionId, RT.resync, { reason: "control" }, ["control", "screen"]);
      }
    } catch (err) {
      this.stats.flushErrors++;
      log.error("falha ao publicar atualizações em tempo real", { err });
    } finally {
      this.flushing = false;
    }
  }

  private async flushResults(sessionId: string, sqId: string) {
    const db = this.ctx.db;
    const [sq] = await db.select().from(sessionQuestions).where(eq(sessionQuestions.id, sqId));
    if (!sq) return;
    const control = await computeResults(db, sq, { includeCorrect: true });
    this.broadcast(sessionId, RT.resultsUpdated, control, ["control"]);
    const counts = { sessionQuestionId: sq.id, answered: control.totals.respondents, registered: control.totals.participants };
    this.broadcast(sessionId, RT.answersCount, counts, ["participants", "screen", "control"]);
    if (resultsPublic(sq) && this.due(`rp:${sqId}`, INTERVALS.resultsPublic)) {
      this.broadcast(sessionId, RT.resultsUpdated, stripForPublic(control), ["participants", "screen"]);
    } else if (resultsPublic(sq)) {
      // fora da janela pública: reagenda
      this.resultsDirty(sessionId, sqId);
    }
  }

  private async flushLeaderboard(sessionId: string, personal: boolean) {
    const db = this.ctx.db;
    const [session] = await db.select().from(eventSessions).where(eq(eventSessions.id, sessionId));
    if (!session) return;
    const pres = await presentationOf(db, sessionId);
    this.broadcast(sessionId, RT.leaderboardUpdated, await controlLeaderboard(db, sessionId, 10), ["control"]);
    const pub = await publicLeaderboard(db, session, pres);
    const settings = eventSettingsSchema.parse(session.settings);
    this.broadcast(sessionId, RT.leaderboardUpdated, pub, settings.showLeaderboardToParticipants ? ["participants", "screen"] : ["screen"]);
    if (!personal) return;
    const connected = await this.connectedIds(sessionId);
    if (connected.length === 0) return;
    const rows = await rowsForStanding(db, session, pres);
    const sps = await db
      .select({
        id: sessionParticipants.id,
        displayName: sessionParticipants.displayName,
        score: sessionParticipants.score,
        correctCount: sessionParticipants.correctCount,
        answeredCount: sessionParticipants.answeredCount,
        disqualifiedAt: sessionParticipants.disqualifiedAt,
      })
      .from(sessionParticipants)
      .where(and(eq(sessionParticipants.sessionId, sessionId), inArray(sessionParticipants.id, connected.slice(0, 5000))));
    for (const sp of sps) {
      this.toParticipant(sessionId, sp.id, RT.scoreUpdated, standingFrom(rows, sp, { hidden: pres.leaderboardHidden }));
    }
  }

  private async flushSatisfaction(sessionId: string) {
    const db = this.ctx.db;
    const data = await satisfactionData(db, sessionId);
    const pres = await presentationOf(db, sessionId);
    const aud: Audience[] = pres.screen === "SATISFACAO" || pres.showSatisfactionToScreen ? ["control", "screen"] : ["control"];
    this.broadcast(sessionId, RT.satisfactionUpdated, data, aud);
  }
}

/* ------------------------------------------------------------------ agregação do tick (modo supabase) */
/** Intervalo mínimo entre envios ao canal dos participantes (centenas de assinantes por mensagem). */
const PUBLIC_MS = 3000;
/** Campos que mudam a cada cálculo sem mudar o conteúdo — ignorados na comparação. */
const VOLATILE = new Set(["generatedAt", "updatedAt", "serverNow"]);
const sig = (v: unknown) =>
  crypto
    .createHash("sha1")
    .update(JSON.stringify(v, (k, val) => (VOLATILE.has(k) ? undefined : val)))
    .digest("base64")
    .slice(0, 16);

/**
 * Calcula resultados, contagens, ranking, satisfação, presença e novas inscrições da sessão e publica
 * apenas o que mudou desde o último tick (`prev` → `next` guardam as assinaturas dos envios).
 */
export async function aggregateSession(rt: Realtime, ctx: AppContext, sessionId: string, prev: Record<string, string | number>, next: Record<string, string | number>) {
  const db = ctx.db;
  const nowMs = Date.now();
  const changed = (key: string, data: unknown) => {
    const s = sig(data);
    if (prev[key] === s) return false;
    next[key] = s;
    return true;
  };
  /** Mudou e já passou o intervalo mínimo desde o último envio desta chave. */
  const changedThrottled = (key: string, data: unknown, ms: number) => {
    const s = sig(data);
    if (prev[key] === s) return false;
    if (nowMs - Number(prev[`${key}@`] ?? 0) < ms) return false;
    next[key] = s;
    next[`${key}@`] = nowMs;
    return true;
  };

  const [session] = await db.select().from(eventSessions).where(eq(eventSessions.id, sessionId));
  if (!session) return;
  const pres = await presentationOf(db, sessionId);
  const settings = eventSettingsSchema.parse(session.settings);

  const sqs = await db
    .select()
    .from(sessionQuestions)
    .where(
      and(
        eq(sessionQuestions.sessionId, sessionId),
        or(eq(sessionQuestions.state, "ABERTA"), pres.sessionQuestionId ? eq(sessionQuestions.id, pres.sessionQuestionId) : sql`false`),
      ),
    );
  for (const sq of sqs) {
    const control = await computeResults(db, sq, { includeCorrect: true });
    if (changed(`rc:${sq.id}`, control)) rt.broadcast(sessionId, RT.resultsUpdated, control, ["control"]);
    const counts = { sessionQuestionId: sq.id, answered: control.totals.respondents, registered: control.totals.participants };
    if (changed(`ac:${sq.id}`, counts)) rt.broadcast(sessionId, RT.answersCount, counts, ["screen", "control"]);
    const pub = resultsPublic(sq) ? stripForPublic(control) : null;
    if (pub && changed(`rs:${sq.id}`, pub)) rt.broadcast(sessionId, RT.resultsUpdated, pub, ["screen"]);
    if (changedThrottled(`rp:${sq.id}`, { counts, pub }, PUBLIC_MS)) {
      rt.broadcast(sessionId, RT.answersCount, counts, ["participants"]);
      if (pub) rt.broadcast(sessionId, RT.resultsUpdated, pub, ["participants"]);
    }
  }

  const lbc = await controlLeaderboard(db, sessionId, 10);
  if (changed("lbc", lbc)) rt.broadcast(sessionId, RT.leaderboardUpdated, lbc, ["control"]);
  const lbp = await publicLeaderboard(db, session, pres);
  if (changed("lbs", lbp)) rt.broadcast(sessionId, RT.leaderboardUpdated, lbp, ["screen"]);
  if (settings.showLeaderboardToParticipants && changedThrottled("lbp", lbp, PUBLIC_MS)) rt.broadcast(sessionId, RT.leaderboardUpdated, lbp, ["participants"]);

  const sat = await satisfactionData(db, sessionId);
  const satAud: Audience[] = pres.screen === "SATISFACAO" || pres.showSatisfactionToScreen ? ["control", "screen"] : ["control"];
  if (changed(`sat:${satAud.join(",")}`, sat)) rt.broadcast(sessionId, RT.satisfactionUpdated, sat, satAud);

  const presence = { registered: await registeredCount(db, sessionId), connected: await rt.connectedCount(sessionId) };
  if (changed("pres", presence)) rt.broadcast(sessionId, RT.presenceChanged, presence, ["control", "screen"]);

  // novas inscrições desde o último tick (o primeiro tick só marca o ponto de partida)
  const since = prev.jt ? new Date(Number(prev.jt)) : null;
  if (!since) next.jt = nowMs;
  else {
    const fresh = await db
      .select({ id: sessionParticipants.id, displayName: sessionParticipants.displayName, joinedAt: sessionParticipants.joinedAt })
      .from(sessionParticipants)
      .where(and(eq(sessionParticipants.sessionId, sessionId), gt(sessionParticipants.joinedAt, since)))
      .orderBy(desc(sessionParticipants.joinedAt))
      .limit(500);
    if (fresh.length) {
      next.jt = fresh[0].joinedAt.getTime();
      const list = fresh.slice(0, 50).reverse().map((p) => ({ id: p.id, displayName: p.displayName }));
      rt.broadcast(sessionId, RT.participantJoined, { participants: list, count: fresh.length }, ["control"]);
      rt.broadcast(sessionId, RT.participantJoined, { count: fresh.length }, ["screen"]);
    }
  }
}

/** Evento enviado ao canal antigo quando o acesso é revogado (troca do token do telão, remoção do participante). */
export const RT_REVOKED = "rt:revoked";

/** Remove marcações de gabarito ainda não reveladas antes de enviar ao público. */
export function stripForPublic(r: ResultsDTO): ResultsDTO {
  if (r.correctRevealed) return r;
  return { ...r, accuracyPct: null, categories: r.categories.map((c) => ({ ...c, isCorrect: null })) };
}


