ALTER TABLE "personal_token" ADD COLUMN "scope" text DEFAULT 'full' NOT NULL;--> statement-breakpoint
-- lock-ok: one row per token, a small table. Only the Clipper's exchange sets client 'clipper' (decision 0137).
UPDATE "personal_token" SET "scope" = 'clip' WHERE "client" = 'clipper';
