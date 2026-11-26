// SPDX-License-Identifier: AGPL-3.0-only
import { Button, Dialog, DialogActions, RadioGroup } from '@inkadra/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { elementDataMoves } from './scene-move.ts';
import './move-scenes.css';

/**
 * The one notice of a board with scenes outside a storyboard (decision 0140), above the toolbar:
 * Move to a storyboard, or Not now. It waits for an answer, then the board's ⋯ menu keeps it.
 */
export function LooseScenesNotice({
  count,
  busy,
  onMove,
  onLater,
}: {
  count: number;
  busy: boolean;
  onMove: () => void;
  onLater: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="loose-scenes"
      role="status"
      data-chrome
      onPointerDown={(e) => e.stopPropagation()}
    >
      <p>{t('scenesMove.notice', { count })}</p>
      <Button variant="primary" disabled={busy} onClick={onMove}>
        {t('scenesMove.move')}
      </Button>
      <Button disabled={busy} onClick={onLater}>
        {t('scenesMove.later')}
      </Button>
    </div>
  );
}

export interface MoveScenesChoice {
  storyboards: ReadonlyArray<{ id: string; title: string }>;
  /** Chosen first: the storyboard opened last (decision 0140). */
  initial: string | null;
  /** The name a new storyboard would take. */
  newTitle: string;
  scenes: number;
  frames: number;
  /** Scenes that will stay on the board, and why (the first reason). */
  stay: number;
}

const NEW = 'new';

/** Where the scenes go, when the project has several storyboards (decision 0140). */
export function MoveScenesDialog({
  choice,
  busy,
  error,
  onMove,
  onClose,
}: {
  choice: MoveScenesChoice;
  busy: boolean;
  error: string | null;
  onMove: (target: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(choice.initial ?? NEW);
  const contents = t('scenesMove.contents', {
    scenes: t('screenplay.scenes', { count: choice.scenes }),
    frames: t('screenplay.framesCount', { count: choice.frames }),
  });
  return (
    <Dialog
      open
      title={t('scenesMove.title', { count: choice.scenes })}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClose={onClose}
    >
      <p className="move-scenes__lead">{t('scenesMove.lead')}</p>
      {choice.stay > 0 && (
        <p className="move-scenes__lead">
          {t(elementDataMoves() ? 'scenesMove.stayTied' : 'scenesMove.stay', {
            count: choice.stay,
          })}
        </p>
      )}
      <RadioGroup
        label={t('scenesMove.where')}
        hideLabel
        className="move-scenes__choices"
        value={value}
        onChange={setValue}
        options={[
          {
            value: NEW,
            label: t('scenesMove.new'),
            description: `«${choice.newTitle}» · ${contents}`,
          },
          ...choice.storyboards.map((b) => ({
            value: b.id,
            label: t('scenesMove.addTo', { title: b.title }),
            description: t('scenesMove.after'),
          })),
        ]}
      />
      {error && (
        <p className="move-scenes__error" role="alert">
          {error}
        </p>
      )}
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          {t('scenesMove.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => onMove(value === NEW ? null : value)}
        >
          {t('scenesMove.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
