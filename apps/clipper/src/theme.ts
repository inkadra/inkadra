// SPDX-License-Identifier: MPL-2.0
import { dark, light } from '@inkadra/ui/tokens';

const vars = (tokens: Record<string, string>) =>
  Object.entries(tokens)
    .map(([k, v]) => `--ink-${k}:${v};`)
    .join('');

/** The --ink-* colour tokens of @inkadra/ui, following the system theme like the web app. */
export function applyTokens(): void {
  const style = document.createElement('style');
  style.textContent =
    `:root{color-scheme:dark;${vars(dark)}}` +
    `@media (prefers-color-scheme: light){:root{color-scheme:light;${vars(light)}}}`;
  document.head.prepend(style);
}
