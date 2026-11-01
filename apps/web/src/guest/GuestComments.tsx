import type { GuestAuthor, GuestComment, GuestCommentThread, ReactionEmoji } from '@inkadra/shared';
import { Button } from '@inkadra/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactionBar } from '../board/ReactionBar.tsx';
import { useGuestActions } from './actions.ts';
import { guestApi } from './api.ts';
import { failureOf } from './model.ts';
import { backoff } from './poller.ts';

const RETRY_MS = 5000;
const RETRY_MAX_MS = 60_000;

/**
 * Comments visible to everyone, as a guest sees them: threads about the board or one card,
 * names only. Guests write plain text; they cannot mention, resolve or see team threads.
 */
export function GuestComments({ elementId }: { elementId: string | null }) {
  const { t } = useTranslation();
  const actions = useGuestActions();
  const { linkId, boardId, version } = actions;
  const [threads, setThreads] = useState<GuestCommentThread[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Failed attempts in a row without an answer; the threads already shown stay.
  const [retries, setRetries] = useState(0);
  const latest = useRef<AbortController | null>(null);
  const headingId = useId();

  const load = useCallback(async () => {
    latest.current?.abort();
    const current = new AbortController();
    latest.current = current;
    try {
      const page = await guestApi.threads(
        linkId,
        boardId,
        elementId ? { elementId } : { scope: 'board' },
        current.signal,
      );
      if (current.signal.aborted) return;
      setThreads(page.items);
      setFailed(false);
      setRetries(0);
    } catch (err) {
      if (current.signal.aborted) return;
      if (failureOf(err).kind === 'transient') {
        setRetries((n) => n + 1);
        return;
      }
      actions.fail(err);
      setFailed(true);
    }
  }, [linkId, boardId, elementId, actions.fail]);

  // Another card or board: the threads shown belong to the one before.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the subject changes
  useEffect(() => {
    setThreads(null);
    setRetries(0);
  }, [linkId, boardId, elementId]);

  // The snapshot's version moves with every comment this guest can read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the board changed
  useEffect(() => {
    void load();
  }, [load, version]);

  useEffect(() => () => latest.current?.abort(), []);

  useEffect(() => {
    if (retries === 0) return;
    const timer = setTimeout(() => void load(), backoff(retries, RETRY_MS, RETRY_MAX_MS));
    return () => clearTimeout(timer);
  }, [retries, load]);

  const after = async () => {
    await load();
    actions.refresh();
  };

  return (
    <section className="guest-comments" aria-labelledby={headingId}>
      <h2 id={headingId} className="guest-panel__heading">
        {elementId ? t('guest.comments.onCard') : t('guest.comments.onBoard')}
      </h2>
      <Composer
        label={t('guest.comments.new')}
        submitLabel={t('guest.comments.send')}
        onSubmit={(body) =>
          guestApi.comment(linkId, boardId, { body, ...(elementId ? { elementId } : {}) })
        }
        onDone={after}
      />
      {retries > 0 ? (
        <p className="ink-muted guest-panel__hint" role="status">
          {t('guest.offline')}
        </p>
      ) : (
        failed && <p className="guest-panel__error">{t('guest.comments.loadFailed')}</p>
      )}
      {threads && threads.length === 0 && (
        <p className="ink-muted guest-panel__hint">{t('guest.comments.none')}</p>
      )}
      <ol className="guest-threads">
        {threads?.map((thread) => (
          <li key={thread.id} className="guest-thread">
            <CommentView comment={thread} onDone={after} />
            {thread.resolvedAt && (
              <span className="guest-thread__resolved">{t('guest.comments.resolved')}</span>
            )}
            {thread.replies.length > 0 && (
              <ol className="guest-thread__replies">
                {thread.replies.map((r) => (
                  <li key={r.id}>
                    <CommentView comment={r} onDone={after} />
                  </li>
                ))}
              </ol>
            )}
            {thread.replyCount > thread.replies.length && (
              <p className="ink-muted guest-panel__hint">
                {t('guest.comments.moreReplies', {
                  count: thread.replyCount - thread.replies.length,
                })}
              </p>
            )}
            <ReplyBox threadId={thread.id} onDone={after} />
          </li>
        ))}
      </ol>
    </section>
  );
}

export function authorName(
  t: (key: string, opts?: Record<string, unknown>) => string,
  author: GuestAuthor,
): string {
  if (author.isYou) return t('guest.comments.you', { name: author.name ?? '' });
  if (author.kind === 'team') return author.name ?? t('guest.comments.team');
  if (author.kind === 'guest')
    return author.name
      ? t('guest.comments.guest', { name: author.name })
      : t('guest.comments.aGuest');
  return t('guest.comments.deleted');
}

function when(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

function CommentView({ comment, onDone }: { comment: GuestComment; onDone: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const actions = useGuestActions();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const deleted = !!comment.deletedAt;
  const own = comment.author.isYou && !deleted;
  return (
    <article className="guest-comment">
      <header className="guest-comment__head">
        <span className="guest-comment__author">{authorName(t, comment.author)}</span>
        <time className="guest-comment__time" dateTime={comment.createdAt}>
          {when(comment.createdAt, i18n.language)}
        </time>
      </header>
      {editing ? (
        <Composer
          label={t('guest.comments.edit')}
          submitLabel={t('guest.comments.save')}
          initial={comment.body}
          autoFocus
          onSubmit={(body) => guestApi.editComment(actions.linkId, comment.id, body)}
          onDone={async () => {
            setEditing(false);
            await onDone();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className={deleted ? 'guest-comment__body ink-muted' : 'guest-comment__body'}>
          {deleted ? t('guest.comments.removed') : comment.body}
          {comment.editedAt && !deleted && (
            <span className="ink-muted"> {t('guest.comments.edited')}</span>
          )}
        </p>
      )}
      {!deleted && !editing && (
        <ReactionBar
          reactions={comment.reactions}
          {...(actions.rights.comments
            ? {
                onToggle: (emoji: ReactionEmoji, on: boolean) => {
                  // Reacting is under the guest's name: asked first if it is missing.
                  actions.withName(async () => {
                    try {
                      await guestApi.react(actions.linkId, comment.id, emoji, on);
                      await onDone();
                    } catch (err) {
                      actions.notify(actions.fail(err));
                    }
                  });
                  return Promise.resolve();
                },
              }
            : {})}
        />
      )}
      {own && !editing && actions.rights.comments && (
        <div className="guest-comment__actions">
          {confirming ? (
            <>
              <span>{t('guest.comments.deleteConfirm')}</span>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t('guest.cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  try {
                    await guestApi.deleteComment(actions.linkId, comment.id);
                    await onDone();
                  } catch (err) {
                    actions.notify(actions.fail(err));
                  }
                  setConfirming(false);
                }}
              >
                {t('guest.comments.delete')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setEditing(true)}>
                {t('guest.comments.edit')}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(true)}>
                {t('guest.comments.delete')}
              </Button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function ReplyBox({ threadId, onDone }: { threadId: string; onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const actions = useGuestActions();
  const [open, setOpen] = useState(false);
  if (!actions.rights.comments) return null;
  if (!open)
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        {t('guest.comments.reply')}
      </Button>
    );
  return (
    <Composer
      label={t('guest.comments.replyLabel')}
      submitLabel={t('guest.comments.reply')}
      autoFocus
      onSubmit={(body) =>
        guestApi.comment(actions.linkId, actions.boardId, { body, parentId: threadId })
      }
      onDone={async () => {
        setOpen(false);
        await onDone();
      }}
      onCancel={() => setOpen(false)}
    />
  );
}

/** A text box that asks for the guest's name before the first thing they send. */
function Composer({
  label,
  submitLabel,
  initial = '',
  autoFocus,
  onSubmit,
  onDone,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  initial?: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<unknown>;
  onDone: () => Promise<void>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const actions = useGuestActions();
  const id = useId();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!actions.rights.comments) return null;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim());
      setText('');
      await onDone();
    } catch (err) {
      setError(actions.fail(err));
    } finally {
      setBusy(false);
    }
  };

  function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!text.trim()) return;
    actions.withName(send);
  }

  return (
    <form className="guest-composer" onSubmit={submit}>
      <label htmlFor={id} className="guest-sr">
        {label}
      </label>
      <textarea
        id={id}
        className="ink-input guest-composer__text"
        placeholder={label}
        value={text}
        rows={2}
        maxLength={5000}
        // biome-ignore lint/a11y/noAutofocus: the box opens because the guest asked to write
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
          if (e.key === 'Escape' && onCancel) {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      {error && (
        <p className="guest-panel__error" role="alert">
          {error}
        </p>
      )}
      <div className="guest-composer__actions">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t('guest.cancel')}
          </Button>
        )}
        <Button type="submit" disabled={busy || !text.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
