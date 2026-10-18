/**
 * Modelo de dados do Gestalt Live (PostgreSQL via Drizzle ORM).
 *
 * Convenções:
 * - Toda entidade pertencente a um cliente (tenant) possui `org_id` para isolamento multi-tenant.
 * - Identificadores UUID gerados pelo banco (gen_random_uuid()).
 * - Tabelas de histórico (satisfaction_vote_history, score_transactions, consent_records,
 *   audit_logs, session_events, leaderboard_snapshots) são append-only.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  bigint,
  doublePrecision,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/* ------------------------------------------------------------------ enums */
export const memberRole = pgEnum("member_role", ["ORG_ADMIN", "SPEAKER"]);
export const sessionStatus = pgEnum("session_status", [
  "RASCUNHO",
  "AGENDADA",
  "AGUARDANDO",
  "AO_VIVO",
  "PAUSADA",
  "ENCERRADA",
  "CANCELADA",
]);
export const questionType = pgEnum("question_type", [
  "PERFIL",
  "OPINIAO",
  "CONHECIMENTO",
  "MULTIPLA_CORRETA",
  "SIM_NAO",
  "ESCALA",
  "NPS",
]);
export const questionStatus = pgEnum("question_status", ["RASCUNHO", "PRONTA"]);
export const sessionQuestionState = pgEnum("session_question_state", [
  "PRONTA",
  "ABERTA",
  "FECHADA",
  "RESULTADO_EXIBIDO",
]);
export const resultsMode = pgEnum("results_mode", ["AO_VIVO", "APOS_ENCERRAMENTO", "MANUAL"]);
export const answerStatus = pgEnum("answer_status", ["ACCEPTED", "SUPERSEDED"]);
export const scoreKind = pgEnum("score_kind", ["ANSWER", "REVERSAL", "ADJUSTMENT"]);
export const satisfactionValue = pgEnum("satisfaction_value", ["POSITIVO", "NEGATIVO"]);
export const consentPurpose = pgEnum("consent_purpose", ["PARTICIPACAO", "MARKETING"]);
export const presentationScreen = pgEnum("presentation_screen", [
  "BOAS_VINDAS",
  "PERGUNTA",
  "RESULTADO",
  "RANKING",
  "SATISFACAO",
  "PREMIACAO",
  "ENCERRAMENTO",
  // Gerenciador de Apresentações
  "SLIDE",
  "TELA_PERSONALIZADA",
]);
export const presentationItemType = pgEnum("presentation_item_type", [
  "IMAGE_SLIDE",
  "QUESTION",
  "POLL",
  "QUIZ",
  "CHART",
  "LEADERBOARD",
  "SATISFACTION",
  "QR_CODE",
  "AWARDS",
  "CUSTOM_SCREEN",
]);
export const presenterStatus = pgEnum("presenter_status", ["PRONTA", "APRESENTANDO", "ENCERRADA"]);
export const screenOverride = pgEnum("screen_override", ["NENHUM", "TELA_PRETA", "PAUSA"]);
export const snapshotKind = pgEnum("snapshot_kind", ["PUBLICACAO", "CONGELADO", "FINAL"]);
export const awardStatus = pgEnum("award_status", ["PENDENTE", "ENTREGUE", "REVOGADO"]);
export const customFieldType = pgEnum("custom_field_type", ["TEXTO", "TEXTO_LONGO", "SELECAO", "NUMERO", "EMAIL", "TELEFONE"]);

/* ------------------------------------------------------- organizações e usuários */
export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  brand: jsonb("brand").$type<{ primary?: string; secondary?: string }>().notNull().default({}),
  plan: text("plan").notNull().default("PADRAO"),
  limits: jsonb("limits").$type<{ maxParticipantsPerSession?: number; maxEvents?: number }>().notNull().default({}),
  retentionDays: integer("retention_days"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isSuperadmin: boolean("is_superadmin").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("org_members_org_user_uq").on(t.orgId, t.userId), index("org_members_user_idx").on(t.userId)],
);

/* ------------------------------------------------------- templates e eventos */
export const trainingTemplates = pgTable(
  "training_templates",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /** Snapshot no formato de importação/exportação (shared/schemas questionnaireExport). */
    content: jsonb("content").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("templates_org_idx").on(t.orgId)],
);

