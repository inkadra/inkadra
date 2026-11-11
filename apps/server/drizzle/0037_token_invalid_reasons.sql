DROP TABLE "creation_request" CASCADE;--> statement-breakpoint
ALTER TABLE "personal_token" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "personal_token" ADD COLUMN "revocation_reason" text;