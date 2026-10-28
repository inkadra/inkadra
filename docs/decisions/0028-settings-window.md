# 0028 · Settings open as a window over the current page

Settings used to replace the page and the project sidebar. They now open as a modal window
(a full-screen sheet on phones) over whatever was on screen, and closing them returns to it
untouched. The URLs do not change (`/settings?section=…`, `/settings/team`), so links, the
search actions and bookmarks keep working.

The settings routes stay ordinary children of the app layout. The layout remembers the last
page element it rendered outside settings and keeps rendering it while a settings URL is
open, inside a location context that still holds that page's URL; the settings route renders
into the window instead. The page is therefore never unmounted: an open board keeps its
collaboration connection, scroll and selection, and nothing in it reacts to the settings URL.
A settings URL loaded directly has no page to remember and shows Home underneath.

The usual alternative, rendering routes a second time with a "background location" kept in
history state, needs every route available to a nested `<Routes>`. That duplicates the lazy
board route outside the data router and remounts the board when settings open. Keeping the
rendered element is simpler and preserves state; the price is `UNSAFE_LocationContext`, a
React Router export that may change in a major version.

Moving between settings pages replaces the history entry, so the browser's Back closes the
window. On phones the list of pages pushes the page, so Back first returns to the list.
Closing goes back through the entries settings added, or replaces the URL with the page
underneath when there are none.