export const events = pgTable(
  "events",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: ts("starts_at"),
    location: text("location"),
    speakerUserId: uuid("speaker_user_id").references(() => users.id, { onDelete: "set null" }),
    speakerName: text("speaker_name"),
    logoUrl: text("logo_url"),
    welcomeMessage: text("welcome_message"),
    closingMessage: text("closing_message"),
    theme: jsonb("theme").$type<{ primary?: string; secondary?: string }>().notNull().default({}),
    /** Configuração do cadastro (shared/schemas registrationConfigSchema). */
    registration: jsonb("registration").notNull(),
    /** Configurações gerais (shared/schemas eventSettingsSchema). */
    settings: jsonb("settings").notNull(),
    templateId: uuid("template_id").references(() => trainingTemplates.id, { onDelete: "set null" }),
    archivedAt: ts("archived_at"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("events_org_idx").on(t.orgId), index("events_speaker_idx").on(t.speakerUserId)],
);

export const eventPrizes = pgTable(
  "event_prizes",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    estimatedValueCents: integer("estimated_value_cents"),
    eligibility: text("eligibility"),
    pickupInfo: text("pickup_info"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("event_prizes_event_rank_uq").on(t.eventId, t.rank)],
);

/* ------------------------------------------------------- perguntas */
export const questions = pgTable(
  "questions",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    /** Nulo = pergunta do banco reutilizável da organização. */
    eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    type: questionType("type").notNull(),
    status: questionStatus("status").notNull().default("RASCUNHO"),
    title: text("title").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    category: text("category"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    required: boolean("required").notNull().default(false),
    /** Seleção: mínimo e máximo de alternativas. */
    minSelections: integer("min_selections").notNull().default(1),
    maxSelections: integer("max_selections").notNull().default(1),
    /** Escala: limites (ESCALA e NPS). */
    scaleMin: integer("scale_min"),
    scaleMax: integer("scale_max"),
    scaleMinLabel: text("scale_min_label"),
    scaleMaxLabel: text("scale_max_label"),
    timeLimitSec: integer("time_limit_sec"),
    allowEdit: boolean("allow_edit").notNull().default(false),
    /** shared/schemas scoringSchema (somente CONHECIMENTO e MULTIPLA_CORRETA). */
    scoring: jsonb("scoring"),
    /** shared/schemas chartConfigSchema */
    chart: jsonb("chart").notNull(),
    resultsMode: resultsMode("results_mode").notNull().default("MANUAL"),
    explanation: text("explanation"),
    currentVersion: integer("current_version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("questions_org_idx").on(t.orgId), index("questions_event_idx").on(t.eventId, t.position)],
);

export const questionOptions = pgTable(
  "question_options",
  {
    id: id(),
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    imageUrl: text("image_url"),
    isCorrect: boolean("is_correct").notNull().default(false),
    color: text("color"),
    createdAt: createdAt(),
  },
  (t) => [index("question_options_q_idx").on(t.questionId, t.position)],
);

/** Versões imutáveis da pergunta. Cada sessão usa a versão vigente no momento da inclusão. */
export const questionVersions = pgTable(
  "question_versions",
  {
    id: id(),
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("question_versions_q_v_uq").on(t.questionId, t.version)],
);

/* ------------------------------------------------------- sessões */
export const eventSessions = pgTable(
  "event_sessions",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull().unique(),
    status: sessionStatus("status").notNull().default("RASCUNHO"),
    scheduledAt: ts("scheduled_at"),
    startedAt: ts("started_at"),
    pausedAt: ts("paused_at"),
    endedAt: ts("ended_at"),
    finalizedAt: ts("finalized_at"),
    /** Nonce do token do telão (token = HMAC(APP_SECRET, id:nonce)); trocar o nonce revoga links antigos. */
    screenTokenNonce: text("screen_token_nonce").notNull(),
    /** Snapshot do cadastro/configurações no momento da criação (pode ser atualizado antes de iniciar). */
    registration: jsonb("registration").notNull(),
    /** Apresentação usada no modo apresentador (opcional). */
    presentationId: uuid("presentation_id").references((): AnyPgColumn => presentations.id, { onDelete: "set null" }),
    settings: jsonb("settings").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_org_idx").on(t.orgId), index("sessions_event_idx").on(t.eventId)],
);

export const sessionQuestions = pgTable(
  "session_questions",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => eventSessions.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
    versionId: uuid("version_id").notNull().references(() => questionVersions.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    state: sessionQuestionState("state").notNull().default("PRONTA"),
    resultsMode: resultsMode("results_mode").notNull(),
    timeLimitMs: integer("time_limit_ms"),
    /** Fechamento automático por pergunta (nulo = segue a configuração da sessão). */
    autoClose: boolean("auto_close"),
    /** Cronômetro autoritativo: tempo acumulado + início do trecho em execução. */
    timerAccumulatedMs: integer("timer_accumulated_ms").notNull().default(0),
    timerRunningSince: ts("timer_running_since"),
    openedAt: ts("opened_at"),
    closedAt: ts("closed_at"),
    resultsShownAt: ts("results_shown_at"),
    correctRevealedAt: ts("correct_revealed_at"),
    scoredAt: ts("scored_at"),
    scoresPublishedAt: ts("scores_published_at"),
    openCount: integer("open_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("sq_session_idx").on(t.sessionId, t.position),
    uniqueIndex("sq_session_question_uq").on(t.sessionId, t.questionId),
  ],
);

/* ------------------------------------------------------- participantes */
export const participants = pgTable(
  "participants",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    email: text("email"),
    emailNorm: text("email_norm"),
    phone: text("phone"),
    phoneNorm: text("phone_norm"),
    anonymizedAt: ts("anonymized_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("participants_org_idx").on(t.orgId),
    index("participants_email_idx").on(t.orgId, t.emailNorm),
    index("participants_phone_idx").on(t.orgId, t.phoneNorm),
  ],
);

export const sessionParticipants = pgTable(
  "session_participants",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => eventSessions.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id").notNull().references(() => participants.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** Identificadores normalizados exigidos únicos pela política da sessão (nulos = sem restrição). */
    uniqueEmail: text("unique_email"),
    uniquePhone: text("unique_phone"),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at"),
    /** Agregados mantidos na mesma transação das score_transactions (consistência verificada em testes). */
    score: integer("score").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
    answeredCount: integer("answered_count").notNull().default(0),
    correctTimeMs: bigint("correct_time_ms", { mode: "number" }).notNull().default(0),
    disqualifiedAt: ts("disqualified_at"),
    recoveryCodeHash: text("recovery_code_hash"),
    recoveryCodeExpiresAt: ts("recovery_code_expires_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("sp_session_idx").on(t.sessionId),
    index("sp_participant_idx").on(t.participantId),
    uniqueIndex("sp_session_unique_email_uq").on(t.sessionId, t.uniqueEmail).where(sql`${t.uniqueEmail} is not null`),
    uniqueIndex("sp_session_unique_phone_uq").on(t.sessionId, t.uniquePhone).where(sql`${t.uniquePhone} is not null`),
    index("sp_ranking_idx").on(t.sessionId, t.score, t.correctCount, t.correctTimeMs),
  ],
);

export const participantCustomFields = pgTable(
  "participant_custom_fields",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: customFieldType("type").notNull().default("TEXTO"),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    required: boolean("required").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pcf_event_key_uq").on(t.eventId, t.key)],
);

export const participantCustomValues = pgTable(
  "participant_custom_values",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionParticipantId: uuid("session_participant_id")
      .notNull()
      .references(() => sessionParticipants.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id").notNull().references(() => participantCustomFields.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pcv_sp_field_uq").on(t.sessionParticipantId, t.fieldId), index("pcv_field_idx").on(t.fieldId)],
);

export const consentRecords = pgTable(
  "consent_records",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id").notNull().references(() => participants.id, { onDelete: "cascade" }),
    sessionParticipantId: uuid("session_participant_id").references(() => sessionParticipants.id, { onDelete: "set null" }),
    purpose: consentPurpose("purpose").notNull(),
    granted: boolean("granted").notNull(),
    textVersion: text("text_version").notNull(),
    textSnapshot: text("text_snapshot").notNull(),
    source: text("source").notNull().default("CADASTRO"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("consent_participant_idx").on(t.participantId, t.purpose, t.createdAt)],
);

/* ------------------------------------------------------- respostas e pontuação */
export const participantAnswers = pgTable(
  "participant_answers",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => eventSessions.id, { onDelete: "cascade" }),
    sessionQuestionId: uuid("session_question_id")
      .notNull()
      .references(() => sessionQuestions.id, { onDelete: "cascade" }),
    sessionParticipantId: uuid("session_participant_id")
      .notNull()
      .references(() => sessionParticipants.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: answerStatus("status").notNull().default("ACCEPTED"),
    revision: integer("revision").notNull().default(1),
    numericValue: doublePrecision("numeric_value"),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    responseTimeMs: integer("response_time_ms").notNull(),
    /** Preenchidos no fechamento da pergunta (cálculo oficial). */
    isCorrect: boolean("is_correct"),
    points: integer("points"),
    speedBonus: integer("speed_bonus"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("answers_one_accepted_uq")
      .on(t.sessionQuestionId, t.sessionParticipantId)
      .where(sql`${t.status} = 'ACCEPTED'`),
    uniqueIndex("answers_idempotency_uq").on(t.sessionParticipantId, t.idempotencyKey),
    index("answers_sq_idx").on(t.sessionQuestionId, t.status),
    index("answers_session_idx").on(t.sessionId),
  ],
);

export const answerOptionSelections = pgTable(
  "answer_option_selections",
  {
    answerId: uuid("answer_id").notNull().references(() => participantAnswers.id, { onDelete: "cascade" }),
    optionId: uuid("option_id").notNull().references(() => questionOptions.id, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.answerId, t.optionId] }), index("aos_option_idx").on(t.optionId)],
);

