# 0086 — Guest decisions and proofing travel with the project archive

## Context

A project archive (decision 0037) left out share links with their guests, picks and guest
review decisions: they were about access on one server. But a client's review and photo proofing
are part of the work: a project moved to another instance, or restored from an archive, lost who
approved which frame and which pictures the client chose. The demo (decisions 0084 and 0085)
showed it: Last Train arrived without Elena Marino's review and Low Tide without Irene Galli's
proofing, the two things a visitor should see a client do. Links themselves must still not
travel: their address is a secret, and nobody on the new server should be able to act as a guest.

## Decision

- **A new entry, `guests.json`.** It holds the guests' current decision on each card, the history
  of their decisions and their picks, rejections and stars, each by the name the guest typed.
  Each guest belongs to a link listed with its board, label, role and whether it had proofing.
  Links and guests get ids made for the archive. Nothing else of a link goes in: no address,
  token, password, expiry, use count or session, and still no email. The archive stays version 1:
  older readers ignore the entry, and archives without it import as before (format in
  `docs/formats/project-archive.md`).
- **Imported as revoked links.** Each link becomes a link of the new project that is already
  revoked, with a token made and thrown away, so no address opens it, and a revoked link cannot
  be changed. Its guests have no session: nobody can act as them. Everything else is what the
  team already knows: the guest's decision on the card and in its review history, with the name
  and the link's label; the picks in the link's results in the share dialog. No new table, screen
  or API: an imported project reads like one whose client links have ended.
- **The demo** lets a sandbox read a link's results (`GET /share-links/:linkId/picks`), which
  only its own revoked links have; creating or changing links stays closed.

## Consequences

- Last Train shows Elena's decisions on 1C and 2A; Low Tide's revoked Studio Maree link on the
  Selects board shows Irene's picks, rejections and stars. Supersedes the first consequence of
  decision 0085 and amends what 0037 leaves out of an archive.
- The link shows the importer as its creator and the import as the day it was revoked; a
  password it had is not kept. Retention treats it like any stopped link: guest names are cleared
  90 days after the import, and the decisions then show without a name.
- Guest comments still import as `team` threads under the guest's name (decision 0037), not
  attached to the imported link.
