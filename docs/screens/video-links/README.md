# Video link card regression

Before/after screenshots render the actual `Card` component with the corresponding
board CSS from `origin/main` and this branch, using Playwright against static HTML.
Both use the same existing bare YouTube card with a persisted height of 400px;
the corrected card fits its content and exposes a keyboard-accessible play button.
These are component fixtures, not screenshots of the deployed instance. Provider
metadata and thumbnails are covered separately by server tests. No live playback
or phone browser session was performed.
