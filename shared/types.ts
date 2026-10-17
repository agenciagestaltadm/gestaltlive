/**
 * Contratos (DTOs) trocados entre servidor e interface, via API e via eventos em tempo real.
 * Nenhum DTO público contém e-mail, WhatsApp ou outro dado pessoal de participantes.
 */
import type { ChartConfig, PresentationScreen, QuestionType, ResultsMode, SessionQuestionState, SessionStatus } from "./schemas";
import type { NpsSummary, SatisfactionSummary } from "./scoring";

/* ---------------------------------------------------------------- eventos em tempo real */
export const RT = {
  sessionStarted: "session:started",
  sessionPaused: "session:paused",
  sessionResumed: "session:resumed",
  sessionEnded: "session:ended",
  participantJoined: "participant:joined",
  presenceChanged: "participant:presence_changed",
  questionOpened: "question:opened",
  questionClosed: "question:closed",
  questionTimerUpdated: "question:timer_updated",
  questionResultRevealed: "question:result_revealed",
  answerAccepted: "answer:accepted",
  answerRejected: "answer:rejected",
  resultsUpdated: "results:updated",
  leaderboardUpdated: "leaderboard:updated",
  satisfactionUpdated: "satisfaction:updated",
  presentationChanged: "presentation:changed",
  prizesRevealed: "prizes:revealed",
  scoreUpdated: "score:updated",
  /** Contagem de respostas da pergunta em foco (não revela a distribuição). */
  answersCount: "question:answers_count",
  /** Pede ao cliente que recarregue o snapshot completo (ex.: sessão reconfigurada). */
  resync: "state:resync",
} as const;
export type RealtimeEventName = (typeof RT)[keyof typeof RT];

/** Envelope de todos os eventos emitidos pelo servidor. */
export interface RealtimeEnvelope<T = unknown> {
  sessionId: string;
  /** Versão monotônica do estado da sessão — permite descartar eventos fora de ordem. */
  v: number;
  at: string;
  data: T;
}

/* ---------------------------------------------------------------- cronômetro */
export interface TimerDTO {
  limitMs: number | null;
  elapsedMs: number;
  running: boolean;
  /** Relógio do servidor no momento do envio (para corrigir o desvio do cliente). */
  serverNow: number;
}

/* ---------------------------------------------------------------- perguntas */
export interface PublicOptionDTO {
  id: string;
  label: string;
  imageUrl: string | null;
  color: string | null;
}

export interface PublicQuestionDTO {
  sessionQuestionId: string;
  position: number;
  total: number;
  type: QuestionType;
  title: string;
  description: string | null;
  imageUrl: string | null;
  options: PublicOptionDTO[];
  minSelections: number;
  maxSelections: number;
  scaleMin: number | null;
  scaleMax: number | null;
  scaleMinLabel: string | null;
  scaleMaxLabel: string | null;
  scored: boolean;
  allowEdit: boolean;
  state: SessionQuestionState;
  timer: TimerDTO;
  resultsMode: ResultsMode;
  chart: ChartConfig;
  /** Preenchidos somente após a revelação do gabarito. */
  correctOptionIds: string[] | null;
  explanation: string | null;
}

/* ---------------------------------------------------------------- resultados */
export interface ResultCategory {
  id: string;
  label: string;
  color: string | null;
  count: number;
  /** Percentual sobre RESPONDENTES (em múltipla seleção a soma pode passar de 100%). */
  pct: number;
  isCorrect: boolean | null;
  avgResponseMs: number | null;
}

export interface ResultsDTO {
  sessionQuestionId: string;
  questionType: QuestionType;
  title: string;
  multiSelect: boolean;
  totals: {
    /** Participantes inscritos na sessão. */
    participants: number;
    /** Pessoas que responderam. */
    respondents: number;
    /** Total de seleções (≠ respondentes em múltipla seleção). */
    selections: number;
  };
  categories: ResultCategory[];
  numeric: { min: number; max: number; mean: number | null; median: number | null; nps: NpsSummary | null } | null;
  correctRevealed: boolean;
  accuracyPct: number | null;
  timeline: { bucketMs: number; points: { t: number; respondents: number; byCategory: number[] }[] };
  scatter: { rtMs: number; value: number }[] | null;
  cross: { questionTitle: string; segments: string[]; matrix: number[][] } | null;
  generatedAt: string;
}

/* ---------------------------------------------------------------- ranking */
export interface LeaderboardEntryDTO {
  position: number;
  sessionParticipantId: string;
  displayName: string;
  score: number;
  correctCount: number;
  answeredCount: number;
  /** Variação de posição desde a publicação anterior (positivo = subiu). */
  movement: number | null;
}

