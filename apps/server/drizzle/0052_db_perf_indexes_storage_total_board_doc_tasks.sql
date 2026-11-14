CREATE TABLE "storage_total" (
	"user_id" uuid,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"rendition_bytes" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "storage_total_user_unique" UNIQUE NULLS NOT DISTINCT("user_id")
);
--> statement-breakpoint
ALTER TABLE "board_doc" ADD COLUMN "tasks" jsonb;--> statement-breakpoint
ALTER TABLE "board_doc" ADD COLUMN "unsorted" jsonb;--> statement-breakpoint
ALTER TABLE "storage_total" ADD CONSTRAINT "storage_total_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_unfinished_idx" ON "asset" USING btree ("status","created_at") WHERE "asset"."status" in ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "asset_proxy_pending_idx" ON "asset" USING btree ("created_at") WHERE "asset"."proxy_status" in ('queued', 'processing');--> statement-breakpoint
CREATE INDEX "board_doc_unindexed_idx" ON "board_doc" USING btree ("board_id") WHERE "board_doc"."indexed_at" is null or "board_doc"."indexed_at" < "board_doc"."updated_at";--> statement-breakpoint
CREATE INDEX "board_element_index_asset_idx" ON "board_element_index" USING btree ("asset_id") WHERE "board_element_index"."asset_id" is not null;
--> statement-breakpoint
-- Running storage totals (#799): kept by the triggers below, read by the storage limits.
CREATE FUNCTION storage_total_add(owner uuid, delta bigint, rendition_delta bigint) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF delta = 0 AND rendition_delta = 0 THEN
    RETURN;
  END IF;
  IF owner IS NULL THEN
    UPDATE storage_total SET bytes = bytes + delta, rendition_bytes = rendition_bytes + rendition_delta
      WHERE user_id IS NULL;
  ELSE
    UPDATE storage_total SET bytes = bytes + delta, rendition_bytes = rendition_bytes + rendition_delta
      WHERE user_id = owner;
  END IF;
  IF NOT FOUND THEN
    -- A person being deleted gets no new row: their files move to the row without a person.
    INSERT INTO storage_total (user_id, bytes, rendition_bytes)
      SELECT owner, delta, rendition_delta
      WHERE owner IS NULL OR EXISTS (SELECT 1 FROM "user" WHERE id = owner)
      ON CONFLICT (user_id) DO UPDATE SET bytes = storage_total.bytes + excluded.bytes,
        rendition_bytes = storage_total.rendition_bytes + excluded.rendition_bytes;
  END IF;
END $$;--> statement-breakpoint
CREATE FUNCTION asset_storage_total() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  copies bigint;
  rungs bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM storage_total_add(NEW.created_by, NEW.size, 0);
    RETURN NULL;
  END IF;
  SELECT coalesce(sum(bytes), 0) INTO copies FROM asset_variant WHERE asset_id = OLD.id;
  SELECT coalesce(sum(bytes), 0) INTO rungs FROM asset_rendition WHERE asset_id = OLD.id;
  IF TG_OP = 'DELETE' THEN
    -- Before the delete, while the copies are still there: their own cascade finds no file.
    PERFORM storage_total_add(OLD.created_by, -(OLD.size + copies), -rungs);
    RETURN OLD;
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    PERFORM storage_total_add(OLD.created_by, -(OLD.size + copies), -rungs);
    PERFORM storage_total_add(NEW.created_by, NEW.size + copies, rungs);
  ELSE
    PERFORM storage_total_add(NEW.created_by, NEW.size - OLD.size, 0);
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION asset_copy_storage_total() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner uuid;
  delta bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    delta := -coalesce(OLD.bytes, 0);
    SELECT created_by INTO owner FROM asset WHERE id = OLD.asset_id;
  ELSE
    delta := coalesce(NEW.bytes, 0) - CASE WHEN TG_OP = 'UPDATE' THEN coalesce(OLD.bytes, 0) ELSE 0 END;
    SELECT created_by INTO owner FROM asset WHERE id = NEW.asset_id;
  END IF;
  -- The file is gone: its own delete took its copies off.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'asset_variant' THEN
    PERFORM storage_total_add(owner, delta, 0);
  ELSE
    PERFORM storage_total_add(owner, 0, delta);
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER asset_storage_total_insert AFTER INSERT ON asset
  FOR EACH ROW EXECUTE FUNCTION asset_storage_total();--> statement-breakpoint
CREATE TRIGGER asset_storage_total_update AFTER UPDATE OF size, created_by ON asset
  FOR EACH ROW WHEN (OLD.size IS DISTINCT FROM NEW.size OR OLD.created_by IS DISTINCT FROM NEW.created_by)
  EXECUTE FUNCTION asset_storage_total();--> statement-breakpoint
CREATE TRIGGER asset_storage_total_delete BEFORE DELETE ON asset
  FOR EACH ROW EXECUTE FUNCTION asset_storage_total();--> statement-breakpoint
CREATE TRIGGER asset_variant_storage_total AFTER INSERT OR UPDATE OF bytes OR DELETE ON asset_variant
  FOR EACH ROW EXECUTE FUNCTION asset_copy_storage_total();--> statement-breakpoint
CREATE TRIGGER asset_rendition_storage_total AFTER INSERT OR UPDATE OF bytes OR DELETE ON asset_rendition
  FOR EACH ROW EXECUTE FUNCTION asset_copy_storage_total();--> statement-breakpoint
INSERT INTO storage_total (user_id, bytes, rendition_bytes)
  SELECT a.created_by, sum(a.size + coalesce(v.bytes, 0)), sum(coalesce(r.bytes, 0))
  FROM asset a
  LEFT JOIN (SELECT asset_id, sum(bytes) AS bytes FROM asset_variant GROUP BY asset_id) v ON v.asset_id = a.id
  LEFT JOIN (SELECT asset_id, sum(bytes) AS bytes FROM asset_rendition GROUP BY asset_id) r ON r.asset_id = a.id
  GROUP BY a.created_by;
