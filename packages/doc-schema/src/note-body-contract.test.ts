// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import * as schema from './index.ts';
it('declares the non-backward-compatible note body features in document schema 16', () => {
  expect((schema as unknown as Record<string,unknown>).NOTE_BODY_FORMAT).toEqual({version:16,marks:['noteInk'],nodes:['taskList','taskItem'],blockAttributes:['textAlign']});
});