export const scoreTransactions = pgTable(
  "score_transactions",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => eventSessions.id, { onDelete: "cascade" }),
    sessionParticipantId: uuid("session_participant_id")
      .notNull()
      .references(() => sessionParticipants.id, { onDelete: "cascade" }),
    sessionQuestionId: uuid("session_question_id").references(() => sessionQuestions.id, { onDelete: "cascade" }),
    answerId: uuid("answer_id").references(() => participantAnswers.id, { onDelete: "cascade" }),
    kind: scoreKind("kind").notNull(),
    points: integer("points").notNull(),
    correctDelta: integer("correct_delta").notNull().default(0),
    answeredDelta: integer("answered_delta").notNull().default(0),
    correctTimeMsDelta: bigint("correct_time_ms_delta", { mode: "number" }).notNull().default(0),
    reason: text("reason"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("score_tx_answer_kind_uq").on(t.answerId, t.kind).where(sql`${t.answerId} is not null`),
    index("score_tx_session_sp_idx").on(t.sessionId, t.sessionParticipantId),
  ],
);

export const leaderboardSnapshots = pgTable(
  "leaderboard_snapshots",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => eventSessions.id, { onDelete: "cascade" }),
    kind: snapshotKind("kind").notNull(),
    revision: integer("revision").notNull().default(1),
    sessionQuestionId: uuid("session_question_id").references(() => sessionQuestions.id, { onDelete: "set null" }),
    entries: jsonb("entries").notNull(),
    reason: text("reason"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("lb_snap_session_idx").on(t.sessionId, t.kind, t.createdAt)],
);

