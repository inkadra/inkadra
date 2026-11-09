# 0088 — The project theme moves to the export dialog; the accent is the project's colour

Status: accepted. Supersedes part of [0057](0057-project-theme.md).

## Context

Decision 0057 put the project theme (accent, heading font, logo) in a third tab, **Presentation**,
of the project appearance dialog. In use it sat in the wrong place and mostly repeated other
controls: the accent was a second colour picker next to the project's own colour, the logo was
already in the export dialog, and the heading font was chosen far from the PDF preview that shows
it.

## Decision

- The appearance dialog keeps only the icon tabs, **Symbol** and **Emoji**.
- **The accent is always the project's colour.** There is no separate choice; `resolveTheme`
  reads `projectColor` and ignores `theme.accent`. Accents stored by earlier versions stay in the
  database and in archives, unread: nothing is migrated or deleted, and the contract keeps the
  field. On paper the accent is still the light theme's darker variant of the same hue (0057).
- **The logo** is set only in the export dialog, as in decision 0039. The presentation view and
  the call sheet keep reading it from the export settings.
- **The heading font** becomes **Heading style** in the PDF options of the export dialog, next to
  the preview that shows it. It is still stored as `theme.headingFont` in the export settings, so
  it applies to the presentation view too. Like the logo beside it, only those who can edit the
  export settings change it, and a choice is saved at once for the whole project.

## Consequences

- No contract or database change: `theme.accent` becomes a value nobody writes and nobody reads.
  Removing it would be a later contract change.
- Choosing a colour for the project in the appearance dialog also changes the accent of its PDFs
  and presentations.
- The rest of 0057 stands: the bundled fonts, where the theme reaches, the logo rules.
