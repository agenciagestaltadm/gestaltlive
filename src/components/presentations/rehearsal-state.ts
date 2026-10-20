/**
 * Gerador de estado FICTÍCIO do telão para o modo ensaio e as prévias do editor.
 *
 * Monta um `ScreenStateDTO` completo para cada item da apresentação, 100% no cliente: nenhuma
 * sessão é criada e nenhuma resposta é registrada. Slides usam as imagens reais; perguntas usam os
 * dados reais da pergunta; gráficos, ranking, satisfação e pódio usam dados demonstrativos
 * (rotulados como "exemplo").
 */
import type {
  LeaderboardDTO,
  PodiumDTO,
  PresentationDTO as ScreenPresentationDTO,
  PrizeDTO,
  PublicQuestionDTO,
  PublicSessionDTO,
  ResultsDTO,
  SatisfactionDTO,
  ScreenStateDTO,
} from "@shared/types";
import {
  OPENS_QUESTION,
  screenForItem,
  type PresentationDTO,
  type PresentationItemDTO,
  type ScreenPresenterDTO,
  type ScreenSlideDTO,
} from "@shared/presentations";
import { previewResults } from "@shared/charts/options";
import { satisfactionSummary } from "@shared/scoring";
import { eventSettingsSchema, isScoredType, type SessionQuestionState } from "@shared/schemas";
import type { QuestionRow } from "@/components/builder/types";
import type { EventDetail } from "@/components/admin/event-types";
import { DEMO_SESSION_CODE } from "./demo-qr";

/** Participantes fictícios do ensaio. */
export const DEMO_REGISTERED = 128;
const DEMO_CONNECTED = 117;

export interface RehearsalSource {
  presentation: Pick<PresentationDTO, "id" | "title" | "settings" | "items">;
  event: Pick<EventDetail, "title" | "description" | "speakerName" | "logoUrl" | "welcomeMessage" | "closingMessage" | "location" | "startsAt" | "theme" | "prizes" | "settings"> & {
    speaker?: { name: string } | null;
  } | null;
  /** Perguntas do evento vinculado (dados completos: alternativas, tempo, gráfico...). */
  questions: Map<string, QuestionRow>;
  org: { name: string; logoUrl: string | null };
  /** Origem da página (para a URL de entrada exibida). */
  origin: string;
}

/** Estado simulado de uma pergunta durante o ensaio. */
export interface QuestionSim {
  state: SessionQuestionState;
  /** Instante (ms) em que o cronômetro voltou a correr; nulo = parado. */
  startedAt: number | null;
  /** Tempo já decorrido antes de `startedAt`. */
  elapsedMs: number;
  /** Gabarito revelado (quiz) / pódio revelado (premiação). */
  revealed: boolean;
  /** Respostas fictícias recebidas. */
  answered: number;
}

export function initialSim(item: PresentationItemDTO): QuestionSim {
  const opens = OPENS_QUESTION.includes(item.type) && item.settings.openMode === "AUTOMATICO";
  return {
    state: item.type === "CHART" ? "RESULTADO_EXIBIDO" : opens ? "ABERTA" : "PRONTA",
    startedAt: opens ? Date.now() : null,
    elapsedMs: 0,
    revealed: false,
    answered: 0,
  };
}

export function simElapsed(sim: QuestionSim, now = Date.now()) {
  return sim.elapsedMs + (sim.startedAt !== null ? now - sim.startedAt : 0);
}

/** Fechamento automático no fim do tempo: configuração do item, senão a do evento. */
export function effectiveAutoClose(item: PresentationItemDTO, event: RehearsalSource["event"]): boolean {
  if (item.settings.autoCloseOnTimer !== null) return item.settings.autoCloseOnTimer;
  return eventSettingsSchema.parse(event?.settings ?? {}).autoCloseOnTimer;
}

/* ------------------------------------------------------------------ dados demonstrativos */
const DEMO_NAMES = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio", "Gabi", "Hugo", "Íris", "João"];

export function demoLeaderboard(): LeaderboardDTO {
  const scores = [1280, 1190, 1105, 990, 940, 870, 800, 760, 690, 610];
  const moves = [0, 2, -1, 1, 0, -2, 3, 0, -1, 1];
  return {
    entries: DEMO_NAMES.map((n, i) => ({
      position: i + 1,
      sessionParticipantId: `demo-${i}`,
      displayName: `${n} (exemplo)`,
      score: scores[i],
      correctCount: Math.max(1, 9 - i),
      answeredCount: 10,
      movement: moves[i],
    })),
    totalRanked: DEMO_CONNECTED,
    frozen: false,
    hidden: false,
    final: false,
    updatedAt: new Date().toISOString(),
  };
}

