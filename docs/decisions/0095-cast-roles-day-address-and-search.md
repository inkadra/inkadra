# 0095 — Cast roles, the day's address and finding the crew

Status: accepted. Follows [0090](0090-call-sheet-at-a-glance.md), [0091](0091-troupe.md) and
[0092](0092-day-calls.md).

## Context

Preparing a short film showed three gaps. A production writes its actors as crew rows in Cast
with the character as their role ("Anna Greco · Elena"), without character cards: those rows
were never called and the cast table of the call sheet stayed empty. When the scenes of a day
name their places, the day's Location field (the address and map link the crew drives to) was
not printed at all, though sunrise and sunset were computed from it and labelled "Loc. 1".
Search found cards and boards, but not the people of the crew nor the place of a shooting day.

## Decision

**A Cast row's role is its character.** A crew row in department Cast counts its role as one
of its cast names (`castNameKey`), beside its own name and its linked card's name, on the web
(`dayCrew`) and on the server (`crewCastKeys`, so presence links and "link a cast name" find
the same row). It is called on the days that name the character, and its name and phone fill
Actor and Contact. Rows outside Cast are left alone: there a role is a job. A row's own name or
its linked card comes before any role: a role counts only when no row has that name or card, and
a role shared by several Cast rows goes to the first by position. A character card with that
name still gives the actor and contact.

**The day's address.** When the scenes name their places, the call sheet and its PDF keep the
numbered scene locations and add the day's Location first, labelled "Address", with its map
link. When it names one of the scene places, that numbered line takes its address and map
instead; a location card of that name without an address or a map keeps the day's. On a phone the
Address line carries the Maps button. Sunrise and sunset taken from it say "(address)". Client exports are unchanged: they
build no call sheet (0090, 0092).

**Search.** `GET /search` also returns the crew, by name, role or department, only to project
members (0091: a grant on one board never sees the roster), and shooting days by their
location on the boards the caller can open. They come as `kind: "element"` with the element
types `crew` and `shootingDay`, which older clients show as plain results; the web app opens
the Troupe and Schedule views. Additive: no schema, no new field.

## Consequences

- An actor whose role happens to equal a character on another day is called that day too.
- The project's time zone stays as 0092 says: "Automatic" uses the device's clock.
