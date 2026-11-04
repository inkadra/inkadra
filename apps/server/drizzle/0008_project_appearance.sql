ALTER TABLE "project" ADD COLUMN "icon_emoji" text;
--> statement-breakpoint
UPDATE "project"
SET "icon_shape" = (ARRAY['diamond', 'triangle', 'square', 'circle'])[1 + (('x' || right(replace(id::text, '-', ''), 6))::bit(24)::int % 4)],
    "icon_color" = (ARRAY['blue', 'orange', 'purple', 'green'])[1 + ((('x' || right(replace(id::text, '-', ''), 6))::bit(24)::int / 4) % 4)]
WHERE "icon_shape" = 'circle' AND "icon_color" = 'neutral';
