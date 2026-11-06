CREATE TABLE "cast_link" (
	"board_id" uuid NOT NULL,
	"cast_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cast_link_board_id_cast_key_pk" PRIMARY KEY("board_id","cast_key")
);
--> statement-breakpoint
CREATE TABLE "shooting_day_attendance" (
	"day_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shooting_day_attendance_day_id_user_id_pk" PRIMARY KEY("day_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "cast_link" ADD CONSTRAINT "cast_link_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cast_link" ADD CONSTRAINT "cast_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shooting_day_attendance" ADD CONSTRAINT "shooting_day_attendance_day_id_shooting_day_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."shooting_day"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shooting_day_attendance" ADD CONSTRAINT "shooting_day_attendance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cast_link_user_idx" ON "cast_link" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shooting_day_attendance_user_idx" ON "shooting_day_attendance" USING btree ("user_id");