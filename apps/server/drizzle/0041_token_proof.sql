ALTER TABLE "personal_token" ADD COLUMN "proof_key_id" text;--> statement-breakpoint
ALTER TABLE "personal_token" ADD COLUMN "proof_key" text;--> statement-breakpoint
ALTER TABLE "personal_token" ADD CONSTRAINT "personal_token_proof_key_id_unique" UNIQUE("proof_key_id");