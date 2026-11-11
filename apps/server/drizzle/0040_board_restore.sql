CREATE TABLE "board_restore" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"count" integer NOT NULL,
	"restored_by" uuid,
	"version_id" uuid NOT NULL,
	"version_kind" text NOT NULL,
	"version_name" text,
	"version_created_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_restore" ADD CONSTRAINT "board_restore_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_restore" ADD CONSTRAINT "board_restore_restored_by_user_id_fk" FOREIGN KEY ("restored_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_restore_count_idx" ON "board_restore" USING btree ("board_id","count");--> statement-breakpoint
CREATE INDEX "board_restore_by_idx" ON "board_restore" USING btree ("restored_by") WHERE "board_restore"."restored_by" is not null;