/* ------------------------------------------------------- satisfação */
export const satisfactionVotes = pgTable(
  "satisfaction_votes",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => eventSessions.id, { onDelete: "cascade" }),
    sessionParticipantId: uuid("session_participant_id")
      .notNull()
      .references(() => sessionParticipants.id, { onDelete: "cascade" }),
    value: satisfactionValue("value").notNull(),
    changes: integer("changes").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("satisfaction_sp_uq").on(t.sessionParticipantId), index("satisfaction_session_idx").on(t.sessionId)],
);

export const satisfactionVoteHistory = pgTable(
  "satisfaction_vote_history",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => eventSessions.id, { onDelete: "cascade" }),
    sessionParticipantId: uuid("session_participant_id")
      .notNull()
      .references(() => sessionParticipants.id, { onDelete: "cascade" }),
    value: satisfactionValue("value").notNull(),
    previousValue: satisfactionValue("previous_value"),
    createdAt: createdAt(),
  },
  (t) => [index("satisfaction_hist_session_idx").on(t.sessionId, t.createdAt)],
);

/* ------------------------------------------------------- prêmios concedidos */
export const prizeAwards = pgTable(
  "prize_awards",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => eventSessions.id, { onDelete: "cascade" }),
    prizeId: uuid("prize_id").references(() => eventPrizes.id, { onDelete: "set null" }),
    rank: integer("rank").notNull(),
    sessionParticipantId: uuid("session_participant_id")
      .notNull()
      .references(() => sessionParticipants.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id").notNull().references(() => leaderboardSnapshots.id, { onDelete: "restrict" }),
    prizeSnapshot: jsonb("prize_snapshot"),
    status: awardStatus("status").notNull().default("PENDENTE"),
    awardedAt: timestamp("awarded_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    deliveredAt: ts("delivered_at"),
    deliveredByUserId: uuid("delivered_by_user_id").references(() => users.id, { onDelete: "set null" }),
    revokedAt: ts("revoked_at"),
    notes: text("notes"),
  },
  (t) => [index("prize_awards_session_idx").on(t.sessionId, t.rank)],
);

