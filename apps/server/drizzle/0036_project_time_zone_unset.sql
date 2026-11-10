ALTER TABLE "project" ALTER COLUMN "time_zone" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "time_zone" DROP NOT NULL;--> statement-breakpoint
UPDATE "project" SET "time_zone" = NULL WHERE "time_zone" = 'UTC';
