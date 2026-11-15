CREATE TABLE "load_test_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preset" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"scheduled_for" timestamp with time zone,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"stop_requested_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"progress" jsonb,
	"report" jsonb,
	"test_user_id" uuid,
	"test_project_id" uuid,
	"cleaned_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "load_test_run" ADD CONSTRAINT "load_test_run_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "load_test_run_created_idx" ON "load_test_run" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "load_test_run_active_uq" ON "load_test_run" USING btree ((true)) WHERE "load_test_run"."status" in ('scheduled', 'running');