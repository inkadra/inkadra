CREATE TABLE "storage_total" (
	"user_id" uuid,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"pending_bytes" bigint DEFAULT 0 NOT NULL,
	"rendition_bytes" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "storage_total_user_unique" UNIQUE NULLS NOT DISTINCT("user_id")
);
--> statement-breakpoint
ALTER TABLE "board_doc" ADD COLUMN "tasks" jsonb;--> statement-breakpoint
ALTER TABLE "board_doc" ADD COLUMN "unsorted" jsonb;--> statement-breakpoint
ALTER TABLE "storage_total" ADD CONSTRAINT "storage_total_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_unfinished_idx" ON "asset" USING btree ("status","created_at") WHERE "asset"."status" in ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "asset_proxy_pending_idx" ON "asset" USING btree ("created_at") WHERE "asset"."proxy_status" in ('queued', 'processing');--> statement-breakpoint
CREATE INDEX "board_doc_unindexed_idx" ON "board_doc" USING btree ("board_id") WHERE "board_doc"."indexed_at" is null or "board_doc"."indexed_at" < "board_doc"."updated_at" or "board_doc"."tasks" is null;--> statement-breakpoint
CREATE INDEX "board_element_index_asset_idx" ON "board_element_index" USING btree ("asset_id") WHERE "board_element_index"."asset_id" is not null;
--> statement-breakpoint
-- Running storage totals (#799): kept by the triggers below, read by the storage limits.
CREATE FUNCTION storage_total_add(owner uuid, delta bigint, pending_delta bigint, rendition_delta bigint)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF delta = 0 AND pending_delta = 0 AND rendition_delta = 0 THEN
    RETURN;
  END IF;
  IF owner IS NULL THEN
    UPDATE storage_total SET bytes = bytes + delta, pending_bytes = pending_bytes + pending_delta,
      rendition_bytes = rendition_bytes + rendition_delta
      WHERE user_id IS NULL;
  ELSE
    UPDATE storage_total SET bytes = bytes + delta, pending_bytes = pending_bytes + pending_delta,
      rendition_bytes = rendition_bytes + rendition_delta
      WHERE user_id = owner;
  END IF;
  IF NOT FOUND THEN
    -- A person being deleted gets no new row: their files move to the row without a person.
    INSERT INTO storage_total (user_id, bytes, pending_bytes, rendition_bytes)
      SELECT owner, delta, pending_delta, rendition_delta
      WHERE owner IS NULL OR EXISTS (SELECT 1 FROM "user" WHERE id = owner)
      ON CONFLICT (user_id) DO UPDATE SET bytes = storage_total.bytes + excluded.bytes,
        pending_bytes = storage_total.pending_bytes + excluded.pending_bytes,
        rendition_bytes = storage_total.rendition_bytes + excluded.rendition_bytes;
  END IF;
END $$;--> statement-breakpoint
-- Statement triggers (#879): a statement touching thousands of files (a project deleted, an import,
-- an account deleted) updates each owner's row once, not once per file.
-- The copies of a deleted file are gone, in its cascade, before any statement trigger runs: a
-- row trigger parks their bytes here while they are still there (an insert, not an update of the
-- owner's total), and the file's statement trigger takes them off with it. Always empty outside
-- a statement, so unlogged and left out of backups.
CREATE UNLOGGED TABLE storage_total_gone (
	"asset_id" uuid NOT NULL,
	"bytes" bigint NOT NULL,
	"rendition_bytes" bigint NOT NULL
);--> statement-breakpoint
CREATE INDEX storage_total_gone_asset_idx ON storage_total_gone (asset_id);--> statement-breakpoint
CREATE FUNCTION asset_storage_total() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  -- Owners in a fixed order, so two statements never wait on each other's rows.
  IF TG_OP = 'INSERT' THEN
    FOR r IN SELECT created_by AS owner, sum(size)::bigint AS bytes,
        sum(CASE WHEN status = 'pending' THEN size ELSE 0 END)::bigint AS pending, 0::bigint AS rungs
      FROM new_rows GROUP BY created_by ORDER BY created_by NULLS FIRST
    LOOP
      PERFORM storage_total_add(r.owner, r.bytes, r.pending, r.rungs);
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR r IN SELECT o.created_by AS owner, -sum(o.size + coalesce(g.bytes, 0))::bigint AS bytes,
        -sum(CASE WHEN o.status = 'pending' THEN o.size ELSE 0 END)::bigint AS pending,
        -sum(coalesce(g.rendition_bytes, 0))::bigint AS rungs
      FROM old_rows o
      LEFT JOIN (SELECT asset_id, sum(bytes) AS bytes, sum(rendition_bytes) AS rendition_bytes
          FROM storage_total_gone WHERE asset_id IN (SELECT id FROM old_rows) GROUP BY asset_id) g
        ON g.asset_id = o.id
      GROUP BY o.created_by ORDER BY o.created_by NULLS FIRST
    LOOP
      PERFORM storage_total_add(r.owner, r.bytes, r.pending, r.rungs);
    END LOOP;
    DELETE FROM storage_total_gone WHERE asset_id IN (SELECT id FROM old_rows);
  ELSE
    -- A file moved to another person, resized, or no longer arriving: off the old, on the new.
    FOR r IN WITH changed AS (
        SELECT o.created_by AS old_owner, n.created_by AS new_owner, o.size AS old_size,
          n.size AS new_size, o.status = 'pending' AS old_pending, n.status = 'pending' AS new_pending,
          coalesce((SELECT sum(v.bytes) FROM asset_variant v WHERE v.asset_id = n.id), 0) AS copies,
          coalesce((SELECT sum(x.bytes) FROM asset_rendition x WHERE x.asset_id = n.id), 0) AS rungs
        FROM old_rows o JOIN new_rows n ON n.id = o.id
        WHERE o.size IS DISTINCT FROM n.size OR o.created_by IS DISTINCT FROM n.created_by
          OR (o.status = 'pending') IS DISTINCT FROM (n.status = 'pending'))
      SELECT owner, sum(bytes)::bigint AS bytes, sum(pending)::bigint AS pending,
        sum(rungs)::bigint AS rungs
      FROM (SELECT old_owner AS owner, -(old_size + copies) AS bytes,
          -CASE WHEN old_pending THEN old_size ELSE 0 END AS pending, -rungs AS rungs FROM changed
        UNION ALL
        SELECT new_owner, new_size + copies, CASE WHEN new_pending THEN new_size ELSE 0 END, rungs
        FROM changed) d
      GROUP BY owner ORDER BY owner NULLS FIRST
    LOOP
      PERFORM storage_total_add(r.owner, r.bytes, r.pending, r.rungs);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION asset_copy_storage_total() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  rung boolean := TG_TABLE_NAME = 'asset_rendition';
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR r IN SELECT a.created_by AS owner, sum(coalesce(n.bytes, 0))::bigint AS bytes
      FROM new_rows n JOIN asset a ON a.id = n.asset_id
      GROUP BY a.created_by ORDER BY a.created_by NULLS FIRST
    LOOP
      PERFORM storage_total_add(r.owner, CASE WHEN rung THEN 0 ELSE r.bytes END, 0,
        CASE WHEN rung THEN r.bytes ELSE 0 END);
    END LOOP;
  ELSIF TG_OP = 'UPDATE' THEN
    FOR r IN SELECT a.created_by AS owner, sum(d.bytes)::bigint AS bytes
      FROM (SELECT asset_id, coalesce(bytes, 0) AS bytes FROM new_rows
        UNION ALL SELECT asset_id, -coalesce(bytes, 0) FROM old_rows) d
      JOIN asset a ON a.id = d.asset_id
      GROUP BY a.created_by ORDER BY a.created_by NULLS FIRST
    LOOP
      PERFORM storage_total_add(r.owner, CASE WHEN rung THEN 0 ELSE r.bytes END, 0,
        CASE WHEN rung THEN r.bytes ELSE 0 END);
    END LOOP;
  ELSE
    -- Copies of a deleted file (its cascade) find no file: it took them off itself.
    FOR r IN SELECT a.created_by AS owner, -sum(coalesce(o.bytes, 0))::bigint AS bytes
      FROM old_rows o JOIN asset a ON a.id = o.asset_id
      GROUP BY a.created_by ORDER BY a.created_by NULLS FIRST
    LOOP
      PERFORM storage_total_add(r.owner, CASE WHEN rung THEN 0 ELSE r.bytes END, 0,
        CASE WHEN rung THEN r.bytes ELSE 0 END);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION asset_storage_total_park() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  copies bigint;
  rungs bigint;
BEGIN
  SELECT coalesce(sum(bytes), 0) INTO copies FROM asset_variant WHERE asset_id = OLD.id;
  SELECT coalesce(sum(bytes), 0) INTO rungs FROM asset_rendition WHERE asset_id = OLD.id;
  IF copies <> 0 OR rungs <> 0 THEN
    INSERT INTO storage_total_gone (asset_id, bytes, rendition_bytes) VALUES (OLD.id, copies, rungs);
  END IF;
  RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER asset_storage_total_park BEFORE DELETE ON asset
  FOR EACH ROW EXECUTE FUNCTION asset_storage_total_park();--> statement-breakpoint
CREATE TRIGGER asset_storage_total_insert AFTER INSERT ON asset
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION asset_storage_total();--> statement-breakpoint
CREATE TRIGGER asset_storage_total_update AFTER UPDATE ON asset
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION asset_storage_total();--> statement-breakpoint
CREATE TRIGGER asset_storage_total_delete AFTER DELETE ON asset
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION asset_storage_total();--> statement-breakpoint
CREATE TRIGGER asset_variant_storage_total_insert AFTER INSERT ON asset_variant
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION asset_copy_storage_total();--> statement-breakpoint
CREATE TRIGGER asset_variant_storage_total_update AFTER UPDATE ON asset_variant
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION asset_copy_storage_total();--> statement-breakpoint
CREATE TRIGGER asset_variant_storage_total_delete AFTER DELETE ON asset_variant
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION asset_copy_storage_total();--> statement-breakpoint
CREATE TRIGGER asset_rendition_storage_total_insert AFTER INSERT ON asset_rendition
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION asset_copy_storage_total();--> statement-breakpoint
CREATE TRIGGER asset_rendition_storage_total_update AFTER UPDATE ON asset_rendition
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION asset_copy_storage_total();--> statement-breakpoint
CREATE TRIGGER asset_rendition_storage_total_delete AFTER DELETE ON asset_rendition
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION asset_copy_storage_total();--> statement-breakpoint
INSERT INTO storage_total (user_id, bytes, pending_bytes, rendition_bytes)
  SELECT a.created_by, sum(a.size + coalesce(v.bytes, 0)),
    sum(CASE WHEN a.status = 'pending' THEN a.size ELSE 0 END), sum(coalesce(r.bytes, 0))
  FROM asset a
  LEFT JOIN (SELECT asset_id, sum(bytes) AS bytes FROM asset_variant GROUP BY asset_id) v ON v.asset_id = a.id
  LEFT JOIN (SELECT asset_id, sum(bytes) AS bytes FROM asset_rendition GROUP BY asset_id) r ON r.asset_id = a.id
  GROUP BY a.created_by;
