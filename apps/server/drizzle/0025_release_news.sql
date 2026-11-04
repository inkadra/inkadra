CREATE TABLE "release_announcement" (
	"version" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "release_delivery" (
	"version" text NOT NULL,
	"user_id" uuid NOT NULL,
	"attempted_at" timestamp with time zone,
	CONSTRAINT "release_delivery_version_user_id_pk" PRIMARY KEY("version","user_id")
);
--> statement-breakpoint
ALTER TABLE "release_delivery" ADD CONSTRAINT "release_delivery_version_release_announcement_version_fk" FOREIGN KEY ("version") REFERENCES "public"."release_announcement"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_delivery" ADD CONSTRAINT "release_delivery_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;