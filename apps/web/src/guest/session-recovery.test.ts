import { describe, expect, it } from 'vitest';
import { COOKIE_CHECK_MS } from './model.ts';
import { SessionRecovery } from './session-recovery.ts';

describe('guest session recovery', () => {
  it('reopens once when several requests of an old session fail together', () => {
    const recovery = new SessionRecovery();
    const first = recovery.begin();
    expect(recovery.opened(first, 0)).toBe(true);
    // Two polls of the expired session answer no_session after the cookie check window.
    const now = COOKIE_CHECK_MS + 1;
    expect(recovery.noSession(first, now)).toBe('reopen');
    expect(recovery.noSession(first, now)).toBe('ignore');
    // The reopen starts a new generation: late answers of the old one change nothing.
    const reopened = recovery.begin();
    expect(recovery.isCurrent(first)).toBe(false);
    expect(recovery.opened(first, now)).toBe(false);
    expect(recovery.opened(reopened, now + 10)).toBe(true);
    // A failure of the old session arriving after the reopen is not taken for blocked cookies.
    expect(recovery.noSession(first, now + 20)).toBe('ignore');
    expect(recovery.isCurrent(reopened)).toBe(true);
  });

  it('stops at the cookie screen instead of creating another guest', () => {
    const recovery = new SessionRecovery();
    const generation = recovery.begin();
    recovery.opened(generation, 1000);
    // The cookie was not kept: the next request already does not know the session.
    expect(recovery.noSession(generation, 2000)).toBe('cookies');
    // A browser that refuses cookies outright never opens the link again.
    const refusing = new SessionRecovery();
    expect(refusing.noSession(refusing.begin(), 0, false)).toBe('cookies');
  });

  it('counts an open with the password typed again after more than a minute', () => {
    const recovery = new SessionRecovery();
    const first = recovery.begin();
    recovery.opened(first, 0);
    expect(recovery.noSession(first, COOKIE_CHECK_MS + 1)).toBe('reopen');
    // The reopen of a password link shows the form; the guest types it two minutes later.
    const form = recovery.begin();
    const typed = 3 * COOKIE_CHECK_MS;
    expect(recovery.opened(form, typed)).toBe(true);
    // Losing the session right after means blocked cookies, not another silent round.
    expect(recovery.noSession(form, typed + 1000)).toBe('cookies');
  });

  it('reopens again once a kept session expires much later', () => {
    const recovery = new SessionRecovery();
    const generation = recovery.begin();
    recovery.opened(generation, 0);
    expect(recovery.noSession(generation, 10 * COOKIE_CHECK_MS)).toBe('reopen');
  });
});
