# 0081 — Storage limits per instance and per person

## Context

A public demo (one sandbox per visitor) and, later, managed hosting need a ceiling on the files
people store. Until now the only limit was the size of one file (`UPLOAD_MAX_SIZE`); a person or
a whole instance could fill the disk. Self-hosters must see no change until they want one.

## Decision

- **What counts.** Originals and the copies and previews the server makes of them (playable
  videos, thumbnails, waveforms): the same number as "Usage by person" in Settings → Storage.
  The database does not count. A file counts for whoever uploaded it (`asset.created_by`); an
  imported project's files count for the importer. Guests of a review link cannot upload files
  today; when they can, their files go to whoever created the link.
- **Limits.** A total for the instance, a default for each person and a limit of one's own
  (`user.storage_limit`: null follows the default, 0 is none). All off by default ("No limit").
  The instance total goes first: when it is reached nobody adds files, whatever their own room.
  Settings → Storage stores the choices in `instance_setting` (`storage-limits`), with the share
  that warns (80 % by default).
- **Managed servers.** `STORAGE_LIMIT` and `STORAGE_LIMIT_PER_USER` win over Settings and lock
  the fields there ("Set by the server operator"), the warning share too. Under a per-person
  limit of the environment an administrator can lower a person's limit, never raise it or remove
  it. These two variables read sizes in powers of 1000 (`500GB` is 500 × 10⁹ bytes), as the app
  shows sizes; `UPLOAD_MAX_SIZE` keeps its binary multiples.
- **Only new files stop.** Uploads (and so recorded video and voice notes, frame grabs and
  pictures of frames), clipper files and pictures, link and map pictures, and project imports.
  A link or map card without room keeps its text, without the picture. Nothing is ever deleted to
  make room; a limit lower than what is used is allowed and touches nothing. Notes, comments and
  edits keep working.
- **Checked on the server, race-safe.** A new file holds its place from the moment its row
  exists: an upload's row is written, `pending` with the declared size, only after a check made
  under one advisory lock for the whole instance, and pending uploads count. Two uploads cannot
  both take the last free bytes. The check runs again when the last byte arrives (a limit
  lowered meanwhile applies; the file is then removed and refused). Without any limit no lock is
  taken. An import checks the whole archive before writing a file and again in the transaction
  that commits the project: it is all or nothing (`storage_full`). Stale pending uploads go after
  24 hours as before, freeing their place.
- **Refusals.** A refused tus upload answers 413 with `StorageFull` as JSON (scope, bytes left,
  limit), which the app tells apart from the plain-text 413 of `UPLOAD_MAX_SIZE`. Files dropped
  together are one batch: the files that fit go through and one dialog lists those that did not;
  a single file gets a toast.
- **Warnings.** People see their space at the top of Settings → Account and a toast after an
  upload past the warning share (once per page). Administrators get a `server_alert`
  (`storage_limit`) in the Inbox when the instance passes it, at most once a day, by email too
  when Server alerts send email (decision 0079). "Ask for more space" sends the administrators a
  `storage_request` alert, at most one a day per person.
- **Deleted files.** Files whose cards are deleted stay with their project, because a board
  version can bring them back (decision 0013); a deleted board's files stay too. They count until
  the project is deleted, which removes them at once. There is no trash to empty, and this change
  adds none.

## Consequences

- Copies and previews are made after a file is accepted, so a person can end slightly above
  their limit; the next file is then refused.
- Every new file adds up the uploader's files and, with a total, the instance's; with limits on,
  new files are counted one at a time. Fine for the instances Inkadra targets; a running counter
  would be the next step if it shows.
- The demo mode (sandboxes, expiry, `DEMO_*` variables) builds on this and is a separate change.
