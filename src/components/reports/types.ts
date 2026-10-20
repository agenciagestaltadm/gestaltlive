/**
 * Formatos das respostas das rotas de relatórios e CRM (espelham `server/domains/reports.ts` e
 * `server/domains/crm.ts`). Datas chegam como string ISO.
 */
import type { QuestionType, SessionStatus } from "@shared/schemas";
import type { NpsSummary, SatisfactionSummary } from "@shared/scoring";
import type { SatisfactionDTO, WordCloudResultsDTO } from "@shared/types";

/* ------------------------------------------------------------------ relatório da sessão */
export interface ReportCategory {
  label: string;
  count: number;
  pct: number;
  isCorrect: boolean | null;
}

export interface ReportQuestion {
  sessionQuestionId: string;
  questionId: string;
  position: number;
  title: string;
  type: QuestionType;
  category: string | null;
  state: string;
  scored: boolean;
  respondents: number;
  responseRatePct: number;
  avgResponseMs: number | null;
  categories: ReportCategory[];
  accuracyPct: number | null;
  mean: number | null;
  nps: NpsSummary | null;
  options: { id: string; label: string }[];
  selectable: boolean;
  /** Nuvem de Palavras: termos aprovados e visíveis do recorte (nas demais perguntas, null). Em `categories` vêm os termos mais citados. */
  wordCloud: WordCloudResultsDTO | null;
}

export interface RankedRow {
  id: string;
  position: number;
  displayName: string;
  score: number;
  correctCount: number;
  answeredCount: number;
  correctTimeMs: number;
  joinedAt: string;
}

export interface SessionReport {
  session: { id: string; name: string; code: string; status: SessionStatus; startedAt: string | null; endedAt: string | null; finalizedAt: string | null };
  event: { id: string; title: string; speakerName: string | null };
  filter: { fieldKey?: string | null; fieldValue?: string | null; profileSqId?: string | null; profileOptionId?: string | null };
  totals: {
    registered: number;
    interacted: number;
    participationPct: number;
    questions: number;
    questionsDone: number;
    scoredQuestions: number;
    avgCorrect: number;
    avgAccuracyPct: number | null;
  };
  questions: ReportQuestion[];
  hardest: ReportQuestion[];
  scoreHistogram: { range: string; count: number }[];
  top10: RankedRow[];
  ranking: RankedRow[];
  satisfaction: SatisfactionDTO;
  demographics: { key: string; label: string; values: { value: string; count: number }[] }[];
  customFields: { key: string; label: string; type: string; options: string[] }[];
}

/* ------------------------------------------------------------------ visão geral */
export interface OverviewRow {
  id: string;
  name: string;
  code: string;
  status: SessionStatus;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  eventId: string;
  eventTitle: string;
  speakerName: string | null;
  registered: number;
  interacted: number;
  answers: number;
  accuracyPct: number | null;
  satisfaction: (SatisfactionSummary & { sessionId: string }) | null;
}

export interface CompareResult {
  event: { id: string; title: string };
  sessions: {
    id: string;
    name: string;
    code: string;
    status: SessionStatus;
    startedAt: string | null;
    registered: number;
    interacted: number;
    participationPct: number;
    questions: number;
    questionsDone: number;
    scoredQuestions: number;
    avgCorrect: number;
    avgAccuracyPct: number | null;
    satisfactionPct: number | null;
    satisfactionVotes: number;
    topScore: number;
  }[];
  byQuestion: {
    questionId: string;
    title: string;
    scored: boolean;
    type: QuestionType;
    perSession: {
      sessionId: string;
      responseRatePct: number | null;
      accuracyPct: number | null;
      mean: number | null;
      /** Nuvem de Palavras: termos mais citados nesta turma (null nas demais perguntas ou se não aplicada). */
      topTerms: { label: string; count: number; pct: number }[] | null;
    }[];
  }[];
}

export interface EventRow {
  id: string;
  title: string;
  speakerUserId: string | null;
  speakerName: string | null;
  sessionCount: number;
}

export interface MemberRow {
  id: string;
  role: "ORG_ADMIN" | "SPEAKER";
  userId: string;
  name: string;
  email: string;
  isActive: boolean;
}

export interface EventQuestionRow {
  id: string;
  type: QuestionType;
  title: string;
  position: number;
  maxSelections: number;
  options: { id: string; label: string }[];
}

export interface EventSessionRow {
  id: string;
  name: string;
  code: string;
}

/* ------------------------------------------------------------------ CRM */
export interface ParticipantListRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  anonymizedAt: string | null;
  marketing: boolean | null;
  sessions: number;
  bestScore: number | null;
}

export interface ParticipantList {
  total: number;
  page: number;
  pageSize: number;
  rows: ParticipantListRow[];
}

export interface ParticipantDetail {
  participant: {
    id: string;
    orgId: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    anonymizedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  sessions: {
    sessionParticipantId: string;
    sessionId: string;
    sessionName: string;
    code: string;
    status: SessionStatus;
    eventTitle: string;
    displayName: string;
    joinedAt: string;
    score: number;
    correctCount: number;
    answeredCount: number;
    disqualifiedAt: string | null;
    position: number;
  }[];
  custom: { spId: string; label: string; key: string; value: string }[];
  profileAnswers: { sessionParticipantId: string; question: string; answer: string }[];
  scoreHistory: { spId: string; kind: "ANSWER" | "REVERSAL" | "ADJUSTMENT"; points: number; reason: string | null; createdAt: string }[];
  consents: {
    id: string;
    purpose: "PARTICIPACAO" | "MARKETING";
    granted: boolean;
    textVersion: string;
    textSnapshot: string;
    source: string;
    createdAt: string;
  }[];
}
