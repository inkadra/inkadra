// SPDX-License-Identifier: AGPL-3.0-only
import { Node } from '@tiptap/core';
import { NodeViewWrapper, type ReactNodeViewProps, ReactNodeViewRenderer } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { pickVariant, useAsset } from './assets.ts';
import { localPreview, useUploadProgress } from './uploads.ts';

/**
 * The nodes of document version 19 in a note body (decision 0074): a mention of a project
 * member and a picture of the project. Every editor of notes must load them, or y-prosemirror
 * would drop them from the shared note.
 */

export const NoteMention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.dataset.mention ?? null },
      label: { default: '', parseHTML: (el) => el.dataset.label ?? '' },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-mention]' }];
  },
  renderHTML({ node }) {
    return [
      'span',
      { class: 'note-mention', 'data-mention': node.attrs.id, 'data-label': node.attrs.label },
      `@${node.attrs.label}`,
    ];
  },
  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
});

export const NoteImageNode = Node.create({
  name: 'noteImage',
  group: 'block',
  atom: true,
  draggable: false,
  addAttributes() {
    return {
      assetId: { default: null, parseHTML: (el) => el.dataset.assetId ?? null },
      alt: { default: null, parseHTML: (el) => el.getAttribute('alt') },
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-asset-id]' }];
  },
  renderHTML({ node }) {
    return ['figure', { class: 'note-picture', 'data-asset-id': node.attrs.assetId }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(NoteImageView);
  },
});

function NoteImageView({ node, selected }: ReactNodeViewProps) {
  return (
    <NodeViewWrapper
      as="figure"
      className={`note-picture${selected ? ' is-selected' : ''}`}
      data-asset-id={node.attrs.assetId}
    >
      <NotePicture assetId={node.attrs.assetId} alt={node.attrs.alt} />
    </NodeViewWrapper>
  );
}

/** A picture in a note: the local copy while it uploads, then a variant of the phone's width. */
export function NotePicture({ assetId, alt }: { assetId: string | null; alt?: string | null }) {
  const { t } = useTranslation();
  const asset = useAsset(assetId ?? undefined);
  const progress = useUploadProgress(assetId ?? undefined);
  const ready = asset && asset !== 'missing' ? asset : null;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const src = (ready ? pickVariant(ready, 640 * dpr) : '') || (assetId && localPreview(assetId));
  if (asset === 'missing' || !assetId)
    return <span className="note-picture__missing">{t('board.note.pictureMissing')}</span>;
  return (
    <>
      {src ? (
        <img
          src={src}
          alt={alt ?? ready?.filename ?? t('board.note.picture')}
          width={ready?.width ?? undefined}
          height={ready?.height ?? undefined}
          draggable={false}
        />
      ) : (
        <span className="note-picture__loading" role="status">
          {t('board.note.pictureLoading')}
        </span>
      )}
      {progress !== null && (
        <progress
          className="note-picture__progress"
          max={1}
          value={progress}
          aria-label={t('board.note.pictureUploading')}
        />
      )}
    </>
  );
}
