CREATE TABLE "board_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"state" "bytea" NOT NULL,
	"schema_version" integer NOT NULL,
	"size" integer NOT NULL,
	"element_count" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "board_version_named_ck" CHECK ("board_version"."kind" <> 'named' or "board_version"."name" is not null)
);
--> statement-breakpoint
CREATE TABLE "comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"element_id" text,
	"thread_id" uuid,
	"author_id" uuid,
	"author_guest_id" uuid,
	"share_link_id" uuid,
	"body" text NOT NULL,
	"mentions" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"visibility" text DEFAULT 'team' NOT NULL,
	"pin" jsonb,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "comment_id_board_uq" UNIQUE("id","board_id"),
	CONSTRAINT "comment_one_author_ck" CHECK (num_nonnulls("comment"."author_id", "comment"."author_guest_id") <= 1),
	CONSTRAINT "comment_guest_link_ck" CHECK ("comment"."author_guest_id" is null or "comment"."share_link_id" is not null),
	CONSTRAINT "comment_team_no_link_ck" CHECK ("comment"."visibility" = 'everyone' or "comment"."share_link_id" is null)
);
--> statement-breakpoint
CREATE TABLE "element_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"element_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"changed_by" uuid,
	"changed_by_guest" uuid,
	"share_link_id" uuid,
	"requested_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "element_review_source_ck" CHECK (("element_review"."share_link_id" is null and "element_review"."changed_by_guest" is null) or ("element_review"."share_link_id" is not null and "element_review"."changed_by_guest" is not null and "element_review"."changed_by" is null and "element_review"."requested_by" is null))
);
--> statement-breakpoint
CREATE TABLE "element_review_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"element_id" text NOT NULL,
	"previous" text NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"user_id" uuid,
	"guest_id" uuid,
	"share_link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "element_review_event_source_ck" CHECK (("element_review_event"."share_link_id" is null and "element_review_event"."guest_id" is null) or ("element_review_event"."share_link_id" is not null and "element_review_event"."guest_id" is not null and "element_review_event"."user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid,
	"actor_guest_id" uuid,
	"project_id" uuid,
	"board_id" uuid,
	"element_id" text,
	"comment_id" uuid,
	"review_status" text,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text DEFAULT 'immediate' NOT NULL,
	"last_digest_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_guest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_link_id" uuid NOT NULL,
	"name" text,
	"token_hash" text,
	"authenticated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_guest_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "share_guest_id_link_uq" UNIQUE("id","share_link_id")
);
--> statement-breakpoint
CREATE TABLE "share_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"role" text NOT NULL,
	"include_sub_boards" boolean DEFAULT true NOT NULL,
	"label" text,
	"token_hash" text NOT NULL,
	"token_sealed" text NOT NULL,
	"password_hash" text,
	"sessions_valid_after" timestamp with time zone DEFAULT now() NOT NULL,
	"allow_download" boolean DEFAULT false NOT NULL,
	"proofing" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_link_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "share_pick" (
	"guest_id" uuid NOT NULL,
	"share_link_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"element_id" text NOT NULL,
	"asset_id" uuid,
	"pick" text,
	"stars" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_pick_guest_id_board_id_element_id_pk" PRIMARY KEY("guest_id","board_id","element_id"),
	CONSTRAINT "share_pick_stars_ck" CHECK ("share_pick"."stars" between 1 and 5),
	CONSTRAINT "share_pick_value_ck" CHECK ("share_pick"."pick" is not null or "share_pick"."stars" is not null)
);
--> statement-breakpoint
ALTER TABLE "board_version" ADD CONSTRAINT "board_version_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_version" ADD CONSTRAINT "board_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_share_link_id_share_link_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_thread_id_board_id_comment_id_board_id_fk" FOREIGN KEY ("thread_id","board_id") REFERENCES "public"."comment"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_guest_fk" FOREIGN KEY ("author_guest_id","share_link_id") REFERENCES "public"."share_guest"("id","share_link_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_review" ADD CONSTRAINT "element_review_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_review" ADD CONSTRAINT "element_review_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_review" ADD CONSTRAINT "element_review_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_review" ADD CONSTRAINT "element_review_share_link_id_share_link_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_review" ADD CONSTRAINT "element_review_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_review" ADD CONSTRAINT "element_review_guest_fk" FOREIGN KEY ("changed_by_guest","share_link_id") REFERENCES "public"."share_guest"("id","share_link_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_review_event" ADD CONSTRAINT "element_review_event_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_review_event" ADD CONSTRAINT "element_review_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_review_event" ADD CONSTRAINT "element_review_event_share_link_id_share_link_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_review_event" ADD CONSTRAINT "element_review_event_guest_fk" FOREIGN KEY ("guest_id","share_link_id") REFERENCES "public"."share_guest"("id","share_link_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_guest_id_share_guest_id_fk" FOREIGN KEY ("actor_guest_id") REFERENCES "public"."share_guest"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_guest" ADD CONSTRAINT "share_guest_share_link_id_share_link_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_pick" ADD CONSTRAINT "share_pick_share_link_id_share_link_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_pick" ADD CONSTRAINT "share_pick_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_pick" ADD CONSTRAINT "share_pick_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_pick" ADD CONSTRAINT "share_pick_guest_fk" FOREIGN KEY ("guest_id","share_link_id") REFERENCES "public"."share_guest"("id","share_link_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_version_board_idx" ON "board_version" USING btree ("board_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "board_version_expires_idx" ON "board_version" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "board_version_created_by_idx" ON "board_version" USING btree ("created_by") WHERE "board_version"."created_by" is not null;--> statement-breakpoint
CREATE INDEX "comment_board_element_idx" ON "comment" USING btree ("board_id","element_id");--> statement-breakpoint
CREATE INDEX "comment_threads_idx" ON "comment" USING btree ("board_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "comment"."thread_id" is null;--> statement-breakpoint
CREATE INDEX "comment_replies_idx" ON "comment" USING btree ("thread_id","created_at","id") WHERE "comment"."thread_id" is not null;--> statement-breakpoint
CREATE INDEX "comment_share_link_idx" ON "comment" USING btree ("share_link_id") WHERE "comment"."share_link_id" is not null;--> statement-breakpoint
CREATE INDEX "comment_author_idx" ON "comment" USING btree ("author_id") WHERE "comment"."author_id" is not null;--> statement-breakpoint
CREATE INDEX "comment_resolved_by_idx" ON "comment" USING btree ("resolved_by") WHERE "comment"."resolved_by" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "element_review_team_uq" ON "element_review" USING btree ("board_id","element_id") WHERE "element_review"."share_link_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "element_review_link_uq" ON "element_review" USING btree ("board_id","element_id","share_link_id") WHERE "element_review"."share_link_id" is not null;--> statement-breakpoint
CREATE INDEX "element_review_share_link_idx" ON "element_review" USING btree ("share_link_id") WHERE "element_review"."share_link_id" is not null;--> statement-breakpoint
CREATE INDEX "element_review_changed_by_idx" ON "element_review" USING btree ("changed_by") WHERE "element_review"."changed_by" is not null;--> statement-breakpoint
CREATE INDEX "element_review_requested_by_idx" ON "element_review" USING btree ("requested_by") WHERE "element_review"."requested_by" is not null;--> statement-breakpoint
CREATE INDEX "element_review_event_element_idx" ON "element_review_event" USING btree ("board_id","element_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "element_review_event_share_link_idx" ON "element_review_event" USING btree ("share_link_id") WHERE "element_review_event"."share_link_id" is not null;--> statement-breakpoint
CREATE INDEX "element_review_event_user_idx" ON "element_review_event" USING btree ("user_id") WHERE "element_review_event"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "notification" USING btree ("user_id") WHERE "notification"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notification_email_idx" ON "notification" USING btree ("created_at") WHERE "notification"."emailed_at" is null and "notification"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notification_created_idx" ON "notification" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_actor_idx" ON "notification" USING btree ("actor_id") WHERE "notification"."actor_id" is not null;--> statement-breakpoint
CREATE INDEX "notification_comment_idx" ON "notification" USING btree ("comment_id") WHERE "notification"."comment_id" is not null;--> statement-breakpoint
CREATE INDEX "share_guest_link_idx" ON "share_guest" USING btree ("share_link_id");--> statement-breakpoint
CREATE INDEX "share_link_board_idx" ON "share_link" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "share_link_project_idx" ON "share_link" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "share_link_created_by_idx" ON "share_link" USING btree ("created_by") WHERE "share_link"."created_by" is not null;--> statement-breakpoint
CREATE INDEX "share_pick_link_idx" ON "share_pick" USING btree ("share_link_id");