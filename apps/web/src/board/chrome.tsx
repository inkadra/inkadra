import {
  type Alignment,
  type Point,
  type Rect,
  TEMPLATE_IDS,
  type TemplateId,
  type TidyGap,
  type Viewport,
} from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import {
  type ContentKind,
  Icon,
  type IconName,
  KeyCap,
  kindStyle,
  swallowOutsidePress,
  type ToolKind,
  toolStyle,
  useExitFade,
} from '@inkadra/ui';
import type { Editor } from '@tiptap/react';
import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type * as Y from 'yjs';
import { addActions, type PaletteAction, rankActions } from '../commands/actions.ts';
import {
  CANVAS_TEMPLATES,
  type CanvasTemplate,
  canvasTemplateIcon,
  canvasTemplateLabel,
} from './canvas-templates.ts';
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
  | 'storyboard'
  | 'character'
  | 'location'
  | 'section'
  | 'table'
  | 'map';
export type CanvasTool = 'select' | 'hand' | 'arrow';
export const TOOL_MIME = 'application/x-inkadra-tool';

export const TOOLS: Array<{ type: ToolType; icon: IconName; key?: string; menuOnly?: boolean }> = [
  { type: 'note', icon: 'stickyNote', key: 'N' },
  { type: 'image', icon: 'image', key: 'I' },
  { type: 'link', icon: 'link', key: 'L' },
  { type: 'todo', icon: 'todo', key: 'T' },
  { type: 'column', icon: 'splitPanel', key: 'C' },
  // Board and Storyboard are inserted from the Canvas menu; their keys and palette entries stay.
  { type: 'board', icon: 'board', key: 'B', menuOnly: true },
  { type: 'color', icon: 'color', key: 'K' },
  { type: 'frame', icon: 'frame', key: 'F' },
  { type: 'storyboard', icon: 'storyboard', key: 'S', menuOnly: true },
  { type: 'scene', icon: 'scene', menuOnly: true },
  // Story bible cards (decision 0044): from the Canvas menu and the command palette.
  { type: 'character', icon: 'user', menuOnly: true },
  { type: 'location', icon: 'pin', menuOnly: true },
  { type: 'section', icon: 'heading', menuOnly: true },
  { type: 'table', icon: 'table', menuOnly: true },
  { type: 'map', icon: 'map', menuOnly: true },
];

/** Cards of the Canvas menu listed after the canvas types, with their icons. */
const MENU_CARDS = [
  ['character', 'user'],
  ['location', 'pin'],
  ['section', 'heading'],
  ['table', 'table'],
  ['map', 'map'],
] as const satisfies ReadonlyArray<readonly [ToolType, IconName]>;
type MenuCard = (typeof MENU_CARDS)[number][0];

const mod = () => (isMac() ? '⌘' : 'Ctrl+');

/**
 * Marks a sideways-scrolling row with `data-more-start` and `data-more-end` while there is more
 * of it past that edge, so CSS can fade the edge instead of showing a tool cut in half.
 */
function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const rest = el.scrollWidth - el.clientWidth - el.scrollLeft;
      el.toggleAttribute('data-more-start', el.scrollLeft > 1);
      el.toggleAttribute('data-more-end', rest > 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resize?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      resize?.disconnect();
    };
  }, []);
  return ref;
}

