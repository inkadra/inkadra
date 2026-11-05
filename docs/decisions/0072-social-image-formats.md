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
- The project remembers the shape, the fit, PNG or JPEG and the colour of the bands. These are
  optional fields, so settings written earlier still load; a picture leaves the remembered PDF
  preset alone.
- **The bands have a colour chosen in the dialog:** black by default, white, or any colour from the
  app's colour picker, shown with Fit. It is checked at the server as `#RRGGBB` and also fills what
  has no content elsewhere: the transparent areas of a JPEG and the margin around a card that is not
  a picture, whatever the shape. An export never depends on the theme of the person making it, so it
  comes out the same for everyone. Cards and the paper under a composition of several cards stay in
  the light print style, so their text stays readable.
- **An exception to decision 0038: original files, only by explicit choice.** With the Original
  shape and a selection, "Dimensione" offers "File originale": the bytes as they were uploaded, with
  their filename and metadata, one file directly and several in one ZIP. It always starts on
  "Anteprima" and is never remembered, so nobody exports a GPS position by accident; a warning says
  so while it is chosen. It uses `/assets/:assetId/file?download=1` and so the existing download
  permission (decision 0011): the control is disabled for viewers and the server refuses them
  anyway. For clients it stays allowed with the same warning, and cards hidden from guests stay out.
- One file goes to the browser's own download after a `HEAD` asks whether the server would give it.
  Several are fetched one at a time into Blobs, so their bytes leave the JavaScript heap as they
  arrive, and zipped with a CRC read in chunks. A ZIP holds at most 2 GiB, a limit stated in the
  dialog: `zipBlobs` has no ZIP64, and browsers keep large Blobs on disk only up to a share of it.
  Files that fail are named and the ZIP is saved with the others.

## Consequences

- The same picture exported from the dark and the light theme is the same file.
- A card by itself is drawn without the running header and footer; pages of a storyboard or shot
  list keep them, since they are pages of a document.
- "File originale" is offered for a selection only: a whole board or storyboard is a picture of a
  page, not a set of files.
- A person who may download can hand on metadata that thumbnails strip, including to clients. That
  is the owner's default, under a visible warning; it is the same file they could already download
  from the card.
