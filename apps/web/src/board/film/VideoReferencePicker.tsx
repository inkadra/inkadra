// SPDX-License-Identifier: AGPL-3.0-only
import type { Element } from '@inkadra/doc-schema';
import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAsset } from '../assets.ts';
import { isVideoLink } from '../FrameGrab.tsx';
import type { BoardStore } from '../store.ts';
import { MediaViewer } from '../viewer.tsx';

type Media = Extract<Element, { type: 'file' | 'link' }>;

export function VideoReferencePicker({ store, frameId, projectId, userId, readOnly }: {
  store: BoardStore; frameId: string; projectId: string; userId: string; readOnly: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const media = [...snap.byId.values()].filter((el): el is Media => el.type === 'file' || (el.type === 'link' && isVideoLink(el)));
  const current = media.find((el) => el.id === selected);
  if (readOnly) return null;
  return <>
    <button type="button" className="ink-btn ink-btn--ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{t('frameGrab.fromVideo')}</button>
    {open && <div className="film-panel__video-picker">
      <p className="ink-muted">{t('frameGrab.pickVideo')}</p>
      {media.map((element) => <VideoOption key={element.id} element={element} onPick={() => setSelected(element.id)} />)}
      {!media.length && <p className="ink-muted">{t('frameGrab.noVideos')}</p>}
    </div>}
    {current && createPortal(<MediaViewer store={store} element={current} projectId={projectId} userId={userId}
      readOnly={readOnly} initialFrameId={frameId} onClose={() => { setSelected(null); setOpen(false); }} />, document.body)}
  </>;
}
function VideoOption({ element, onPick }: { element: Media; onPick: () => void }) {
  const asset = useAsset(element.type === 'link' ? element.imageAssetId : element.assetId);
  if (element.type === 'file' && (!asset || asset === 'missing' || asset.kind !== 'video')) return null;
  return <button type="button" className="ink-btn ink-btn--secondary" onClick={onPick}>{element.type === 'link' ? element.title || element.url : asset && asset !== 'missing' ? asset.filename : ''}</button>;
}
