CREATE TABLE "comment_read" (
	"user_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"marked_unread" boolean DEFAULT false NOT NULL,
	CONSTRAINT "comment_read_user_id_thread_id_pk" PRIMARY KEY("user_id","thread_id")
);
--> statement-breakpoint
ALTER TABLE "comment_read" ADD CONSTRAINT "comment_read_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_read" ADD CONSTRAINT "comment_read_thread_id_comment_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_read_thread_idx" ON "comment_read" USING btree ("thread_id");