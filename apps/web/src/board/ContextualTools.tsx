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
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAsset } from './assets.ts';
import { BarButton } from './chrome.tsx';
import { useBoard } from './context.ts';
import { rotateImageQuarterTurn } from './ImageCropEditor.tsx';
import { normalizeNoteLink } from './links.ts';
import { noteColor, selectedBlocks, TEXT_COLORS } from './note-format.ts';
import { LOCAL } from './store.ts';
import { videoEmbedUrl } from './youtube.ts';

export function ToolPopover({
  label,
  icon,
  children,
  text,
}: {
  text?: string;
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
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('keydown', onEscape, true);
    document.addEventListener('pointerdown', close, true);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', onEscape, true);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const position = () => {
      const popup = panel.current;
      const trigger = button.current?.getBoundingClientRect();
      if (!popup || !trigger) return;
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      const below = Math.max(0, top + height - trigger.bottom - 14);
      const above = Math.max(0, trigger.top - top - 14);
      const down = below >= Math.min(popup.scrollHeight, above);
      popup.style.maxHeight = `${Math.min(height - 16, Math.max(44, down ? below : above))}px`;
      const preferred = down ? trigger.bottom + 6 : trigger.top - popup.offsetHeight - 6;
      popup.style.top = `${Math.max(top + 8, Math.min(preferred, top + height - popup.offsetHeight - 8))}px`;
    };
    position();
    viewport?.addEventListener('resize', position);
    window.addEventListener('resize', position);
    return () => {
      viewport?.removeEventListener('resize', position);
      window.removeEventListener('resize', position);
    };
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
        {icon ? <Icon name={icon} size={14} /> : (text ?? 'Tt')}
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
                  ...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
                    []),
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
  const [linkError, setLinkError] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [activeCell, setActiveCell] = useState<{ row: string; column: string } | null>(null);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const currentHref = (editor.getAttributes('link')?.href as string | undefined) ?? '';
      setHref(currentHref);
      setLinkError(false);
    };
    update();
    editor.on('selectionUpdate', update);
    return () => {
      editor.off('selectionUpdate', update);
    };
  }, [editor]);

  const applyNoteLink = () => {
    if (!editor) return;
    const normalized = normalizeNoteLink(href);
    if (normalized) {
      setLinkError(false);
      setHref(normalized);
      editor.chain().focus().setLink({ href: normalized }).run();
    } else {
      setLinkError(true);
    }
  };
  useEffect(() => {
    const remember = (element: EventTarget | null) => {
      const target =
        element instanceof HTMLElement ? element.closest<HTMLElement>('[data-table-cell]') : null;
      if (target?.closest('[data-el]')?.getAttribute('data-el') !== el.id) return;
      const row = target.dataset.tableRow;
      const column = target.dataset.tableColumn;
      if (row && column) setActiveCell({ row, column });
    };
    const focus = (event: FocusEvent) => remember(event.target);
    remember(document.activeElement);
    document.addEventListener('focusin', focus);
    return () => document.removeEventListener('focusin', focus);
  }, [el.id]);
  if (readOnly || el.locked) return null;
  const noSelection = el.type === 'note' && (!editor || editor.state.selection.empty);
  const patch = (value: Record<string, unknown>) => updateElement(store.doc, el.id, value, LOCAL);
  const option = (
    label: string,
    run: () => void,
    pressed?: boolean,
    disabled?: boolean,
    display?: string,
  ) => (
    <button
      key={label}
      type="button"
      className="menu__item"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled || noSelection}
      onClick={run}
    >
      {display ?? label}
    </button>
  );
  const palette = (value: unknown, run: (c: string | undefined) => void, highlight = false) => (
    <div className="contextual-palette">
      {[undefined, ...TEXT_COLORS].map((c) => (
        <button
          key={c ?? 'none'}
          type="button"
          aria-label={`${t(highlight ? 'board.contextual.highlight' : 'board.contextual.textColor')}: ${c ? t(`board.contextual.colors.${c}`) : t('board.colors.none')}`}
          aria-pressed={c ? value === c : value == null}
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
          <div className="contextual-label">{t('board.contextual.lists')}</div>
          <div className="contextual-row">
            {option(
              t('board.format.list'),
              () => editor.chain().focus().toggleBulletList().run(),
              editor.isActive('bulletList'),
              undefined,
              t('board.contextual.bulletsShort'),
            )}
            {option(
              t('board.contextual.orderedList'),
              () => editor.chain().focus().toggleOrderedList().run(),
              editor.isActive('orderedList'),
              undefined,
              t('board.contextual.orderedShort'),
            )}
            {option(
              t('board.contextual.taskList'),
              () => editor.chain().focus().toggleList('taskList', 'taskItem').run(),
              editor.isActive('taskList'),
              undefined,
              t('board.contextual.tasksShort'),
            )}
          </div>
          <div className="contextual-label">{t('board.contextual.alignment')}</div>
          <div className="contextual-row">
            {(['left', 'center', 'right'] as const).map((textAlign) =>
              option(
                t(`board.align.${textAlign}`),
                () =>
                  editor
                    .chain()
                    .focus()
                    .updateAttributes('paragraph', { textAlign })
                    .updateAttributes('heading', { textAlign })
                    .run(),
                undefined,
                undefined,
                t(`board.contextual.alignShort.${textAlign}`),
              ),
            )}
          </div>
          <div className="contextual-mobile">
            <div className="contextual-row">
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
            </div>
            <input
              aria-label={t('board.contextual.link')}
              aria-invalid={linkError || undefined}
              value={href}
              onChange={(e) => {
                setHref(e.target.value);
                setLinkError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyNoteLink();
                }
              }}
              placeholder="https://"
            />
            {linkError && (
              <span className="ink-field__error" role="alert">
                {t('board.contextual.invalidLink')}
              </span>
            )}
            <div className="contextual-row">
              {option(t('board.contextual.apply'), applyNoteLink, undefined, !href.trim())}
              {option(t('board.contextual.removeLink'), () => {
                setHref('');
                setLinkError(false);
                editor.chain().focus().unsetLink().run();
              })}
            </div>
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
              aria-invalid={linkError || undefined}
              value={href}
              onChange={(e) => {
                setHref(e.target.value);
                setLinkError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyNoteLink();
                }
              }}
              placeholder="https://"
            />
            {linkError && (
              <span className="ink-field__error" role="alert">
                {t('board.contextual.invalidLink')}
              </span>
            )}
            {option(t('board.contextual.apply'), applyNoteLink, undefined, !href.trim())}
            {option(t('board.contextual.removeLink'), () => {
              setHref('');
              setLinkError(false);
              editor.chain().focus().unsetLink().run();
            })}
          </ToolPopover>
        </span>
        <ToolPopover label={t('board.contextual.ink')} icon="textColor">
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
        <ToolPopover label={t('board.contextual.typography')} text={el.size ?? 'S'}>
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
          active={el.bold === true}
          onClick={() => patch({ bold: el.bold !== true })}
        />
        <BarButton
          icon="italic"
          label={t('board.format.italic')}
          active={el.italic ?? false}
          onClick={() => patch({ italic: !el.italic })}
        />
        <ToolPopover label={t('board.contextual.textColor')} icon="textColor">
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
          onClick={() => {
            if (asset && asset !== 'missing')
              rotateImageQuarterTurn(store, el, asset.width || 4, asset.height || 3, 1);
          }}
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
    const row = activeCell && el.rows.find((row) => row.id === activeCell.row);
    const col = activeCell && el.columns.find((col) => col.id === activeCell.column);
    const rows = (
      <>
        {option(
          t('board.contextual.addRow'),
          () => insertTableRow(store.doc, el.id, row ? el.rows.indexOf(row) + 1 : undefined, LOCAL),
          undefined,
          el.rows.length >= MAX_TABLE_ROWS,
        )}
        {option(
          t('board.table.deleteRow'),
          () => {
            if (row) removeTableRow(store.doc, el.id, row.id, LOCAL);
            setActiveCell(null);
          },
          undefined,
          !row || el.rows.length <= 1,
        )}
      </>
    );
    const columns = (
      <>
        {option(
          t('board.contextual.addColumn'),
          () =>
            insertTableColumn(
              store.doc,
              el.id,
              col ? el.columns.indexOf(col) + 1 : undefined,
              LOCAL,
            ),
          undefined,
          el.columns.length >= MAX_TABLE_COLUMNS,
        )}
        {option(
          t('board.table.deleteColumn'),
          () => {
            if (col) removeTableColumn(store.doc, el.id, col.id, LOCAL);
            setActiveCell(null);
          },
          undefined,
          !col || el.columns.length <= 1,
        )}
      </>
    );
    return (
      <>
        <span className="contextual-desktop">
          <BarButton
            icon="rowAdd"
            label={t('board.contextual.addRow')}
            disabled={el.rows.length >= MAX_TABLE_ROWS}
            onClick={() =>
              insertTableRow(store.doc, el.id, row ? el.rows.indexOf(row) + 1 : undefined, LOCAL)
            }
          />
          <BarButton
            icon="rowRemove"
            label={t('board.table.deleteRow')}
            disabled={!row || el.rows.length <= 1}
            onClick={() => {
              if (row) removeTableRow(store.doc, el.id, row.id, LOCAL);
              setActiveCell(null);
            }}
          />
          <span className="ctxbar__sep" aria-hidden="true" />
          <BarButton
            icon="columnAdd"
            label={t('board.contextual.addColumn')}
            disabled={el.columns.length >= MAX_TABLE_COLUMNS}
            onClick={() =>
              insertTableColumn(
                store.doc,
                el.id,
                col ? el.columns.indexOf(col) + 1 : undefined,
                LOCAL,
              )
            }
          />
          <BarButton
            icon="columnRemove"
            label={t('board.table.deleteColumn')}
            disabled={!col || el.columns.length <= 1}
            onClick={() => {
              if (col) removeTableColumn(store.doc, el.id, col.id, LOCAL);
              setActiveCell(null);
            }}
          />
        </span>
        <span className="contextual-mobile-tools">
          <ToolPopover label={t('board.contextual.rows')} icon="rows">
            {rows}
          </ToolPopover>
          <ToolPopover label={t('board.contextual.columns')} icon="column">
            {columns}
          </ToolPopover>
        </span>
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
