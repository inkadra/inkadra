ALTER TABLE "board_doc" ADD COLUMN "counts" jsonb;--> statement-breakpoint
CREATE INDEX "notification_board_idx" ON "notification" USING btree ("board_id") WHERE "notification"."board_id" is not null;--> statement-breakpoint
CREATE INDEX "notification_project_idx" ON "notification" USING btree ("project_id") WHERE "notification"."project_id" is not null;