import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

it('turns off Zod code generation before any schema is created', async () => {
  const probe = vi.spyOn(globalThis, 'Function');
  await import('./zod-jitless.ts');
  const { globalConfig } = await import('zod/v4/core');
  expect(globalConfig.jitless).toBe(true);
  // Shared and doc-schema build object schemas at import time; with jitless set, none of them
  // tries `new Function` (the eval that CSP reports).
  await import('@inkadra/shared');
  await import('@inkadra/doc-schema');
  expect(probe).not.toHaveBeenCalled();
  probe.mockRestore();
});

it('is the first import of the web entry point', () => {
  const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
  expect(main.match(/^import .+$/m)?.[0]).toBe("import './zod-jitless.ts';");
});
