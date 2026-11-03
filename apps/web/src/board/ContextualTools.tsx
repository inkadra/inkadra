// SPDX-License-Identifier: AGPL-3.0-only
import { insertTableColumn, insertTableRow, removeTableColumn, removeTableRow, updateElement } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import { Icon, type IconName } from '@inkadra/ui';
import type { Editor } from '@tiptap/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { BarButton } from './chrome.tsx';
import { useBoard } from './context.ts';
import { useAsset } from './assets.ts';
import { normalizeRotation } from './image-crop.ts';
import { TEXT_COLORS, noteColor, selectedBlocks } from './note-format.ts';
import { LOCAL } from './store.ts';
import { videoEmbedUrl } from './youtube.ts';

export function ToolPopover({ label, icon, children }: { label: string; icon?: IconName; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener('inkadra:context-popover',close);
    return () => window.removeEventListener('inkadra:context-popover',close);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [open]);
  const rect = button.current?.getBoundingClientRect();
  return <><button ref={button} type="button" className="ctxbar__btn" aria-label={label} aria-expanded={open} aria-haspopup="dialog" onMouseDown={e => e.preventDefault()} onClick={() => { const next = !open; window.dispatchEvent(new Event('inkadra:context-popover')); setOpen(next); }}>{icon ? <Icon name={icon} size={14} /> : 'Tt'}</button>
    {open && rect && createPortal(<div ref={panel} role="dialog" aria-label={label} className="menu contextual-popover" data-chrome style={{ position: 'fixed', left: Math.max(8,Math.min(rect.left,window.innerWidth-248)), top: Math.max(8,Math.min(rect.bottom+6,window.innerHeight-380)) }} onMouseDown={e => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }} onKeyDown={e => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); button.current?.focus(); }
      if (['ArrowDown','ArrowUp','Home','End'].includes(e.key) && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault(); const all = [...panel.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const i = all.indexOf(document.activeElement as HTMLButtonElement);
        all[e.key === 'Home' ? 0 : e.key === 'End' ? all.length-1 : (i+(e.key === 'ArrowUp' ? -1 : 1)+all.length)%all.length]?.focus();
      }
    }}>{children}</div>, document.body)}
  </>;
}

