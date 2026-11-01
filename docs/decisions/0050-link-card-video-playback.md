# 0050 · Link cards: inline video playback, Vimeo and Instagram

Proposed, 2026-11. Extends the board link card (decisions 0009 and 0035). Issues #303 and #321.

**Context.** A YouTube link card opened the viewer to play. People want to play a reference in
place, next to the others, and Vimeo and Instagram links should preview as well as YouTube.
Every embed is a third-party page inside Inkadra, so each one has a privacy and CSP cost.

**Decision.**
- **Inline player.** Play on a YouTube or Vimeo card swaps the thumbnail for the player in the
  card's picture. No iframe exists before play. One card plays at a time (a small shared
  store); starting another, pressing Esc, opening the viewer, the card moving more than a screen
  off-screen or unmounting all return the card to its thumbnail. The card is dragged by its title
  and frame; ↗ opens the viewer. Guests and phones use the same card.
- **Privacy.** YouTube through `youtube-nocookie.com`, Vimeo through `player.vimeo.com` with
  `dnt=1`. `frame-src` and the `permissions-policy` lists name exactly these two origins.
- **Vimeo preview.** Title, author, duration (in the description) and a 1280 px thumbnail from
  Vimeo's oEmbed, through the existing SSRF-safe `safeFetch`. The viewer plays Vimeo too.
- **Instagram: preview, no embed.** The server reads the Open Graph tags of the post: caption as
  title, handle as author, thumbnail copied as an asset. Instagram's embed loads its scripts and
  cookies and cannot be limited to the user's click in a way we can check, and its oEmbed needs
  an app token. So the card shows an Instagram badge and ↗ "Open on Instagram", and
  `frame-src` stays without Instagram. When Instagram answers with a login page instead of the
  tags, the card is a plain link.

**Consequences.** Revisit Instagram only if an embed without third-party calls before the click
becomes possible. Other video providers are one more entry in `videoEmbedUrl` and the CSP.
