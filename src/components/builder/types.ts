/** Tipos das perguntas como devolvidas pela API administrativa (listagem de evento e banco). */
import type { ChartConfig, QuestionType, ResultsMode, ScoringConfig } from "@shared/schemas";

export interface QuestionOptionRow {
  id: string;
  label: string;
  imageUrl: string | null;
  isCorrect: boolean;
  color: string | null;
}

export interface QuestionRow {
  id: string;
  eventId: string | null;
  position: number;
  status: "RASCUNHO" | "PRONTA";
  version: number;
  answersCount: number;
  locked: boolean;
  updatedAt: string;
  type: QuestionType;
  title: string;
  description: string | null;
  imageUrl: string | null;
  category: string | null;
  tags: string[];
  required: boolean;
  minSelections: number;
  maxSelections: number;
  scaleMin: number | null;
  scaleMax: number | null;
  scaleMinLabel: string | null;
  scaleMaxLabel: string | null;
  timeLimitSec: number | null;
  allowEdit: boolean;
  scoring: ScoringConfig | null;
  chart: ChartConfig;
  resultsMode: ResultsMode;
  explanation: string | null;
  options: QuestionOptionRow[];
}

/** Tipos que podem servir de cruzamento (segunda dimensão) quando de escolha única. */
export const CROSS_TYPES: QuestionType[] = ["PERFIL", "OPINIAO", "SIM_NAO"];

export const isCrossCandidate = (q: Pick<QuestionRow, "type" | "maxSelections">) => CROSS_TYPES.includes(q.type) && q.maxSelections === 1;