export function ContextualTools({ element: el, editor }: { element: Element; editor: Editor | null }) {
  const { t } = useTranslation();
  const { store, readOnly, setCropping } = useBoard();
  const asset = useAsset(el.type === 'file' || el.type === 'image' ? el.assetId : undefined);
  const [href, setHref] = useState('');
  const activeCell = useRef<{r:number;c:number} | null>(null);
  useEffect(() => {
    const focus = (e: FocusEvent) => { const target = (e.target as HTMLElement).closest<HTMLElement>('[data-table-cell]');
      if (target) { const [r,c] = target.dataset.tableCell!.split(':').map(Number); activeCell.current = { r: r!, c: c! }; }
    };
    document.addEventListener('focusin',focus); return () => document.removeEventListener('focusin',focus);
  }, []);
  if (readOnly || el.locked) return null;
  const noSelection = el.type === 'note' && (!editor || editor.state.selection.empty);
  const patch = (value: Record<string,unknown>) => updateElement(store.doc,el.id,value,LOCAL);
  const option = (label: string, run: () => void, pressed?: boolean, disabled?: boolean) => <button key={label} type="button" className="menu__item" aria-pressed={pressed} disabled={disabled || noSelection} onClick={run}>{label}</button>;
  const palette = (value: unknown, run: (c: string | undefined) => void, highlight = false) => <div className="contextual-palette">{[undefined,...TEXT_COLORS].map(c => <button key={c ?? 'none'} type="button" aria-label={c ? t(`board.contextual.colors.${c}`) : t('board.colors.none')} aria-pressed={value === c} disabled={noSelection} style={{color: noteColor(c), backgroundColor: highlight ? noteColor(c,true) : undefined}} onClick={() => run(c)}>{highlight ? '▰' : c ? 'A' : '∅'}</button>)}</div>;
  if (el.type === 'note' && editor) return <fieldset className="contextual-note" disabled={noSelection}>
    <ToolPopover label={t('board.contextual.typography')}>
      <div className="contextual-row">{option(t('board.contextual.text'),() => selectedBlocks(editor).setParagraph().run(),editor.isActive('paragraph'))}{([1,2,3] as const).map(level => option(`H${level}`,() => selectedBlocks(editor).toggleHeading({level}).run(),editor.isActive('heading',{level})))}</div>
      {option(t('board.format.list'),() => selectedBlocks(editor).toggleBulletList().run(),editor.isActive('bulletList'))}
      {option(t('board.contextual.orderedList'),() => selectedBlocks(editor).toggleOrderedList().run(),editor.isActive('orderedList'))}
      {option(t('board.contextual.taskList'),() => selectedBlocks(editor).toggleList('taskList','taskItem').run(),editor.isActive('taskList'))}
      {(['left','center','right'] as const).map(textAlign => option(t(`board.align.${textAlign}`),() => selectedBlocks(editor).updateAttributes('paragraph',{textAlign}).updateAttributes('heading',{textAlign}).run()))}
    </ToolPopover>
    <BarButton icon="bold" label={t('board.format.bold')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
    <BarButton icon="italic" label={t('board.format.italic')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
    <button type="button" className="ctxbar__btn" aria-label={t('board.contextual.underline')} aria-pressed={editor.isActive('underline')} onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></button>
    <button type="button" className="ctxbar__btn" aria-label={t('board.contextual.strike')} aria-pressed={editor.isActive('strike')} onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></button>
    <ToolPopover label={t('board.contextual.link')} icon="link"><input aria-label={t('board.contextual.link')} value={href} onChange={e => setHref(e.target.value)} placeholder="https://" />{option(t('board.contextual.apply'),() => { if (/^(https?:\/\/|mailto:)/i.test(href)) editor.chain().focus().setLink({href}).run(); })}{option(t('board.contextual.removeLink'),() => editor.chain().focus().unsetLink().run())}</ToolPopover>
    <ToolPopover label={t('board.contextual.ink')} icon="color"><div>{t('board.contextual.textColor')}</div>{palette(editor.getAttributes('noteInk').color,c => editor.chain().focus().setMark('noteInk',{color:c ?? null}).run())}<div>{t('board.contextual.highlight')}</div>{palette(editor.getAttributes('noteInk').highlight,c => editor.chain().focus().setMark('noteInk',{highlight:c ?? null}).run(),true)}{option(t('board.contextual.clear'),() => selectedBlocks(editor).unsetAllMarks().clearNodes().run())}</ToolPopover>
  </fieldset>;
  if (el.type === 'section') return <>
    <ToolPopover label={t('board.contextual.typography')}><div className="contextual-row">{(['s','m','l'] as const).map(size => option(size.toUpperCase(),() => patch({size}),el.size === size))}</div>{(['left','center','right'] as const).map(align => option(t(`board.align.${align}`),() => patch({align}),el.align === align))}</ToolPopover>
    <BarButton icon="bold" label={t('board.format.bold')} active={el.bold ?? true} onClick={() => patch({bold: !(el.bold ?? true)})} />
    <BarButton icon="italic" label={t('board.format.italic')} active={el.italic ?? false} onClick={() => patch({italic: !el.italic})} />
    <ToolPopover label={t('board.contextual.textColor')} icon="color">{palette(el.color,color => patch({color}))}</ToolPopover>
    <button type="button" role="switch" aria-checked={el.line !== false} className="ctxbar__btn ctxbar__done" onClick={() => patch({line: el.line === false})}>{t('board.contextual.line')}</button>
  </>;
  if (el.type === 'image') return <fieldset className="contextual-note" disabled={!asset || asset === 'missing' || asset.status !== 'ready'}>
    <BarButton icon="mosaic" label={t('board.contextual.gridFit')} onClick={() => patch({w: Math.max(20,Math.round(el.w/20)*20),x: Math.round(el.x/20)*20,y:Math.round(el.y/20)*20})} />
    <BarButton icon="crop" label={t('board.image.cropRotate')} onClick={() => setCropping?.(el.id)} />
    <BarButton icon="rotateRight" label={t('board.image.rotateRight')} onClick={() => patch({rotation: normalizeRotation((el.rotation ?? 0)+90)})} />
    <BarButton icon="pen" label={t('board.contextual.draw')} onClick={() => { window.dispatchEvent(new CustomEvent('inkadra:image-draw',{detail:el.id})); }} />
  </fieldset>;
  if (el.type === 'table') return <>
    {option(t('board.table.addRow'),() => insertTableRow(store.doc,el.id,(activeCell.current?.r ?? 0)+1,LOCAL))}
    {option(t('board.table.deleteRow'),() => { const row = el.rows[(activeCell.current?.r ?? 0)]; if (row) removeTableRow(store.doc,el.id,row.id,LOCAL); },undefined,el.rows.length <= 1 || !activeCell.current)}
    {option(t('board.table.addColumn'),() => insertTableColumn(store.doc,el.id,(activeCell.current?.c ?? 0)+1,LOCAL))}
    {option(t('board.table.deleteColumn'),() => { const col = el.columns[(activeCell.current?.c ?? 0)]; if (col) removeTableColumn(store.doc,el.id,col.id,LOCAL); },undefined,el.columns.length <= 1 || !activeCell.current)}
  </>;
  if (el.type === 'link') return <>
    <button className="ctxbar__btn ctxbar__done" type="button" role="switch" aria-checked={el.showInfo !== false} onClick={() => patch({showInfo:el.showInfo === false})}>{t('board.contextual.info')}</button>
    {videoEmbedUrl(el.url) && <button className="ctxbar__btn ctxbar__done" type="button" role="switch" aria-checked={el.showPreview !== false} onClick={() => patch({showPreview:el.showPreview === false})}>{t('board.contextual.preview')}</button>}
  </>;
  if (el.type === 'file' && asset && asset !== 'missing' && asset.kind === 'video') return <button className="ctxbar__btn ctxbar__done" type="button" role="switch" aria-checked={el.showPreview !== false} onClick={() => patch({showPreview:el.showPreview === false})}>{t('board.contextual.preview')}</button>;
  return null;
}
