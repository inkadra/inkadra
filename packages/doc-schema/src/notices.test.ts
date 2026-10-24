// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { readBoardNotice } from './index.ts';

describe('board notices', () => {
  it('reads the messages it knows', () => {
    expect(readBoardNotice('{"type":"access","readOnly":true}')).toEqual({
      type: 'access',
      readOnly: true,
    });
    const threadId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
    expect(
      readBoardNotice(JSON.stringify({ type: 'comments', elementId: null, threadId })),
    ).toEqual({ type: 'comments', elementId: null, threadId });
    expect(readBoardNotice('{"type":"review","elementId":"V1StGXR8_Z5jdHi6B-myT"}')?.type).toBe(
      'review',
    );
    expect(readBoardNotice(JSON.stringify({ type: 'versions', versionId: threadId }))).toEqual({
      type: 'versions',
      versionId: threadId,
    });
  });

  it('ignores malformed and unknown messages', () => {
    expect(readBoardNotice('not json')).toBeNull();
    expect(readBoardNotice('{"type":"fireworks"}')).toBeNull();
    expect(readBoardNotice('{"type":"restored","versionId":"nope"}')).toBeNull();
    expect(readBoardNotice('{"type":"versions"}')).toBeNull();
  });
});
