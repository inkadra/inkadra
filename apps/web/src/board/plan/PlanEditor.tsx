// SPDX-License-Identifier: AGPL-3.0-only
import {
  iconCone,
  itemsInRect,
  layerOf,
  linkedPlan,
  mergeProjectKits,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type Point,
  planItem,
  planItems,
  planPower,
  projectKit,
  toggleGroup,
} from '@inkadra/canvas-core';
import type { PlanIconKind } from '@inkadra/doc-schema';
import { Button, Icon, IconButton } from '@inkadra/ui';
import type { TFunction } from 'i18next';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '../chrome.tsx';
import { canSpacePan, isMac } from '../shortcuts.ts';
import { isIcon, type PlanEditorProps, QUARTER_TURN, usePlanEditing } from './editing.ts';
import { kitList } from './kit.ts';
import { isNoteTool, type LibraryItem } from './library.ts';
import { BackgroundPanel, useBackgroundPicker } from './PlanBackground.tsx';
import { type CanvasHandle, PlanCanvas, TOOL_KEYS } from './PlanCanvas.tsx';
import { planTitle } from './PlanCard.tsx';
import { PlanElements } from './PlanElements.tsx';
import { PlanExport, visibleArea } from './PlanExport.tsx';
import { copyKit, PlanKit, powerText, setupName } from './PlanKit.tsx';
import { type Dragged, PlanLibrary } from './PlanLibrary.tsx';
import { SceneChips, useSunDayRepair } from './PlanLinks.tsx';
import { PlanProperties } from './PlanProperties.tsx';
import { PlanStart } from './PlanStart.tsx';
import { ScenePicker } from './scenes.tsx';
import { type SetupChange, setupChanges } from './setups.ts';
import './plan.css';

/** Px an arrow key moves the view when nothing is picked; four times that with Shift. */
const PAN_KEY_STEP = 40;

const NOTE_TOOL = { arrow: 'arrow', text: 'text', measure: 'measure', zone: 'zone' } as const;

/** The number of the first scene a plan serves, for "All 3 of scene 2". */
function scenesOf(cards: PlanEditorProps['cards'], ids: readonly string[] | undefined) {
  for (const id of ids ?? []) {
    const scene = cards?.get(id);
    if (scene?.type === 'scene') return scene.number || null;
  }
  return null;
}

/** "B cam moved 0.6 m, now 85 mm · Neg added": what a setup changed from its base. */
function changeText(c: SetupChange, scale: number | undefined, t: TFunction, lang: string): string {
  const name = c.icon.label || t(`board.plan.icons.${c.icon.kind}`);
  if (c.kind === 'moved') {
    const by = scale ? (c.by / scale).toLocaleString(lang, { maximumFractionDigits: 1 }) : null;
    const moved = by
      ? t('board.plan.change.movedBy', { name, metres: by })
      : t('board.plan.change.moved', { name });
    return c.lens ? `${moved}, ${t('board.plan.change.nowLens', { mm: c.lens })}` : moved;
  }
  if (c.kind === 'lens') return t('board.plan.change.lens', { name, mm: c.lens });
  return t(`board.plan.change.${c.kind}`, { name });
}

/**
 * The editor of a set plan (decision 0104, after 0062 and 0071): the whole screen, with the top
 * bar (back, title, scenes, setup tabs, scale, export, Done), the library docked on the left,
 * the drawing in the middle with its tools, zoom and scale bar, and the right panel with
 * Properties, Elements and Kit. Nothing floats over the drawing for the selection. On a phone the
 * plan is on top, the selection in a sheet under it, the tools at the bottom with their names,
 * the library, Elements and Kit as sheets. Every finished gesture or edit is one change of the
 * document, so it syncs as you go and undo goes back one step at a time.
 */
