CREATE TYPE "public"."answer_status" AS ENUM('ACCEPTED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."award_status" AS ENUM('PENDENTE', 'ENTREGUE', 'REVOGADO');--> statement-breakpoint
CREATE TYPE "public"."consent_purpose" AS ENUM('PARTICIPACAO', 'MARKETING');--> statement-breakpoint
CREATE TYPE "public"."custom_field_type" AS ENUM('TEXTO', 'TEXTO_LONGO', 'SELECAO', 'NUMERO', 'EMAIL', 'TELEFONE');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('ORG_ADMIN', 'SPEAKER');--> statement-breakpoint
CREATE TYPE "public"."presentation_screen" AS ENUM('BOAS_VINDAS', 'PERGUNTA', 'RESULTADO', 'RANKING', 'SATISFACAO', 'PREMIACAO', 'ENCERRAMENTO');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('RASCUNHO', 'PRONTA');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('PERFIL', 'OPINIAO', 'CONHECIMENTO', 'MULTIPLA_CORRETA', 'SIM_NAO', 'ESCALA', 'NPS');--> statement-breakpoint
CREATE TYPE "public"."results_mode" AS ENUM('AO_VIVO', 'APOS_ENCERRAMENTO', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."satisfaction_value" AS ENUM('POSITIVO', 'NEGATIVO');--> statement-breakpoint
CREATE TYPE "public"."score_kind" AS ENUM('ANSWER', 'REVERSAL', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."session_question_state" AS ENUM('PRONTA', 'ABERTA', 'FECHADA', 'RESULTADO_EXIBIDO');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('RASCUNHO', 'AGENDADA', 'AGUARDANDO', 'AO_VIVO', 'PAUSADA', 'ENCERRADA', 'CANCELADA');--> statement-breakpoint
CREATE TYPE "public"."snapshot_kind" AS ENUM('PUBLICACAO', 'CONGELADO', 'FINAL');--> statement-breakpoint
CREATE TABLE "answer_option_selections" (
	"answer_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	CONSTRAINT "answer_option_selections_answer_id_option_id_pk" PRIMARY KEY("answer_id","option_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"session_participant_id" uuid,
	"purpose" "consent_purpose" NOT NULL,
	"granted" boolean NOT NULL,
	"text_version" text NOT NULL,
	"text_snapshot" text NOT NULL,
	"source" text DEFAULT 'CADASTRO' NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disqualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"session_participant_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"reverted_at" timestamp with time zone,
	"reverted_by_user_id" uuid,
	"revert_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_prizes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"estimated_value_cents" integer,
	"eligibility" text,
	"pickup_info" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"status" "session_status" DEFAULT 'RASCUNHO' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"screen_token_nonce" text NOT NULL,
	"registration" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_sessions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone,
	"location" text,
	"speaker_user_id" uuid,
	"speaker_name" text,
	"logo_url" text,
	"welcome_message" text,
	"closing_message" text,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"registration" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"template_id" uuid,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDENTE' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leaderboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" "snapshot_kind" NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"session_question_id" uuid,
	"entries" jsonb NOT NULL,
	"reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"brand" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"plan" text DEFAULT 'PADRAO' NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retention_days" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "participant_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"session_question_id" uuid NOT NULL,
	"session_participant_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "answer_status" DEFAULT 'ACCEPTED' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"numeric_value" double precision,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response_time_ms" integer NOT NULL,
	"is_correct" boolean,
	"points" integer,
	"speed_bonus" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participant_custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" "custom_field_type" DEFAULT 'TEXTO' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participant_custom_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_participant_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"email_norm" text,
	"phone" text,
	"phone_norm" text,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presentation_states" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"screen" "presentation_screen" DEFAULT 'BOAS_VINDAS' NOT NULL,
	"session_question_id" uuid,
	"leaderboard_hidden" boolean DEFAULT false NOT NULL,
	"leaderboard_frozen_snapshot_id" uuid,
	"show_satisfaction_to_screen" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prize_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"prize_id" uuid,
	"rank" integer NOT NULL,
	"session_participant_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"prize_snapshot" jsonb,
	"status" "award_status" DEFAULT 'PENDENTE' NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"delivered_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "question_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"image_url" text,
	"is_correct" boolean DEFAULT false NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"event_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"type" "question_type" NOT NULL,
	"status" "question_status" DEFAULT 'RASCUNHO' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"image_url" text,
	"category" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"min_selections" integer DEFAULT 1 NOT NULL,
	"max_selections" integer DEFAULT 1 NOT NULL,
	"scale_min" integer,
	"scale_max" integer,
	"scale_min_label" text,
	"scale_max_label" text,
	"time_limit_sec" integer,
	"allow_edit" boolean DEFAULT false NOT NULL,
	"scoring" jsonb,
	"chart" jsonb NOT NULL,
	"results_mode" "results_mode" DEFAULT 'MANUAL' NOT NULL,
	"explanation" text,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "satisfaction_vote_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"session_participant_id" uuid NOT NULL,
	"value" "satisfaction_value" NOT NULL,
	"previous_value" "satisfaction_value",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "satisfaction_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"session_participant_id" uuid NOT NULL,
	"value" "satisfaction_value" NOT NULL,
	"changes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"session_participant_id" uuid NOT NULL,
	"session_question_id" uuid,
	"answer_id" uuid,
	"kind" "score_kind" NOT NULL,
	"points" integer NOT NULL,
	"correct_delta" integer DEFAULT 0 NOT NULL,
	"answered_delta" integer DEFAULT 0 NOT NULL,
	"correct_time_ms_delta" bigint DEFAULT 0 NOT NULL,
	"reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"token_hash" text NOT NULL,
	"unique_email" text,
	"unique_phone" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"score" integer DEFAULT 0 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"answered_count" integer DEFAULT 0 NOT NULL,
	"correct_time_ms" bigint DEFAULT 0 NOT NULL,
	"disqualified_at" timestamp with time zone,
	"recovery_code_hash" text,
	"recovery_code_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_participants_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "session_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"state" "session_question_state" DEFAULT 'PRONTA' NOT NULL,
	"results_mode" "results_mode" NOT NULL,
	"time_limit_ms" integer,
	"timer_accumulated_ms" integer DEFAULT 0 NOT NULL,
	"timer_running_since" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"results_shown_at" timestamp with time zone,
	"correct_revealed_at" timestamp with time zone,
	"scored_at" timestamp with time zone,
	"scores_published_at" timestamp with time zone,
	"open_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"content" jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_superadmin" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "answer_option_selections" ADD CONSTRAINT "answer_option_selections_answer_id_participant_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."participant_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_option_selections" ADD CONSTRAINT "answer_option_selections_option_id_question_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."question_options"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_session_participant_id_session_participants_id_fk" FOREIGN KEY ("session_participant_id") REFERENCES "public"."session_participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disqualifications" ADD CONSTRAINT "disqualifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disqualifications" ADD CONSTRAINT "disqualifications_session_id_event_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disqualifications" ADD CONSTRAINT "disqualifications_session_participant_id_session_participants_id_fk" FOREIGN KEY ("session_participant_id") REFERENCES "public"."session_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disqualifications" ADD CONSTRAINT "disqualifications_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disqualifications" ADD CONSTRAINT "disqualifications_reverted_by_user_id_users_id_fk" FOREIGN KEY ("reverted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_prizes" ADD CONSTRAINT "event_prizes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_prizes" ADD CONSTRAINT "event_prizes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sessions" ADD CONSTRAINT "event_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sessions" ADD CONSTRAINT "event_sessions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sessions" ADD CONSTRAINT "event_sessions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_speaker_user_id_users_id_fk" FOREIGN KEY ("speaker_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_template_id_training_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."training_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD CONSTRAINT "integration_outbox_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_session_id_event_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_session_question_id_session_questions_id_fk" FOREIGN KEY ("session_question_id") REFERENCES "public"."session_questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_answers" ADD CONSTRAINT "participant_answers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_answers" ADD CONSTRAINT "participant_answers_session_id_event_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_answers" ADD CONSTRAINT "participant_answers_session_question_id_session_questions_id_fk" FOREIGN KEY ("session_question_id") REFERENCES "public"."session_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_answers" ADD CONSTRAINT "participant_answers_session_participant_id_session_participants_id_fk" FOREIGN KEY ("session_participant_id") REFERENCES "public"."session_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_custom_fields" ADD CONSTRAINT "participant_custom_fields_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_custom_fields" ADD CONSTRAINT "participant_custom_fields_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_custom_values" ADD CONSTRAINT "participant_custom_values_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_custom_values" ADD CONSTRAINT "participant_custom_values_session_participant_id_session_participants_id_fk" FOREIGN KEY ("session_participant_id") REFERENCES "public"."session_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_custom_values" ADD CONSTRAINT "participant_custom_values_field_id_participant_custom_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."participant_custom_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_states" ADD CONSTRAINT "presentation_states_session_id_event_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_states" ADD CONSTRAINT "presentation_states_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_states" ADD CONSTRAINT "presentation_states_session_question_id_session_questions_id_fk" FOREIGN KEY ("session_question_id") REFERENCES "public"."session_questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_states" ADD CONSTRAINT "presentation_states_leaderboard_frozen_snapshot_id_leaderboard_snapshots_id_fk" FOREIGN KEY ("leaderboard_frozen_snapshot_id") REFERENCES "public"."leaderboard_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_awards" ADD CONSTRAINT "prize_awards_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_awards" ADD CONSTRAINT "prize_awards_session_id_event_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_awards" ADD CONSTRAINT "prize_awards_prize_id_event_prizes_id_fk" FOREIGN KEY ("prize_id") REFERENCES "public"."event_prizes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_awards" ADD CONSTRAINT "prize_awards_session_participant_id_session_participants_id_fk" FOREIGN KEY ("session_participant_id") REFERENCES "public"."session_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_awards" ADD CONSTRAINT "prize_awards_snapshot_id_leaderboard_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."leaderboard_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_awards" ADD CONSTRAINT "prize_awards_delivered_by_user_id_users_id_fk" FOREIGN KEY ("delivered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satisfaction_vote_history" ADD CONSTRAINT "satisfaction_vote_history_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satisfaction_vote_history" ADD CONSTRAINT "satisfaction_vote_history_session_id_event_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satisfaction_vote_history" ADD CONSTRAINT "satisfaction_vote_history_session_participant_id_session_participants_id_fk" FOREIGN KEY ("session_participant_id") REFERENCES "public"."session_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satisfaction_votes" ADD CONSTRAINT "satisfaction_votes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satisfaction_votes" ADD CONSTRAINT "satisfaction_votes_session_id_event_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satisfaction_votes" ADD CONSTRAINT "satisfaction_votes_session_participant_id_session_participants_id_fk" FOREIGN KEY ("session_participant_id") REFERENCES "public"."session_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_transactions" ADD CONSTRAINT "score_transactions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_transactions" ADD CONSTRAINT "score_transactions_session_id_event_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_transactions" ADD CONSTRAINT "score_transactions_session_participant_id_session_participants_id_fk" FOREIGN KEY ("session_participant_id") REFERENCES "public"."session_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_transactions" ADD CONSTRAINT "score_transactions_session_question_id_session_questions_id_fk" FOREIGN KEY ("session_question_id") REFERENCES "public"."session_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_transactions" ADD CONSTRAINT "score_transactions_answer_id_participant_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."participant_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_transactions" ADD CONSTRAINT "score_transactions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_event_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_session_id_event_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_questions" ADD CONSTRAINT "session_questions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_questions" ADD CONSTRAINT "session_questions_session_id_event_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_questions" ADD CONSTRAINT "session_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_questions" ADD CONSTRAINT "session_questions_version_id_question_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."question_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_templates" ADD CONSTRAINT "training_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_templates" ADD CONSTRAINT "training_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aos_option_idx" ON "answer_option_selections" USING btree ("option_id");--> statement-breakpoint
CREATE INDEX "audit_org_idx" ON "audit_logs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "consent_participant_idx" ON "consent_records" USING btree ("participant_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "disq_session_idx" ON "disqualifications" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_prizes_event_rank_uq" ON "event_prizes" USING btree ("event_id","rank");--> statement-breakpoint
CREATE INDEX "sessions_org_idx" ON "event_sessions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sessions_event_idx" ON "event_sessions" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "events_org_idx" ON "events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "events_speaker_idx" ON "events" USING btree ("speaker_user_id");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "integration_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "lb_snap_session_idx" ON "leaderboard_snapshots" USING btree ("session_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_org_user_uq" ON "organization_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "org_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "answers_one_accepted_uq" ON "participant_answers" USING btree ("session_question_id","session_participant_id") WHERE "participant_answers"."status" = 'ACCEPTED';--> statement-breakpoint
CREATE UNIQUE INDEX "answers_idempotency_uq" ON "participant_answers" USING btree ("session_participant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "answers_sq_idx" ON "participant_answers" USING btree ("session_question_id","status");--> statement-breakpoint
CREATE INDEX "answers_session_idx" ON "participant_answers" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pcf_event_key_uq" ON "participant_custom_fields" USING btree ("event_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "pcv_sp_field_uq" ON "participant_custom_values" USING btree ("session_participant_id","field_id");--> statement-breakpoint
CREATE INDEX "pcv_field_idx" ON "participant_custom_values" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "participants_org_idx" ON "participants" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "participants_email_idx" ON "participants" USING btree ("org_id","email_norm");--> statement-breakpoint
CREATE INDEX "participants_phone_idx" ON "participants" USING btree ("org_id","phone_norm");--> statement-breakpoint
CREATE INDEX "prize_awards_session_idx" ON "prize_awards" USING btree ("session_id","rank");--> statement-breakpoint
CREATE INDEX "question_options_q_idx" ON "question_options" USING btree ("question_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "question_versions_q_v_uq" ON "question_versions" USING btree ("question_id","version");--> statement-breakpoint
CREATE INDEX "questions_org_idx" ON "questions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "questions_event_idx" ON "questions" USING btree ("event_id","position");--> statement-breakpoint
CREATE INDEX "satisfaction_hist_session_idx" ON "satisfaction_vote_history" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "satisfaction_sp_uq" ON "satisfaction_votes" USING btree ("session_participant_id");--> statement-breakpoint
CREATE INDEX "satisfaction_session_idx" ON "satisfaction_votes" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "score_tx_answer_kind_uq" ON "score_transactions" USING btree ("answer_id","kind") WHERE "score_transactions"."answer_id" is not null;--> statement-breakpoint
CREATE INDEX "score_tx_session_sp_idx" ON "score_transactions" USING btree ("session_id","session_participant_id");--> statement-breakpoint
CREATE INDEX "session_events_session_idx" ON "session_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "sp_session_idx" ON "session_participants" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "sp_participant_idx" ON "session_participants" USING btree ("participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sp_session_unique_email_uq" ON "session_participants" USING btree ("session_id","unique_email") WHERE "session_participants"."unique_email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sp_session_unique_phone_uq" ON "session_participants" USING btree ("session_id","unique_phone") WHERE "session_participants"."unique_phone" is not null;--> statement-breakpoint
CREATE INDEX "sp_ranking_idx" ON "session_participants" USING btree ("session_id","score","correct_count","correct_time_ms");--> statement-breakpoint
CREATE INDEX "sq_session_idx" ON "session_questions" USING btree ("session_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "sq_session_question_uq" ON "session_questions" USING btree ("session_id","question_id");--> statement-breakpoint
CREATE INDEX "templates_org_idx" ON "training_templates" USING btree ("org_id");