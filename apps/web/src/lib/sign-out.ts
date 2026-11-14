// SPDX-License-Identifier: AGPL-3.0-only
import { authApi } from './api.ts';

/**
 * Every way of signing out (#831). The page then loads again from scratch: the boards,
 * groups, assets, tags, comment drafts and previews kept in memory for the last account go
 * with it (#824), and the same address leads to sign-in, or stays on an invitation.
 * A failed request rejects, and the caller says so: the person is still signed in.
 */
export async function signOut(): Promise<void> {
  await authApi.signOut();
  window.location.reload();
}
