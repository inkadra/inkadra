CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_name" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"project_id" uuid,
	"ip" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_backup" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instance_backup" ADD COLUMN "missing_files" integer;--> statement-breakpoint
ALTER TABLE "instance_backup" ADD COLUMN "checked_files" integer;--> statement-breakpoint
ALTER TABLE "instance_backup" ADD COLUMN "unverified_files" integer;--> statement-breakpoint
ALTER TABLE "instance_backup" ADD COLUMN "verify_complete" boolean;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "email_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "email_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "email_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_at_idx" ON "audit_event" USING btree ("at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_event_action_idx" ON "audit_event" USING btree ("action","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_event_actor_idx" ON "audit_event" USING btree ("actor_id") WHERE "audit_event"."actor_id" is not null;