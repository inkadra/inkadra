ALTER TABLE "asset" ADD COLUMN "video_codec" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "audio_codec" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "frame_rate" real;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "proxy_status" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "proxy_progress" integer;--> statement-breakpoint
ALTER TABLE "asset_variant" ADD COLUMN "mime" text;--> statement-breakpoint
ALTER TABLE "asset_variant" ADD COLUMN "bytes" bigint;