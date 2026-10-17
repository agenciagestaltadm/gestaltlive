import { describe, expect, it } from "vitest";
import {
  compareRanking,
  elapsedMs,
  isSelectionCorrect,
  isTimerExpired,
  npsSummary,
  rankRows,
  remainingMs,
  satisfactionSummary,
  scoreAnswer,
  speedBonus,
} from "@shared/scoring";
import { DEFAULT_SCORING } from "@shared/schemas";

describe("bônus de velocidade", () => {
  it("segue a fórmula floor(max * max(0, 1 - t/limite))", () => {
    expect(speedBonus(50, 0, 30_000)).toBe(50);
    expect(speedBonus(50, 15_000, 30_000)).toBe(25);
    expect(speedBonus(50, 1_000, 30_000)).toBe(48);
    expect(speedBonus(50, 29_999, 30_000)).toBe(0);
    expect(speedBonus(50, 30_000, 30_000)).toBe(0);
    expect(speedBonus(50, 45_000, 30_000)).toBe(0);
  });
  it("sem tempo limite não há bônus", () => {
    expect(speedBonus(50, 1000, null)).toBe(0);
  });
});

describe("pontuação", () => {
  it("padrão: acerto 100, erro 0, sem bônus", () => {
    expect(scoreAnswer(DEFAULT_SCORING, true, 5000, 30_000)).toEqual({ points: 100, bonus: 0 });
    expect(scoreAnswer(DEFAULT_SCORING, false, 5000, 30_000)).toEqual({ points: 0, bonus: 0 });
  });
  it("aplica bônus e peso apenas para acerto", () => {
    const cfg = { ...DEFAULT_SCORING, speedBonusEnabled: true, weight: 2 };
    expect(scoreAnswer(cfg, true, 15_000, 30_000)).toEqual({ points: 250, bonus: 25 });
    expect(scoreAnswer(cfg, false, 0, 30_000).points).toBe(0);
  });
  it("penalidade opcional por erro", () => {
    expect(scoreAnswer({ ...DEFAULT_SCORING, wrongPenalty: 20 }, false, 0, null).points).toBe(-20);
  });
  it("múltiplas corretas exigem o conjunto exato", () => {
    expect(isSelectionCorrect(["a", "b"], ["b", "a"])).toBe(true);
    expect(isSelectionCorrect(["a"], ["a", "b"])).toBe(false);
    expect(isSelectionCorrect(["a", "b", "c"], ["a", "b"])).toBe(false);
    expect(isSelectionCorrect([], [])).toBe(false);
  });
});

describe("cronômetro autoritativo", () => {
  const t0 = new Date("2026-01-01T10:00:00Z");
  it("desconta pausas", () => {
    const timer = { limitMs: 30_000, accumulatedMs: 10_000, runningSince: null };
    expect(elapsedMs(timer, new Date(t0.getTime() + 60_000))).toBe(10_000);
    expect(remainingMs(timer, t0)).toBe(20_000);
  });
  it("conta o trecho em execução", () => {
    const timer = { limitMs: 30_000, accumulatedMs: 10_000, runningSince: t0 };
    expect(elapsedMs(timer, new Date(t0.getTime() + 5_000))).toBe(15_000);
    expect(isTimerExpired(timer, new Date(t0.getTime() + 20_000))).toBe(true);
    expect(isTimerExpired(timer, new Date(t0.getTime() + 19_999))).toBe(false);
  });
});

describe("desempate oficial", () => {
  const base = { joinedAt: "2026-01-01T10:00:00Z", correctTimeMs: 0, correctCount: 0, score: 0 };
  it("pontos > acertos > menor tempo > inscrição > id", () => {
    const rows = [
      { ...base, id: "e", score: 100, correctCount: 1, correctTimeMs: 5000 },
      { ...base, id: "d", score: 100, correctCount: 1, correctTimeMs: 5000, joinedAt: "2026-01-01T09:00:00Z" },
      { ...base, id: "c", score: 100, correctCount: 1, correctTimeMs: 3000 },
      { ...base, id: "b", score: 100, correctCount: 2, correctTimeMs: 9000 },
      { ...base, id: "a", score: 200, correctCount: 1, correctTimeMs: 9000 },
      { ...base, id: "f", score: 100, correctCount: 1, correctTimeMs: 5000 },
    ];
    expect(rankRows(rows).map((r) => r.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
  it("é determinístico e estável", () => {
    const a = { ...base, id: "x" };
    const b = { ...base, id: "y" };
    expect(compareRanking(a, b)).toBeLessThan(0);
    expect(compareRanking(b, a)).toBeGreaterThan(0);
    expect(compareRanking(a, a)).toBe(0);
  });
});

describe("indicadores", () => {
  it("satisfação considera apenas votos registrados", () => {
    expect(satisfactionSummary(0, 0)).toMatchObject({ total: 0, positivePct: null, negativePct: null });
    expect(satisfactionSummary(3, 1)).toMatchObject({ total: 4, positivePct: 75, negativePct: 25 });
  });
  it("NPS = %promotores − %detratores", () => {
    const s = npsSummary([10, 9, 8, 7, 6, 0, 10, 10]);
    expect(s).toMatchObject({ promoters: 4, passives: 2, detractors: 2, total: 8, score: 25 });
    expect(npsSummary([]).score).toBeNull();
  });
});
