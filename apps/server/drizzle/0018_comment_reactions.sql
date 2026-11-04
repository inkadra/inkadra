CREATE TABLE "comment_reaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"user_id" uuid,
	"guest_id" uuid,
	"share_link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reaction_one_author_ck" CHECK (num_nonnulls("comment_reaction"."user_id", "comment_reaction"."guest_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "element_reaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"element_id" text NOT NULL,
	"emoji" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "element_reaction_uq" UNIQUE("board_id","element_id","emoji","user_id")
);
--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_share_link_id_share_link_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_guest_fk" FOREIGN KEY ("guest_id","share_link_id") REFERENCES "public"."share_guest"("id","share_link_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_reaction" ADD CONSTRAINT "element_reaction_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_reaction" ADD CONSTRAINT "element_reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_reaction_user_uq" ON "comment_reaction" USING btree ("comment_id","emoji","user_id") WHERE "comment_reaction"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_reaction_guest_uq" ON "comment_reaction" USING btree ("comment_id","emoji","guest_id") WHERE "comment_reaction"."guest_id" is not null;--> statement-breakpoint
CREATE INDEX "comment_reaction_user_idx" ON "comment_reaction" USING btree ("user_id") WHERE "comment_reaction"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "comment_reaction_share_link_idx" ON "comment_reaction" USING btree ("share_link_id") WHERE "comment_reaction"."share_link_id" is not null;--> statement-breakpoint
CREATE INDEX "element_reaction_user_idx" ON "element_reaction" USING btree ("user_id");