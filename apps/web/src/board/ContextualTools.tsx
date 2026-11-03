// SPDX-License-Identifier: AGPL-3.0-only
import {
  GRID,
  insertTableColumn,
  insertTableRow,
  removeTableColumn,
  removeTableRow,
  updateElement,
} from '@inkadra/canvas-core';
import { type Element, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from '@inkadra/doc-schema';
import { Icon, type IconName } from '@inkadra/ui';
import type { Editor } from '@tiptap/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAsset } from './assets.ts';
import { BarButton } from './chrome.tsx';
import { useBoard } from './context.ts';
import { normalizeRotation } from './image-crop.ts';
import { noteColor, selectedBlocks, TEXT_COLORS } from './note-format.ts';
import { LOCAL } from './store.ts';
import { videoEmbedUrl } from './youtube.ts';

export function ToolPopover({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: IconName;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener('inkadra:context-popover', close);
    return () => window.removeEventListener('inkadra:context-popover', close);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node))
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation(); setOpen(false); button.current?.focus();
    };
    document.addEventListener('keydown',escape,true);
    document.addEventListener('pointerdown', close, true);
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown',escape,true); };
  }, [open]);
  const rect = button.current?.getBoundingClientRect();
  return (
    <>
      <button
        ref={button}
        type="button"
        className="ctxbar__btn"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const next = !open;
          window.dispatchEvent(new Event('inkadra:context-popover'));
          setOpen(next);
        }}
      >
        {icon ? <Icon name={icon} size={14} /> : 'Tt'}
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label={label}
            className="menu contextual-popover"
            data-chrome
            style={{
              position: 'fixed',
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)),
              top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 380)),
            }}
            onMouseDown={(e) => {
              if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setOpen(false);
                button.current?.focus();
              }
              if (
                ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) &&
                !(e.target instanceof HTMLInputElement)
              ) {
                e.preventDefault();
                const all = [
                  ...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
                ];
                const i = all.indexOf(document.activeElement as HTMLButtonElement);
                all[
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? all.length - 1
                      : (i + (e.key === 'ArrowUp' ? -1 : 1) + all.length) % all.length
                ]?.focus();
              }
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