export function demoSatisfaction(now = Date.now()): SatisfactionDTO {
  const summary = satisfactionSummary(84, 16);
  const steps = [
    [10, 2],
    [24, 5],
    [38, 8],
    [51, 10],
    [63, 12],
    [72, 14],
    [79, 15],
    [84, 16],
  ];
  return {
    summary,
    registered: DEMO_REGISTERED,
    notVoted: DEMO_REGISTERED - summary.total,
    participationPct: (summary.total / DEMO_REGISTERED) * 100,
    timeline: steps.map(([p, n], i) => ({ t: new Date(now - (steps.length - 1 - i) * 5 * 60_000).toISOString(), positive: p, negative: n })),
  };
}

function demoPrizes(event: RehearsalSource["event"]): PrizeDTO[] {
  if (event?.prizes?.length) return [...event.prizes].sort((a, b) => a.rank - b.rank);
  return [1, 2, 3].map((rank) => ({
    id: `demo-premio-${rank}`,
    rank,
    name: `Prêmio de exemplo — ${rank}º lugar`,
    description: "Cadastre os prêmios reais na aba Prêmios do evento.",
    imageUrl: null,
    estimatedValueCents: null,
    eligibility: null,
    pickupInfo: null,
  }));
}

export function demoPodium(prizes: PrizeDTO[], revealed: boolean): PodiumDTO {
  const lb = demoLeaderboard();
  return {
    final: true,
    revealed,
    finalizedAt: revealed ? new Date().toISOString() : null,
    winners: lb.entries.slice(0, 3).map((e) => ({
      rank: e.position,
      displayName: e.displayName,
      score: e.score,
      correctCount: e.correctCount,
      prize: prizes.find((p) => p.rank === e.position) ?? null,
    })),
  };
}

/* ------------------------------------------------------------------ perguntas */
function questionNumbering(items: PresentationItemDTO[]) {
  const ids: string[] = [];
  for (const it of items) if (!it.hidden && OPENS_QUESTION.includes(it.type) && it.questionId && !ids.includes(it.questionId)) ids.push(it.questionId);
  return ids;
}

const sqId = (questionId: string) => `ensaio-${questionId}`;

function publicQuestion(q: QuestionRow, sim: QuestionSim, position: number, total: number, now: number): PublicQuestionDTO {
  const limitMs = q.timeLimitSec ? q.timeLimitSec * 1000 : null;
  const running = sim.state === "ABERTA" && sim.startedAt !== null;
  const elapsed = simElapsed(sim, now);
  return {
    sessionQuestionId: sqId(q.id),
    position,
    total,
    type: q.type,
    title: q.title,
    description: q.description,
    imageUrl: q.imageUrl,
    options: q.options.map((o) => ({ id: o.id, label: o.label, imageUrl: o.imageUrl, color: o.color })),
    minSelections: q.minSelections,
    maxSelections: q.maxSelections,
    scaleMin: q.scaleMin,
    scaleMax: q.scaleMax,
    scaleMinLabel: q.scaleMinLabel,
    scaleMaxLabel: q.scaleMaxLabel,
    scored: isScoredType(q.type),
    allowEdit: q.allowEdit,
    state: sim.state,
    timer: { limitMs, elapsedMs: limitMs !== null ? Math.min(elapsed, limitMs) : elapsed, running, serverNow: now },
    resultsMode: q.resultsMode,
    chart: q.chart,
    correctOptionIds: sim.revealed ? q.options.filter((o) => o.isCorrect).map((o) => o.id) : null,
    explanation: sim.revealed ? q.explanation : null,
    wordCloud: q.wordCloud
      ? {
          mode: q.wordCloud.mode,
          maxWords: q.wordCloud.maxWords,
          maxEntries: q.wordCloud.maxEntries,
          maxChars: q.wordCloud.maxChars,
          allowRepeat: q.wordCloud.allowRepeat,
          requireApproval: q.wordCloud.requireApproval,
        }
      : null,
  };
}

/** Resultado ilustrativo (mesmo gerador da galeria de gráficos), com os ids das alternativas reais. */
export function demoResults(q: QuestionRow, revealed: boolean): ResultsDTO {
  const r = previewResults({
    type: q.type,
    title: q.title,
    options: q.options.map((o) => ({ label: o.label, color: o.color, isCorrect: o.isCorrect })),
    maxSelections: q.maxSelections,
    scaleMin: q.scaleMin,
    scaleMax: q.scaleMax,
    withCross: !!q.chart.crossQuestionId,
  });
  return {
    ...r,
    sessionQuestionId: sqId(q.id),
    correctRevealed: revealed,
    categories: r.categories.map((c, i) => ({ ...c, id: q.options[i]?.id ?? c.id, isCorrect: revealed ? c.isCorrect : null })),
  };
}

function resultsVisible(q: QuestionRow, sim: QuestionSim) {
  if (sim.state === "RESULTADO_EXIBIDO") return true;
  if (q.resultsMode === "AO_VIVO") return sim.state !== "PRONTA";
  if (q.resultsMode === "APOS_ENCERRAMENTO") return sim.state === "FECHADA";
  return false;
}