export function PlanEditor(props: PlanEditorProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const ed = usePlanEditing(props);
  // The sun's date follows the shooting day it links, for everyone who reads the plan (0119).
  useSunDayRepair(ed);
  const { plan, base, phone, drawn } = ed;
  const canvas = useRef<CanvasHandle>(null);
  const [picking, setPicking] = useState<{ x: number; y: number } | null>(null);
  const [scaleOpen, setScaleOpen] = useState<CSSProperties | null>(null);
  const [setupMenu, setSetupMenu] = useState<CSSProperties | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [fullProps, setFullProps] = useState(false);
  const [toolSlot, setToolSlot] = useState<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState<CSSProperties | null>(null);
  const backgroundButton = useRef<HTMLButtonElement>(null);
  const picker = useBackgroundPicker(ed);
  const empty = planItems(drawn).length === 0 && !(drawn.walls?.length ?? 0) && !drawn.background;
  /** The start dialog: open on a plan with nothing on it, until a way to start is picked. */
  const [starting, setStarting] = useState(empty);
  // Something on the plan (drawn here, by undo or by someone else) closes it.
  useEffect(() => {
    if (!empty) setStarting(false);
  }, [empty]);
  // So does picking a tool or a type to place: that is starting too.
  useEffect(() => {
    if (ed.tool !== 'select' || ed.armed) setStarting(false);
  }, [ed.tool, ed.armed]);
  const [exporting, setExporting] = useState<{ area: ReturnType<typeof visibleArea> } | null>(null);
  const scaleButton = useRef<HTMLButtonElement>(null);
  const family = props.family?.length ? props.family : [plan];
  const title = planTitle(t, drawn);
  // The base's title on every setup, never a setup's stale copy of it (decision 0117).
  const titleShown = drawn.title ?? '';
  const { kitPlans, otherKits } = props;
  // This board's plans live, the other boards' from the server (decision 0114).
  const kit = useMemo(
    () => mergeProjectKits(projectKit(kitPlans ?? [plan]), otherKits?.entries ?? []),
    [kitPlans, plan, otherKits],
  );
  const sensorName = t(`board.plan.sensors.${plan.sensor ?? 's35'}`);
  // Read with the live names of what the icons link to (decision 0111).
  // Once per change of the two setups, not on every render (a drag renders at every move).
  const changes = useMemo(
    () =>
      base
        ? setupChanges(
            linkedPlan(base, ed.cards).icons ?? [],
            linkedPlan(plan, ed.cards).icons ?? [],
          )
        : [],
    [base, plan, ed.cards],
  );
  const scaleValue = drawn.scale
    ? t('board.plan.scaleGrid', { grid: Number(drawn.grid ?? '0.5').toLocaleString(lang) })
    : t('board.plan.scale');
  const kitLines = kitList(drawn, t, lang);
  const kitCount = kitLines.reduce((n, l) => n + l.count, 0);
  const power = planPower(drawn);

  // Placing ---------------------------------------------------------------------------
  const arm = (next: LibraryItem) => {
    ed.setArmed(next);
    ed.setSelection([]);
    if (isNoteTool(next)) ed.setTool(NOTE_TOOL[next]);
    else ed.setTool('icons');
  };
  /** The base an icon would attach to at `p` (0 to 1), unless Alt or Snap off (decision 0104). */
  const baseAt = (kind: PlanIconKind, p: Point, alt = false) =>
    ed.attach && !alt
      ? (ed.snapAt({ kind }, { x: p.x * PLAN_VIEW_W, y: p.y * PLAN_VIEW_H })?.id ?? null)
      : null;
  const place = (what: Dragged, at: { clientX: number; clientY: number } | null, alt = false) => {
    ed.setDropTarget(null);
    const p = at ? canvas.current?.pointOf(at) : ed.middle.current();
    if (!p) return;
    if ('item' in what) {
      if (isNoteTool(what.item)) {
        arm(what.item);
        return;
      }
      ed.placeIcon(what.item, p, { on: at ? baseAt(what.item, p, alt) : null });
    } else {
      const { kind, ...fields } = what.kit.icon;
      const lens = what.kit.lenses[0];
      // The light with its modifiers on its front: one drop, one undo step, the light selected.
      ed.placeIcon(kind, p, {
        fields: { ...fields, ...(lens ? { lens } : {}) },
        modifiers: what.kit.modifiers,
        on: at ? baseAt(kind, p, alt) : null,
      });
    }
    if (phone) ed.setSheet(null);
  };

  // Keys ------------------------------------------------------------------------------
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('.menu, [role="listbox"], .plan-scenes, dialog')) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
    // Whatever the editor does not use never reaches the board behind it.
    e.stopImmediatePropagation();
    // Space held pans the drawing, as on the board (decision 0118).
    if (e.key === ' ' && canSpacePan(e.target)) {
      e.preventDefault();
      if (!e.repeat) canvas.current?.space(e.type === 'keydown');
      return;
    }
    if (e.type !== 'keydown') return;
    // The setup tabs: arrows move between setups, F2 renames the current one. Here, since this
    // listener stops every key before the tabs' own handlers would see it.
    const tab = target?.closest<HTMLElement>('.plan-setups [role="tab"]');
    if (tab && (e.key === 'F2' || e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      if (e.key === 'F2') setRenaming(true);
      else {
        const at = family.findIndex((f) => f.id === plan.id) + (e.key === 'ArrowRight' ? 1 : -1);
        const next = family[(at + family.length) % family.length];
        if (next && next.id !== plan.id) {
          props.onSwitch?.(next.id);
          // The editor of the next setup mounts anew: its selected tab takes the focus.
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLElement>('.plan-setups [role="tab"][aria-selected="true"]')
              ?.focus(),
          );
        }
      }
      return;
    }
    const mod = isMac() ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    const { selection, item } = ed;
    if (canvas.current?.key(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      if (canvas.current?.escape()) return;
      if (starting) setStarting(false);
      else if (backgroundOpen) setBackgroundOpen(null);
      else if (scaleOpen) setScaleOpen(null);
      else if (ed.moving) ed.endRoute();
      else if (ed.armed) ed.disarm();
      else if (selection.length) ed.setSelection([]);
      else if (ed.wallSel || ed.lockedWall) ed.selectWall(null);
      else if (ed.tool !== 'select') ed.setTool('select');
      else if (ed.sheet) ed.setSheet(null);
      else props.onClose();
    } else if (
      e.key === 'Enter' &&
      item &&
      'x0' in item &&
      item.kind === 'text' &&
      target?.tagName !== 'BUTTON'
    ) {
      ed.setTab('properties');
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>('[data-plan-field="text"]')?.focus(),
      );
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && (selection.length || ed.wallSel))
      ed.remove();
    else if (mod && key === 'a')
      ed.setSelection(
        itemsInRect(drawn, { x: -1e5, y: -1e5, w: 2e5, h: 2e5 }, ed.viewOf).filter((r) => {
          const found = planItem(drawn, r);
          return !!found && (!ed.activeLayer || layerOf(found) === ed.activeLayer);
        }),
      );
    else if (mod && key === 'g' && selection.length > 1) ed.write(toggleGroup(ed.many));
    else if (e.key.startsWith('Arrow') && target?.closest('[data-reach]') && isIcon(item)) {
      const reach = iconCone(item, plan.sensor)?.reach ?? 0;
      const more = drawn.scale ? drawn.scale / 10 : ed.step;
      const by = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? more : -more;
      ed.write({
        ...item,
        reach: Math.round(Math.min(4000, Math.max(20, reach + by)) * 100) / 100,
      });
    } else if (e.key.startsWith('Arrow') && selection.length) {
      const k = e.shiftKey ? ed.step * 4 : ed.step;
      ed.nudge({
        x: e.key === 'ArrowLeft' ? -k : e.key === 'ArrowRight' ? k : 0,
        y: e.key === 'ArrowUp' ? -k : e.key === 'ArrowDown' ? k : 0,
      });
    } else if (e.key.startsWith('Arrow') && !ed.wallSel) {
      // Nothing picked: the arrows move the view, as in the read-only view (decision 0118).
      const d = e.shiftKey ? PAN_KEY_STEP * 4 : PAN_KEY_STEP;
      canvas.current?.panBy(
        e.key === 'ArrowLeft' ? d : e.key === 'ArrowRight' ? -d : 0,
        e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0,
      );
    } else if (mod && key === 'z') e.shiftKey ? ed.store.undo.redo() : ed.store.undo.undo();
    else if (mod && key === 'y') ed.store.undo.redo();
    else if (mod && key === 'd' && selection.length) ed.duplicate();
    // Zoom by keys as on the board: + and −, with or without Ctrl/⌘; Shift+1 or 0 fits.
    else if (key === '=' || key === '+') canvas.current?.zoomBy(1);
    else if (key === '-') canvas.current?.zoomBy(-1);
    else if ((e.shiftKey && e.code === 'Digit1') || (!mod && key === '0')) canvas.current?.fit();
    else if (!mod && key === 'r' && selection.length)
      ed.rotate(e.shiftKey ? -QUARTER_TURN : QUARTER_TURN);
    else if (!mod && e.key === ']' && selection.length) ed.restack(1);
    else if (!mod && e.key === '[' && selection.length) ed.restack(-1);
    else if (!mod && key === '/') {
      if (phone) ed.setSheet('library');
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>('.plan-lib__search input')?.focus(),
      );
    } else if (!mod && key === 'g') ed.setSnap((v) => !v);
    else if (!mod && key === 'm' && isIcon(item)) ed.startRoute(item);
    else if (!mod && TOOL_KEYS.some((x) => x.key.toLowerCase() === key)) {
      ed.setArmed(null);
      ed.setTool(TOOL_KEYS.find((x) => x.key.toLowerCase() === key)?.tool ?? 'select');
    } else return;
    e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on, true);
    window.addEventListener('keyup', on, true);
    return () => {
      window.removeEventListener('keydown', on, true);
      window.removeEventListener('keyup', on, true);
    };
  }, []);
  // A modal: the app behind is inert, the editor takes the focus and gives it back on close.
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const app = document.getElementById('root');
    const wasInert = app?.inert ?? false;
    if (app) app.inert = true;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      if (app) app.inert = wasInert;
      before?.focus?.({ preventScroll: true });
    };
  }, []);
  // A new selection shows its properties.
  const selectedId = ed.selection[0]?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows what is selected.
  useEffect(() => {
    if (selectedId && ed.tab !== 'elements') ed.setTab('properties');
    setFullProps(false);
  }, [selectedId]);

  // Parts -----------------------------------------------------------------------------
  const scenePicker = picking && (
    <ScenePicker
      store={props.store}
      plan={plan}
      scenes={props.scenes}
      style={{ position: 'fixed', left: picking.x, top: picking.y }}
      onClose={() => setPicking(null)}
    />
  );
  /** The name of the setup being renamed, on its tab (or the phone's header): Enter keeps it. */
  /** The tabs by setup, and the phone's setup button: focus comes back to them after a rename. */
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const setupButton = useRef<HTMLButtonElement>(null);
  const backToTab = () =>
    requestAnimationFrame(() =>
      (phone ? setupButton.current : tabRefs.current.get(plan.id))?.focus(),
    );
  const renameField = (
    <input
      className="plan-field"
      aria-label={t('board.plan.setupName')}
      maxLength={60}
      defaultValue={plan.variant ?? ''}
      placeholder={t(base ? 'board.plan.variant' : 'board.plan.base')}
      // biome-ignore lint/a11y/noAutofocus: Rename asks to type the name.
      autoFocus
      onBlur={(e) => {
        const variant = e.target.value.trim() || undefined;
        if (variant !== plan.variant) ed.editPlan({ variant });
        setRenaming(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Escape') e.currentTarget.value = plan.variant ?? '';
          e.currentTarget.blur();
          backToTab();
        }
      }}
    />
  );
  // While renaming, the field lies over the tab, outside the tablist: a tablist holds tabs only.
  const renamedTab = renaming ? tabRefs.current.get(plan.id) : undefined;
  const setupTabs = (
    <div className="plan-setups" data-tour="plan-setups">
      <div className="plan-setups__list" role="tablist" aria-label={t('board.plan.setups')}>
        {family.map((p) => (
          <button
            key={p.id}
            ref={(el) => {
              if (el) tabRefs.current.set(p.id, el);
              else tabRefs.current.delete(p.id);
            }}
            type="button"
            role="tab"
            className="plan-setups__tab"
            aria-selected={p.id === plan.id}
            tabIndex={p.id === plan.id ? 0 : -1}
            title={p.id === plan.id ? t('board.plan.renameHint') : undefined}
            onClick={() => p.id !== plan.id && props.onSwitch?.(p.id)}
            // Every setup is renamed on its tab, the base too (decision 0117).
            onDoubleClick={() => p.id === plan.id && setRenaming(true)}
            onContextMenu={(e) => {
              if (p.id !== plan.id) return;
              e.preventDefault();
              setRenaming(true);
            }}
          >
            {setupName(p, family, t)}
          </button>
        ))}
      </div>
      {renaming && (
        <span
          className="plan-setups__rename"
          style={
            renamedTab
              ? { left: renamedTab.offsetLeft, width: Math.max(140, renamedTab.offsetWidth) }
              : undefined
          }
        >
          {renameField}
        </span>
      )}
      {props.onNewVariant && (
        <IconButton icon="plus" label={t('board.plan.newSetup')} onClick={props.onNewVariant} />
      )}
    </div>
  );
  const baseName = base ? setupName(base, family, t) : '';
  // The bare name of the base, for "Show Master as a ghost".
  const baseBare = base ? base.variant || t('board.plan.base') : '';
  /** What this setup changed from its base: a strip under the setup tabs, never on the plan. */
  const setupNote = base && (
    <section
      className="plan-setup-note"
      aria-label={t('board.plan.changedFrom', { name: baseName })}
    >
      <span className="plan-props__cap">{t('board.plan.onAnotherSetup')}</span>
      <b>
        {t('board.plan.changedFromTitle', { name: setupName(plan, family, t), base: baseName })}
      </b>
      <span className="plan-setup-note__text">
        {changes.length
          ? changes.map((c) => changeText(c, drawn.scale, t, lang)).join(' · ')
          : t('board.plan.sameAsBase')}
      </span>
      <button
        type="button"
        className="plan-setup-note__ghost"
        aria-pressed={ed.ghostBase}
        onClick={() => ed.setGhostBase((v) => !v)}
      >
        {t(ed.ghostBase ? 'board.plan.hideGhost' : 'board.plan.showGhost', { name: baseBare })}
      </button>
    </section>
  );
  // The start dialog again, from the plan's menu, while the plan is still empty (decision 0110).
  const startItem = empty
    ? [
        {
          label: t('board.plan.start.again'),
          icon: 'plus' as const,
          action: () => setStarting(true),
        },
      ]
    : [];
  const openBackground = (r: DOMRect) => {
    if (!drawn.background && !backgroundOpen && picker.can && picker.state === 'idle') {
      picker.pick();
      return;
    }
    setBackgroundOpen(
      backgroundOpen
        ? null
        : phone
          ? { position: 'fixed', left: 8, right: 8, bottom: 8, width: 'auto' }
          : {
              position: 'fixed',
              right: Math.max(8, window.innerWidth - r.right),
              top: r.bottom + 6,
            },
    );
  };
  const backgroundPop = backgroundOpen && (
    <BackgroundPanel
      ed={ed}
      picker={picker}
      style={backgroundOpen}
      onClose={() => setBackgroundOpen(null)}
    />
  );
  const startDialog = starting && empty && (
    <PlanStart ed={ed} picker={picker} onClose={() => setStarting(false)} />
  );
  /** In the plan's menu whenever an item has earlier positions, as before decision 0104. */
  const ghostsItem = (drawn.icons ?? []).some((i) => i.steps?.length)
    ? [{ label: t('board.plan.ghosts'), checked: ed.ghosts, action: () => ed.setGhosts((v) => !v) }]
    : [];
  const scalePop = scaleOpen && (
    <ContextMenu
      className="plan-menu"
      label={t('board.plan.scale')}
      style={scaleOpen}
      anchor={scaleButton}
      items={[
        { heading: drawn.scale ? scaleValue : t('board.plan.noScale') },
        {
          label: t('board.plan.setScale'),
          icon: 'ruler',
          action: () => {
            ed.setArmed(null);
            ed.setTool('scale');
          },
        },
        ...(drawn.scale
          ? [
              {
                label: t('board.plan.rulers'),
                checked: !!drawn.rulers,
                action: () =>
                  ed.editPlan({ rulers: drawn.rulers ? undefined : true }, ed.scaleOwner),
              },
              // The rooms' sizes, shown unless the plan turns them off (decision 0119).
              {
                label: t('board.plan.roomSizes'),
                checked: drawn.roomSizes !== false,
                action: () =>
                  ed.editPlan(
                    { roomSizes: drawn.roomSizes === false ? undefined : false },
                    ed.scaleOwner,
                  ),
              },
              {
                label: t('board.plan.clearScale'),
                action: () =>
                  ed.editPlan(
                    { scale: undefined, grid: undefined, rulers: undefined },
                    ed.scaleOwner,
                  ),
              },
            ]
          : []),
        { divider: true },
        {
          label: t('board.plan.snap'),
          shortcut: 'G',
          checked: ed.snap,
          action: () => ed.setSnap((v) => !v),
        },
        ...ghostsItem,
        {
          label: t('board.plan.snapIcons'),
          shortcut: 'Alt',
          checked: ed.attach,
          action: () => ed.setAttach((v) => !v),
        },
        {
          label: t('board.plan.inPresentation'),
          checked: plan.presentation !== false,
          action: () =>
            ed.editPlan({ presentation: plan.presentation !== false ? false : undefined }),
        },
        ...startItem,
      ]}
      onClose={() => setScaleOpen(null)}
    />
  );
  const callSheet = (r: DOMRect) =>
    setPicking({ x: Math.max(8, r.left - 120), y: Math.max(8, r.top - 320) });
  const kitCard = (
    <button type="button" className="plan-side__kitcard" onClick={() => ed.setTab('kit')}>
      <span className="plan-props__row">
        <b>{t('board.plan.kitForSetup')}</b>
        <span className="plan-prop__label">{t('board.plan.items', { count: kitCount })}</span>
      </span>
      <span className="plan-props__row">
        <span className="plan-prop__label">
          {t('board.plan.powerSummary', {
            power: powerText(power.watts, power.amps, lang),
            volts: power.voltage,
          })}
        </span>
        <span className="plan-side__open">{t('board.plan.open')}</span>
      </span>
    </button>
  );
  const panel = (
    <aside className="plan-side" aria-label={t('board.plan.sidePanel')}>
      <div className="plan-side__tabs" role="tablist" aria-label={t('board.plan.sidePanel')}>
        {(['properties', 'elements', 'kit'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`plan-tab-${tab}`}
            aria-selected={ed.tab === tab}
            aria-controls={`plan-panel-${tab}`}
            tabIndex={ed.tab === tab ? 0 : -1}
            onClick={() => ed.setTab(tab)}
            onKeyDown={(e) => {
              const order = ['properties', 'elements', 'kit'] as const;
              const at = order.indexOf(tab);
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                const next = order[
                  (at + (e.key === 'ArrowRight' ? 1 : 2)) % 3
                ] as (typeof order)[number];
                ed.setTab(next);
                document.getElementById(`plan-tab-${next}`)?.focus();
              }
            }}
          >
            {t(`board.plan.tabs2.${tab}`)}
          </button>
        ))}
      </div>
      <div
        className="plan-side__body"
        role="tabpanel"
        id={`plan-panel-${ed.tab}`}
        aria-labelledby={`plan-tab-${ed.tab}`}
      >
        {ed.tab === 'properties' && (
          <PlanProperties ed={ed} onMeasure={(id) => canvas.current?.openMeasure(id)} />
        )}
        {ed.tab === 'elements' && (
          <PlanElements
            ed={ed}
            onBackground={() => {
              const r = backgroundButton.current?.getBoundingClientRect();
              if (r) openBackground(r);
            }}
          />
        )}
        {ed.tab === 'kit' && <PlanKit ed={ed} onCallSheet={callSheet} />}
      </div>
      {ed.tab === 'properties' && kitCard}
    </aside>
  );
  const library = (
    <PlanLibrary
      armed={ed.armed}
      phone={phone}
      kit={kit}
      kitScope={otherKits?.scope ?? 'local'}
      sensor={sensorName}
      onArm={arm}
      onPlace={place}
      onDrag={(what, at) => {
        const p = what && at ? canvas.current?.pointOf(at) : null;
        const kind = what ? ('item' in what ? what.item : what.kit.icon.kind) : null;
        const alt = !!at && 'altKey' in at && !!(at as { altKey?: boolean }).altKey;
        ed.setDropTarget(p && kind && !isNoteTool(kind) ? baseAt(kind, p, alt) : null);
      }}
      onClose={() => ed.setSheet(null)}
    />
  );

  const openExport = () =>
    setExporting({ area: visibleArea(dialogRef.current ?? document, PLAN_VIEW_W, PLAN_VIEW_H) });
  const exportDialog = exporting && (
    <PlanExport
      store={props.store}
      plan={plan}
      family={family}
      scene={scenesOf(props.cards, plan.sceneIds ?? base?.sceneIds)}
      area={exporting.area}
      onCallSheet={callSheet}
      onClose={() => setExporting(null)}
    />
  );

  if (phone) {
    const sheetTitle =
      ed.sheet === 'elements'
        ? t('board.plan.tabs2.elements')
        : `${t('board.plan.tabs2.kit')} · ${setupName(plan, family, t)}`;
    const selectedSomething = ed.selection.length > 0;
    return createPortal(
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="plan-editor plan-editor--v2 plan-editor--phone"
        data-chrome=""
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="plan-top plan-top--phone">
          <IconButton icon="chevronLeft" label={t('board.plan.back')} onClick={props.onClose} />
          {renaming ? (
            <span className="plan-top__setup">{renameField}</span>
          ) : (
            <button
              ref={setupButton}
              type="button"
              className="plan-top__setup"
              aria-haspopup="menu"
              data-tour="plan-setups"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setSetupMenu(
                  setupMenu ? null : { position: 'fixed', left: r.left, top: r.bottom + 6 },
                );
              }}
            >
              {setupName(plan, family, t)}
              <Icon name="chevronDown" size={14} />
            </button>
          )}
          <span className="plan-top__spacer" />
          <IconButton
            icon="magnet"
            label={t('board.plan.snapIcons')}
            aria-pressed={ed.attach}
            onClick={() => ed.setAttach((v) => !v)}
          />
          {/* The background is reached from Elements on a phone: the tour points here. */}
          <IconButton
            icon="layers"
            label={t('board.plan.tabs2.elements')}
            data-tour="plan-background"
            onClick={() => ed.setSheet('elements')}
          />
          <Button variant="primary" onClick={props.onClose}>
            {t('film.pen.done')}
          </Button>
        </header>
        <div className="plan-main plan-main--phone">
          <PlanCanvas ed={ed} handle={canvas} toolSlot={toolSlot} />
          <button
            type="button"
            className="plan-float plan-top__kitpill"
            aria-label={t('board.plan.kitPillLabel', {
              items: kitCount,
              power: powerText(power.watts, power.amps, lang),
            })}
            onClick={() => ed.setSheet('kit')}
          >
            <i />
            {t('board.plan.items', { count: kitCount })} ·{' '}
            {powerText(power.watts, power.amps, lang).split(' · ')[0]}
          </button>
          {base && !selectedSomething && !ed.sheet && setupNote}
          {!ed.sheet && startDialog}
        </div>
        {/* While a path is drawn the plan takes the room: the sheet comes back after Done. */}
        {selectedSomething && !ed.sheet && !ed.moving && (
          <section
            className={`plan-sheet plan-sheet--selection${fullProps ? ' is-tall' : ''}`}
            aria-label={t('board.plan.selection')}
          >
            <span className="plan-sheet__grab" aria-hidden="true" />
            <PlanProperties
              ed={ed}
              compact={!fullProps}
              onMore={() => setFullProps(true)}
              onMeasure={(id) => canvas.current?.openMeasure(id)}
            />
          </section>
        )}
        {/* The bar of tools, at the very bottom under the sheet (audit P2). */}
        <div ref={setToolSlot} className="plan-phone-tools" />
        {ed.sheet === 'library' && library}
        {picker.field}
        {backgroundPop}
        {(ed.sheet === 'elements' || ed.sheet === 'kit') && (
          <section className="plan-sheet plan-sheet--full" aria-label={sheetTitle}>
            <header className="plan-top plan-top--phone">
              <IconButton
                icon="chevronLeft"
                label={t('board.plan.backToPlan')}
                onClick={() => ed.setSheet(null)}
              />
              <b className="plan-top__title">{sheetTitle}</b>
              <span className="plan-top__spacer" />
              {ed.sheet === 'kit' && (
                <IconButton
                  icon={copied ? 'check' : 'copy'}
                  label={t(copied ? 'board.plan.copied' : 'board.plan.copyList')}
                  disabled={!kitLines.length}
                  onClick={async () => {
                    setCopied(await copyKit(kitLines));
                    setTimeout(() => setCopied(false), 2000);
                  }}
                />
              )}
            </header>
            <div className="plan-sheet__body">
              {ed.sheet === 'elements' ? (
                <PlanElements
                  ed={ed}
                  onPicked={() => ed.setSheet(null)}
                  onBackground={() => {
                    ed.setSheet(null);
                    openBackground(new DOMRect());
                  }}
                />
              ) : (
                <PlanKit ed={ed} onCallSheet={callSheet} />
              )}
            </div>
          </section>
        )}
        {setupMenu && (
          <ContextMenu
            className="plan-menu"
            label={t('board.plan.setups')}
            style={setupMenu}
            items={[
              ...family.map((p) => ({
                label: setupName(p, family, t),
                checked: p.id === plan.id,
                action: () => p.id !== plan.id && props.onSwitch?.(p.id),
              })),
              ...(props.onNewVariant
                ? [
                    { divider: true as const },
                    {
                      label: t('board.plan.newSetup'),
                      icon: 'plus' as const,
                      action: props.onNewVariant,
                    },
                  ]
                : []),
              { label: t('board.plan.rename'), action: () => setRenaming(true) },
              { divider: true as const },
              {
                label: t('board.plan.background.button'),
                icon: 'image' as const,
                disabled: !picker.can && !drawn.background,
                action: () => openBackground(new DOMRect()),
              },
              ...startItem,
              ...ghostsItem,
              // The phone's way to the export dialog, as the top bar's Export on a desktop.
              { divider: true as const },
              { label: t('board.plan.export'), icon: 'download' as const, action: openExport },
            ]}
            onClose={() => setSetupMenu(null)}
          />
        )}
        {scenePicker}
        {exportDialog && <div className="phone-sheet">{exportDialog}</div>}
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="plan-editor plan-editor--v2"
      data-chrome=""
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <header className="plan-top">
        <div className="plan-top__start">
          <IconButton icon="chevronLeft" label={t('board.plan.back')} onClick={props.onClose} />
          <b className="plan-top__name">{t('board.plan.name')}</b>
          <input
            className="plan-top__title"
            aria-label={t('board.plan.titleField')}
            placeholder={t('board.plan.titlePlaceholder')}
            maxLength={200}
            // The title is the base's: every setup shows it, and writes it there (decision 0117).
            key={ed.scaleOwner}
            defaultValue={titleShown}
            size={Math.max(8, titleShown.length + 1)}
            onBlur={(e) => {
              const next = e.target.value.trim() || undefined;
              if (next !== (base ? base.title : plan.title))
                ed.editPlan({ title: next }, ed.scaleOwner);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
          <SceneChips ed={ed} onOpen={props.onOpenScene} />
          <IconButton
            icon="link"
            label={t('board.plan.linkScene')}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPicking({ x: r.left, y: r.bottom + 6 });
            }}
          />
        </div>
        {setupTabs}
        <div className="plan-top__end">
          <button
            ref={backgroundButton}
            type="button"
            className="plan-top__btn"
            data-tour="plan-background"
            aria-haspopup="dialog"
            aria-expanded={!!backgroundOpen}
            disabled={!picker.can && !drawn.background}
            onClick={(e) => openBackground(e.currentTarget.getBoundingClientRect())}
          >
            <Icon name="image" size={16} />
            {t('board.plan.background.button')}
          </button>
          <button
            ref={scaleButton}
            type="button"
            className="plan-top__btn"
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setScaleOpen(
                scaleOpen
                  ? null
                  : { position: 'fixed', right: window.innerWidth - r.right, top: r.bottom + 6 },
              );
            }}
          >
            <Icon name="ruler" size={16} />
            {scaleValue}
          </button>
          <button
            type="button"
            className="plan-top__btn"
            data-tour="plan-export-button"
            onClick={openExport}
          >
            <Icon name="download" size={16} />
            {t('board.plan.export')}
          </button>
          <Button variant="primary" onClick={props.onClose}>
            {t('film.pen.done')}
          </Button>
        </div>
      </header>
      <div className="plan-main">
        {library}
        <div className="plan-main__column">
          {setupNote}
          <main className="plan-main__canvas">
            <PlanCanvas ed={ed} handle={canvas} />
            {startDialog}
          </main>
        </div>
        {panel}
      </div>
      {picker.field}
      {backgroundPop}
      {scalePop}
      {scenePicker}
      {exportDialog}
    </div>,
    document.body,
  );
}
