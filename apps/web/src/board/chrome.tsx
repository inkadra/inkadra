import type { Alignment, Point, Rect, TidyGap, Viewport } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import { type ModuleId, moduleOf } from '@inkadra/shared';
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
  useCallback,
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
import { openFeedback, useFeedbackStatus } from '../feedback/state.ts';
import { CLIPPER_STORE_URL } from '../lib/clipper.ts';
import { setModule, useModules } from '../lib/modules.ts';
import { updatePreferences, usePreferences } from '../lib/preferences.ts';
import { pickVariant, useAsset } from './assets.ts';
import { ContextualTools } from './ContextualTools.tsx';
import { Card, NOTE_COLORS } from './cards.tsx';
import { GuestVisibilityIcon } from './guest-visibility.tsx';
import { StorageNotice } from './StorageNotice.tsx';
import { isMac } from './shortcuts.ts';
import {
  BAR_ICONS,
  type BarTool,
  barKind,
  barLabelKey,
  CORE_TOOLS,
  MORE_TOOLS,
  type MoreTool,
  pinnedTools,
  togglePinned,
} from './toolbar-prefs.ts';
import { cancelUpload, localPreview, retryUpload, useUploads } from './uploads.ts';
import { kindIcon } from './views.ts';

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
  | 'map'
  | 'plan';
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
  { type: 'plan', icon: 'planCamera', menuOnly: true },
];

const mod = () => (isMac() ? '⌘' : 'Ctrl+');

/** The phone bar of the mockup (#110): note, photo and to-do beside Select and More. */
const PHONE_BAR = ['note', 'image', 'todo'] as const;

/** The kinds of board the Canvas menu creates, with the module each belongs to (0121). */
const NEW_BOARDS = ['board', 'moodboard', 'storyboard'] as const;
type NewBoardKind = (typeof NEW_BOARDS)[number];

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

/** Above a toolbar button, its right edge on the button's. */
function placeAbove(button: HTMLElement | null) {
  const rect = button?.getBoundingClientRect();
  if (!rect) return null;
  return {
    right: Math.max(8, document.documentElement.clientWidth - rect.right),
    bottom: window.innerHeight - rect.top + 8,
    // Below the header: a long menu scrolls instead of running under it.
    maxHeight: Math.max(160, rect.top - 72),
  };
}

/**
 * A popup closes on a press outside it; its own button is left to toggle it. Only while it is
 * `open`: a closed one must leave every press to the page.
 */
function useOutsidePress(
  ref: RefObject<HTMLElement | null>,
  anchor: RefObject<HTMLElement | null> | undefined,
  onClose: (reason: 'outside') => void,
  open = true,
) {
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchor?.current?.contains(target)) return;
      swallowOutsidePress(e);
      onClose('outside');
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [ref, anchor, onClose, open]);
}

/**
 * Bottom tool bar (decision 0121): Select, Hand, Arrow; Note, Image, Link, To-do; the tools a
 * person put in the bar; More; Canvas. Click adds in the middle of the view, drag drops where
 * you let go. The tools of a module that is off are not offered.
 */
