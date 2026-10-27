CREATE TABLE "project_pin" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "project_pin_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "type" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "shooting_start" date;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "shooting_end" date;--> statement-breakpoint
ALTER TABLE "project_pin" ADD CONSTRAINT "project_pin_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_pin" ADD CONSTRAINT "project_pin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_pin" ADD CONSTRAINT "project_pin_project_id_user_id_project_member_project_id_user_id_fk" FOREIGN KEY ("project_id","user_id") REFERENCES "public"."project_member"("project_id","user_id") ON DELETE cascade ON UPDATE no action;