// SPDX-License-Identifier: MPL-2.0
/** Chrome's documented waitUntil pattern, scoped to a user-initiated clip only. */
export async function whileClipping<T>(work: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    // An actual extension API call resets MV3's idle timer; a timer alone does not.
    void chrome.runtime.getPlatformInfo().catch(() => {});
  }, 20_000);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}
