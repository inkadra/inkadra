CREATE TABLE "asset_rendition" (
	"asset_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"progress" integer,
	"width" integer,
	"height" integer,
	"codecs" text,
	"bitrate" integer,
	"peak_bitrate" integer,
	"frame_rate" real,
	"bytes" bigint,
	"storage_key" text,
	"playlist" text,
	"recipe" text NOT NULL,
	"encoder" text,
	"encode_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_rendition_asset_id_name_pk" PRIMARY KEY("asset_id","name")
);
--> statement-breakpoint
ALTER TABLE "asset_rendition" ADD CONSTRAINT "asset_rendition_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;