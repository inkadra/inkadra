// SPDX-License-Identifier: AGPL-3.0-only
import type { AspectRatio } from '@inkadra/doc-schema';
import type { GuestBoardSnapshot, GuestElement, GuestVersion } from '@inkadra/shared';
import { Button, EmptyState, IconButton, Segmented } from '@inkadra/ui';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { primeAsset } from '../board/assets.ts';
import { FramePicture } from '../board/film/FramePicture.tsx';
import { useGuestActions } from './actions.ts';
import { guestApi } from './api.ts';
import { ReviewChip } from './GuestCardExtras.tsx';
import { GuestComments } from './GuestComments.tsx';
import { toAsset } from './guest-assets.ts';
import { framesBefore, linkDecisions, shotLabels, shownStatus, storyboardOrder } from './model.ts';

const NOW = 'now';

/**
 * The client review on a phone (#110, mockup screen 9): one shot at a time with its position,
 * Approve and Ask for changes, its comments, the shot as it was in a named version, and
 * "Send review", which tells the team (decision 0074). Decisions are saved one at a time.
 */
export function GuestReview({
  snapshot,
  boardTitle,
  onShowBoard,
}: {
  snapshot: GuestBoardSnapshot | null;
  boardTitle: string;
  onShowBoard: () => void;
}) {
  const { t } = useTranslation();
  const actions = useGuestActions();
  const { rights, linkId, boardId } = actions;
  const elements = snapshot?.elements ?? [];
  const frames = useMemo(
    () => storyboardOrder(elements.filter((e) => e.type === 'frame'), elements),
    [elements],
  );
  const labels = useMemo(() => shotLabels(elements), [elements]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const index = Math.max(
    0,
    frames.findIndex((f) => f.id === currentId),
  );
  const frame = frames[index];
  const versions = useVersions(rights.review && frames.length > 0, linkId, boardId);
  const before = frame && versions.list ? framesBefore(versions.list, frame) : [];
  const [shown, setShown] = useState(NOW);
  // A new shot starts on how it is now.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per shot
  useEffect(() => setShown(NOW), [frame?.id]);
  const compared = before.find((b) => b.version.id === shown)?.frame;
  const picture = compared ?? frame;
  const counts = linkDecisions(
    actions.reviews,
    frames.map((f) => f.id),
  );
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const aspect = (snapshot?.board.aspect ?? '16:9') as AspectRatio;

  if (!snapshot)
    return (
      <section className="guest-review" aria-busy="true">
        <p className="guest-review__state ink-muted" role="status">
          {t('guest.loading')}
        </p>
      </section>
    );
  if (!frame)
    return (
      <section className="guest-review">
        <EmptyState icon="storyboard" title={t('guest.review.phone.title')}>
          {t('guest.review.phone.empty')}
        </EmptyState>
        <Button onClick={onShowBoard}>{t('guest.review.phone.board')}</Button>
      </section>
    );

  const label = (el: GuestElement) =>
    (typeof el.label === 'string' && el.label.trim()) || labels.get(el.id) || t('board.types.frame');
  const status = shownStatus(actions.reviews.get(frame.id)?.status);
  const decide = (value: 'approved' | 'changes_requested') =>
    actions.withName(async () => {
      setBusy(true);
      try {
        if (await actions.review(frame.id, { status: value }))
          actions.notify(t(`guest.review.done.${value}`));
      } catch (err) {
        actions.notify(err instanceof Error ? err.message : t('guest.errors.generic'));
      } finally {
        setBusy(false);
      }
    });
  const send = () =>
    actions.withName(async () => {
      setSending(true);
      try {
        const summary = await guestApi.sendReview(linkId, boardId);
        actions.notify(
          t(summary.sent ? 'guest.review.phone.sent' : 'guest.review.phone.alreadySent'),
        );
      } catch (err) {
        actions.notify(actions.fail(err) ?? t('guest.errors.generic'));
      } finally {
        setSending(false);
      }
    });
  const choices = [
    ...before
      .slice(0, 2)
      .reverse()
      .map((b) => ({ value: b.version.id, label: b.version.name })),
    { value: NOW, label: t('guest.review.phone.now') },
  ];
  const action = typeof picture?.action === 'string' ? picture.action : '';

  return (
    <section className="guest-review" aria-label={t('guest.review.phone.title')}>
      <header className="guest-review__head">
        <span className="guest-review__heading">
          {t('guest.review.phone.title')}
          <small>{boardTitle}</small>
        </span>
        {choices.length > 1 && (
          <Segmented
            className="guest-review__versions"
            label={t('guest.review.phone.versions')}
            value={shown}
            onChange={setShown}
            options={choices}
          />
        )}
      </header>
      {versions.failed && (
        <p className="guest-review__note ink-muted" role="status">
          {t('guest.review.phone.versionsFailed')}
        </p>
      )}
      <div className="guest-review__picture">
        <FramePicture
          key={`${picture?.id}-${shown}`}
          assetId={typeof picture?.assetId === 'string' ? picture.assetId : undefined}
          aspect={picture?.aspect as AspectRatio | undefined}
          boardAspect={aspect}
          strokes={picture?.strokes as never}
          shapes={picture?.shapes as never}
          pixels={720}
        />
      </div>
      <div className="guest-review__title">
        <IconButton
          icon="chevronLeft"
          label={t('clientReview.previous')}
          disabled={index === 0}
          onClick={() => setCurrentId(frames[index - 1]?.id ?? null)}
        />
        <h2>{label(frame)}</h2>
        <span className="guest-review__position">
          {t('clientReview.position', { index: index + 1, total: frames.length })}
        </span>
        <IconButton
          icon="chevronRight"
          label={t('clientReview.next')}
          disabled={index >= frames.length - 1}
          onClick={() => setCurrentId(frames[index + 1]?.id ?? null)}
        />
      </div>
      {action && <p className="guest-review__action">{action}</p>}
      {status !== 'none' && (
        <p className="guest-review__status">
          <ReviewChip review={actions.reviews.get(frame.id)} />
        </p>
      )}
      {rights.review && (
        <div className="guest-review__decide">
          <Button
            variant="primary"
            size="lg"
            icon="check"
            aria-pressed={status === 'approved'}
            disabled={busy}
            onClick={() => decide('approved')}
          >
            {t('guest.review.approve')}
          </Button>
          <Button
            size="lg"
            icon="comment"
            aria-pressed={status === 'changes_requested'}
            disabled={busy}
            onClick={() => decide('changes_requested')}
          >
            {t('guest.review.requestChanges')}
          </Button>
        </div>
      )}
      {rights.comments && <GuestComments key={frame.id} elementId={frame.id} />}
      <div className="guest-review__footer">
        {rights.review && (
          <Button
            size="lg"
            block
            disabled={sending || counts.approved + counts.changes === 0}
            onClick={send}
          >
            {t('guest.review.phone.send', {
              approved: t('guest.review.phone.approved', { count: counts.approved }),
              changes: t('guest.review.phone.changes', { count: counts.changes }),
            })}
          </Button>
        )}
        <Button variant="ghost" onClick={onShowBoard}>
          {t('guest.review.phone.board')}
        </Button>
      </div>
    </section>
  );
}

/** Named versions to compare with, fetched once per board; their pictures go to the cache. */
function useVersions(enabled: boolean, linkId: string, boardId: string) {
  const [state, setState] = useState<{ list: GuestVersion[] | null; failed: boolean }>({
    list: null,
    failed: false,
  });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    guestApi.versions(linkId, boardId).then(
      (result) => {
        if (!live) return;
        for (const asset of result.assets) primeAsset(toAsset(asset));
        setState({ list: result.versions, failed: false });
      },
      () => live && setState({ list: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [enabled, linkId, boardId]);
  return state;
}
