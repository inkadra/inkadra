# 0057 — Project theme for presentations and PDF exports

Status: accepted.

## Context

The presentation view and the PDF export (decision 0038) looked the same for every project. A
team wants its pitch and its printed storyboard to look like the project — its colour, a title
typeface, its logo — without restyling each export. The export settings of decision 0039
already hold one logo per project, shown on the PDF.

## Decision

- The theme is a third tab, **Presentation**, of the project appearance dialog (#291), for
  project editors and owners. It holds an **accent** (one of the nine project colours), a
  **heading font** from a short list, and the **logo**, which is the export logo of decision
  0039: one logo per project, set from either dialog.
- It is stored with the export settings, in a new `theme` JSON column of
  `project_export_settings`, read **field by field** like `preferences`. The export settings
  endpoints carry it (`theme`, and `projectColor` so readers with only a board grant can
  resolve the default), so everyone who can export or present a board reads it in the same
  request as the logo. Additive within v1; project archives carry it in `export-settings.json`.
- `accent: null` means **the project's colour** and follows it when the icon colour changes;
  choosing the project's own colour stores null.
- On screen the accent is the tag colour of the current app theme. On paper it is always the
  **light theme's darker variant of the same hue**, which reads at 4.5:1 on white
  (`theme.test.ts` holds every colour to it).
- Heading fonts: **Inter, Fraunces, Space Grotesk, IBM Plex Mono**, weight 600, Latin subset,
  from the `@fontsource` packages (SIL Open Font License 1.1, like Inter). They are bundled with
  the app and served by the instance, never from a font service. The browser loads WOFF2 with
  `FontFace` only where a heading font is shown (presentation, export, the dialog's previews);
  the PDF embeds the WOFF file as a subset, because fontkit reads WOFF without Brotli. Text the
  heading font cannot draw falls back to Inter 600, measured and drawn alike.
- The theme reaches headings only: the presentation's shot titles, progress and scene heading,
  the PDF cover title and accent bar, and the running header with its accent rule. Body text
  stays Inter for legibility.
- The logo keeps the rules of decision 0039 (PNG or JPEG of at most 512 KiB, type read from the
  stored bytes, drawn from its WebP thumbnails, which the worker re-encodes without metadata).
  As in the export dialog, choosing or removing it is saved at once; accent and font wait for
  Save.

## Consequences

- One more JSON column and no new endpoint. A new font is one entry in `THEME_FONTS` and its
  files; an unknown stored value falls back to Inter.
- About 100 KB of font files ship with the image (three fonts, WOFF2 and WOFF); a client
  downloads one only when a project uses it.
- Custom uploaded fonts are not offered: their licences cannot be checked, and they could
  carry anything a font parser has to survive.