/* ------------------------------------------------------------------ estado do telão */
function demoSession(src: RehearsalSource, questionCount: number): PublicSessionDTO {
  const ev = src.event;
  return {
    id: "ensaio",
    code: DEMO_SESSION_CODE,
    name: "Ensaio",
    status: "AO_VIVO",
    startedAt: null,
    endedAt: null,
    event: {
      title: ev?.title ?? src.presentation.title,
      description: ev?.description ?? null,
      speakerName: ev?.speakerName ?? ev?.speaker?.name ?? null,
      logoUrl: ev?.logoUrl ?? null,
      welcomeMessage: ev?.welcomeMessage ?? null,
      closingMessage: ev?.closingMessage ?? null,
      location: ev?.location ?? null,
      startsAt: ev?.startsAt ?? null,
      theme: ev?.theme ?? {},
    },
    organization: src.org,
    settings: { showLeaderboardToParticipants: true, showPrizesToParticipants: true, soundEffects: false },
    questionCount,
    joinUrl: `${src.origin}/entrar/${DEMO_SESSION_CODE}`,
  };
}

export interface BuildOptions {
  /** Variante das imagens dos slides: "tela" (ensaio) ou "mini" (prévias leves do editor). */
  imageVariant?: "tela" | "mini";
  now?: number;
}

export function slideFor(item: PresentationItemDTO, src: RehearsalSource, variant: "tela" | "mini" = "tela"): ScreenSlideDTO | null {
  if (item.type !== "IMAGE_SLIDE" && item.type !== "CUSTOM_SCREEN") return null;
  const pset = src.presentation.settings;
  const s = item.settings;
  return {
    itemId: item.id,
    type: item.type,
    imageUrl: item.type === "IMAGE_SLIDE" ? (item.asset ? item.asset.urls[variant] : null) : s.backgroundImageUrl,
    fit: s.fit ?? pset.fit,
    background: s.background ?? pset.background,
    transition: item.transition ?? pset.defaultTransition,
    heading: s.heading,
    subheading: s.subheading,
    message: s.message,
    textColor: s.textColor,
  };
}

/**
 * Estado fictício do telão para o item `index`.
 * `sim` é o estado simulado da pergunta/premiação do item (use `initialSim` quando ausente).
 */
export function buildRehearsalState(src: RehearsalSource, index: number, sim: QuestionSim | null, opts: BuildOptions = {}): ScreenStateDTO {
  const now = opts.now ?? Date.now();
  const items = src.presentation.items;
  const item = items[index] ?? null;
  const numbering = questionNumbering(items);
  const session = demoSession(src, numbering.length);
  const s = sim ?? (item ? initialSim(item) : null);
  const q = item?.questionId ? src.questions.get(item.questionId) ?? null : null;

  const preload: string[] = [];
  for (let i = index + 1; i < items.length && preload.length < 2; i++) {
    const it = items[i];
    if (!it.hidden && it.type === "IMAGE_SLIDE" && it.asset) preload.push(it.asset.urls[opts.imageVariant ?? "tela"]);
  }

  const presenter: ScreenPresenterDTO = {
    active: true,
    itemId: item?.id ?? null,
    slide: item ? slideFor(item, src, opts.imageVariant) : null,
    override: "NENHUM",
    preload,
    chartType: item?.type === "CHART" ? item.settings.chartType : null,
    showJoinBadge: src.presentation.settings.showJoinBadgeOnSlides,
    version: index,
  };

  let question: PublicQuestionDTO | null = null;
  let results: ResultsDTO | null = null;
  if (item && q && s) {
    const pos = Math.max(1, numbering.indexOf(q.id) + 1 || numbering.length);
    const qs = item.type === "CHART" ? { ...s, state: "RESULTADO_EXIBIDO" as const, startedAt: null } : s;
    question = publicQuestion(q, qs, pos, Math.max(1, numbering.length), now);
    if (item.type === "CHART" || resultsVisible(q, qs)) results = demoResults(q, qs.revealed);
  }

  const screen = item ? screenForItem(item.type) : "BOAS_VINDAS";
  const presentation: ScreenPresentationDTO = {
    screen,
    sessionQuestionId: question?.sessionQuestionId ?? null,
    leaderboardHidden: false,
    leaderboardFrozen: false,
    showSatisfactionToScreen: false,
    version: index,
  };
  const prizes = demoPrizes(src.event);

  return {
    session,
    presentation,
    presenter,
    question,
    results,
    leaderboard: screen === "RANKING" ? demoLeaderboard() : null,
    satisfaction: screen === "SATISFACAO" ? demoSatisfaction(now) : null,
    podium: screen === "PREMIACAO" ? demoPodium(prizes, !!s?.revealed) : null,
    prizes,
    counts: { registered: DEMO_REGISTERED, connected: DEMO_CONNECTED, answered: s?.answered ?? 0 },
    closing: null,
    serverNow: now,
    v: index,
  };
}

/** Índices de perguntas como mapa id → pergunta. */
export function questionMap(list: QuestionRow[] | null | undefined) {
  return new Map((list ?? []).map((q) => [q.id, q]));
}