export const disqualifications = pgTable(
  "disqualifications",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => eventSessions.id, { onDelete: "cascade" }),
    sessionParticipantId: uuid("session_participant_id")
      .notNull()
      .references(() => sessionParticipants.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    revertedAt: ts("reverted_at"),
    revertedByUserId: uuid("reverted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    revertReason: text("revert_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("disq_session_idx").on(t.sessionId)],
);

/* ------------------------------------------------------- apresentação, eventos e auditoria */
export const presentationStates = pgTable("presentation_states", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => eventSessions.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  screen: presentationScreen("screen").notNull().default("BOAS_VINDAS"),
  sessionQuestionId: uuid("session_question_id").references(() => sessionQuestions.id, { onDelete: "set null" }),
  leaderboardHidden: boolean("leaderboard_hidden").notNull().default(false),
  leaderboardFrozenSnapshotId: uuid("leaderboard_frozen_snapshot_id").references(() => leaderboardSnapshots.id, {
    onDelete: "set null",
  }),
  showSatisfactionToScreen: boolean("show_satisfaction_to_screen").notNull().default(false),
  /** Incrementado a cada mudança — clientes descartam eventos antigos. */
  version: integer("version").notNull().default(1),
  updatedAt: updatedAt(),
});

export const sessionEvents = pgTable(
  "session_events",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => eventSessions.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("session_events_session_idx").on(t.sessionId, t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data").notNull().default({}),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_idx").on(t.orgId, t.createdAt), index("audit_entity_idx").on(t.entityType, t.entityId)],
);

/**
 * Outbox de integrações (CRM LIDIA, webhooks). Eventos só são enfileirados quando a organização tem
 * um webhook ativo (integration_webhooks); o consumidor (server/domains/integrations.ts) entrega com
 * assinatura HMAC e novas tentativas com backoff. Status: PENDENTE → ENVIADO | FALHOU.
 */
export const integrationOutbox = pgTable(
  "integration_outbox",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("PENDENTE"),
    attempts: integer("attempts").notNull().default(0),
    /** Próxima tentativa (também funciona como reserva enquanto uma instância entrega o item). */
    nextAttemptAt: ts("next_attempt_at"),
    lastError: text("last_error"),
    /** Participante a que o evento se refere — o item é removido na anonimização. */
    participantId: uuid("participant_id").references(() => participants.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    processedAt: ts("processed_at"),
  },
  (t) => [
    index("outbox_status_idx").on(t.status, t.createdAt),
    index("outbox_org_idx").on(t.orgId, t.createdAt),
    index("outbox_participant_idx").on(t.participantId),
  ],
);