export function Toolbar({
  tool,
  onTool,
  onAdd,
  onCanvas,
  onScreenplay,
  onVoiceNote,
  onModuleOn,
  phone = false,
}: {
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
  onAdd: (type: ToolType) => void;
  /** Makes a sub-board of a kind (decision 0121). */
  onCanvas: (kind?: Exclude<NewBoardKind, 'board'>) => void;
  /** Imports a screenplay. */
  onScreenplay?: () => void;
  /** Records a voice note from the microphone, saved as an audio card (#327). */
  onVoiceNote?: (() => void) | undefined;
  /** Turns on a module that is off, from a dimmed entry of the Canvas menu. */
  onModuleOn?: (id: ModuleId) => void;
  /** Select, note, photo and to-do on the bar; every other tool waits in the "More" menu. */
  phone?: boolean;
}) {
  const { t } = useTranslation();
  const tools = useScrollEdges<HTMLDivElement>();
  const saved = usePreferences().toolbar;
  const { offers } = useModules();
  const more = MORE_TOOLS.filter((tl) => offers('tools', tl) && (tl !== 'voice' || onVoiceNote));
  const pinned = pinnedTools(saved).filter((tl) => more.includes(tl));
  const addTool = (tl: BarTool) => (tl === 'voice' ? onVoiceNote?.() : onAdd(tl));
  const turnOn = (id: ModuleId) => (onModuleOn ? onModuleOn(id) : void setModule(id, true));
  const button = (tl: BarTool) => {
    const meta = TOOLS.find((x) => x.type === tl);
    return (
      <ToolButton
        key={tl}
        kind={barKind(tl)}
        icon={BAR_ICONS[tl]}
        label={t(barLabelKey(tl))}
        keyHint={meta?.key ?? ''}
        onClick={() => addTool(tl)}
        dragType={meta ? meta.type : undefined}
        className={tl === 'voice' ? 'toolbar__btn--mic' : undefined}
      />
    );
  };
  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label={t('board.toolbar')}
      data-chrome
      data-tour="dock"
    >
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
          {/* On a phone the hand comes from "More" and shows here only while it is on. */}
          {(!phone || tool === 'hand') && (
            <ToolButton
              icon="hand"
              kind="hand"
              label={t('board.tools.hand')}
              keyHint="H"
              pressed={tool === 'hand'}
              onClick={() => onTool(phone ? 'select' : 'hand')}
            />
          )}
          {(!phone || tool === 'arrow') && (
            <ToolButton
              icon="arrow"
              kind="arrow"
              label={t('board.tools.arrow')}
              keyHint="A"
              pressed={tool === 'arrow'}
              onClick={() => onTool(tool === 'arrow' ? 'select' : 'arrow')}
            />
          )}
        </fieldset>
        <fieldset
          className="toolbar__group toolbar__group--create"
          aria-label={t('board.toolGroups.create')}
        >
          {(phone ? PHONE_BAR : CORE_TOOLS).map(button)}
        </fieldset>
        {!phone && pinned.length > 0 && (
          <fieldset
            className="toolbar__group toolbar__group--organize"
            aria-label={t('board.toolGroups.organize')}
          >
            {pinned.map(button)}
          </fieldset>
        )}
        {!phone && (
          <fieldset
            className="toolbar__group toolbar__group--more"
            aria-label={t('board.more.title')}
          >
            <MoreButton
              tools={more}
              pinned={pinned}
              onAdd={addTool}
              onPin={(tl) =>
                void updatePreferences({ toolbar: togglePinned(saved, tl) }).catch(() => {})
              }
            />
          </fieldset>
        )}
      </div>
      <fieldset
        className="toolbar__group toolbar__group--canvas"
        aria-label={t('board.canvasMenu.hint')}
      >
        <CanvasMenuButton
          phone={phone}
          more={more}
          onTool={onTool}
          onAdd={addTool}
          onCanvas={onCanvas}
          onScreenplay={onScreenplay}
          onModuleOn={turnOn}
        />
      </fieldset>
    </div>
  );
}

