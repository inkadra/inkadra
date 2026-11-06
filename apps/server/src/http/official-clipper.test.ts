// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import type { Config } from '../config.ts';
import { allowedRedirects } from './account-routes.ts';

it('lets the Web Store clipper sign in, next to self-built ones', () => {
  const config = { CLIPPER_EXTENSION_IDS: ['abcdefghijklmnopabcdefghijklmnop'] } as Config;
  expect(allowedRedirects(config, 'clipper')).toEqual([
    'https://hdajoikapihpjfbgioeagenmoalckjkh.chromiumapp.org/auth',
    'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/auth',
  ]);
});
