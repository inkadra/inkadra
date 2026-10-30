ALTER TABLE "board_grant" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "board_grant" ADD COLUMN "expiry_warned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "access_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "subject_user_id" uuid;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "access_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_member" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_member" ADD COLUMN "expiry_warned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "can_create_projects" boolean;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_subject_user_id_user_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_grant_expires_idx" ON "board_grant" USING btree ("expires_at") WHERE "board_grant"."expires_at" is not null;--> statement-breakpoint
CREATE INDEX "notification_subject_idx" ON "notification" USING btree ("subject_user_id") WHERE "notification"."subject_user_id" is not null;--> statement-breakpoint
CREATE INDEX "project_member_expires_idx" ON "project_member" USING btree ("expires_at") WHERE "project_member"."expires_at" is not null;--> statement-breakpoint
ALTER TABLE "board_grant" ADD CONSTRAINT "board_grant_owner_no_expiry" CHECK ("board_grant"."role" <> 'owner' or "board_grant"."expires_at" is null);--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_owner_no_expiry" CHECK ("project_member"."role" <> 'owner' or "project_member"."expires_at" is null);