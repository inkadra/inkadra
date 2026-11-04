CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "board_element_index" (
	"board_id" uuid NOT NULL,
	"element_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"asset_id" uuid,
	"data" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_element_index_board_id_element_id_pk" PRIMARY KEY("board_id","element_id")
);
--> statement-breakpoint
ALTER TABLE "board_doc" ADD COLUMN "indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "board_element_index" ADD CONSTRAINT "board_element_index_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_element_index" ADD CONSTRAINT "board_element_index_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_element_index_project_idx" ON "board_element_index" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "board_element_index_text_idx" ON "board_element_index" USING gin ("text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "board_element_index_tags_idx" ON "board_element_index" USING gin ("tags");