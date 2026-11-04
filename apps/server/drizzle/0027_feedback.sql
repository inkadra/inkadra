CREATE TABLE "feedback_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"report_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "feedback_report_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"owner" text NOT NULL,
	"request_id" uuid NOT NULL,
	"reporter" text NOT NULL,
	"report" jsonb NOT NULL,
	"destination" text NOT NULL,
	"repository" text,
	"delivery" text NOT NULL,
	"issue_number" integer,
	"signature" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_report_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "feedback_attachment" ADD CONSTRAINT "feedback_attachment_report_id_feedback_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."feedback_report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_report_request_uq" ON "feedback_report" USING btree ("owner","request_id");--> statement-breakpoint
CREATE INDEX "feedback_report_pending_idx" ON "feedback_report" USING btree ("delivery","next_attempt_at");