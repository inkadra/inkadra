# 0069 — Richer character sheet

The approved character sheet needs more than the nine fields of decision 0044. Document version 17
adds optional fields to character cards, with a no-op migration from version 16: `nickname`,
`profession`, `origin`, `appearance`, `wants`, `fears`, `arc`, `costume`, `references` (asset ids)
and `relations` (`characterId` and a free label).

- Older documents stay unchanged. As in decision 0068, clients that support fewer versions stay
  read-only on a version 17 document, so they cannot drop the new fields.
- Guests receive everything except `contact` and `notes`: the allow list of `GUEST_ELEMENT_FIELDS`
  keeps those on the server. Guests may read the files in `references`. A relation with a character
  they cannot see is not sent, because its label would give it away.
- Relations are one way: they do not appear on the other character. They point at a card, so they
  stay within one board.
- Scenes are computed from frame casts, matching names without case; the manual `scenes` field
  stays and the two are merged. Characters and frames often live on different boards, so
  `GET /projects/{id}/cast-appearances` reads the frames of the other boards the caller can read.
  Guests have no such endpoint and see what is computed from the frames of the board they got.
- A character's height follows its content and only its width resizes, with a 160 px minimum. A
  stored `h` from an older document is ignored, not rewritten.
- Location cards do not change.
