CREATE TABLE "collab_epoch" (
	"id" integer PRIMARY KEY NOT NULL,
	"epoch" integer NOT NULL,
	CONSTRAINT "collab_epoch_single_row" CHECK ("collab_epoch"."id" = 1)
);
