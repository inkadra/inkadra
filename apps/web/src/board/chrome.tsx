import {
  type Point,
  type Rect,
  TEMPLATE_IDS,
  type TemplateId,
  type Viewport,
} from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import { Icon, type IconName, KeyCap } from '@inkadra/ui';
import type { Editor } from '@tiptap/react';
import {
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { addActions, type PaletteAction, rankActions } from '../commands/actions.ts';
import { Card, NOTE_COLORS } from './cards.tsx';
import { GuestVisibilityIcon } from './guest-visibility.tsx';
import { isMac } from './shortcuts.ts';
import { cancelUpload, retryUpload, useUploads } from './uploads.ts';

export type ToolType =
  | 'note'
  | 'image'
  | 'link'
  | 'todo'
  | 'column'
  | 'board'
  | 'color'
  | 'frame'
  | 'scene'
  | 'storyboard';
export type CanvasTool = 'select' | 'hand' | 'arrow';
export const TOOL_MIME = 'application/x-inkadra-tool';

export const TOOLS: Array<{ type: ToolType; icon: IconName; key?: string; menuOnly?: boolean }> = [
  { type: 'note', icon: 'note', key: 'N' },
  { type: 'image', icon: 'image', key: 'I' },
  { type: 'link', icon: 'link', key: 'L' },
  { type: 'todo', icon: 'todo', key: 'T' },
  { type: 'column', icon: 'column', key: 'C' },
  { type: 'board', icon: 'board', key: 'B' },
  { type: 'color', icon: 'color', key: 'K' },
  { type: 'frame', icon: 'frame', key: 'F' },
  { type: 'storyboard', icon: 'storyboard', key: 'S' },
  { type: 'scene', icon: 'scene', menuOnly: true },
];

const mod = () => (isMac() ? '⌘' : 'Ctrl+');

/** Bottom tool bar: click adds in the middle of the view, drag drops where you let go. */
export function Toolbar({
  tool,
  onTool,
  onAdd,
}: {
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
  onAdd: (type: ToolType) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="toolbar" role="toolbar" aria-label={t('board.toolbar')} data-chrome>
      <ToolButton
        icon="pointer"
        label={t('board.tools.select')}
        keyHint="V"
        pressed={tool === 'select'}
        onClick={() => onTool('select')}
      />
      <ToolButton
        icon="hand"
        label={t('board.tools.hand')}
        keyHint="H"
        pressed={tool === 'hand'}
        onClick={() => onTool('hand')}
      />
      <ToolButton
        icon="arrow"
        label={t('board.tools.arrow')}
        keyHint="A"
        pressed={tool === 'arrow'}
        onClick={() => onTool(tool === 'arrow' ? 'select' : 'arrow')}
      />
      <span className="toolbar__sep" aria-hidden="true" />
      {TOOLS.filter((tl) => !tl.menuOnly).map((tl) => (
        <ToolButton
          key={tl.type}
          icon={tl.icon}
          label={t(`board.types.${tl.type}`)}
          keyHint={tl.key ?? ''}
          onClick={() => onAdd(tl.type)}
          dragType={tl.type}
        />
      ))}
    </div>
  );
}

function ToolButton({
  icon,
  label,
  keyHint,
  pressed,
  onClick,
  dragType,
}: {
  icon: IconName;
  label: string;
  keyHint: string;
  pressed?: boolean;
  onClick: () => void;
  dragType?: ToolType;
}) {
  return (
    <button
      type="button"
      className="toolbar__btn"
      aria-label={label}
      aria-pressed={pressed}
      title={`${label} (${keyHint})`}
      onClick={onClick}
      draggable={!!dragType}
      onDragStart={(e) => {
        if (!dragType) return;
        e.dataTransfer.setData(TOOL_MIME, dragType);
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <Icon name={icon} size={16} />
      <span className="toolbar__tip" aria-hidden="true">
        {label}
        <KeyCap>{keyHint}</KeyCap>
      </span>
    </button>
  );
}

export function BarButton({
  icon,
  label,
  onClick,
  active,
  danger,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`ctxbar__btn${active ? ' is-active' : ''}${danger ? ' is-danger' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

/** Floating bar above the selection; its content follows what is selected. */
export function ContextBar({
  box,
  elements,
  editor,
  readOnly,
  onAlign,
  onGroup,
  onLock,
  onGuestHidden,
  onDelete,
  onDuplicate,
  onMore,
  onColor,
  onTags,
  extra,
  onComments,
}: {
  box: Rect;
  onComments?: (() => void) | undefined;
  elements: Element[];
  editor: Editor | null;
  readOnly: boolean;
  onAlign: (how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distribute') => void;
  onGroup: () => void;
  onLock: () => void;
  onGuestHidden: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMore: (x: number, y: number) => void;
  onColor: (color: string | undefined) => void;
  onTags: (x: number, y: number) => void;
  /** Buttons that only some cards have (arrow line style). */
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  if (elements.length === 0 || (readOnly && !onComments)) return null;
  if (readOnly && onComments)
    return (
      <div
        className="ctxbar"
        role="toolbar"
        aria-label={t('board.contextBar')}
        style={{ left: Math.max(8, box.x), top: box.y - 44 < 8 ? box.y + box.h + 8 : box.y - 44 }}
        data-chrome
      >
        <BarButton icon="comment" label={t('comments.open')} onClick={onComments} />
      </div>
    );
  const free = elements.filter((e) => e.parent === null);
  const notes = elements.filter((e) => e.type === 'note');
  const locked = elements.some((e) => e.locked);
  const hideable = elements.filter((e) => e.type !== 'arrow');
  const guestHidden = hideable.length > 0 && hideable.every((e) => e.guestHidden);
  const top = box.y - 44 < 8 ? box.y + box.h + 8 : box.y - 44;
  return (
    <div
      className="ctxbar"
      role="toolbar"
      aria-label={t('board.contextBar')}
      style={{ left: Math.max(8, box.x), top }}
      data-chrome
    >
      {onComments && <BarButton icon="comment" label={t('comments.open')} onClick={onComments} />}
      {editor && (
        <>
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
          <BarButton
            icon="heading"
            label={t('board.format.heading')}
            active={editor.isActive('heading')}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          />
          <BarButton
            icon="list"
            label={t('board.format.list')}
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <span className="ctxbar__sep" aria-hidden="true" />
        </>
      )}
      {notes.length > 0 && notes.length === elements.length && (
        <>
          <button
            type="button"
            className="ctxbar__swatch"
            aria-label={t('board.colors.none')}
            title={t('board.colors.none')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onColor(undefined)}
          />
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`ctxbar__swatch ctxbar__swatch--${c}`}
              aria-label={t(`board.colors.${c}`)}
              title={t(`board.colors.${c}`)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onColor(c)}
            />
          ))}
          <span className="ctxbar__sep" aria-hidden="true" />
        </>
      )}
      {free.length > 1 && (
        <>
          <span className="ctxbar__count">{t('board.selected', { count: elements.length })}</span>
          <BarButton
            icon="alignLeft"
            label={t('board.align.left')}
            onClick={() => onAlign('left')}
          />
          <BarButton
            icon="alignCenter"
            label={t('board.align.center')}
            onClick={() => onAlign('center')}
          />
          <BarButton icon="alignTop" label={t('board.align.top')} onClick={() => onAlign('top')} />
          <BarButton
            icon="alignMiddle"
            label={t('board.align.middle')}
            onClick={() => onAlign('middle')}
          />
          {free.length > 2 && (
            <BarButton
              icon="distribute"
              label={t('board.align.distribute')}
              onClick={() => onAlign('distribute')}
            />
          )}
          <BarButton icon="column" label={t('board.align.group')} onClick={onGroup} />
          <span className="ctxbar__sep" aria-hidden="true" />
        </>
      )}
      <BarButton
        icon={locked ? 'unlock' : 'lock'}
        label={locked ? t('board.menu.unlock') : t('board.menu.lock')}
        onClick={onLock}
        active={locked}
      />
      {hideable.length > 0 && (
        <button
          type="button"
          className={`ctxbar__btn${guestHidden ? ' is-active' : ''}`}
          aria-label={t('guestVisibility.hide')}
          title={t('guestVisibility.hide')}
          aria-pressed={guestHidden}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onGuestHidden}
        >
          <GuestVisibilityIcon />
        </button>
      )}
      {extra}
      <BarButton
        icon="tag"
        label={t('tags.title')}
        onClick={() => onTags(Math.max(8, box.x), box.y + box.h + 8)}
      />
      <BarButton icon="copy" label={t('board.menu.duplicate')} onClick={onDuplicate} />
      <BarButton icon="trash" label={t('board.menu.delete')} onClick={onDelete} />
      <button
        type="button"
        className="ctxbar__btn"
        aria-label={t('board.menu.more')}
        title={t('board.menu.more')}
        aria-haspopup="menu"
        onClick={(e) => {
          const bar = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
          const root = (e.currentTarget.closest('.canvas') as HTMLElement).getBoundingClientRect();
          onMore(bar.right - root.left - 200, bar.bottom - root.top + 6);
        }}
      >
        <Icon name="more" size={14} />
      </button>
    </div>
  );
}

export type MenuItem =
  | { label: string; shortcut?: string; danger?: boolean; action: () => void; divider?: never }
  | { divider: true };

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  anchor,
}: {
  /** Viewport position; without it the menu is placed by the stylesheet of its container. */
  x?: number;
  y?: number;
  items: MenuItem[];
  /** Why the menu closes, so a caller can return focus only when the keyboard was used. */
  onClose: (reason: 'escape' | 'outside' | 'item') => void;
  /** The button that toggles the menu: pressing it is left to the button. */
  anchor?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchor?.current?.contains(target)) onClose('outside');
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose, anchor]);
  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={x === undefined ? undefined : { left: x, top: y }}
      data-chrome
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose('escape');
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const all = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
          const i = all.indexOf(document.activeElement as HTMLElement);
          all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
        }
      }}
    >
      {items.map((item, i) =>
        item.divider ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: dividers have no identity
          <hr key={`d${i}`} className="menu__divider" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={`menu__item${item.danger ? ' is-danger' : ''}`}
            onClick={() => {
              onClose('item');
              item.action();
            }}
          >
            {item.label}
            {item.shortcut && (
              <span className="menu__key">{item.shortcut.replace('⌘', mod())}</span>
            )}
          </button>
        ),
      )}
    </div>
  );
}

export function Minimap({
  elements,
  rectOf,
  viewport,
  size,
  onJump,
}: {
  elements: readonly Element[];
  rectOf: (el: Element) => Rect;
  viewport: Viewport;
  size: { w: number; h: number };
  onJump: (p: Point) => void;
}) {
  const { t } = useTranslation();
  const W = 150;
  const H = 90;
  // The board's shapes are one path, laid out on the content bounds: moving the view only
  // moves the view rectangle, it does not redraw a thousand shapes.
  const layout = useMemo(() => {
    const rects = elements.map(rectOf);
    if (rects.length === 0) return null;
    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.w));
    const maxY = Math.max(...rects.map((r) => r.y + r.h));
    const s = Math.min((W - 8) / (maxX - minX || 1), (H - 8) / (maxY - minY || 1));
    const ox = (W - (maxX - minX) * s) / 2;
    const oy = (H - (maxY - minY) * s) / 2;
    const map = (r: Rect) => ({
      x: ox + (r.x - minX) * s,
      y: oy + (r.y - minY) * s,
      width: Math.max(1, r.w * s),
      height: Math.max(1, r.h * s),
    });
    const path = rects
      .map((r) => {
        const m = map(r);
        return `M${m.x.toFixed(1)} ${m.y.toFixed(1)}h${m.width.toFixed(1)}v${m.height.toFixed(1)}h${(-m.width).toFixed(1)}z`;
      })
      .join('');
    return { minX, minY, s, ox, oy, map, path };
  }, [elements, rectOf]);
  if (!layout || size.w === 0) return null;
  const { minX, minY, s, ox, oy, map, path } = layout;
  const view = map({
    x: viewport.x,
    y: viewport.y,
    w: size.w / viewport.zoom,
    h: size.h / viewport.zoom,
  });
  return (
    <button
      type="button"
      className="minimap"
      aria-label={t('board.minimap')}
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        onJump({
          x: minX + (e.clientX - box.left - ox) / s,
          y: minY + (e.clientY - box.top - oy) / s,
        });
      }}
    >
      <svg className="minimap__svg" width={W} height={H} aria-hidden="true">
        <path d={path} className="minimap__el" />
      </svg>
      <span
        className="minimap__view"
        style={{
          width: view.width,
          height: view.height,
          transform: `translate(${view.x}px, ${view.y}px)`,
        }}
      />
    </button>
  );
}

export function ZoomControls({
  zoom,
  onZoom,
}: {
  zoom: number;
  onZoom: (to: 'in' | 'out' | 'reset' | 'fit') => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="zoom" aria-label={t('board.zoom.label')}>
      <button
        type="button"
        aria-label={t('board.zoom.out')}
        title={t('board.zoom.out')}
        onClick={() => onZoom('out')}
      >
        <Icon name="minus" size={14} />
      </button>
      <button
        type="button"
        className="zoom__value"
        title={t('board.zoom.reset')}
        onClick={() => onZoom('reset')}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        aria-label={t('board.zoom.in')}
        title={t('board.zoom.in')}
        onClick={() => onZoom('in')}
      >
        <Icon name="plus" size={14} />
      </button>
      <button
        type="button"
        aria-label={t('board.zoom.fit')}
        title={t('board.zoom.fit')}
        onClick={() => onZoom('fit')}
      >
        <Icon name="fit" size={14} />
      </button>
    </fieldset>
  );
}

/** "Non ordinati": what arrives from the clipper, the phone or other boards, still to place. */
export function UnsortedDrawer({
  ref,
  items,
  open,
  onToggle,
  selection,
  dropping,
  draggingIds,
}: {
  ref: Ref<HTMLDivElement>;
  items: readonly Element[];
  open: boolean;
  onToggle: () => void;
  selection: ReadonlySet<string>;
  dropping: boolean;
  draggingIds: ReadonlySet<string> | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div ref={ref} className={`unsorted${dropping ? ' is-dropping' : ''}`} data-chrome>
      {open && (
        <section className="unsorted__panel" aria-label={t('nav.unsorted')} data-scroll>
          {items.length === 0 ? (
            <p className="ink-muted unsorted__empty">{t('board.unsorted.empty')}</p>
          ) : (
            items.map((el) => (
              <Card
                key={el.id}
                element={el}
                nested
                selected={selection.has(el.id)}
                dimmed={draggingIds?.has(el.id)}
              />
            ))
          )}
        </section>
      )}
      <button type="button" className="unsorted__toggle" aria-expanded={open} onClick={onToggle}>
        <Icon name="unsorted" size={14} />
        {t('nav.unsorted')}
        <span className="ink-muted">· {items.length}</span>
      </button>
    </div>
  );
}

export function UploadPanel() {
  const { t } = useTranslation();
  const uploads = useUploads();
  if (uploads.length === 0) return null;
  return (
    <section className="uploads" aria-label={t('board.uploads.title')} data-chrome>
      {uploads.map((u) => (
        <div key={u.key} className="uploads__item">
          <div className="uploads__row">
            <span className="uploads__name">{u.name}</span>
            <span className="ink-muted">
              {u.state === 'uploading'
                ? `${u.reconnecting ? `${t('board.uploads.reconnecting')} · ` : ''}${Math.round((u.sent / (u.size || 1)) * 100)}%`
                : t(`board.uploads.${u.state}`)}
            </span>
            {u.state === 'failed' && (
              <button type="button" className="uploads__cancel" onClick={() => retryUpload(u.key)}>
                {t('board.uploads.retry')}
              </button>
            )}
            {u.state !== 'done' && u.state !== 'cancelled' && (
              <button type="button" className="uploads__cancel" onClick={() => cancelUpload(u.key)}>
                {t('board.uploads.cancel')}
              </button>
            )}
          </div>
          <div className="uploads__bar">
            <span style={{ width: `${(u.sent / (u.size || 1)) * 100}%` }} />
          </div>
        </div>
      ))}
    </section>
  );
}

export function CommandPalette({
  readOnly,
  onClose,
  onAdd,
  onTemplate,
  onZoom,
  onUndo,
  onRedo,
  onToggleUnsorted,
}: {
  readOnly: boolean;
  onClose: () => void;
  onAdd: (type: ToolType) => void;
  onTemplate: (id: TemplateId) => void;
  onZoom: (to: 'in' | 'out' | 'reset' | 'fit' | 'selection') => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleUnsorted: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const m = mod();
  const commands: PaletteAction[] = [
    ...(readOnly
      ? []
      : addActions(
          TOOLS,
          (type) => t('board.palette.add', { type: t(`board.types.${type}`) }),
          onAdd,
        )),
    ...(readOnly
      ? []
      : TEMPLATE_IDS.map((id) => ({
          id: `template-${id}`,
          label: t('board.palette.template', { name: t(`templates.${id}.name`) }),
          run: () => onTemplate(id),
        }))),
    { id: 'fit', label: t('board.zoom.fit'), hint: '⇧1', run: () => onZoom('fit') },
    {
      id: 'selection',
      label: t('board.zoom.selection'),
      hint: '⇧2',
      run: () => onZoom('selection'),
    },
    { id: 'reset', label: t('board.zoom.reset'), hint: '⇧0', run: () => onZoom('reset') },
    { id: 'unsorted', label: t('board.palette.unsorted'), run: onToggleUnsorted },
    ...(readOnly
      ? []
      : [
          { id: 'undo', label: t('board.palette.undo'), hint: `${m}Z`, run: onUndo },
          { id: 'redo', label: t('board.palette.redo'), hint: `${m}⇧Z`, run: onRedo },
        ]),
  ];
  const shown = rankActions(commands, query);
  const run = (c: PaletteAction | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };
  return (
    <div className="palette__backdrop" data-chrome onPointerDown={onClose}>
      <dialog
        open
        className="palette"
        aria-label={t('board.palette.title')}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          className="palette__input"
          autoFocus
          value={query}
          placeholder={t('board.palette.placeholder')}
          aria-label={t('board.palette.title')}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={shown[active] ? `palette-option-${active}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown')
              setActive((a) => Math.max(0, Math.min(shown.length - 1, a + 1)));
            else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
            else if (e.key === 'Enter') run(shown[active]);
            else return;
            e.preventDefault();
          }}
        />
        <div id="palette-list" role="listbox" className="palette__list">
          {shown.map((c, i) => (
            <button
              key={c.id}
              id={`palette-option-${i}`}
              tabIndex={-1}
              onPointerDown={(e) => e.preventDefault()}
              type="button"
              role="option"
              aria-selected={i === active}
              className="palette__item"
              onMouseEnter={() => setActive(i)}
              onClick={() => run(c)}
            >
              {c.label}
              {c.hint && <KeyCap>{c.hint}</KeyCap>}
            </button>
          ))}
          {shown.length === 0 && (
            <p className="ink-muted palette__none">{t('board.palette.none')}</p>
          )}
        </div>
      </dialog>
    </div>
  );
}

export function Toast({
  text,
  onUndo,
  onClose,
}: {
  text: string;
  onUndo?: (() => void) | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <div className="toast" role="status" data-chrome>
      <span>{text}</span>
      {onUndo && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            onUndo();
            onClose();
          }}
        >
          {t('board.undo')}
        </button>
      )}
    </div>
  );
}
