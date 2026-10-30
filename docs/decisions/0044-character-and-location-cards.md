# 0044 · Character and location cards

Proposed, 2026-10. Extends the board document (decision 0003 and later), guest fields
(decision 0013), search (decision 0012) and project archives (decision 0037).

**Context.** Pre-production keeps a story bible: who the characters are, who plays them, where
the story is shot. Today that lives in free notes on the Casting and Locations template boards,
so nothing is structured: search cannot tell a character from a note, exports and guest views
show contacts typed in a note, and storyboard frames name their cast in free text.

**Decision.**
- Document version 7 adds two element types, both plain cards (not containers):
  - `character`: `name`, optional `role` (in the story), `assetId` (photo or reference), `age`
    (as written), `description`, `actor`, `contact`, `notes`, `scenes`.
  - `location`: `name`, optional `setting` (`int`, `ext`, `int-ext`, as on scenes), `address`,
    `mapUrl`, `assetId` (photo), `light` (best time and light), `availability`, `contact`,
    `notes`, `scenes`.
    Migration from version 6 changes only the schema version.
- **Linked scenes are scene numbers** as written in the script (`"4"`, `"12A"`), not element
  ids: scenes live in storyboard boards, other documents, and are renumbered and re-imported;
  numbers are what crews use on call sheets and survive both.
- **Frames link to characters by name.** `cast` stays a list of names: the frame panel offers
  the project's character cards (from search) to pick, which adds the card's name. Existing
  free-text cast keeps working; a name that matches a character card (ignoring case) is shown
  as linked. No frame field changes.
- **Search by type**: `GET /search` also accepts a `type` with a `projectId` and no words, to
  list the cards of a type in a project (the cast picker lists the project's characters).
- **Maps**: `mapUrl` is any HTTP(S) link opened in a new tab. No embedded map, tiles or
  geocoding: nothing new for the CSP and no API key.
- **Guests** (allow list, decision 0013) see on characters the name, role, picture, age,
  description, actor and scenes; on locations the name, setting, picture, light and scenes.
  Contacts and notes are never shown; nor are a location's address, map link and availability,
  since locations are often private homes. Pictures of shown cards are reachable by guests as
  for image cards.
- **Search** indexes every field the team sees, including contacts and notes (search is for the
  team, not for guests). **Exports** (archive, PDF, image) carry the cards; a picture that is
  not in the archive is removed on import, as for frames and links.
- **Colour only with meaning**: the cards are neutral surfaces like notes; the INT/EXT chip uses
  the existing scene chip. The new tool entries use the neutral tool colour; no new tokens.

**Consequences.** Older builds refuse version 7 documents instead of dropping unknown cards.
The archive format keeps version 1 (an additive element type is read by version 1 importers
with this schema). The screenplay import can create character cards for speaking characters,
skipping names a card on the board already has.
