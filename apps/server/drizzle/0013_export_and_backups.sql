CREATE TABLE "instance_backup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"file_name" text,
	"size" bigint,
	"copied_to_bucket" boolean DEFAULT false NOT NULL,
	"file_count" integer,
	"file_bytes" bigint,
	"failure" text,
	"requested_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"project_name" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"size" bigint,
	"failure" text,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "imported_author" text;--> statement-breakpoint
ALTER TABLE "board_version" ADD COLUMN "imported_author" text;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "imported_author" text;--> statement-breakpoint
ALTER TABLE "element_review" ADD COLUMN "imported_author" text;--> statement-breakpoint
ALTER TABLE "element_review_event" ADD COLUMN "imported_author" text;--> statement-breakpoint
ALTER TABLE "instance_backup" ADD CONSTRAINT "instance_backup_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_transfer" ADD CONSTRAINT "project_transfer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_transfer" ADD CONSTRAINT "project_transfer_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instance_backup_started_idx" ON "instance_backup" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "instance_backup_running_uq" ON "instance_backup" USING btree ("status") WHERE "instance_backup"."status" = 'running';--> statement-breakpoint
CREATE INDEX "project_transfer_user_idx" ON "project_transfer" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "project_transfer_project_idx" ON "project_transfer" USING btree ("project_id") WHERE "project_transfer"."project_id" is not null;--> statement-breakpoint
CREATE INDEX "project_transfer_expires_idx" ON "project_transfer" USING btree ("expires_at") WHERE "project_transfer"."expires_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "project_transfer_one_import_uq" ON "project_transfer" USING btree ("user_id") WHERE "project_transfer"."kind" = 'import' and "project_transfer"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "project_transfer_active_idx" ON "project_transfer" USING btree ("updated_at") WHERE "project_transfer"."status" in ('queued', 'running');