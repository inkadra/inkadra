ALTER TABLE "board" ALTER COLUMN "position" SET DATA TYPE text COLLATE "C";--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "position" SET DATA TYPE text COLLATE "C";--> statement-breakpoint
ALTER TABLE "project_group" ALTER COLUMN "position" SET DATA TYPE text COLLATE "C";--> statement-breakpoint
ALTER TABLE "project_group_item" ALTER COLUMN "position" SET DATA TYPE text COLLATE "C";