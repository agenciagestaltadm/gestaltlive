/**
 * Regras puras de pontuação, cronômetro, ranking e indicadores.
 * Executadas EXCLUSIVAMENTE no servidor para fins oficiais; a interface usa apenas para exibição.
 */
import type { ScoringConfig } from "./schemas";

/* ---------------------------------------------------------------- cronômetro */
export interface TimerState {
  limitMs: number | null;
  accumulatedMs: number;
  runningSince: Date | null;
}

/** Tempo decorrido efetivo (descontando pausas) segundo o relógio do servidor. */
export function elapsedMs(t: TimerState, now: Date): number {
  const running = t.runningSince ? Math.max(0, now.getTime() - t.runningSince.getTime()) : 0;
  return t.accumulatedMs + running;
}

export function remainingMs(t: TimerState, now: Date): number | null {
  if (t.limitMs === null) return null;
  return Math.max(0, t.limitMs - elapsedMs(t, now));
}

export function isTimerExpired(t: TimerState, now: Date): boolean {
  return t.limitMs !== null && elapsedMs(t, now) >= t.limitMs;
}

/* ---------------------------------------------------------------- pontuação */
/**
 * bonus = floor(bonusMaximo * max(0, 1 - tempoResposta / tempoLimite))
 * Sem tempo limite não há bônus (a fórmula exige um limite).
 */
export function speedBonus(maxBonus: number, responseTimeMs: number, limitMs: number | null): number {
  if (!limitMs || limitMs <= 0 || maxBonus <= 0) return 0;
  const ratio = Math.max(0, 1 - Math.max(0, responseTimeMs) / limitMs);
  return Math.floor(maxBonus * ratio);
}

export interface ScoreResult {
  points: number;
  bonus: number;
}

/**
 * Pontuação de uma resposta aceita dentro do prazo.
 * - Acerto: floor((pontosBase + bônus) × peso). Bônus só se habilitado.
 * - Erro: −penalidade (0 por padrão).
 */
export function scoreAnswer(cfg: ScoringConfig, isCorrect: boolean, responseTimeMs: number, limitMs: number | null): ScoreResult {
  if (isCorrect) {
    const bonus = cfg.speedBonusEnabled ? speedBonus(cfg.speedBonusMax, responseTimeMs, limitMs) : 0;
    return { points: Math.floor((cfg.basePoints + bonus) * cfg.weight), bonus };
  }
  return { points: cfg.wrongPenalty > 0 ? -Math.floor(cfg.wrongPenalty * cfg.weight) : 0, bonus: 0 };
}

/** Correção: conjunto selecionado precisa ser exatamente igual ao conjunto correto. */
export function isSelectionCorrect(selected: readonly string[], correct: readonly string[]): boolean {
  if (correct.length === 0) return false;
  const s = new Set(selected);
  if (s.size !== correct.length) return false;
  return correct.every((c) => s.has(c));
}

/* ---------------------------------------------------------------- ranking */
export interface RankingRow {
  id: string;
  score: number;
  correctCount: number;
  correctTimeMs: number;
  joinedAt: Date | string;
}

/**
 * Critérios oficiais de desempate (nunca aleatórios):
 * 1. maior pontuação; 2. mais acertos; 3. menor soma de tempos em acertos;
 * 4. inscrição mais antiga; 5. identificador (ordem lexicográfica) — garante determinismo total.
 */
export function compareRanking(a: RankingRow, b: RankingRow): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
  if (a.correctTimeMs !== b.correctTimeMs) return a.correctTimeMs - b.correctTimeMs;
  const ja = new Date(a.joinedAt).getTime();
  const jb = new Date(b.joinedAt).getTime();
  if (ja !== jb) return ja - jb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function rankRows<T extends RankingRow>(rows: T[]): (T & { position: number })[] {
  return [...rows].sort(compareRanking).map((r, i) => ({ ...r, position: i + 1 }));
}

/* ---------------------------------------------------------------- satisfação */
export interface SatisfactionSummary {
  positive: number;
  negative: number;
  total: number;
  positivePct: number | null;
  negativePct: number | null;
}

/** Percentuais calculados apenas sobre avaliações registradas (ausência de voto não conta). */
export function satisfactionSummary(positive: number, negative: number): SatisfactionSummary {
  const total = positive + negative;
  if (total === 0) return { positive, negative, total, positivePct: null, negativePct: null };
  return {
    positive,
    negative,
    total,
    positivePct: (positive / total) * 100,
    negativePct: (negative / total) * 100,
  };
}

/* ---------------------------------------------------------------- NPS */
export interface NpsSummary {
  promoters: number;
  passives: number;
  detractors: number;
  total: number;
  score: number | null;
}

/** NPS = %promotores (9–10) − %detratores (0–6). */
export function npsSummary(values: number[]): NpsSummary {
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const v of values) {
    if (v >= 9) promoters++;
    else if (v >= 7) passives++;
    else detractors++;
  }
  const total = values.length;
  return {
    promoters,
    passives,
    detractors,
    total,
    score: total === 0 ? null : Math.round(((promoters - detractors) / total) * 100),
  };
}

export function ordinal(n: number): string {
  return `${n}º`;
}
