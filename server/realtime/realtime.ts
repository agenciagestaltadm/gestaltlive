/**
 * Publicador de eventos em tempo real.
 *
 * - Apenas o servidor publica eventos oficiais (clientes não emitem nada além de heartbeat).
 * - Canais isolados por sessão e por público: participantes, telão, controle e sala pessoal.
 * - Atualizações frequentes (resultados, ranking, satisfação, presença) são marcadas como "sujas"
 *   e agregadas em janelas curtas, evitando uma transmissão por resposta.
 * - Presença conta PESSOAS distintas (várias abas do mesmo participante contam uma vez).
 */
import type { Server } from "socket.io";
import { and, eq, inArray } from "drizzle-orm";
import type { AppContext } from "../context";
import { eventSessions, sessionParticipants, sessionQuestions } from "../db/schema";
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

export class Realtime {
  io: Server | null = null;
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

  bind(ctx: AppContext) {
    this.ctx = ctx;
  }

  start() {
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
    if (!this.io) return;
    const env = this.envelope(sessionId, data);
    let target = this.io.to(room(sessionId, audiences[0]));
    for (const a of audiences.slice(1)) target = target.to(room(sessionId, a));
    target.emit(event, env);
    this.stats.emitted++;
  }

  toParticipant(sessionId: string, spId: string, event: string, data: unknown) {
    if (!this.io) return;
    this.io.to(personalRoom(spId)).emit(event, this.envelope(sessionId, data));
    this.stats.emitted++;
  }

  /* ---------------------------------------------------------------- marcações */
  resultsDirty(sessionId: string, sqId: string) {
    const set = this.dirtyResults.get(sessionId) ?? new Set();
    set.add(sqId);
    this.dirtyResults.set(sessionId, set);
  }
  leaderboardDirty(sessionId: string, personal = false) {
    this.dirtyLeaderboard.set(sessionId, (this.dirtyLeaderboard.get(sessionId) ?? false) || personal);
  }
  satisfactionDirty(sessionId: string) {
    this.dirtySatisfaction.add(sessionId);
  }
  presenceDirty(sessionId: string) {
    this.dirtyPresence.add(sessionId);
  }
  controlResync(sessionId: string) {
    this.dirtyControl.add(sessionId);
  }
  participantJoined(sessionId: string, sp: { id: string; displayName: string }) {
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

  disconnectScreens(sessionId: string) {
    this.io?.in(room(sessionId, "screen")).disconnectSockets(true);
  }
  disconnectParticipant(spId: string) {
    this.io?.in(personalRoom(spId)).disconnectSockets(true);
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
  connectedCount(sessionId: string): number {
    return this.presence.get(sessionId)?.size ?? 0;
  }
  connectedIds(sessionId: string): string[] {
    return [...(this.presence.get(sessionId)?.keys() ?? [])];
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
        this.broadcast(sessionId, RT.presenceChanged, { registered, connected: this.connectedCount(sessionId) }, ["control", "screen"]);
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
    this.broadcast(sessionId, RT.answersCount, counts, ["participants", "screen"]);
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
    const connected = this.connectedIds(sessionId);
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

/** Remove marcações de gabarito ainda não reveladas antes de enviar ao público. */
export function stripForPublic(r: ResultsDTO): ResultsDTO {
  if (r.correctRevealed) return r;
  return { ...r, accuracyPct: null, categories: r.categories.map((c) => ({ ...c, isCorrect: null })) };
}


