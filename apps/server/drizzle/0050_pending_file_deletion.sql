CREATE TABLE "pending_file_deletion" (
	"key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pending_file_deletion_created_idx" ON "pending_file_deletion" USING btree ("created_at");