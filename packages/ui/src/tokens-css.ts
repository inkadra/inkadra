import { dark, light } from './tokens.ts';

const vars = (tokens: Record<string, string>, indent: string) =>
  Object.entries(tokens)
    .map(([k, v]) => `${indent}--ink-${k}: ${v};`)
    .join('\n');

/** Source of tokens.css. `pnpm --filter @inkadra/ui tokens` writes it; a test checks it is current. */
export function tokensCss(): string {
  return `/* Generated from tokens.ts with \`pnpm --filter @inkadra/ui tokens\`. Do not edit by hand. */

:root,
:root[data-theme='dark'] {
  color-scheme: dark;
${vars(dark, '  ')}
}

:root[data-theme='light'] {
  color-scheme: light;
${vars(light, '  ')}
}

@media (prefers-color-scheme: light) {
  :root:not([data-theme]) {
    color-scheme: light;
${vars(light, '    ')}
  }
}
`;
}
