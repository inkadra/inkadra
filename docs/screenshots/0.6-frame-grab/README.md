# Video frame grab · 0.6

Captured from the running app in installed Chrome on the workstation, using the fictional
**Last Train / Platform 09** project and a synthetic 1280×720 WebM recorded in Chrome.
No client footage or external video was downloaded. The image shown in each storyboard is
an actual uploaded PNG captured by the viewer through the normal tus/media flow.

| View                      | Desktop light                          | Desktop dark                          | Phone light                          | Phone dark                          |
| ------------------------- | -------------------------------------- | ------------------------------------- | ------------------------------------ | ----------------------------------- |
| Viewer and capture action | [Image](desktop-light-viewer.png)      | [Image](desktop-dark-viewer.png)      | [Image](phone-light-viewer.png)      | [Image](phone-dark-viewer.png)      |
| Destination choice        | [Image](desktop-light-destination.png) | [Image](desktop-dark-destination.png) | [Image](phone-light-destination.png) | [Image](phone-dark-destination.png) |
| Resulting storyboard      | [Image](desktop-light-storyboard.png)  | [Image](desktop-dark-storyboard.png)  | [Image](phone-light-storyboard.png)  | [Image](phone-dark-storyboard.png)  |

Desktop viewport: 1440×900. Phone viewport: 412×915. Themes use Inkadra's existing tokens.
Regenerate with `pnpm --filter @inkadra/e2e exec playwright test --config frame-grab.config.ts
--project chromium`, **on the workstation only**, with a unique `E2E_PORT`, disposable
Postgres/Valkey URLs and `CSP_ENFORCE=true`. The config uses installed Chrome and the built
server/web app, with no preview server. The tests also assert no CSP violations.

Stepping uses adjacent presentation timestamps observed through `requestVideoFrameCallback`.
An unobserved adjacent frame uses an approximate 1/30-second seek; this
is not a promise of frame accuracy for arbitrary seeks or variable-rate footage (ADR 0042).
YouTube/Vimeo use the stored server thumbnail, which does not depict the reference time.
YouTube times received from the player can seed the reference; the seconds field remains
editable when the player cannot report a time.

The viewer shows only the previous/next frame keyboard hint while paused. Source times in
the capture popover and card captions use a shared localized timecode (`0:00,62` in Italian,
`0:00.62` in English); numeric provenance retains its full precision. Hint text and key badges
use the shared viewer tokens on a token surface for contrast in both themes.
