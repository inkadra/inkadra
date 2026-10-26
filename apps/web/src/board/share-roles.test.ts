import { describe, expect, it } from 'vitest';
import { linkRoleChoices, roleChoices } from './share-roles.ts';

describe('share role choices', () => {
  it('lets owners name owners for people, not for links', () => {
    expect(roleChoices('owner')).toEqual(['viewer', 'commenter', 'editor', 'owner']);
    expect(linkRoleChoices('owner')).toEqual(['viewer', 'commenter', 'editor']);
  });

  it('never offers more than your own role', () => {
    expect(linkRoleChoices('editor')).toEqual(['viewer', 'commenter', 'editor']);
    expect(linkRoleChoices('commenter')).toEqual(['viewer', 'commenter']);
    expect(roleChoices('viewer')).toEqual(['viewer']);
  });
});
