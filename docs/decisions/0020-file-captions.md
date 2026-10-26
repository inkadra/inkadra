# 0020 · Keep captions on file cards

Accepted, 2026-10-26. Approved by the maintainer in chat for #66.

**Context.** The clip endpoint drops the note sent with a non-image file (decision 0014).
Image cards already keep the note as a caption; file cards need the same behaviour.

**Decision.** Add optional `caption` to `FileElement`, a string of at most 2000 characters,
exactly like `ImageElement.caption`. A file clip keeps its `note` there. File and image cards
share caption display and editing, and search includes file captions alongside file names.
Captions are visible to guests, like image captions: add `caption` to the file allow list in
`GUEST_ELEMENT_FIELDS` (extending decision 0013). Hidden cards and internal fields remain
filtered by the existing guest rules.

**Consequences.** Board document version 4 has an identity migration from 3: captions are
optional, so old documents remain valid and cards without captions look as before. Older
builds reject version 4 through `SchemaTooNewError` instead of silently stripping captions
when copying cards. This is an additive board contract change, with no database or API
request/response shape changes. The clip description is updated and OpenAPI regenerated;
API version stays 0.6.0, following the description-only precedent in #53. This supersedes
only the discarded-file-note behaviour in decision 0014 and the file field list in 0013.
