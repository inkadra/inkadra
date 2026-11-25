-- The search index tells a set plan's setups from its base (data.variantOf), so a listing of plans
-- names the bases only. Boards indexed before have their plans indexed again by the backfill.
UPDATE "board_doc" SET "indexed_at" = NULL
WHERE "board_id" IN (SELECT DISTINCT "board_id" FROM "board_element_index" WHERE "type" = 'plan');
