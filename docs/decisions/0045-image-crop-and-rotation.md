# 0045 · Non-destructive image crop and rotation

Proposed, 2026-10. Extends [0004](0004-data-split.md), [0009](0009-files-and-media.md),
[0013](0013-review-and-sharing.md) and [0038](0038-pdf-and-image-export.md).

**Context.** Reference pictures placed on a board often need framing adjustments—cropping out
margins, matching a film aspect ratio (`1:1`, `4:3`, `16:9`, `2.39:1`) or rotating—without
modifying the immutable uploaded asset or preventing an editor from restoring the original
picture later.

**Decision.**
- Document version 8 adds optional `crop` and `rotation` fields to `image` elements.
  `rotation` is a finite clockwise angle in degrees (`-360` to `360`, supporting 90° steps and
  fine straightening angles; omitted or `0` means unrotated). `crop` holds a normalized
  rectangle `{ x, y, w, h }` in `[0, 1]` coordinates of the rotated image's bounding box, plus
  an optional `aspect` preset (`free`, `1:1`, `4:3`, `16:9`, `2.39:1`). A preset is the shape
  of the result: turning the picture or changing its angle refits the rectangle so the card
  stays at that aspect; a free rectangle turns with the picture. The card keeps its width and
  takes its height from the cropped picture, with the caption below.
- The stored asset in object storage and its server-generated thumbnails are never modified.
  "Restore original" deletes `crop` and `rotation` from the image element, returning the card
  to its intrinsic framing.
- Migration from version 7 changes only the schema version; existing image cards stay uncropped
  and unrotated. Version 6 (curved arrows, [0043](0043-arrow-labels-and-styles.md)) and version 7
  (character and location cards, [0044](0044-character-and-location-cards.md)) came first, so the
  chain is 6 → 7 → 8.
- `crop` and `rotation` are included in `GUEST_ELEMENT_FIELDS.image` so guests of shared links
  and client exports see the intended framing. The canvas, moodboard gallery, media viewer (with
  a toggle to inspect the uncropped original), guest views, browser-built PDF/PNG exports and
  project archive exports/imports all preserve and apply the same non-destructive framing.

**Consequences.** Older builds reject version 8 documents instead of silently discarding crop or
rotation when copying or exporting image cards. No database migration, HTTP endpoint or storage
change is required.
