# 0055 · Personal preferences that follow the person

Proposed, 2026-11. Issue #302. Builds on notifications (decision 0013).

**Context.** Until now the only personal choices kept on the account were the language and the
email frequency of notifications. Everything else a person chooses for themselves, such as snap
to grid, lived in the local storage of one browser, so a phone and a laptop disagreed. Issue #302
adds a date and time format, canvas defaults and the tools of the bottom bar, which people expect
to find again on every device.

**Decision.**
- **One JSON record per account.** `user_preference.preferences` holds them, read and changed
  through `GET` and `PATCH /me/preferences`. The Zod schema `UserPreferences` in
  `packages/shared` names every field; the server merges a `PATCH` over what is stored and
  answers with the full set, defaults filled in. `readUserPreferences` keeps each stored field
  that is still valid and the default for the rest, so a record written by an older or newer
  server never fails to read; fields this server does not know are left in the record.
- **Open lists stay open.** The bottom bar is a list of tool names; clients skip names they do
  not know, so a newer app adding a tool does not break an older one.
- **Notification channels belong with the notifications.** Turning an event off in the Inbox or
  for email is enforced by the server, so it lives in `notification_preference` (`inbox_off`,
  `email_off`) next to the email frequency, not in the JSON record. Types turned off for the
  Inbox are never written; types turned off for email are marked as sent. Mentions always reach
  the Inbox.
- **Device-only choices stay on the device.** Playing videos off-screen depends on the device's
  power and stays in local storage, as does the dot grid chosen for one board from the canvas
  menu. The preference is the default those choices start from.
- The web app caches the last preferences read in local storage, so a board opens with them
  before the server answers.

**Consequences.** New personal options add a field to `UserPreferences` and a default, with no
migration. The mobile app and the browser extension can read the same record when they need it.
