CREATE TABLE "integration_webhooks" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD COLUMN "participant_id" uuid;--> statement-breakpoint
ALTER TABLE "integration_webhooks" ADD CONSTRAINT "integration_webhooks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD CONSTRAINT "integration_outbox_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_org_idx" ON "integration_outbox" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_participant_idx" ON "integration_outbox" USING btree ("participant_id");