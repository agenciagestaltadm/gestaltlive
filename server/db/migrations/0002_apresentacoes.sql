CREATE TYPE "public"."presentation_item_type" AS ENUM('IMAGE_SLIDE', 'QUESTION', 'POLL', 'QUIZ', 'CHART', 'LEADERBOARD', 'SATISFACTION', 'QR_CODE', 'AWARDS', 'CUSTOM_SCREEN');--> statement-breakpoint
CREATE TYPE "public"."presenter_status" AS ENUM('PRONTA', 'APRESENTANDO', 'ENCERRADA');--> statement-breakpoint
CREATE TYPE "public"."screen_override" AS ENUM('NENHUM', 'TELA_PRETA', 'PAUSA');--> statement-breakpoint
ALTER TYPE "public"."presentation_screen" ADD VALUE 'SLIDE';--> statement-breakpoint
ALTER TYPE "public"."presentation_screen" ADD VALUE 'TELA_PERSONALIZADA';--> statement-breakpoint
CREATE TABLE "presentation_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"ext" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"folder" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presentation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"presentation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" "presentation_item_type" NOT NULL,
	"title" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"transition" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"asset_id" uuid,
	"question_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presentation_session_states" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"presentation_id" uuid NOT NULL,
	"current_item_id" uuid,
	"current_index" integer DEFAULT 0 NOT NULL,
	"status" "presenter_status" DEFAULT 'PRONTA' NOT NULL,
	"override" "screen_override" DEFAULT 'NENHUM' NOT NULL,
	"item_entered_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presentation_speaker_notes" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"notes" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presentation_state_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"action" text NOT NULL,
	"item_id" uuid,
	"index" integer,
	"version" integer NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presentations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"event_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_sessions" ADD COLUMN "presentation_id" uuid;--> statement-breakpoint
ALTER TABLE "session_questions" ADD COLUMN "auto_close" boolean;--> statement-breakpoint
ALTER TABLE "presentation_assets" ADD CONSTRAINT "presentation_assets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_assets" ADD CONSTRAINT "presentation_assets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_items" ADD CONSTRAINT "presentation_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_items" ADD CONSTRAINT "presentation_items_presentation_id_presentations_id_fk" FOREIGN KEY ("presentation_id") REFERENCES "public"."presentations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_items" ADD CONSTRAINT "presentation_items_asset_id_presentation_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."presentation_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_items" ADD CONSTRAINT "presentation_items_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_session_states" ADD CONSTRAINT "presentation_session_states_session_id_event_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_session_states" ADD CONSTRAINT "presentation_session_states_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_session_states" ADD CONSTRAINT "presentation_session_states_presentation_id_presentations_id_fk" FOREIGN KEY ("presentation_id") REFERENCES "public"."presentations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_session_states" ADD CONSTRAINT "presentation_session_states_current_item_id_presentation_items_id_fk" FOREIGN KEY ("current_item_id") REFERENCES "public"."presentation_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_speaker_notes" ADD CONSTRAINT "presentation_speaker_notes_item_id_presentation_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."presentation_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_speaker_notes" ADD CONSTRAINT "presentation_speaker_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_state_history" ADD CONSTRAINT "presentation_state_history_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_state_history" ADD CONSTRAINT "presentation_state_history_session_id_event_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_state_history" ADD CONSTRAINT "presentation_state_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentations" ADD CONSTRAINT "presentations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentations" ADD CONSTRAINT "presentations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentations" ADD CONSTRAINT "presentations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "presentation_assets_org_sha_uq" ON "presentation_assets" USING btree ("org_id","sha256");--> statement-breakpoint
CREATE INDEX "presentation_assets_org_idx" ON "presentation_assets" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "presentation_items_pres_idx" ON "presentation_items" USING btree ("presentation_id","position");--> statement-breakpoint
CREATE INDEX "presentation_items_asset_idx" ON "presentation_items" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "presentation_history_session_idx" ON "presentation_state_history" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "presentations_org_idx" ON "presentations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "presentations_event_idx" ON "presentations" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "event_sessions" ADD CONSTRAINT "event_sessions_presentation_id_presentations_id_fk" FOREIGN KEY ("presentation_id") REFERENCES "public"."presentations"("id") ON DELETE set null ON UPDATE no action;