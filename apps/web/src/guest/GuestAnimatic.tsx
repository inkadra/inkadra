// SPDX-License-Identifier: AGPL-3.0-only
import { Button } from '@inkadra/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animatic } from '../board/film/Animatic.tsx';
import { useBoardAspect } from '../board/film/aspect.ts';
import { useStoryboard } from '../board/film/StoryboardView.tsx';
import type { BoardStore } from '../board/store.ts';

/**
 * The animatic of a shared storyboard, read only: the frames guests may see, in order, with
 * the sound track streamed (decision 0046). Nothing here changes the board.
 */
export function GuestAnimatic({ store }: { store: BoardStore }) {
  const { t } = useTranslation();
  const { groups, frames, labels } = useStoryboard(store);
  const boardAspect = useBoardAspect(store.doc);
  const [open, setOpen] = useState(false);
  if (frames.length === 0) return null;
  return (
    <>
      <Button icon="play" onClick={() => setOpen(true)}>
        {t('film.playback.watch')}
      </Button>
      {open && (
        <Animatic
          store={store}
          frames={frames}
          groups={groups}
          labels={labels}
          boardAspect={boardAspect}
          readOnly
          present
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
