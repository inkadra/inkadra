# 0124 · Settings redesign: three groups, sixteen pages, one visual grammar

Accepted, 2026-11-12. The maintainer approved the interactive mockup kept in
[0124/settings-redesign.html](0124/settings-redesign.html): its `NAV` is the navigation, its
`PAGES` the content of every page, and the page "Cosa cambia" lists every move. Its sample data
and the dashed "↪ da …" chips are illustration only. Builds on 0029 (the settings window),
0055 (personal preferences) and 0121 (modules). Amended by
[0128](0128-video-renditions.md): the Server group gains a seventeenth page, Video, after
Archiviazione.

## Context

The settings window grew one page at a time and each page brought its own layout: Account used
borderless rows, Server filled tiles, Tutorials, Toolbar and Notifications grids and tables of
their own. Several pages mixed topics: the calendar link sat in Notifications, tokens and the
clipper in Account, the feedback settings at the bottom of Informazioni, the right to create
projects and the calendar feed above the list of members, registration and its two-step rule on
a page of three rows next to a read-only page of sign-in methods. Three pages shared one icon.

## Decision

**Three groups named for who they concern**, sixteen pages with one topic each:

| Group             | Pages                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Personale         | Account · Aspetto e lingua · Board · Moduli · Notifiche · App collegate · Aiuto e tutorial |
| Workspace · admin | Membri · Accesso e permessi · Classificazioni · Segnalazioni                               |
| Server · admin    | Generale · Archiviazione · Backup · Stato del server · Aggiornamenti                       |

Moves:

- Account keeps profile, sign-in methods and sessions; "Il tuo spazio" follows Sessions; tokens,
  the clipper and "Segnala un problema" leave.
- Preferences becomes "Aspetto e lingua" (theme, language, date and time). Its Canvas card and the
  former Toolbar page make the new **Board** page; "keep playing videos" says it is for this
  device only.
- **App collegate** gathers what connects to the account from outside: the calendar link (from
  Notifiche), the clipper and personal tokens (from Account).
- Notifiche keeps the matrix and an Email card; the daily-digest switch becomes a choice of two,
  Subito or Riepilogo giornaliero, with the same stored values (the legacy `off` shows as Subito
  and keeps every email off when changed, as before).
- **Aiuto e tutorial** is the Tutorials page with an "Assistenza" card holding "Segnala un
  problema", the same for members and administrators.
- Membri lists only people and invitations; people stay a table, so role, right to create
  projects, space, projects and last activity line up in columns across people. "Feed del calendario" and "I membri possono creare
  progetti" move to **Accesso e permessi**, which also holds registration, the two-step rule for
  administrators and the read-only sign-in methods and SMTP (the former pages `providers` and
  `registration`).
- **Segnalazioni** is the feedback settings of Informazioni. The relay switch and the list of
  destinations said the same thing: one menu of the four destinations replaces both.
- Informazioni becomes **Generale**: name, address, version and the setup checklist, with
  "Configura" on a failing check that opens the page that fixes it. The release-news switch moves
  to Aggiornamenti; storage and the server link leave (they have their own pages).
- Archiviazione moves to the Server group; its three breakdowns become one card with a choice of
  per progetto, per persona, per tipo.
- The Diagnostics link leaves the navigation footer: Stato del server already shows the same
  checks on its Configuration row. `/diagnostics` stays for when signing in fails.

**One visual grammar.** Every block is an optional uppercase label (with an action on its right)
and one bordered card of rows split by hairlines; a row is an optional 32px icon tile, a label with
one line of help and a control on the right (switch, segmented choice, menu, field, button or
badge). Pages that have a state (Stato del server, Backup, Archiviazione, Aggiornamenti, Aiuto e
tutorial) open with the same summary strip: round icon, sentence, main action, optional meter.
Each page has its own icon. The header says "Salvato" on every page that saves itself;
Classificazioni, saved by hand, shows its bar only when there is something to save. `Card`,
`Row`, `Tile` and `Summary` in `settings-ui.tsx` and `settings.css` implement it once.

**Addresses stay.** Surviving pages keep their `?section=` id (`preferences` is now "Aspetto e
lingua", `instance` "Generale", `workspace` "Archiviazione", `tutorials` "Aiuto e tutorial").
New ones are `board`, `apps`, `access` and `reports`. Old ids open the page that took their
content: `toolbar` → `board`, `providers` and `registration` → `access`.

## Consequences

- The notification of a new report should open `?section=reports`. `notificationPath` lives in
  `packages/shared`, a contract with the mobile app, so that one-line change goes in its own
  pull request labelled `contract`; until it is merged the notification opens General, and the
  Inbox of the web app keeps showing the reports inline as before.
- No API, database or board-schema change.
- Modules (0121) still apply: tools of a module that is off are not offered on Board, its
  notification rows leave Notifiche and its tours leave Aiuto e tutorial.
- Screenshots of every page, both themes, desktop and phone: private review captures (not committed).
