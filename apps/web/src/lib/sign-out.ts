// SPDX-License-Identifier: AGPL-3.0-only
import { clearLocalBoards } from '../board/local-boards.ts';
import { authApi } from './api.ts';

/**
 * Every way of signing out (#831). The page then loads again from scratch: the boards,
 * groups, assets, tags, comment drafts and previews kept in memory for the last account go
 * with it (#824), and the same address leads to sign-in, or stays on an invitation.
 * The copies of the person's boards kept on this device go too (#791): the next person on this
 * browser must not find them. `useSignOut` asks first when some hold edits the server lacks.
 * A failed request rejects, and the caller says so: the person is still signed in.
 */
export async function signOut(userId: string | undefined): Promise<void> {
  await authApi.signOut();
  if (userId) await clearLocalBoards(userId).catch(() => {});
  window.location.reload();
}
