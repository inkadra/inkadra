CREATE TABLE "creation_request" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creation_request" ADD CONSTRAINT "creation_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creation_request_expiry_idx" ON "creation_request" USING btree ("expires_at");