# 0039 — Project export settings on the server

Status: accepted.

## Context

The PDF and image export (decision 0038) starts from choices a team makes once per project:
format, frames per page, page size and orientation, audience, title page, comments, and a logo
printed on the pages. Kept in each browser, they differ between people and machines and are
lost with the browser's storage. They belong to the project, like its name and icon.

## Decision

- One row per project in `project_export_settings`: `preferences` as JSON, `logo_asset_id`,
  `updated_by`, `updated_at`. The row exists only once someone saves; until then the API answers
  the defaults of `DEFAULT_EXPORT_PREFERENCES` with `updatedAt` null.
- `preferences` is read **field by field** against `ExportPreferences`: a value a later version
  adds, renames or narrows falls back to its default instead of failing the whole row. Writes
  merge into the stored JSON (`||`) under a lock on the project row, so two editors changing
  different fields both win.
- `GET /api/v1/projects/{projectId}/export-settings`: anyone with a role on the project **or a
  grant on one of its boards** (whoever can open a board can export it). Others get 404.
  `canEdit` tells the client whether to show the controls as editable.
- `PATCH` with the same path: project **editors and owners** only. Board-only grants get 403,
  people without access 404. Fields left out keep their value.
- The logo is an ordinary **image asset of the same project**, uploaded through the existing
  upload flow, so it counts towards project storage and is served, cached and permission-checked
  like any picture. It must be PNG or JPEG of at most 512 KiB and **ready**: processed by the
  worker, so its type has been read from the file. The PATCH checks the declared type and the
  first bytes of the stored file again, inside the transaction. SVG is refused: it can carry
  scripts, and sanitising it on the server is more than this needs. A logo whose file is not
  ready is not returned to readers.
  Clients draw the logo from its WebP thumbnails (which keep transparency), or from the original
  when it is too small to have any, which viewers may open in that case.
- Replacing or removing the logo **deletes the previous asset** when nothing else may show it:
  no board cover, no guest pick, and its id in no board document or version of the project
  (versions can bring cards back, decision 0013). The id is looked for in the stored Yjs bytes,
  where strings are UTF-8; a false match only keeps the file. Deleting the asset clears the
  reference (`on delete set null`); deleting the project deletes the row.

## Consequences

- Additive within v1: one table, two endpoints, no change to existing ones.
- Project archives (decision 0037, still a proposal) should carry these settings and remap the
  logo asset like other assets.
- A per-person override (someone who always wants Letter) is not offered; the shared value is
  what everyone starts from, and each export can still change any option before downloading.
