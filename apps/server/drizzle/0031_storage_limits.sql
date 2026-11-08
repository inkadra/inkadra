ALTER TABLE "user" ADD COLUMN "storage_limit" bigint;--> statement-breakpoint
CREATE INDEX "asset_created_by_idx" ON "asset" USING btree ("created_by");