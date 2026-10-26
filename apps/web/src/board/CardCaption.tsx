import { updateElement } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useBoard } from './context.ts';
import { LOCAL } from './store.ts';

type CaptionedElement = Extract<Element, { type: 'file' | 'image' }>;

/** Images and files share their caption display, editing and undo behaviour. */
export function CardCaption({ element }: { element: CaptionedElement }) {
  const { editing, readOnly } = useBoard();
  if (editing === element.id && !readOnly && !element.locked) {
    return <CaptionEditor element={element} />;
  }
  return element.caption ? <div className="card__caption">{element.caption}</div> : null;
}

function CaptionEditor({ element }: { element: CaptionedElement }) {
  const { store, setEditing } = useBoard();
  const { t } = useTranslation();
  const input = useRef<HTMLTextAreaElement>(null);
  const original = useRef(element.caption);
  useEffect(() => {
    store.undo.stopCapturing();
    input.current?.focus();
    return () => store.undo.stopCapturing();
  }, [store]);
  return (
    <textarea
      ref={input}
      className="card__caption card__caption-input"
      aria-label={t('board.caption.label')}
      defaultValue={element.caption ?? ''}
      maxLength={2000}
      rows={3}
      data-no-drag
      // Save while typing: a canvas pointer-down can unmount this editor before blur.
      onChange={(e) => {
        updateElement(
          store.doc,
          element.id,
          { caption: e.currentTarget.value || undefined },
          LOCAL,
        );
      }}
      onBlur={() => setEditing(null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Escape') {
            updateElement(store.doc, element.id, { caption: original.current }, LOCAL);
          }
          e.currentTarget.blur();
        }
      }}
    />
  );
}
