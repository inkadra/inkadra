CREATE TABLE "element_move" (
	"board_id" uuid NOT NULL,
	"element_id" text NOT NULL,
	"to_board_id" uuid NOT NULL,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "element_move_board_id_element_id_pk" PRIMARY KEY("board_id","element_id")
);
--> statement-breakpoint
ALTER TABLE "element_move" ADD CONSTRAINT "element_move_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_move" ADD CONSTRAINT "element_move_to_board_id_board_id_fk" FOREIGN KEY ("to_board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "element_move_to_board_idx" ON "element_move" USING btree ("to_board_id");