export function ContextualTools({
  element: el,
  editor,
}: {
  element: Element;
  editor: Editor | null;
}) {
  const { t } = useTranslation();
  const { store, readOnly, setCropping } = useBoard();
  const asset = useAsset(el.type === 'file' || el.type === 'image' ? el.assetId : undefined);
  const [href, setHref] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [activeCell, setActiveCell] = useState<{ r: number; c: number } | null>(null);
  useEffect(() => {
    const remember = (element: EventTarget | null) => {
      const target =
        element instanceof HTMLElement ? element.closest<HTMLElement>('[data-table-cell]') : null;
      if (target?.closest('[data-el]')?.getAttribute('data-el') !== el.id) return;
      const [r, c] = (target.dataset.tableCell ?? '').split(':').map(Number);
      if (r !== undefined && c !== undefined && Number.isInteger(r) && Number.isInteger(c)) setActiveCell({ r, c });
    };
    const focus = (event: FocusEvent) => remember(event.target);
    remember(document.activeElement);
    document.addEventListener('focusin', focus);
    return () => document.removeEventListener('focusin', focus);
  }, [el.id]);
  if (readOnly || el.locked) return null;
  const noSelection = el.type === 'note' && (!editor || editor.state.selection.empty);
  const patch = (value: Record<string, unknown>) => updateElement(store.doc, el.id, value, LOCAL);
  const option = (label: string, run: () => void, pressed?: boolean, disabled?: boolean) => (
    <button
      key={label}
      type="button"
      className="menu__item"
      aria-pressed={pressed}
      disabled={disabled || noSelection}
      onClick={run}
    >
      {label}
    </button>
  );
  const palette = (value: unknown, run: (c: string | undefined) => void, highlight = false) => (
    <div className="contextual-palette">
      {[undefined, ...TEXT_COLORS].map((c) => (
        <button
          key={c ?? 'none'}
          type="button"
          aria-label={`${t(highlight ? 'board.contextual.highlight' : 'board.contextual.textColor')}: ${c ? t(`board.contextual.colors.${c}`) : t('board.colors.none')}`}
          aria-pressed={value === c}
          disabled={noSelection}
          style={{
            color: noteColor(c),
            backgroundColor: highlight ? noteColor(c, true) : undefined,
          }}
          onClick={() => run(c)}
        >
          {highlight ? '▰' : c ? 'A' : '∅'}
        </button>
      ))}
    </div>
  );
  if (el.type === 'note' && editor)
    return (
      <fieldset className="contextual-note" disabled={noSelection}>
        <ToolPopover label={t('board.contextual.typography')}>
          <div className="contextual-row">
            {option(
              t('board.contextual.text'),
              () => selectedBlocks(editor).setParagraph().run(),
              editor.isActive('paragraph'),
            )}
            {([1, 2, 3] as const).map((level) =>
              option(
                `H${level}`,
                () => selectedBlocks(editor).toggleHeading({ level }).run(),
                editor.isActive('heading', { level }),
              ),
            )}
          </div>
          {option(
            t('board.format.list'),
            () => editor.chain().focus().toggleBulletList().run(),
            editor.isActive('bulletList'),
          )}
          {option(
            t('board.contextual.orderedList'),
            () => editor.chain().focus().toggleOrderedList().run(),
            editor.isActive('orderedList'),
          )}
          {option(
            t('board.contextual.taskList'),
            () => editor.chain().focus().toggleList('taskList', 'taskItem').run(),
            editor.isActive('taskList'),
          )}
          {(['left', 'center', 'right'] as const).map((textAlign) =>
            option(t(`board.align.${textAlign}`), () =>
              editor
                .chain()
                .focus()
                .updateAttributes('paragraph', { textAlign })
                .updateAttributes('heading', { textAlign })
                .run(),
            ),
          )}
          <div className="contextual-mobile">
            {option(
              t('board.contextual.underline'),
              () => editor.chain().focus().toggleUnderline().run(),
              editor.isActive('underline'),
            )}
            {option(
              t('board.contextual.strike'),
              () => editor.chain().focus().toggleStrike().run(),
              editor.isActive('strike'),
            )}
            <input
              aria-label={t('board.contextual.link')}
              value={href}
              onChange={(e) => setHref(e.target.value)}
              placeholder="https://"
            />
            {option(
              t('board.contextual.apply'),
              () => editor.chain().focus().setLink({ href }).run(),
              undefined,
              !/^(https?:\/\/|mailto:)/i.test(href),
            )}
            {option(t('board.contextual.removeLink'), () =>
              editor.chain().focus().unsetLink().run(),
            )}
            {option(t('board.contextual.clear'), () =>
              selectedBlocks(editor).unsetAllMarks().clearNodes().run(),
            )}
          </div>
        </ToolPopover>
        <BarButton
          icon="bold"
          label={t('board.format.bold')}
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <BarButton
          icon="italic"
          label={t('board.format.italic')}
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <button
          type="button"
          className="ctxbar__btn contextual-desktop"
          aria-label={t('board.contextual.underline')}
          aria-pressed={editor.isActive('underline')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <u>U</u>
        </button>
        <button
          type="button"
          className="ctxbar__btn contextual-desktop"
          aria-label={t('board.contextual.strike')}
          aria-pressed={editor.isActive('strike')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <s>S</s>
        </button>
        <span className="contextual-desktop">
          <ToolPopover label={t('board.contextual.link')} icon="link">
            <input
              aria-label={t('board.contextual.link')}
              value={href}
              onChange={(e) => setHref(e.target.value)}
              placeholder="https://"
            />
            {option(t('board.contextual.apply'), () => {
              if (/^(https?:\/\/|mailto:)/i.test(href))
                editor.chain().focus().setLink({ href }).run();
            })}
            {option(t('board.contextual.removeLink'), () =>
              editor.chain().focus().unsetLink().run(),
            )}
          </ToolPopover>
        </span>
        <ToolPopover label={t('board.contextual.ink')} icon="color">
          <div>{t('board.contextual.textColor')}</div>
          {palette(editor.getAttributes('noteInk').color, (c) =>
            editor
              .chain()
              .focus()
              .setMark('noteInk', { color: c ?? null })
              .run(),
          )}
          <div>{t('board.contextual.highlight')}</div>
          {palette(
            editor.getAttributes('noteInk').highlight,
            (c) =>
              editor
                .chain()
                .focus()
                .setMark('noteInk', { highlight: c ?? null })
                .run(),
            true,
          )}
        </ToolPopover>
      </fieldset>
    );
  if (el.type === 'section')
    return (
      <>
        <ToolPopover label={t('board.contextual.typography')}>
          <div className="contextual-row">
            {(['S', 'M', 'L'] as const).map((size) =>
              option(size.toUpperCase(), () => patch({ size }), el.size === size),
            )}
          </div>
          {(['left', 'center', 'right'] as const).map((align) =>
            option(t(`board.align.${align}`), () => patch({ align }), el.align === align),
          )}
        </ToolPopover>
        <BarButton
          icon="bold"
          label={t('board.format.bold')}
          active={el.bold ?? true}
          onClick={() => patch({ bold: !(el.bold ?? true) })}
        />
        <BarButton
          icon="italic"
          label={t('board.format.italic')}
          active={el.italic ?? false}
          onClick={() => patch({ italic: !el.italic })}
        />
        <ToolPopover label={t('board.contextual.textColor')} icon="color">
          {palette(el.color, (color) => patch({ color }))}
        </ToolPopover>
        <button
          type="button"
          role="switch"
          aria-checked={el.line !== false}
          className="ctxbar__btn ctxbar__done"
          onClick={() => patch({ line: el.line === false })}
        >
          {t('board.contextual.line')}
        </button>
      </>
    );
  if (el.type === 'image')
    return (
      <fieldset
        className="contextual-note"
        disabled={!asset || asset === 'missing' || asset.status !== 'ready'}
      >
        <BarButton
          icon="mosaic"
          label={t('board.contextual.gridFit')}
          onClick={() =>
            patch({
              w: Math.max(GRID, Math.round(el.w / GRID) * GRID),
              x: Math.round(el.x / GRID) * GRID,
              y: Math.round(el.y / GRID) * GRID,
            })
          }
        />
        <BarButton
          icon="crop"
          label={t('board.image.cropRotate')}
          onClick={() => setCropping?.(el.id)}
        />
        <BarButton
          icon="rotateRight"
          label={t('board.image.rotateRight')}
          onClick={() => patch({ rotation: normalizeRotation((el.rotation ?? 0) + 90) })}
        />
        <BarButton
          icon="pen"
          label={t('board.contextual.draw')}
          active={drawing}
          onClick={() => {
            setDrawing(!drawing);
            window.dispatchEvent(new CustomEvent('inkadra:image-draw', { detail: el.id }));
          }}
        />
      </fieldset>
    );
  if (el.type === 'table') {
    const row = activeCell && el.rows[activeCell.r];
    const col = activeCell && el.columns[activeCell.c];
    const rows = (
      <>
        {option(
          t('board.table.addRow'),
          () => insertTableRow(store.doc, el.id, (activeCell?.r ?? 0) + 1, LOCAL),
          undefined,
          el.rows.length >= MAX_TABLE_ROWS,
        )}
        {option(
          t('board.table.deleteRow'),
          () => {
            if (row) removeTableRow(store.doc, el.id, row.id, LOCAL);
          },
          undefined,
          !row || el.rows.length <= 1,
        )}
      </>
    );
    const columns = (
      <>
        {option(
          t('board.table.addColumn'),
          () => insertTableColumn(store.doc, el.id, (activeCell?.c ?? 0) + 1, LOCAL),
          undefined,
          el.columns.length >= MAX_TABLE_COLUMNS,
        )}
        {option(
          t('board.table.deleteColumn'),
          () => {
            if (col) removeTableColumn(store.doc, el.id, col.id, LOCAL);
          },
          undefined,
          !col || el.columns.length <= 1,
        )}
      </>
    );
    return (
      <>
        <ToolPopover label={t('board.contextual.rows')} icon="rows">
          {rows}
        </ToolPopover>
        <ToolPopover label={t('board.contextual.columns')} icon="column">
          {columns}
        </ToolPopover>
      </>
    );
  }
  if (el.type === 'link')
    return (
      <>
        <button
          className="ctxbar__btn ctxbar__done"
          type="button"
          role="switch"
          aria-checked={el.showInfo !== false}
          onClick={() => patch({ showInfo: el.showInfo === false })}
        >
          {t('board.contextual.info')}
        </button>
        {videoEmbedUrl(el.url) && (
          <button
            className="ctxbar__btn ctxbar__done"
            type="button"
            role="switch"
            aria-checked={el.showPreview !== false}
            onClick={() => patch({ showPreview: el.showPreview === false })}
          >
            {t('board.contextual.preview')}
          </button>
        )}
      </>
    );
  if (el.type === 'file' && asset && asset !== 'missing' && asset.kind === 'video')
    return (
      <button
        className="ctxbar__btn ctxbar__done"
        type="button"
        role="switch"
        aria-checked={el.showPreview !== false}
        onClick={() => patch({ showPreview: el.showPreview === false })}
      >
        {t('board.contextual.preview')}
      </button>
    );
  return null;
}
