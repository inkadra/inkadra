ALTER TABLE "shooting_day" ADD COLUMN "moved_from" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "board_production_uq" ON "board" USING btree ("project_id") WHERE "board"."kind" = 'production';