/** More (⋯): the other tools, each one added with a click or put in the bar (decision 0121). */
function MoreButton({
  tools,
  pinned,
  onAdd,
  onPin,
}: {
  tools: readonly MoreTool[];
  pinned: readonly MoreTool[];
  onAdd: (tool: MoreTool) => void;
  onPin: (tool: MoreTool) => void;
}) {
  const { t } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<ReturnType<typeof placeAbove>>(null);
  const close = useCallback(() => setAt(null), []);
  useOutsidePress(panel, button, close, !!at);
  useEffect(() => {
    if (at) panel.current?.querySelector<HTMLElement>('.more-tools__add')?.focus();
  }, [at]);
  const label = t('board.more.title');
  return (
    <>
      <button
        ref={button}
        type="button"
        className="toolbar__btn toolbar__btn--more"
        data-tour="dock-tools"
        aria-haspopup="dialog"
        aria-expanded={!!at}
        aria-label={label}
        data-ink-tooltip={label}
        onClick={() => setAt(at ? null : placeAbove(button.current))}
      >
        <Icon name="more" size={20} />
      </button>
      {at &&
        createPortal(
          <div
            ref={panel}
            className="ink-menu menu menu--canvas more-tools"
            role="dialog"
            aria-label={label}
            style={{ right: at.right, bottom: at.bottom, maxHeight: at.maxHeight }}
            data-chrome
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setAt(null);
                button.current?.focus();
              }
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const all = [
                  ...(panel.current?.querySelectorAll<HTMLElement>('.more-tools__add') ?? []),
                ];
                const i = all.indexOf(document.activeElement as HTMLElement);
                const step = e.key === 'ArrowDown' ? 1 : -1;
                all[(i + step + all.length) % all.length]?.focus();
              }
            }}
          >
            <p className="menu__heading">{label}</p>
            <ul className="more-tools__list">
              {tools.map((tl) => {
                const inBar = pinned.includes(tl);
                const name = t(barLabelKey(tl));
                return (
                  <li key={tl} className="more-tools__row">
                    <button
                      type="button"
                      className="ink-menu__item menu__item more-tools__add"
                      onClick={() => {
                        setAt(null);
                        onAdd(tl);
                      }}
                    >
                      <span
                        className="menu__tile"
                        style={toolStyle(barKind(tl))}
                        aria-hidden="true"
                      >
                        <Icon name={BAR_ICONS[tl]} size={14} />
                      </span>
                      {name}
                    </button>
                    <button
                      type="button"
                      className={`more-tools__pin${inBar ? ' is-on' : ''}`}
                      aria-pressed={inBar}
                      aria-label={t('board.more.pinFor', { name })}
                      onClick={() => onPin(tl)}
                    >
                      {t(inBar ? 'board.more.pinned' : 'board.more.pin')}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}

/** The small picture of a kind in the Canvas menu, as in the mockup of 0121. */
function KindCard({ kind, off }: { kind: NewBoardKind; off: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={`new-board${off ? ' is-off' : ''}`} style={kindStyle(kind)}>
      <span className={`new-board__preview new-board__preview--${kind}`} aria-hidden="true">
        {Array.from({ length: kind === 'board' ? 5 : 3 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: shapes of a drawing, without identity
          <i key={i} />
        ))}
      </span>
      <span className="new-board__name">
        <Icon name={kindIcon(kind)} size={14} />
        {t(kind === 'board' ? 'board.types.board' : `film.views.${kind}`)}
      </span>
      <span className="new-board__desc">
        {t(off ? 'modules.off' : `board.canvasMenu.desc.${kind}`)}
      </span>
      {off && <span className="new-board__tag">{t('modules.turnOn')}</span>}
    </span>
  );
}

/**
 * The primary action at the end of the bar (decision 0121): the boards to create, one card per
 * kind, and the screenplay import. A kind of a module that is off stays, dimmed, with Turn on.
 * On a phone it is "More", with the tools the bar has no room for first.
 */
function CanvasMenuButton({
  phone,
  more,
  onTool,
  onAdd,
  onCanvas,
  onScreenplay,
  onModuleOn,
}: {
  phone: boolean;
  /** The tools of More, for the phone. */
  more: readonly MoreTool[];
  onTool: (tool: CanvasTool) => void;
  onAdd: (tool: BarTool) => void;
  onCanvas: (kind?: Exclude<NewBoardKind, 'board'>) => void;
  onScreenplay?: (() => void) | undefined;
  onModuleOn: (id: ModuleId) => void;
}) {
  const { t } = useTranslation();
  const { offers } = useModules();
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<ReturnType<typeof placeAbove>>(null);
  const label = t(phone ? 'board.canvasMenu.more' : 'board.canvasMenu.label');
  const open = () => setAt(placeAbove(button.current));
  const storyboardOn = offers('menus', 'screenplayImport');
  const kinds = NEW_BOARDS.map((kind) => {
    const owner = moduleOf('kinds', kind);
    const off = !offers('kinds', kind);
    const name = t(kind === 'board' ? 'board.types.board' : `film.views.${kind}`);
    return {
      label: off ? t('modules.kindOff', { name }) : name,
      kind,
      off,
      action: () =>
        off && owner ? onModuleOn(owner) : onCanvas(kind === 'board' ? undefined : kind),
    };
  });
  const script: MenuItem | null = onScreenplay
    ? {
        label: storyboardOn
          ? t('board.canvasMenu.screenplay')
          : t('modules.kindOff', { name: t('board.canvasMenu.screenplay') }),
        icon: 'upload',
        kind: 'storyboard',
        content: (
          <span className={`new-board__script${storyboardOn ? '' : ' is-off'}`}>
            {t('board.canvasMenu.screenplay')}
            {!storyboardOn && <span className="new-board__tag">{t('modules.turnOn')}</span>}
          </span>
        ),
        action: storyboardOn ? onScreenplay : () => onModuleOn('storyboard'),
      }
    : null;
  const items: MenuItem[] = phone
    ? [
        {
          label: t('board.tools.hand'),
          icon: 'hand',
          kind: 'canvas',
          action: () => onTool('hand'),
        },
        {
          label: t('board.tools.arrow'),
          icon: 'arrow',
          kind: 'canvas',
          action: () => onTool('arrow'),
        },
        ...(['link', ...more] as const).map(
          (tl): MenuItem => ({
            label: t(barLabelKey(tl)),
            icon: BAR_ICONS[tl],
            kind: 'canvas',
            action: () => onAdd(tl),
          }),
        ),
        { divider: true },
        { heading: t('board.canvasMenu.newBoard') },
        ...kinds.map(
          (k): MenuItem => ({
            label: k.label,
            icon: kindIcon(k.kind),
            kind: k.kind,
            content: (
              <span className={`new-board__script${k.off ? ' is-off' : ''}`}>
                {t(k.kind === 'board' ? 'board.types.board' : `film.views.${k.kind}`)}
                {k.off && <span className="new-board__tag">{t('modules.turnOn')}</span>}
              </span>
            ),
            action: k.action,
          }),
        ),
        ...(script ? [script] : []),
      ]
    : [
        { heading: t('board.canvasMenu.newBoard') },
        ...kinds.map(
          (k): MenuItem => ({
            label: k.label,
            content: <KindCard kind={k.kind} off={k.off} />,
            action: k.action,
          }),
        ),
        ...(script ? [{ divider: true } as MenuItem, script] : []),
      ];
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`toolbar__btn toolbar__btn--canvas${phone ? ' toolbar__btn--more' : ''}`}
        data-tour="dock-more"
        aria-haspopup="menu"
        aria-expanded={!!at}
        aria-label={label}
        data-ink-tooltip={t(phone ? 'board.canvasMenu.more' : 'board.canvasMenu.hint')}
        onClick={() => (at ? setAt(null) : open())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            open();
          }
        }}
      >
        <Icon name={phone ? 'more' : 'plus'} size={18} />
        <span className="toolbar__label">{label}</span>
        {!phone && <Icon name="caretDown" size={10} />}
      </button>
      {at &&
        createPortal(
          <ContextMenu
            label={label}
            className={phone ? 'menu--canvas' : 'menu--canvas menu--new-board'}
            style={{ right: at.right, bottom: at.bottom, maxHeight: at.maxHeight }}
            anchor={button}
            items={items}
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
  className,
}: {
  kind: ToolKind;
  icon: IconName;
  label: string;
  keyHint: string;
  pressed?: boolean;
  onClick: () => void;
  dragType?: ToolType | undefined;
  className?: string | undefined;
}) {
  return (
    <button
      type="button"
      className={`toolbar__btn ${className ?? `toolbar__btn--${dragType ?? icon}`}`}
      style={toolStyle(kind)}
      aria-keyshortcuts={keyHint || undefined}
      aria-label={label}
      aria-pressed={pressed}
      data-ink-tooltip={keyHint ? `${label} (${keyHint})` : label}
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
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
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
  editing,
  onDone,
}: {
  editing?: string | null;
  onDone?: () => void;
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
  const editBox = useRef<Rect | null>(null);
  if (!editing) editBox.current = null;
  else if (!editBox.current) editBox.current = box;
  const anchor = editBox.current ?? box;
  const left = Math.max(8, anchor.x);
  // A selection near the right edge would push the bar off a narrow screen: keep it inside.
  // The bar is taller with touch targets, so it also clears the selection by its real height.
  useLayoutEffect(() => {
    const el = bar.current;
    const room = (el?.offsetParent as HTMLElement | null)?.clientWidth;
    if (!el || !room) return;
    el.style.left = `${Math.max(8, Math.min(left, room - el.offsetWidth - 8))}px`;
    const above = anchor.y - el.offsetHeight - 10;
    const top = above < 8 ? anchor.y + anchor.h + 8 : above;
    el.style.top = `${Math.max(8, Math.min(top, (el.offsetParent as HTMLElement).clientHeight - el.offsetHeight - 8))}px`;
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
  // A character's bar follows its mockup: hiding, duplicating and deleting are under "more".
  const character = elements.length === 1 && elements[0]?.type === 'character';
  const tagButton = (
    <BarButton icon="tag" label={t('tags.title')} onClick={() => onTags(left, box.y + box.h + 8)} />
  );
  return (
    <div
      ref={bar}
      className="ctxbar"
      role="toolbar"
      aria-label={t('board.contextBar')}
      style={{ left, top }}
      data-chrome
      onFocus={(e) => keepClearOfPinned(e.currentTarget, e.target)}
    >
      {editing && !locked && elements[0] ? (
        <>
          <ContextualTools key={elements[0].id} element={elements[0]} editor={editor} />
          {elements[0]?.type === 'arrow' && extra}
          <BarButton
            icon="more"
            label={t('board.menu.more')}
            onClick={() => {
              const rect = bar.current;
              if (!rect) return;
              onMore(rect.offsetLeft, rect.offsetTop + rect.offsetHeight + 6);
            }}
          />
          <span className="ctxbar__sep" aria-hidden="true" />
          <button type="button" className="ctxbar__btn ctxbar__done" onClick={onDone}>
            {t('board.contextual.done')}
          </button>
        </>
      ) : (
        <>
          {onComments && (
            <BarButton icon="comment" label={t('comments.open')} onClick={onComments} />
          )}
          {/* A heading has only its look to change: no need to open it first. */}
          {elements.length === 1 && elements[0]?.type === 'section' && !locked && (
            <>
              <ContextualTools key={elements[0].id} element={elements[0]} editor={editor} />
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
              <span className="ctxbar__count">
                {t('board.selected', { count: elements.length })}
              </span>
              <ArrangeButton count={free.length} gap={gap} onGap={onGap} onArrange={onArrange} />
              <BarButton icon="column" label={t('board.align.group')} onClick={onGroup} />
              <span className="ctxbar__sep" aria-hidden="true" />
            </>
          )}
          {character && tagButton}
          <BarButton
            icon={locked ? 'unlock' : 'lock'}
            label={locked ? t('board.menu.unlock') : t('board.menu.lock')}
            onClick={onLock}
            active={locked}
            danger={locked}
          />
          {!character && hideable.length > 0 && (
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
          {character && <span className="ctxbar__sep" aria-hidden="true" />}
          {extra}
          {character && <span className="ctxbar__sep" aria-hidden="true" />}
          {!character && (
            <>
              {tagButton}
              <BarButton icon="copy" label={t('board.menu.duplicate')} onClick={onDuplicate} />
              <BarButton icon="trash" label={t('board.menu.delete')} onClick={onDelete} />
            </>
          )}
          <button
            type="button"
            className="ctxbar__btn"
            aria-label={t('board.menu.more')}
            data-ink-tooltip={t('board.menu.more')}
            aria-haspopup="menu"
            onClick={(e) => {
              const bar = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
              const root = (
                e.currentTarget.closest('.canvas') as HTMLElement
              ).getBoundingClientRect();
              onMore(bar.right - root.left - 200, bar.bottom - root.top + 6);
            }}
          >
            <Icon name="more" size={14} />
          </button>
        </>
      )}
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
      className="ink-menu__item menu__item"
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
            className="ink-menu menu arrange-menu"
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

export type SheetSlot =
  | 'comment'
  | 'duplicate'
  | 'lock'
  | 'guest'
  | 'unsorted'
  | 'storyboard'
  | 'delete';

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
      /** Drawn instead of the label, which stays the item's name. */
      content?: ReactNode;
      /** One choice of a set, ticked when it is the current one. */
      checked?: boolean;
      /**
       * With `checked`: a switch of its own rather than one choice of a set, drawn as a switch
       * that shows off as well as on (a disabled one keeps the tick).
       */
      toggle?: boolean;
      /** Where the phone's card sheet puts the action, out of the list of other actions. */
      sheet?: SheetSlot;
      divider?: never;
      heading?: never;
      note?: never;
    }
  | { divider: true; heading?: never; note?: never }
  | { heading: string; divider?: never; note?: never }
  /** A line that explains the items above it. */
  | { note: string; divider?: never; heading?: never };

/** One titled part of a menu; the heading is left out when the section has no action. */
export type MenuSection = { heading?: string; items: readonly MenuItem[] };

/**
 * A long menu as sections (open, the card's tools, organize…) instead of one list: empty
 * sections are dropped, the rest are joined by a divider, without a divider at either end or
 * two in a row.
 */
export function joinMenuSections(sections: readonly MenuSection[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const section of sections) {
    const items: MenuItem[] = [];
    for (const item of section.items) {
      if (item.divider && (items.length === 0 || items.at(-1)?.divider)) continue;
      items.push(item);
    }
    if (items.at(-1)?.divider) items.pop();
    if (!items.some((item) => 'label' in item)) continue;
    if (out.length > 0) out.push({ divider: true });
    if (section.heading) out.push({ heading: section.heading });
    out.push(...items);
  }
  return out;
}

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
      ?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not([aria-disabled="true"])')
      // The menu is already placed in view; scrolling to it would shift a clipped list beside it.
      ?.focus({ preventScroll: true });
  }, []);
  useOutsidePress(ref, anchor, onClose);
  return (
    <div
      ref={ref}
      className={className ? `ink-menu menu ${className}` : 'ink-menu menu'}
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
            ...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []),
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
        ) : item.heading !== undefined ? (
          <p key={item.heading} className="menu__heading" role="presentation">
            {item.heading}
          </p>
        ) : item.note !== undefined ? (
          <p key={item.note} className="menu__note" role="presentation">
            {item.note}
          </p>
        ) : (
          // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked only comes with menuitemradio or menuitemcheckbox.
          <button
            key={item.label}
            type="button"
            role={
              item.checked === undefined
                ? 'menuitem'
                : item.toggle
                  ? 'menuitemcheckbox'
                  : 'menuitemradio'
            }
            aria-checked={item.checked}
            aria-label={item.content ? item.label : undefined}
            className={`ink-menu__item menu__item${item.danger ? ' is-danger' : ''}${item.disabled ? ' is-disabled' : ''}`}
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
            {item.content ?? item.label}
            {item.toggle && !item.disabled ? (
              // The switch is drawn, not a control: the item is the menuitemcheckbox.
              <span
                className={`ink-switch menu__switch${item.checked ? ' is-on' : ''}`}
                aria-hidden="true"
              >
                <span className="ink-switch__track" />
              </span>
            ) : (
              item.checked && (
                <span className="menu__check" aria-hidden="true">
                  <Icon name="check" size={14} />
                </span>
              )
            )}
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

/** Undo and redo, for people who turned the buttons on (#302): a small pill of their own. */
/**
 * On a phone the bar scrolls under its last two actions, which stay pinned (board.css). Focus
 * scrolls a control only to the edge, under them; this moves it to their left. Browsers apply
 * the bar's `scroll-padding` to scrollIntoView but not to focus.
 */
function keepClearOfPinned(bar: HTMLElement, target: EventTarget) {
  if (!(target instanceof HTMLElement) || getComputedStyle(target).position === 'sticky') return;
  const pinned = Number.parseFloat(getComputedStyle(bar).scrollPaddingInlineEnd) || 0;
  const over = target.getBoundingClientRect().right - (bar.getBoundingClientRect().right - pinned);
  if (pinned > 0 && over > 0) bar.scrollLeft += over;
}

export function HistoryControls({ onUndo, onRedo }: { onUndo: () => void; onRedo: () => void }) {
  const { t } = useTranslation();
  return (
    <fieldset className="zoom zoom--history" aria-label={t('board.history')}>
      <button
        type="button"
        aria-label={t('board.palette.undo')}
        aria-keyshortcuts={isMac() ? 'Meta+Z' : 'Control+Z'}
        data-ink-tooltip={`${t('board.palette.undo')} (${mod()}Z)`}
        onClick={onUndo}
      >
        <Icon name="undo" size={14} />
      </button>
      <button
        type="button"
        className="zoom__redo"
        aria-label={t('board.palette.redo')}
        aria-keyshortcuts={isMac() ? 'Meta+Shift+Z' : 'Control+Shift+Z'}
        data-ink-tooltip={`${t('board.palette.redo')} (${mod()}⇧Z)`}
        onClick={onRedo}
      >
        <Icon name="undo" size={14} />
      </button>
    </fieldset>
  );
}

export function ZoomControls({
  zoom,
  onZoom,
  snap,
  zoomOutDisabled = false,
}: {
  zoom: number;
  /** At the farthest zoom out of a board kept around its content (#324). */
  zoomOutDisabled?: boolean;
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
        disabled={zoomOutDisabled}
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

/** The open tray: rises in, and fades out as it closes. */
function UnsortedPanel({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const ref = useExitFade<HTMLElement>();
  return (
    <section ref={ref} className="unsorted__panel ink-motion-rise" aria-label={t('nav.unsorted')}>
      {children}
    </section>
  );
}

/** A waiting item on the closed toggle: its picture, or a text tile. */
function UnsortedThumb({ element }: { element: Element }) {
  const assetId = element.type === 'image' ? element.assetId : undefined;
  const asset = useAsset(assetId);
  const src =
    (asset && asset !== 'missing' ? pickVariant(asset, 48) : '') ||
    (assetId && localPreview(assetId)) ||
    '';
  return src ? (
    <img className="unsorted__thumb" src={src} alt="" />
  ) : (
    <span className="unsorted__thumb">
      <Icon name="text" size={10} />
    </span>
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
  onPlaceAll,
  selection,
  dropping,
  dragging,
  draggingIds,
}: {
  ref: Ref<HTMLDivElement>;
  items: readonly Element[];
  open: boolean;
  onToggle: () => void;
  onPlaceAll: () => void;
  selection: ReadonlySet<string>;
  dropping: boolean;
  dragging: boolean;
  draggingIds: ReadonlySet<string> | undefined;
}) {
  const { t } = useTranslation();
  // One ring pulse each time something new arrives; the key restarts the animation.
  const count = items.length;
  const seen = useRef(count);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (count > seen.current) setPulse((p) => p + 1);
    seen.current = count;
  }, [count]);
  if (count === 0 && !open && !dragging) return null;
  return (
    <div ref={ref} className={`unsorted${dropping ? ' is-dropping' : ''}`} data-chrome>
      {open ? (
        <UnsortedPanel>
          <header className="unsorted__head">
            <h2 className="unsorted__title">{t('nav.unsorted')}</h2>
            {count > 0 && <span className="unsorted__badge">{count}</span>}
            <button
              type="button"
              className="unsorted__close"
              aria-label={t('board.unsorted.close')}
              onClick={onToggle}
            >
              <Icon name="close" size={14} />
            </button>
          </header>
          {count === 0 ? (
            <p className="ink-muted unsorted__empty">
              {t('board.unsorted.empty')}{' '}
              <a href={CLIPPER_STORE_URL} target="_blank" rel="noopener">
                {t('board.unsorted.clipper')}
              </a>
            </p>
          ) : (
            <>
              <p className="ink-muted unsorted__hint">{t('board.unsorted.hint')}</p>
              <div className="unsorted__items" data-scroll>
                {items.map((el) => (
                  <Card
                    key={el.id}
                    element={el}
                    nested
                    selected={selection.has(el.id)}
                    dimmed={draggingIds?.has(el.id)}
                  />
                ))}
              </div>
              <footer className="unsorted__foot">
                <span className="ink-muted">{t('board.unsorted.count', { count })}</span>
                <button type="button" className="unsorted__place" onClick={onPlaceAll}>
                  {t('board.unsorted.placeAll')}
                </button>
              </footer>
            </>
          )}
        </UnsortedPanel>
      ) : (
        dragging && <div className="unsorted__drop">{t('board.unsorted.drop')}</div>
      )}
      <button
        type="button"
        className={`unsorted__toggle${count > 0 ? ' has-items' : ''}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <Icon name="unsorted" size={14} />
        <span className="unsorted__label">{t('nav.unsorted')}</span>
        {count > 0 && !open && (
          <span className="unsorted__thumbs" aria-hidden="true">
            {items.slice(-3).map((el) => (
              <UnsortedThumb key={el.id} element={el} />
            ))}
          </span>
        )}
        <span className={count > 0 ? 'unsorted__badge' : 'unsorted__count'}>{count}</span>
        {open && <Icon name="chevronDown" size={14} />}
        {pulse > 0 && <span key={pulse} className="unsorted__ring" aria-hidden="true" />}
      </button>
    </div>
  );
}

export function UploadPanel() {
  const { t } = useTranslation();
  const all = useUploads();
  // Refused for lack of space: told once for the batch by StorageNotice, not as rows here.
  const uploads = all.filter((u) => u.state !== 'full');
  return (
    <>
      <StorageNotice />
      {uploads.length > 0 && (
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
                  <button
                    type="button"
                    className="uploads__cancel"
                    onClick={() => retryUpload(u.key)}
                  >
                    {t('board.uploads.retry')}
                  </button>
                )}
                {u.state !== 'done' && u.state !== 'cancelled' && (
                  <button
                    type="button"
                    className="uploads__cancel"
                    onClick={() => cancelUpload(u.key)}
                  >
                    {t('board.uploads.cancel')}
                  </button>
                )}
              </div>
              {u.state === 'uploading' && !u.reconnecting && u.remainingSeconds !== null && (
                <span className="ink-muted">
                  {t('board.uploads.transfer', {
                    speed: (u.bytesPerSecond / 1024 / 1024).toFixed(1),
                    seconds: u.remainingSeconds,
                  })}
                </span>
              )}
              <div className="uploads__bar">
                <span style={{ width: `${(u.sent / (u.size || 1)) * 100}%` }} />
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

export function CommandPalette({
  readOnly,
  onClose,
  onAdd,
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
  onZoom: (to: 'in' | 'out' | 'reset' | 'fit' | 'selection') => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleUnsorted: () => void;
}) {
  const { t } = useTranslation();
  const { offers } = useModules();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const m = mod();
  const commands: PaletteAction[] = [
    ...(readOnly
      ? []
      : addActions(
          TOOLS.filter((tl) => offers('tools', tl.type)),
          (type) => t('board.palette.add', { type: t(`board.types.${type}`) }),
          onAdd,
        )),
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
/** A toast that offers Show or Undo stays longer: there is time to read it and then act. */
export const TOAST_ACTION_MS = 12_000;

export function Toast({
  text,
  ok,
  warning,
  error,
  onShow,
  showLabel,
  onUndo,
  history,
  onClose,
}: {
  text: string;
  /** A check before the text: something was done. */
  ok?: boolean | undefined;
  /** A warning sign before the text, orange or red: something needs a look. */
  warning?: 'warn' | 'danger' | undefined;
  /** The words of the `onShow` button, "Mostra" by default. */
  showLabel?: string | undefined;
  /** Something failed: the toast offers to report it, when reporting is on. */
  error?: boolean | undefined;
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
  const time = onShow || onUndo ? TOAST_ACTION_MS : TOAST_MS;
  const left = useRef(time);
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
  const feedback = useFeedbackStatus();
  const canReport = !!error && !!feedback?.enabled;
  const actions = !!onShow || !!onUndo || canReport;
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
      {warning && (
        <span className={`toast__warning toast__warning--${warning}`} aria-hidden="true">
          <Icon name="warning" size={14} />
        </span>
      )}
      <span className="toast__text">{text}</span>
      {canReport && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            openFeedback({ title: text });
            onClose();
          }}
        >
          {t('feedback.report')}
        </button>
      )}
      {onShow && (
        <button type="button" className="toast__action" onClick={onShow}>
          {showLabel ?? t('board.show')}
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
            style={{ animationDuration: `${time}ms` }}
          />
        </>
      )}
    </div>
  );
}
