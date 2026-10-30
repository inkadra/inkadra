# Inkadra Clipper

Browser extension (Chrome, Edge, Brave, Arc: Manifest V3) that saves images, text and links to
an Inkadra board. It talks to the server only through the public API of `@inkadra/shared`:
`POST /api/v1/clip` to save, and the read endpoints to pick a board.

What it does:
- **Toolbar button**: saves the current page as a link card, with a board (recent boards
  first, then projects and their sub-boards, or search), a column, a note and tags. The tab title is kept on link cards. The board is
  remembered for next time.
- **Right-click menus**: on an image, a selection (a note with the quote and its page), a
  link or the page itself. They save to the board last chosen from the toolbar button.
  Images are read inside the browser, with the page's cookies when it can, so pictures
  behind a login are uploaded as files; when they cannot be read the image address is sent
  instead.
- **Shortcut**: `Alt+Shift+S` saves the page to the last board. Change it at
  `chrome://extensions/shortcuts`.

Interface text is in `public/_locales` (Italian is the default, English the other).

## Build

```sh
pnpm install
pnpm --filter @inkadra/clipper build
```

This writes the unpacked extension to `apps/clipper/dist/` and a zip for the Chrome Web Store
to `apps/clipper/release/inkadra-clipper-<version>.zip`. The icons are drawn by
`scripts/package.mjs` during the build. `pnpm --filter @inkadra/clipper watch` rebuilds `dist/`
on every change (reload the extension to see it).

Other commands: `pnpm --filter @inkadra/clipper test` (unit tests) and `… typecheck`.

## Load it unpacked

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode** and choose **Load unpacked**, then select `apps/clipper/dist`.
3. The settings page opens. Its **Extension you built yourself** section shows the extension
   id and the redirect address.

An unpacked extension gets an id derived from its folder path, so it changes when the folder
moves. To keep the same id across machines, add a `key` (public key) to `manifest.json` of
your own build; see Chrome's documentation on keeping a consistent extension id.

## Connect to a server

1. In the settings page, type the address of your server (`https://inkadra.example.com`)
   and choose **Connect**.
2. Chrome asks for permission to contact **that address only**: the extension has no access
   to other sites until you right-click or press its button on them.
3. A window opens on the server's `/authorize` page: sign in if needed, check the device name
   and allow access. The extension receives an app token (OAuth 2.0 code flow with PKCE
   S256) and keeps it in `chrome.storage.local`.

The token appears in **Settings → Account → Apps and tokens** on the web, where it can be
revoked. **Disconnect** in the extension revokes it on the server and forgets it. When the
server answers 401 (token revoked or expired), the extension asks to reconnect.

## Self-built extensions and CLIPPER_EXTENSION_IDS

The server hands out tokens only to the official extension ids, so another extension cannot
get a token from someone who clicks "Allow". A self-built or unpacked clipper has a different
id: the server administrator adds it to `CLIPPER_EXTENSION_IDS` (comma-separated, see
[configuration](../../docs/self-hosting/configuration.md)) and restarts the server:

```sh
CLIPPER_EXTENSION_IDS=abcdefghijklmnopabcdefghijklmnop
```

Until then, the `/authorize` page answers that the app is not one of the official ones.

## Permissions

| Permission                                    | Why                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `storage`                                     | Server address, token, last and recent boards                                                    |
| `identity`                                    | The sign-in window (`launchWebAuthFlow`)                                                         |
| `contextMenus`                                | The right-click menus                                                                            |
| `activeTab`, `scripting`                      | Read an image with the page's cookies and show a confirmation, only on the tab where you clicked |
| `optional_host_permissions` (`http(s)://*/*`) | Lets the settings page ask for **your server's origin only**; nothing is granted at install      |

## Not in this version

Area and full-page screenshots, a "collection mode" that highlights the images of a page,
and Firefox.

## Columns, permissions and compatibility

The popup lists `GET /api/v1/boards/{id}/columns` after selecting a board (including the
remembered board), in the order returned by the server. An empty title is shown as
"Untitled column". "Unsorted" always omits `columnId`; an empty list or an unsupported
endpoint (404, 405, 501) leaves only that option. Changing boards resets the column and
ignores late responses for the previous board. Other errors remain visible. Menus and the
shortcut still use Unsorted on the last board; the column choice is not persisted.

Search hides board and card hits whose `myRole` is below editor, while missing roles from
servers before API 0.5.0 remain visible. Page saves send the tab title (up to 500 characters);
a context-menu link to another page does not inherit the source tab's unrelated title.

Clip errors preserve `details.reason`. `outcome_unknown` and every HTTP 500 (including
missing, malformed or unknown reasons) ask to check the board before trying again, per
ADR 0017. There are no automatic clip retries. HTTP 413 reports the upload limit from
`Instance.limits` cached at connection time when positive, otherwise a generic size error;
HTTP 429 asks to wait a minute. Both locales use the same messages in popup and menu toasts.

## Long uploads in Chrome MV3

Image reads and multipart uploads run in the service worker, including context-menu saves
with no popup open. An unresolved fetch or an open message channel alone is insufficient
to keep an MV3 worker alive. Each user-initiated save is wrapped in `whileClipping`: every
20 seconds it calls `chrome.runtime.getPlatformInfo()` to reset Chrome's idle timer, using
Chrome's documented [long-operation waitUntil pattern](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers#keep_a_service_worker_alive_until_a_long-running_operation_is_finished).
The timer starts before reading the connection/image and ends in `finally`, after success
or failure. Concurrent clips have independent timers. There is no permanent heartbeat,
additional permission, offscreen page, dependency on the popup, or upload replay.

This prevents idle shutdown during a slow upload; it cannot survive browser exit, extension
reload or a process crash. Check the board before manually repeating an interrupted save.
Unit tests exercise the actual background handlers with pending mock fetches beyond 30
seconds, success/failure cleanup and overlapping saves. For a real-browser check, load the
unpacked extension, close its worker DevTools (which itself prevents idle shutdown), and save
an image through the context menu over a connection slow enough to take over 30 seconds.
Confirm one request/card and that the worker can become idle again after completion.

## Clip destination history

Confirmed clips update a private server history shared across browsers (up to 20 boards).
The first accessible destination is the default. The extension caches this list locally
for offline use; successful server reads replace the cache, including empty lists. Older
servers keep local-only history. See [ADR 0036](../../docs/decisions/0036-personal-clip-history.md)
and the generated API contract for `GET /api/v1/me/clip-boards` and
`DELETE /api/v1/me/clip-boards/{boardId}`.
