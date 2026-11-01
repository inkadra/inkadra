# 0050 · Link cards: inline video playback, Vimeo and Instagram

Proposed, 2026-11. Extends the board link card (decisions 0009 and 0035). Issues #303 and #321.

**Context.** A YouTube link card opened the viewer to play. People want to play a reference in
place, next to the others, and Vimeo and Instagram links should preview as well as YouTube.
Every embed is a third-party page inside Inkadra, so each one has a privacy and CSP cost.

**Decision.**
- **Inline player.** Play on a YouTube, Vimeo or Instagram card swaps the thumbnail for the
  player in the card's picture. No iframe exists before play: until the click the card shows
  only our own preview and a play button, and nothing is requested from the provider. One card
  plays at a time (a small shared store); starting another, pressing Esc, opening the viewer or
  unmounting returns the card to its thumbnail. So does the card going more than a screen
  off-screen, unless the person turned on **Continue playing videos off-screen** (Settings,
  Preferences; a setting of this browser like the theme, off by default). Guests and phones use
  the same card.
- **Dragging.** The providers' own controls stay: no custom controls on top. The player sits
  inside a 6 px frame, and the frame and the title below drag the card. Holding Alt lays a
  transparent shield over the player so the card drags from anywhere. While the player has
  keyboard focus the page does not see Alt (key events go to the iframe), and the frame still
  drags.
- **Privacy.** YouTube through `youtube-nocookie.com`, Vimeo through `player.vimeo.com` with
  `dnt=1`. `frame-src` and the `permissions-policy` lists name exactly these two origins and
  `www.instagram.com`.
- **Vimeo preview.** Title, author, duration (in the description) and a 1280 px thumbnail from
  Vimeo's oEmbed, through the existing SSRF-safe `safeFetch`. The viewer plays Vimeo too.
- **Instagram.** The server reads the Open Graph tags of the post: caption as title, handle as
  author, thumbnail copied as an asset (Instagram's oEmbed needs an app token). The card shows
  an Instagram badge. On play the card loads Instagram's official embed page
  (`/p/<code>/embed`, `/reel/<code>/embed`) in a taller picture area: a post is not 16:9, and
  Instagram cannot autoplay, so its own play button follows. The embed loads Instagram's scripts
  and cookies, but only after the click. ↗ opens the post on Instagram; the viewer and the
  gallery stay with YouTube and Vimeo. When Instagram answers with a login page instead of the
  tags, the card is a plain link.

**Consequences.** Other video providers are one more entry in `videoEmbedUrl` and the CSP.
