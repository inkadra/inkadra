import { onNoSession } from './model.ts';

/** A generation identifies requests made with one cookie, even when the guest ID stays the same. */
export class SessionRecovery {
  private generation = 0;
  private openedAt: number | null = null;

  begin() {
    return ++this.generation;
  }

  isCurrent(generation: number) {
    return generation === this.generation;
  }

  opened(generation: number, now: number) {
    if (!this.isCurrent(generation)) return false;
    this.openedAt = now;
    return true;
  }

  noSession(generation: number, now: number, cookiesEnabled = true) {
    if (!this.isCurrent(generation)) return 'ignore';
    // Invalidate synchronously: concurrent failures cannot act during or after reopening.
    this.begin();
    return onNoSession(this.openedAt, now, cookiesEnabled);
  }
}