/** Bottom tool bar: click adds in the middle of the view, drag drops where you let go. */
export function Toolbar({
  tool,
  onTool,
  onAdd,
  onCanvas,
  onScreenplay,
  onVoiceNote,
}: {
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
  onAdd: (type: ToolType) => void;
  /** A board from the Canvas menu: plain or laid out from a template. */
  onCanvas: (template: CanvasTemplate) => void;
  /** A storyboard made from a screenplay file, after the Canvas menu's Storyboard. */
  onScreenplay?: () => void;
  /** Records a voice note from the microphone, saved as an audio card (#327). */
  onVoiceNote?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const tools = useScrollEdges<HTMLDivElement>();
  return (
    <div className="toolbar" role="toolbar" aria-label={t('board.toolbar')} data-chrome>
      {/* On phones the tools scroll sideways and the Canvas button stays pinned beside them. */}
      <div ref={tools} className="toolbar__tools">
        <fieldset
          className="toolbar__group toolbar__group--navigate"
          aria-label={t('board.toolGroups.navigate')}
        >
          <ToolButton
            icon="pointer"
            kind="select"
            label={t('board.tools.select')}
            keyHint="V"
            pressed={tool === 'select'}
            onClick={() => onTool('select')}
          />
          <ToolButton
            icon="hand"
            kind="hand"
            label={t('board.tools.hand')}
            keyHint="H"
            pressed={tool === 'hand'}
            onClick={() => onTool('hand')}
          />
          <ToolButton
            icon="arrow"
            kind="arrow"
            label={t('board.tools.arrow')}
            keyHint="A"
            pressed={tool === 'arrow'}
            onClick={() => onTool(tool === 'arrow' ? 'select' : 'arrow')}
          />
        </fieldset>
        {(['create', 'organize'] as const).map((group) => (
          <fieldset
            key={group}
            className={`toolbar__group toolbar__group--${group}`}
            aria-label={t(`board.toolGroups.${group}`)}
          >
            {TOOLS.filter(
              (tl) =>
                !tl.menuOnly &&
                (group === 'create'
                  ? ['note', 'image', 'link', 'todo', 'color'].includes(tl.type)
                  : ['column', 'frame'].includes(tl.type)),
            ).map((tl) => (
              <ToolButton
                key={tl.type}
                kind={tl.type as ToolKind}
                icon={tl.icon}
                label={t(`board.types.${tl.type}`)}
                keyHint={tl.key ?? ''}
                onClick={() => onAdd(tl.type)}
                dragType={tl.type}
              />
            ))}
          </fieldset>
        ))}
      </div>
      <fieldset
        className="toolbar__group toolbar__group--canvas"
        aria-label={t('board.canvasMenu.hint')}
      >
        <CanvasMenuButton
          onCanvas={onCanvas}
          onScreenplay={onScreenplay}
          onVoiceNote={onVoiceNote}
          onCard={(type) => onAdd(type)}
        />
      </fieldset>
    </div>
  );
}

/**
 * The primary action at the end of the bar: a menu of the canvas types to insert, each in its
 * content-kind colour. The menu sits outside the bar, whose tools scroll sideways on phones.
 */
function CanvasMenuButton({
  onCanvas,
  onScreenplay,
  onVoiceNote,
  onCard,
}: {
  onCanvas: (template: CanvasTemplate) => void;
  onScreenplay?: (() => void) | undefined;
  /** Records a voice note (#327); absent where the browser cannot record. */
  onVoiceNote?: (() => void) | undefined;
  /** Story bible cards, section headings and tables, listed after the canvas types. */
  onCard: (type: MenuCard) => void;
}) {
  const { t } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ right: number; bottom: number } | null>(null);
  const label = t('board.canvasMenu.label');
  // Above the button, its right edge on the button's.
  const open = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setAt({
      right: Math.max(8, document.documentElement.clientWidth - rect.right),
      bottom: window.innerHeight - rect.top + 8,
    });
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className="toolbar__btn toolbar__btn--canvas"
        aria-haspopup="menu"
        aria-expanded={!!at}
        aria-label={label}
        data-ink-tooltip={t('board.canvasMenu.hint')}
        onClick={() => (at ? setAt(null) : open())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            open();
          }
        }}
      >
        <Icon name="plus" size={18} />
        <span className="toolbar__label">{label}</span>
        <Icon name="caretDown" size={10} />
      </button>
      {at &&
        createPortal(
          <ContextMenu
            label={label}
            className="menu--canvas"
            style={{ right: at.right, bottom: at.bottom }}
            anchor={button}
            items={CANVAS_TEMPLATES.flatMap((template): MenuItem[] => [
              {
                label: canvasTemplateLabel(template, t),
                icon: canvasTemplateIcon(template),
                kind: template,
                action: () => onCanvas(template),
              },
              ...(template === 'storyboard' && onScreenplay
                ? [
                    {
                      label: t('screenplay.fromScreenplay'),
                      icon: 'upload' as const,
                      kind: 'storyboard' as const,
                      action: onScreenplay,
                    },
                  ]
                : []),
            ]).concat([
              { divider: true },
              ...MENU_CARDS.map(
                ([type, icon]): MenuItem => ({
                  label: t(`board.types.${type}`),
                  icon,
                  kind: 'canvas',
                  action: () => onCard(type),
                }),
              ),
              ...(onVoiceNote
                ? [
                    { divider: true } as MenuItem,
                    {
                      label: t('board.voiceNote.label'),
                      icon: 'mic' as const,
                      kind: 'canvas' as const,
                      action: onVoiceNote,
                    },
                  ]
                : []),
            ])}
            onClose={(reason) => {
              setAt(null);
              if (reason === 'escape') button.current?.focus();
            }}
          />,
          document.body,
        )}
    </>
  );
}

