# 0087 — No audience presets and no kickoff summary in the PDF export

## Context

The PDF export dialog opened on three audience presets (#305: client pitch, production book,
internal kickoff), one marked "Recommended" for the open view, with the actual options folded
under "Customise". #380 made the presets set the 16:9 page, approved frames only, a new kickoff
summary page and the call sheet. In use they did not work well: the recommendation changed with
the view and with review statuses still loading, a remembered preset overrode the options people
had picked, every edit turned the choice into "editing preset N", and the options themselves were
one click away. The kickoff summary (dates, people, open tasks, schedule) was printed only by the
kickoff preset and repeated what the schedule and the to-do cards already show.

## Decision

- **The options are the dialog.** In PDF mode it shows content, department, scenes, frames per
  page, page size, audience and the options (title page, approved only, hidden cards, comments,
  call sheet, logo) at once: no presets, no "Recommended" badge, nothing to unfold. The picture
  formats lose their note about the presets.
- **It starts from what the project remembers** (decision 0039), or from the defaults when
  nothing was saved or the settings cannot be read. The content follows the view the dialog was
  opened from; a null paper is still the reader's A4 or Letter.
- **The kickoff summary is gone**, with its page and texts. The call sheet stays.
- **Contract.** `preset` and `kickoffSummary` leave `ExportPreferences`. Stored rows keep the
  keys, but the server reads preferences field by field and drops them, so no migration is
  needed. `UpdateExportSettings` stays strict: a client that still sends them gets a 400. Only
  the web app, served by the same server, writes these settings, and it saves them after an
  export without blocking it, so a tab open across the upgrade only fails to remember one export.

Supersedes the audience presets of #305 and #380, the "presets stay PDF only" point of decision
0072, and the kickoff summary and production book preset mentioned in decision 0083.

## Consequences

- A PDF needs a few explicit choices instead of one click on a preset, but what is chosen is
  what is printed, and it is remembered for the project.
- One less request when exporting: the project members were fetched only for the summary.
