ALTER TABLE "project_member" ADD COLUMN "position" text COLLATE "C";--> statement-breakpoint
-- lock-ok: one row per person and project, a small table; every list keeps today's order (decision 0134).
UPDATE "project_member" SET "position" = "project"."position" FROM "project" WHERE "project"."id" = "project_member"."project_id";
