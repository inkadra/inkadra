CREATE TABLE "board_writer" (
	"board_id" uuid NOT NULL,
	"client_id" bigint NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"contested" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"marks" jsonb NOT NULL,
	CONSTRAINT "board_writer_board_id_client_id_pk" PRIMARY KEY("board_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "board_writer" ADD CONSTRAINT "board_writer_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_writer" ADD CONSTRAINT "board_writer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_writer_last_seen_idx" ON "board_writer" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "board_writer_user_idx" ON "board_writer" USING btree ("user_id") WHERE "board_writer"."user_id" is not null;