function ToolButton({
  kind,
  icon,
  label,
  keyHint,
  pressed,
  onClick,
  dragType,
}: {
  kind: ToolKind;
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
      className={`toolbar__btn toolbar__btn--${dragType ?? icon}`}
      style={toolStyle(kind)}
      aria-keyshortcuts={keyHint}
      aria-label={label}
      aria-pressed={pressed}
      data-ink-tooltip={`${label} (${keyHint})`}
      onClick={onClick}
      draggable={!!dragType}
      onDragStart={(e) => {
        if (!dragType) return;
        e.dataTransfer.setData(TOOL_MIME, dragType);
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <Icon name={icon} size={20} />
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
      data-ink-tooltip={label}
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
  onArrange,
  gap,
  onGap,
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
  onArrange: (how: ArrangeCommand) => void;
  /** Gap of the tidy-up commands, remembered per person. */
  gap: TidyGap;
  onGap: (gap: TidyGap) => void;
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
  const bar = useRef<HTMLDivElement>(null);
  const left = Math.max(8, box.x);
  // A selection near the right edge would push the bar off a narrow screen: keep it inside.
  // The bar is taller with touch targets, so it also clears the selection by its real height.
  useLayoutEffect(() => {
    const el = bar.current;
    const room = (el?.offsetParent as HTMLElement | null)?.clientWidth;
    if (!el || !room) return;
    el.style.left = `${Math.max(8, Math.min(left, room - el.offsetWidth - 8))}px`;
    const above = box.y - el.offsetHeight - 10;
    el.style.top = `${above < 8 ? box.y + box.h + 8 : above}px`;
  });
  if (elements.length === 0 || (readOnly && !onComments)) return null;
  if (readOnly && onComments)
    return (
      <div
        ref={bar}
        className="ctxbar"
        role="toolbar"
        aria-label={t('board.contextBar')}
        style={{ left, top: box.y - 44 < 8 ? box.y + box.h + 8 : box.y - 44 }}
        data-chrome
      >
        <BarButton icon="comment" label={t('comments.open')} onClick={onComments} />
      </div>
    );
  const free = elements.filter((e) => e.parent === null);
  // Notes take a tint, columns an accent and tables a header tint, from the same card palette.
  const colored = elements.filter(
    (e) => e.type === 'note' || e.type === 'column' || e.type === 'table',
  );
  const locked = elements.some((e) => e.locked);
  const hideable = elements.filter((e) => e.type !== 'arrow');
  const guestHidden = hideable.length > 0 && hideable.every((e) => e.guestHidden);
  const top = box.y - 44 < 8 ? box.y + box.h + 8 : box.y - 44;
  return (
    <div
      ref={bar}
      className="ctxbar"
      role="toolbar"
      aria-label={t('board.contextBar')}
      style={{ left, top }}
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
      {colored.length > 0 && colored.length === elements.length && (
        <>
          <button
            type="button"
            className="ctxbar__swatch"
            aria-label={t('board.colors.none')}
            data-ink-tooltip={t('board.colors.none')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onColor(undefined)}
          />
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`ctxbar__swatch ctxbar__swatch--${c}`}
              aria-label={t(`board.colors.${c}`)}
              data-ink-tooltip={t(`board.colors.${c}`)}
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
          <ArrangeButton count={free.length} gap={gap} onGap={onGap} onArrange={onArrange} />
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
          data-ink-tooltip={t('guestVisibility.hide')}
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
        onClick={() => onTags(left, box.y + box.h + 8)}
      />
      <BarButton icon="copy" label={t('board.menu.duplicate')} onClick={onDuplicate} />
      <BarButton icon="trash" label={t('board.menu.delete')} onClick={onDelete} />
      <button
        type="button"
        className="ctxbar__btn"
        aria-label={t('board.menu.more')}
        data-ink-tooltip={t('board.menu.more')}
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

/** What the Arrange menu does to the selection (#320). */
export type ArrangeCommand = Alignment | 'distributeX' | 'distributeY' | 'mosaic' | 'rows';

const ALIGN_ITEMS: Array<{ how: Alignment; icon: IconName }> = [
  { how: 'left', icon: 'alignLeft' },
  { how: 'center', icon: 'alignCenter' },
  { how: 'right', icon: 'alignRight' },
  { how: 'top', icon: 'alignTop' },
  { how: 'middle', icon: 'alignMiddle' },
  { how: 'bottom', icon: 'alignBottom' },
];
const GAPS: TidyGap[] = ['s', 'm', 'l'];

/**
 * The selection bar's Arrange button and its menu: align, distribute and tidy up into a mosaic
 * or rows with a gap of S, M or L. The menu sits beside the bar, which scrolls on phones.
 */
function ArrangeButton({
  count,
  gap,
  onGap,
  onArrange,
}: {
  count: number;
  gap: TidyGap;
  onGap: (gap: TidyGap) => void;
  onArrange: (how: ArrangeCommand) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const label = t('board.arrange.label');
  // Under the button, or above the bar when there is no room below; inside the board.
  useLayoutEffect(() => {
    const el = menu.current;
    const btn = button.current;
    const bar = btn?.parentElement;
    const room = el?.offsetParent as HTMLElement | null;
    if (!el || !btn || !bar || !room) return;
    const left = bar.offsetLeft + btn.offsetLeft - bar.scrollLeft;
    el.style.left = `${Math.max(8, Math.min(left, room.clientWidth - el.offsetWidth - 8))}px`;
    const below = bar.offsetTop + bar.offsetHeight + 6;
    el.style.top = `${
      below + el.offsetHeight > room.clientHeight - 8
        ? Math.max(8, bar.offsetTop - el.offsetHeight - 6)
        : below
    }px`;
  });
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menu.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);
  const run = (how: ArrangeCommand) => {
    setOpen(false);
    onArrange(how);
  };
  const item = (how: ArrangeCommand, icon: IconName, text: string, shortcut?: string) => (
    <button
      key={how}
      type="button"
      role="menuitem"
      className="menu__item"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run(how)}
    >
      <Icon name={icon} size={14} />
      {text}
      {shortcut && <span className="menu__key">{shortcut}</span>}
    </button>
  );
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`ctxbar__btn${open ? ' is-active' : ''}`}
        aria-label={label}
        data-ink-tooltip={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="arrange" size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="menu arrange-menu"
            role="menu"
            aria-label={label}
            data-chrome
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                button.current?.focus();
              }
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                // The keys move through the menu, not the selected cards.
                e.preventDefault();
                e.stopPropagation();
                const all = [
                  ...(menu.current?.querySelectorAll<HTMLElement>(
                    '[role="menuitem"], [role="menuitemradio"]',
                  ) ?? []),
                ];
                const i = all.indexOf(document.activeElement as HTMLElement);
                const next =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? all.length - 1
                      : (i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
                all[next]?.focus();
              }
            }}
          >
            {ALIGN_ITEMS.map(({ how, icon }) => item(how, icon, t(`board.align.${how}`)))}
            {count > 2 && (
              <>
                {item('distributeX', 'distribute', t('board.arrange.distributeX'))}
                {item('distributeY', 'distributeVertical', t('board.arrange.distributeY'))}
              </>
            )}
            <hr className="menu__divider" />
            {item('mosaic', 'mosaic', t('board.arrange.mosaic'), '⇧T')}
            {item('rows', 'rows', t('board.arrange.rows'))}
            <fieldset className="arrange-menu__gap" aria-label={t('board.arrange.gap')}>
              <span aria-hidden="true">{t('board.arrange.gap')}</span>
              {GAPS.map((g) => (
                <button
                  key={g}
                  type="button"
                  role="menuitemradio"
                  aria-checked={gap === g}
                  aria-label={t(`board.arrange.gaps.${g}`)}
                  className="arrange-menu__chip"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onGap(g)}
                >
                  {g.toUpperCase()}
                </button>
              ))}
            </fieldset>
          </div>,
          button.current?.closest('.canvas') ?? document.body,
        )}
    </>
  );
}

