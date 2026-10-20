CREATE TYPE "public"."word_cloud_entry_status" AS ENUM('APROVADA', 'PENDENTE', 'REJEITADA');--> statement-breakpoint
CREATE TYPE "public"."word_cloud_term_action" AS ENUM('OCULTO', 'BLOQUEADO');--> statement-breakpoint
ALTER TYPE "public"."question_type" ADD VALUE 'NUVEM_PALAVRAS';--> statement-breakpoint
CREATE TABLE "word_cloud_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"session_question_id" uuid NOT NULL,
	"session_participant_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"original" text NOT NULL,
	"normalized" text NOT NULL,
	"terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "word_cloud_entry_status" DEFAULT 'APROVADA' NOT NULL,
	"reason" text,
	"moderated_by_user_id" uuid,
	"moderated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_cloud_term_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_question_id" uuid NOT NULL,
	"term_key" text NOT NULL,
	"label" text NOT NULL,
	"action" "word_cloud_term_action" NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "word_cloud" jsonb;--> statement-breakpoint
ALTER TABLE "word_cloud_entries" ADD CONSTRAINT "word_cloud_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_cloud_entries" ADD CONSTRAINT "word_cloud_entries_session_id_event_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_cloud_entries" ADD CONSTRAINT "word_cloud_entries_session_question_id_session_questions_id_fk" FOREIGN KEY ("session_question_id") REFERENCES "public"."session_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_cloud_entries" ADD CONSTRAINT "word_cloud_entries_session_participant_id_session_participants_id_fk" FOREIGN KEY ("session_participant_id") REFERENCES "public"."session_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_cloud_entries" ADD CONSTRAINT "word_cloud_entries_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_cloud_term_rules" ADD CONSTRAINT "word_cloud_term_rules_session_question_id_session_questions_id_fk" FOREIGN KEY ("session_question_id") REFERENCES "public"."session_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_cloud_term_rules" ADD CONSTRAINT "word_cloud_term_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "word_cloud_idempotency_uq" ON "word_cloud_entries" USING btree ("session_participant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "word_cloud_sq_status_idx" ON "word_cloud_entries" USING btree ("session_question_id","status");--> statement-breakpoint
CREATE INDEX "word_cloud_sp_idx" ON "word_cloud_entries" USING btree ("session_participant_id","session_question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "word_cloud_rule_uq" ON "word_cloud_term_rules" USING btree ("session_question_id","term_key");