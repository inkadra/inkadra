// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { formatBytes } from './bytes.ts';

describe('formatBytes', () => {
  it('prints whole bytes under 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('steps by 1024 with one decimal under ten and none above', () => {
    expect(formatBytes(1024, 'en')).toBe('1 KB');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(4.2 * 1024 * 1024, 'it')).toBe('4,2 MB');
    expect(formatBytes(9.96 * 1024 * 1024, 'en')).toBe('10 MB');
    expect(formatBytes(148.6 * 1024 * 1024, 'en')).toBe('149 MB');
    expect(formatBytes(3 * 1024 ** 3, 'en')).toBe('3 GB');
  });

  it('stays in TB above it', () => {
    expect(formatBytes(2048 * 1024 ** 4, 'en')).toBe('2,048 TB');
  });
});
