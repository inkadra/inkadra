// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A part of the app that no longer exists on the server: this tab still runs the build from
 * before a deploy (#832). Chrome, Firefox and Safari word it differently; Vite adds its own for
 * preloaded CSS.
 */
export function isChunkError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
      error.message,
    )
  );
}

const RELOADED = 'inkadra:update-reload';

/**
 * Reloads the page to pick up the new build, at most once a minute: if the reload does not
 * help, the error page says what happened instead of reloading in a loop.
 */
export function reloadForUpdate(): boolean {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOADED)) < 60_000) return false;
    sessionStorage.setItem(RELOADED, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** A route's lazy module; one missing after a deploy reloads the page once. */
export async function lazyRoute<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isChunkError(error) && reloadForUpdate()) return new Promise<T>(() => {});
    throw error;
  }
}

/** Vite's own signal that a module's dependencies could not be preloaded. */
export function reloadOnPreloadError() {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForUpdate()) event.preventDefault();
  });
}
