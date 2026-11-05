# 0072 — Pictures in social formats

Status: accepted.

## Context

People share frames and moodboards on social networks, which want fixed shapes. The export
already draws pages to a canvas (decision 0038), so a shape is one more step on those pages.

## Decision

- PNG and JPEG offer **Original, 4:5, 1:1, 9:16 and 16:9**, 1080 px on the short side
  (1080 × 1350, 1080 × 1080, 1080 × 1920, 1920 × 1080). Original keeps today's size, up to 4096 px
  on the long side, and never enlarges a thumbnail past its own pixels. JPEG is quality 90, sRGB.
- These are shapes of a **picture**, not pages: the PDF's `slide` page (#380) is a separate setting
  with the same proportions as the 16:9 picture. The presets stay PDF only.
- **Fit** shows everything, **Fill** crops around a focus point that is kept per image while the
  dialog is open and never saved. Several selected cards make one image per card by default with
  a social format, in one ZIP named like the pages of a PNG export (#397).
- The project remembers the shape, the fit and PNG or JPEG. These are optional fields, so settings
  written earlier still load; a picture leaves the remembered PDF preset alone.
- **An exception to decision 0038, for this export only:** the bars of Fit, and the transparent
  areas of a JPEG, take the colour of the **board background as the person exporting sees it**
  (`--ink-bg-canvas`), so dark in the dark theme, rather than the light paper of every other export.
  Boards have no background colour of their own. Cards and the paper under a composition of
  several cards stay in the light print style, so their text stays readable.

## Consequences

- The same picture exported from the dark and the light theme differs in its bars.
- A card by itself is drawn without the running header and footer; pages of a storyboard or shot
  list keep them, since they are pages of a document.
