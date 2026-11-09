import {
  atLeast,
  CAPABILITIES,
  CAPABILITY_ROLE,
  guestCan,
  guestCapabilities,
  roleCapabilities,
} from '@inkadra/shared';
import { describe, expect, it } from 'vitest';

/** The share dialog's texts on roles (share.legend.*, guestLinks.roleHelp.*) say what these do. */
describe('what the role texts are based on', () => {
  it.each(['owner', 'editor', 'commenter', 'viewer'] as const)(
    'uses server role thresholds for %s',
    (role) => {
      expect(roleCapabilities(role)).toEqual(
        CAPABILITIES.map((capability) => atLeast(role, CAPABILITY_ROLE[capability])),
      );
    },
  );
  it('distinguishes view, comment, edit, sharing and original downloads', () => {
    expect(roleCapabilities('viewer')).toEqual([true, false, false, false, false]);
    expect(roleCapabilities('commenter')).toEqual([true, true, false, false, true]);
    expect(roleCapabilities('editor')).toEqual([true, true, true, true, true]);
  });
  it.each(['guest_view', 'guest_comment', 'guest_approve'] as const)(
    'honors %s and both download settings',
    (role) => {
      for (const allowDownload of [false, true]) {
        expect(guestCapabilities({ role, allowDownload, proofing: false })).toEqual([
          true,
          role !== 'guest_view',
          false,
          false,
          allowDownload,
        ]);
      }
    },
  );
  it('gives guests what the role descriptions under the choice say', () => {
    const can = (role: 'guest_view' | 'guest_comment' | 'guest_approve') =>
      (['view', 'read_comments', 'write_comments', 'review'] as const).filter((action) =>
        guestCan({ role, proofing: false }, action),
      );
    expect(can('guest_view')).toEqual(['view']);
    expect(can('guest_comment')).toEqual(['view', 'read_comments', 'write_comments']);
    expect(can('guest_approve')).toEqual(['view', 'read_comments', 'write_comments', 'review']);
  });
});
