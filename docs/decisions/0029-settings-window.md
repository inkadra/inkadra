# 0029 · Settings open as a window over the current page

Settings used to replace the page and the project sidebar. They now open as a modal window
(a full-screen sheet on phones) over whatever was on screen, and closing them returns to it
untouched. The URLs do not change (`/settings?section=…`, `/settings/team`), so links, the
search actions and bookmarks keep working.

The settings routes stay ordinary children of the app layout. The layout remembers the last
page element it rendered outside settings and keeps rendering it while a settings URL is
open, inside a location context that still holds that page's URL; the settings route renders
into the window instead. The page is therefore never unmounted: an open board keeps its
collaboration connection, scroll and selection, and its location hooks keep reading the
background URL. Data-router subscriptions can still observe router state; overriding location
alone does not isolate navigation.
A settings URL loaded directly has no page to remember and shows Home underneath.

The usual alternative, rendering routes a second time with a "background location" kept in
history state, needs every route available to a nested `<Routes>`. That duplicates the lazy
board route outside the data router and remounts the board when settings open. Keeping the
rendered element is simpler and preserves state; the price is `UNSAFE_LocationContext`, a
React Router export. The underlay also wraps `UNSAFE_NavigationContext` and
`UNSAFE_DataRouterContext`: both navigator calls and data-router `router.navigate` calls
from the page underneath are ignored while settings are open (including callbacks captured
before opening). This deliberately drops stale asynchronous navigation rather than queueing
it: replaying it could discard settings edits or unexpectedly move the page after closing.
The wrappers remain mounted when closed and forward navigation normally. This does not
isolate fetchers, revalidation or direct singleton-router calls; underlay code must use routing
hooks for navigation. React Router is pinned to the current minor with a tilde because these
UNSAFE exports may change in a minor release; upgrades require the data-router regression tests.

Moving between settings pages replaces the history entry, so the browser's Back closes the
window. On phones the list of pages pushes the page, so Back first returns to the list.
Closing goes back through the entries settings added, or replaces the URL with the page
underneath when there are none. Positions are remembered by location key, so Back and
Forward restore the correct distance rather than treating every POP as Back. The Diagnostics
footer first closes all settings entries and then pushes Diagnostics, so Back returns to the
background page even after visiting multiple phone sections. The modal locks body scrolling
and initially focuses its heading, leaving selected navigation styling neutral.
