CREATE TABLE "project_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"position" text NOT NULL,
	"collapsed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_group_id_user_key" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_group_item" (
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"position" text NOT NULL,
	CONSTRAINT "project_group_item_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "project_group" ADD CONSTRAINT "project_group_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group_item" ADD CONSTRAINT "project_group_item_member_fk" FOREIGN KEY ("project_id","user_id") REFERENCES "public"."project_member"("project_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group_item" ADD CONSTRAINT "project_group_item_group_fk" FOREIGN KEY ("group_id","user_id") REFERENCES "public"."project_group"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_group_user_idx" ON "project_group" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_group_item_group_idx" ON "project_group_item" USING btree ("group_id");