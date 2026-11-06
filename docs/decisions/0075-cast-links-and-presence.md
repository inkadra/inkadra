# 0075. Cast links and presence on the call sheet

## Context

The cast of a shooting day is free text. A person on the phone should see their own call and
say whether they will be there, which needs a name to mean an account. Most cast members are not
users at all, and nothing may change for them or for sheets without links.

## Decision

- **Links are per board, by normalised name.** `cast_link` maps a name (trimmed, lower case) to
  an account for one board's schedule, so a name is linked once and not day by day. Board and not
  project, because whoever can edit the plan sets them, and that right can be a grant on one board.
- **Presence is one answer per day and person.** `shooting_day_attendance` holds it, changeable.
- **Only for oneself.** The route takes no person: it answers for the signed-in account, which must
  have access to the board and be linked to a name in that day's blocks. Guests have no account.
- **Organisers see everybody, the others only themselves.** The list is filtered on the server.
- **Where.** On a phone, everyone with access gets the sheet with their own call and, if linked,
  the buttons. On a computer the printed sheet and its preview stay as they were: people who can
  edit the plan get the same attendance panel beside them, outside the print, and only they ask the
  server for it, once the sheet is open. Answering from a computer is left out for now.
- **"Open in Maps" reuses the map cards' link** to OpenStreetMap search. The address leaves the
  browser only when the link is tapped, which is also why the sheet has no map picture: the map
  card's preview asks a geocoder on the server and stores a file as soon as it is requested.

## Consequences

Renaming a cast name drops its link until it is set again. **Exporting a project and importing it
loses every link and every answer:** they point at accounts of one instance, and neither is in the
archive. The cast text travels as before, and links have to be set again after an import. There is
no notification for answers: the existing types are fixed events with their own texts and emails, and
a new one is a change of its own.