export type MenuItem =
  | {
      label: string;
      /** The same permitted action is exposed by a contextual toolbar icon. */
      toolbar?: boolean;
      shortcut?: string;
      danger?: boolean;
      action?: () => void;
      /** Not available yet: shown, but it does nothing and says why in `hint`. */
      disabled?: boolean;
      hint?: string;
      /** A leading icon on a tile in the content-kind colour, as in the Canvas menu. */
      icon?: IconName;
      kind?: ContentKind;
      divider?: never;
    }
  | { divider: true };

export function ContextMenu({
  x,
  y,
  style,
  className,
  label,
  items,
  onClose,
  anchor,
}: {
  /** Viewport position; without it the menu is placed by the stylesheet of its container. */
  x?: number;
  y?: number;
  /** Placement other than a top-left corner, e.g. above the toolbar button that opens it. */
  style?: CSSProperties;
  className?: string;
  label?: string;
  items: MenuItem[];
  /** Why the menu closes, so a caller can return focus only when the keyboard was used. */
  onClose: (reason: 'escape' | 'outside' | 'item') => void;
  /** The button that toggles the menu: pressing it is left to the button. */
  anchor?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hintId = useId();
  // Opened at a point near an edge (a long press on a phone), the menu moves back inside its
  // container instead of running off the screen; a menu taller than the room scrolls.
  useLayoutEffect(() => {
    const el = ref.current;
    const room = el?.offsetParent as HTMLElement | null;
    if (!el || !room || x === undefined || y === undefined || style) return;
    el.style.maxHeight = `${room.clientHeight - 16}px`;
    el.style.left = `${Math.max(8, Math.min(x, room.clientWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(y, room.clientHeight - el.offsetHeight - 8))}px`;
  }, [x, y, style]);
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])')
      ?.focus();
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchor?.current?.contains(target)) return;
      swallowOutsidePress(e);
      onClose('outside');
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose, anchor]);
  return (
    <div
      ref={ref}
      className={className ? `menu ${className}` : 'menu'}
      role="menu"
      aria-label={label}
      style={style ?? (x === undefined ? undefined : { left: x, top: y })}
      data-chrome
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose('escape');
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          const all = [
            // Disabled items stay in the walk so their "coming soon" hint can be found.
            ...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
          ];
          const i = all.indexOf(document.activeElement as HTMLElement);
          const next =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? all.length - 1
                : (i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
          all[next]?.focus();
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
            className={`menu__item${item.danger ? ' is-danger' : ''}${item.disabled ? ' is-disabled' : ''}`}
            aria-disabled={item.disabled || undefined}
            aria-describedby={item.hint ? `${hintId}-${i}` : undefined}
            onClick={() => {
              if (item.disabled) return;
              onClose('item');
              item.action?.();
            }}
          >
            {item.icon && (
              <span
                className="menu__tile"
                style={item.kind ? kindStyle(item.kind) : undefined}
                aria-hidden="true"
              >
                <Icon name={item.icon} size={14} />
              </span>
            )}
            {item.label}
            {item.hint && (
              <span id={`${hintId}-${i}`} className="menu__hint" aria-hidden="true">
                {item.hint}
              </span>
            )}
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
    // Section headings are landmarks: a line along their rule.
    const landmarks = elements
      .flatMap((el, i) => {
        const r = rects[i];
        if (el.type !== 'section' || !r) return [];
        const m = map(r);
        return [`M${m.x.toFixed(1)} ${(m.y + m.height).toFixed(1)}h${m.width.toFixed(1)}`];
      })
      .join('');
    return { minX, minY, s, ox, oy, map, path, landmarks };
  }, [elements, rectOf]);
  if (!layout || size.w === 0) return null;
  const { minX, minY, s, ox, oy, map, path, landmarks } = layout;
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
        {landmarks && <path d={landmarks} className="minimap__landmark" />}
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
  snap,
}: {
  zoom: number;
  onZoom: (to: 'in' | 'out' | 'reset' | 'fit') => void;
  /** The magnet (#296): snap to grid, for people who can edit. */
  snap?: { on: boolean; onToggle: () => void } | undefined;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="zoom" aria-label={t('board.zoom.label')}>
      <button
        type="button"
        aria-label={t('board.zoom.out')}
        data-ink-tooltip={t('board.zoom.out')}
        onClick={() => onZoom('out')}
      >
        <Icon name="minus" size={14} />
      </button>
      <button
        type="button"
        className="zoom__value"
        data-ink-tooltip={t('board.zoom.reset')}
        onClick={() => onZoom('reset')}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        aria-label={t('board.zoom.in')}
        data-ink-tooltip={t('board.zoom.in')}
        onClick={() => onZoom('in')}
      >
        <Icon name="plus" size={14} />
      </button>
      <button
        type="button"
        aria-label={t('board.zoom.fit')}
        data-ink-tooltip={t('board.zoom.fit')}
        onClick={() => onZoom('fit')}
      >
        <Icon name="fit" size={14} />
      </button>
      {snap && (
        <button
          type="button"
          className={`zoom__snap${snap.on ? ' is-active' : ''}`}
          aria-label={t('board.snap.label')}
          aria-pressed={snap.on}
          aria-keyshortcuts="G"
          data-ink-tooltip={t('board.snap.tooltip')}
          onClick={snap.onToggle}
        >
          <Icon name="magnet" size={14} />
        </button>
      )}
    </fieldset>
  );
}

