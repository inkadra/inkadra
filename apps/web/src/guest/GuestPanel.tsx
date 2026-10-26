import type { GuestBoardSnapshot, GuestElement, GuestSession } from '@inkadra/shared';
import { Button } from '@inkadra/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGuestActions } from './actions.ts';
import { PickControls, ReviewChip } from './GuestCardExtras.tsx';
import { GuestComments } from './GuestComments.tsx';
import { boardTree, canWithdraw, cardLabel, isPicture, shotLabels, shownStatus } from './model.ts';

const LISTED = new Set(['note', 'image', 'link', 'file', 'todo', 'color', 'board', 'frame']);

/** The side of the guest page: who you are, the boards of the link, and the selected card. */
export function GuestPanel({
  session,
  snapshot,
  selected,
  onOpenBoard,
  onAskName,
}: {
  session: GuestSession;
  snapshot: GuestBoardSnapshot | null;
  selected: GuestElement | null;
  onOpenBoard: (id: string) => void;
  onAskName: () => void;
}) {
  const { t } = useTranslation();
  const actions = useGuestActions();
  const { rights } = actions;
  const writes = rights.comments || rights.review || rights.pick;
  const tree = boardTree(session.boards, session.boardId);
  const cardsId = useId();
  const elements = snapshot?.elements ?? [];
  const cards = elements.filter((e) => LISTED.has(e.type));
  const shots = shotLabels(elements);
  // Frames take the shot label of the canvas; cards without text of their own are told apart
  // by number: "Immagine 1", "Immagine 2".
  const labels = new Map<string, string>();
  const numbers = new Map<string, number>();
  for (const el of cards) {
    const own = (el.type === 'frame' ? shots.get(el.id) : undefined) ?? cardLabel(el);
    if (own) labels.set(el.id, own);
    else {
      const n = (numbers.get(el.type) ?? 0) + 1;
      numbers.set(el.type, n);
      labels.set(el.id, `${t(`board.types.${el.type}`)} ${n}`);
    }
  }
  const label = (el: GuestElement) => labels.get(el.id) ?? t(`board.types.${el.type}`);
  const picked = (snapshot?.picks ?? []).filter((p) => p.pick === 'picked').length;
  const rejected = (snapshot?.picks ?? []).filter((p) => p.pick === 'rejected').length;

  return (
    // Keys pressed in the panel are its own, not the canvas's shortcuts.
    <aside
      className="guest-panel"
      aria-label={t('guest.panel')}
      data-scroll
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <p className="guest-panel__notice" role="status">
        {actions.notice}
      </p>
      <section className="guest-panel__section guest-you">
        <p className="guest-you__line">
          {session.guest.name
            ? t('guest.you.named', { name: session.guest.name })
            : t('guest.you.anonymous')}
        </p>
        {writes && (
          <Button variant="ghost" onClick={onAskName}>
            {session.guest.name ? t('guest.you.rename') : t('guest.you.setName')}
          </Button>
        )}
      </section>

      {tree.length > 1 && (
        <nav className="guest-panel__section" aria-label={t('guest.boards')}>
          <h2 className="guest-panel__heading">{t('guest.boards')}</h2>
          <ul className="guest-boards">
            {tree.map(({ board, depth }) => (
              <li key={board.id} style={{ paddingInlineStart: depth * 14 }}>
                <button
                  type="button"
                  className="guest-boards__item"
                  aria-current={board.id === actions.boardId ? 'page' : undefined}
                  onClick={() => onOpenBoard(board.id)}
                >
                  {board.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {cards.length > 0 && (
        <div className="guest-panel__section">
          <label className="guest-panel__label" htmlFor={cardsId}>
            {t('guest.card.choose')}
          </label>
          <select
            id={cardsId}
            className="ink-input guest-panel__select"
            value={selected?.id ?? ''}
            onChange={(e) => actions.select(e.target.value || null)}
          >
            <option value="">{t('guest.card.none')}</option>
            {cards.map((el) => (
              <option key={el.id} value={el.id}>
                {label(el)}
              </option>
            ))}
          </select>
        </div>
      )}

      {selected ? (
        <CardSection key={selected.id} element={selected} title={label(selected)} />
      ) : (
        <>
          <section className="guest-panel__section">
            <p className="ink-muted guest-panel__hint">{t('guest.card.hint')}</p>
            {rights.pick && (
              <p className="guest-panel__hint">{t('guest.pick.summary', { picked, rejected })}</p>
            )}
          </section>
          {rights.comments && snapshot && <GuestComments key="board" elementId={null} />}
        </>
      )}
    </aside>
  );
}

function CardSection({ element, title }: { element: GuestElement; title: string }) {
  const { t } = useTranslation();
  const actions = useGuestActions();
  const { rights } = actions;
  const assetId = typeof element.assetId === 'string' ? element.assetId : undefined;
  const asset = assetId ? actions.assets.get(assetId) : undefined;
  const picture = isPicture(element);

  return (
    <>
      <section className="guest-panel__section" aria-labelledby={`card-${element.id}`}>
        <h2 id={`card-${element.id}`} className="guest-panel__card-title">
          {title}
        </h2>
        <p className="ink-muted guest-panel__type">{t(`board.types.${element.type}`)}</p>
        <div className="guest-panel__row">
          {(picture || element.type === 'file') && asset && (
            <Button variant="secondary" onClick={() => actions.view(element.id)}>
              {t('guest.viewer.open')}
            </Button>
          )}
          {rights.download && asset?.downloadUrl && (
            <a
              className="ink-btn ink-btn--secondary"
              href={asset.downloadUrl}
              download={asset.filename ?? ''}
            >
              {t('guest.download')}
            </a>
          )}
        </div>
      </section>
      <ReviewSection elementId={element.id} />
      {rights.pick && picture && (
        <section className="guest-panel__section">
          <h2 className="guest-panel__heading">{t('guest.pick.title')}</h2>
          <PickControls elementId={element.id} />
        </section>
      )}
      {rights.comments && <GuestComments elementId={element.id} />}
    </>
  );
}

function ReviewSection({ elementId }: { elementId: string }) {
  const { t } = useTranslation();
  const actions = useGuestActions();
  const review = actions.reviews.get(elementId);
  const status = shownStatus(review?.status);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const noteId = useId();
  if (!actions.rights.review && status === 'none') return null;

  const send = (value: 'approved' | 'changes_requested' | 'none') =>
    actions.withName(async () => {
      setBusy(true);
      try {
        const done = await actions.review(elementId, {
          status: value,
          ...(value !== 'none' && note.trim() ? { note: note.trim() } : {}),
        });
        if (done) {
          setNote('');
          actions.notify(t(`guest.review.done.${value}`));
        }
      } catch (err) {
        actions.notify(err instanceof Error ? err.message : t('guest.errors.generic'));
      } finally {
        setBusy(false);
      }
    });

  return (
    <section className="guest-panel__section">
      <h2 className="guest-panel__heading">{t('guest.review.title')}</h2>
      {status === 'none' ? (
        <p className="ink-muted guest-panel__hint">{t('guest.review.status.none')}</p>
      ) : (
        <p className="guest-panel__review">
          <ReviewChip review={review} />
          {review && (
            <span className="ink-muted">
              {review.changedBy.isYou
                ? t('guest.review.byYou')
                : review.changedBy.name
                  ? t('guest.review.by', { name: review.changedBy.name })
                  : ''}
            </span>
          )}
        </p>
      )}
      {review?.note && <p className="guest-panel__note">{review.note}</p>}
      {actions.rights.review && (
        <>
          <label className="guest-sr" htmlFor={noteId}>
            {t('guest.review.note')}
          </label>
          <input
            id={noteId}
            className="ink-input"
            placeholder={t('guest.review.note')}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="guest-panel__row">
            <Button
              aria-pressed={status === 'approved'}
              disabled={busy}
              onClick={() => send('approved')}
            >
              {t('guest.review.approve')}
            </Button>
            <Button
              aria-pressed={status === 'changes_requested'}
              disabled={busy}
              onClick={() => send('changes_requested')}
            >
              {t('guest.review.requestChanges')}
            </Button>
            {canWithdraw(review) && (
              <Button variant="ghost" disabled={busy} onClick={() => send('none')}>
                {t('guest.review.withdraw')}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