export interface LeaderboardDTO {
  entries: LeaderboardEntryDTO[];
  totalRanked: number;
  frozen: boolean;
  hidden: boolean;
  final: boolean;
  updatedAt: string;
}

export interface MyStandingDTO {
  sessionParticipantId: string;
  displayName: string;
  position: number | null;
  totalRanked: number;
  score: number;
  correctCount: number;
  answeredCount: number;
  gapToNext: number | null;
  disqualified: boolean;
}

/* ---------------------------------------------------------------- satisfação */
export interface SatisfactionDTO {
  summary: SatisfactionSummary;
  registered: number;
  notVoted: number;
  participationPct: number | null;
  timeline: { t: string; positive: number; negative: number }[];
}

/* ---------------------------------------------------------------- prêmios */
export interface PrizeDTO {
  id: string;
  rank: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  estimatedValueCents: number | null;
  eligibility: string | null;
  pickupInfo: string | null;
}

export interface PodiumDTO {
  final: boolean;
  revealed: boolean;
  finalizedAt: string | null;
  winners: { rank: number; displayName: string; score: number; correctCount: number; prize: PrizeDTO | null }[];
}

/* ---------------------------------------------------------------- estado da sessão */
export interface PresentationDTO {
  screen: PresentationScreen;
  sessionQuestionId: string | null;
  leaderboardHidden: boolean;
  leaderboardFrozen: boolean;
  showSatisfactionToScreen: boolean;
  version: number;
}

export interface PublicSessionDTO {
  id: string;
  code: string;
  name: string;
  status: SessionStatus;
  startedAt: string | null;
  endedAt: string | null;
  event: {
    title: string;
    description: string | null;
    speakerName: string | null;
    logoUrl: string | null;
    welcomeMessage: string | null;
    closingMessage: string | null;
    location: string | null;
    startsAt: string | null;
    theme: { primary?: string; secondary?: string };
  };
  organization: { name: string; logoUrl: string | null };
  settings: { showLeaderboardToParticipants: boolean; showPrizesToParticipants: boolean; soundEffects: boolean };
  questionCount: number;
  joinUrl: string;
}

export interface ParticipantStateDTO {
  session: PublicSessionDTO;
  me: MyStandingDTO;
  satisfaction: "POSITIVO" | "NEGATIVO" | null;
  activeQuestion: PublicQuestionDTO | null;
  /** Resposta do participante à pergunta ativa (se houver). */
  myAnswer: { optionIds: string[]; value: number | null; revision: number; isCorrect: boolean | null; points: number | null } | null;
  /** Resultado visível ao público para a pergunta ativa, conforme o modo de exibição. */
  results: ResultsDTO | null;
  leaderboard: LeaderboardDTO | null;
  prizes: PrizeDTO[];
  podium: PodiumDTO | null;
  presentation: PresentationDTO;
  serverNow: number;
  v: number;
}

export interface ScreenStateDTO {
  session: PublicSessionDTO;
  presentation: PresentationDTO;
  question: PublicQuestionDTO | null;
  results: ResultsDTO | null;
  leaderboard: LeaderboardDTO | null;
  satisfaction: SatisfactionDTO | null;
  podium: PodiumDTO | null;
  prizes: PrizeDTO[];
  counts: { registered: number; connected: number; answered: number };
  closing: { participants: number; interacted: number; questionsDone: number; satisfactionPct: number | null } | null;
  serverNow: number;
  v: number;
}

export interface ControlQuestionDTO extends PublicQuestionDTO {
  questionId: string;
  correctOptionIdsAdmin: string[];
  answeredCount: number;
  scoredAt: string | null;
  scoresPublishedAt: string | null;
  correctRevealedAt: string | null;
  resultsShownAt: string | null;
}

export interface ActivityItemDTO {
  id: string;
  type: string;
  label: string;
  at: string;
}

export interface ControlStateDTO {
  session: PublicSessionDTO & { eventId: string; finalizedAt: string | null; screenUrl: string | null };
  presentation: PresentationDTO;
  questions: ControlQuestionDTO[];
  activeQuestionId: string | null;
  results: ResultsDTO | null;
  leaderboard: LeaderboardDTO;
  satisfaction: SatisfactionDTO;
  podium: PodiumDTO | null;
  prizes: PrizeDTO[];
  counts: { registered: number; connected: number; answeredCurrent: number; questionsDone: number };
  activity: ActivityItemDTO[];
  profileQuestions: { sessionQuestionId: string; title: string }[];
  serverNow: number;
  v: number;
}
