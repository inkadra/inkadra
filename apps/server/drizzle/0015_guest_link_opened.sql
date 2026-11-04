CREATE TABLE "share_link_open" (
	"share_link_id" uuid NOT NULL,
	"version_key" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_link_open_share_link_id_version_key_pk" PRIMARY KEY("share_link_id","version_key")
);
--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "share_link_id" uuid;--> statement-breakpoint
ALTER TABLE "share_link_open" ADD CONSTRAINT "share_link_open_share_link_id_share_link_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_share_link_id_share_link_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_share_link_idx" ON "notification" USING btree ("share_link_id") WHERE "notification"."share_link_id" is not null;