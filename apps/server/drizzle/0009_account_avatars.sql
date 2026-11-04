CREATE TABLE "user_avatar" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"version" uuid NOT NULL,
	"image" "bytea" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_avatar" ADD CONSTRAINT "user_avatar_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;