/** Webhook de integração da organização (opcional). O segredo só é exibido na criação/rotação. */
export const integrationWebhooks = pgTable("integration_webhooks", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  /** Tópicos assinados (INTEGRATION_TOPICS em server/domains/integrations.ts). */
  topics: jsonb("topics").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------- Gerenciador de Apresentações */
/**
 * Arquivos de slides (JPG/PNG). O binário fica em disco (UPLOAD_DIR), nunca no banco.
 * O mesmo conteúdo (SHA-256) é armazenado uma única vez por organização.
 */
export const presentationAssets = pgTable(
  "presentation_assets",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sha256: text("sha256").notNull(),
    originalName: text("original_name").notNull(),
    mime: text("mime").notNull(),
    ext: text("ext").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    folder: text("folder"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("presentation_assets_org_sha_uq").on(t.orgId, t.sha256), index("presentation_assets_org_idx").on(t.orgId, t.createdAt)],
);

export const presentations = pgTable(
  "presentations",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    /** Evento vinculado (necessário para itens de pergunta). */
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    /** shared/presentations presentationSettingsSchema */
    settings: jsonb("settings").notNull().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("presentations_org_idx").on(t.orgId), index("presentations_event_idx").on(t.eventId)],
);

export const presentationItems = pgTable(
  "presentation_items",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    presentationId: uuid("presentation_id").notNull().references(() => presentations.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    type: presentationItemType("type").notNull(),
    title: text("title"),
    hidden: boolean("hidden").notNull().default(false),
    /** Transição específica (nula = padrão da apresentação). */
    transition: text("transition"),
    /** shared/presentations itemSettingsSchema */
    settings: jsonb("settings").notNull().default({}),
    assetId: uuid("asset_id").references(() => presentationAssets.id, { onDelete: "restrict" }),
    /** Pergunta existente referenciada (perguntas, quizzes, enquetes e gráficos). */
    questionId: uuid("question_id").references(() => questions.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("presentation_items_pres_idx").on(t.presentationId, t.position), index("presentation_items_asset_idx").on(t.assetId)],
);

/** Notas privadas do palestrante: tabela separada, lida apenas pela rota autenticada do apresentador. */
export const presentationSpeakerNotes = pgTable("presentation_speaker_notes", {
  itemId: uuid("item_id")
    .primaryKey()
    .references(() => presentationItems.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  notes: text("notes").notNull(),
  updatedAt: updatedAt(),
});

/** Estado ao vivo da apresentação numa sessão (item atual ≠ pergunta aberta). */
export const presentationSessionStates = pgTable("presentation_session_states", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => eventSessions.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  presentationId: uuid("presentation_id").notNull().references(() => presentations.id, { onDelete: "cascade" }),
  currentItemId: uuid("current_item_id").references(() => presentationItems.id, { onDelete: "set null" }),
  currentIndex: integer("current_index").notNull().default(0),
  status: presenterStatus("status").notNull().default("PRONTA"),
  override: screenOverride("override").notNull().default("NENHUM"),
  itemEnteredAt: ts("item_entered_at"),
  startedAt: ts("started_at"),
  version: integer("version").notNull().default(1),
  updatedAt: updatedAt(),
});

export const presentationStateHistory = pgTable(
  "presentation_state_history",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => eventSessions.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    itemId: uuid("item_id"),
    index: integer("index"),
    version: integer("version").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("presentation_history_session_idx").on(t.sessionId, t.createdAt)],
);

/* ================================================================== tempo real sem processo residente */
/**
 * Coordenação do "tick" no modo serverless (Vercel + Supabase Realtime): telão e painel chamam o tick a cada
 * segundo; a atualização condicional de `at` garante que só uma chamada por janela faça o trabalho
 * (fechar perguntas pelo tempo, avançar slides, publicar resultados/ranking agregados).
 * `sent` guarda a assinatura do último envio de cada tipo, para não repetir mensagens iguais.
 */
export const realtimeTicks = pgTable("realtime_ticks", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => eventSessions.id, { onDelete: "cascade" }),
  at: timestamp("at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  sent: jsonb("sent").$type<Record<string, string | number>>().notNull().default({}),
});