/**
 * "Non ordinati": what arrives from the clipper, the phone or other boards, still to place.
 * Shown only while something waits there, while it is open (the command palette opens it) or
 * while cards are dragged, so they can be dropped on it.
 */
export function UnsortedDrawer({
  ref,
  items,
  open,
  onToggle,
  selection,
  dropping,
  dragging,
  draggingIds,
}: {
  ref: Ref<HTMLDivElement>;
  items: readonly Element[];
  open: boolean;
  onToggle: () => void;
  selection: ReadonlySet<string>;
  dropping: boolean;
  dragging: boolean;
  draggingIds: ReadonlySet<string> | undefined;
}) {
  const { t } = useTranslation();
  if (items.length === 0 && !open && !dragging) return null;
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
  extra = [],
}: {
  readOnly: boolean;
  /** Commands of the board itself: snap to grid, arranging the selection. */
  extra?: PaletteAction[];
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
    ...(readOnly ? [] : extra),
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
        className="palette ink-motion-dialog"
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

/** How long a toast stays; the pointer or the focus on it pauses the count (#310). */
export const TOAST_MS = 6000;

export function Toast({
  text,
  ok,
  onShow,
  onUndo,
  history,
  onClose,
}: {
  text: string;
  /** A check before the text: something was done. */
  ok?: boolean | undefined;
  /** Brings what was added into view. */
  onShow?: (() => void) | undefined;
  onUndo?: (() => void) | undefined;
  /** The history `onUndo` belongs to: Undo leaves once another edit or ⌘Z changes it. */
  history?: Pick<Y.UndoManager, 'on' | 'off'> | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useExitFade<HTMLDivElement>();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [stale, setStale] = useState(false);
  const left = useRef(TOAST_MS);
  const held = hovered || focused;
  useEffect(() => {
    if (held) return;
    const start = Date.now();
    const timer = setTimeout(onClose, left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - start;
    };
  }, [held, onClose]);
  useEffect(() => {
    if (!history) return;
    const done = () => setStale(true);
    history.on('stack-item-added', done);
    history.on('stack-item-popped', done);
    return () => {
      history.off('stack-item-added', done);
      history.off('stack-item-popped', done);
    };
  }, [history]);
  const actions = !!onShow || !!onUndo;
  return (
    <div
      ref={ref}
      className="toast ink-motion-rise"
      role="status"
      data-chrome
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      {ok && (
        <span className="toast__ok" aria-hidden="true">
          <Icon name="check" size={11} />
        </span>
      )}
      <span className="toast__text">{text}</span>
      {onShow && (
        <button type="button" className="toast__action" onClick={onShow}>
          {t('board.show')}
        </button>
      )}
      {onUndo && !stale && (
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
      {actions && (
        <>
          <span className="toast__divider" aria-hidden="true" />
          <button
            type="button"
            className="toast__close"
            aria-label={t('board.toastClose')}
            onClick={onClose}
          >
            <Icon name="close" size={13} />
          </button>
          <span
            className="toast__bar"
            aria-hidden="true"
            data-held={held || undefined}
            style={{ animationDuration: `${TOAST_MS}ms` }}
          />
        </>
      )}
    </div>
  );
}
