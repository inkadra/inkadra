// SPDX-License-Identifier: AGPL-3.0-only
import { type PlanElement, type SceneElement, updateElement } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import { Button, Checkbox, Icon } from '@inkadra/ui';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { ContextMenu } from '../chrome.tsx';
import { sceneLabel } from '../film/NeededItems.tsx';
import { type BoardStore, LOCAL } from '../store.ts';

/** Plans of a board that serve a scene, oldest first. */
export function plansOfScene(elements: Iterable<Element>, sceneId: string): PlanElement[] {
  return [...elements]
    .filter((e): e is PlanElement => e.type === 'plan' && !!e.sceneIds?.includes(sceneId))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The scenes a plan serves that still exist, in its order. */
export function scenesOfPlan(
  plan: Pick<PlanElement, 'sceneIds'>,
  byId: ReadonlyMap<string, Element>,
): SceneElement[] {
  return (plan.sceneIds ?? [])
    .map((id) => byId.get(id))
    .filter((e): e is SceneElement => e?.type === 'scene');
}

/**
 * Links between plans and scenes travel in the address: `?view=canvas&plan=<id>` opens a plan
 * in its editor, `?view=storyboard&scene=<id>` shows a scene in the storyboard.
 */
export function usePlanNav() {
  const [, setParams] = useSearchParams();
  const go = useCallback(
    (view: string, key: string, id: string) =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.set('view', view);
        next.set(key, id);
        return next;
      }),
    [setParams],
  );
  return {
    openPlan: useCallback((id: string) => go('canvas', 'plan', id), [go]),
    openScene: useCallback((id: string) => go('storyboard', 'scene', id), [go]),
  };
}

/** Takes `key` out of the address once handled, as a search result's `el` is. */
export function useTakeParam(key: string): [string | null, () => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key);
  const take = useCallback(
    () =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.delete(key);
          return next;
        },
        { replace: true },
      ),
    [key, setParams],
  );
  return [value, take];
}

/** "Sc. 5 · Sc. 7": the scenes of a plan, each a link to the scene in the storyboard. */
export function SceneBadges({
  scenes,
  onOpen,
}: {
  scenes: readonly SceneElement[];
  onOpen?: ((id: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  if (scenes.length === 0) return null;
  return (
    <span className="plan__badges">
      {scenes.map((s) =>
        onOpen ? (
          <button
            key={s.id}
            type="button"
            className="plan__badge"
            data-no-drag=""
            title={sceneLabel(s, t)}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(s.id);
            }}
          >
            {t('needed.sceneNumber', { number: s.number || '—' })}
          </button>
        ) : (
          <span key={s.id} className="plan__badge">
            {t('needed.sceneNumber', { number: s.number || '—' })}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * "Collega a una scena": the scenes of the board with a box each, a search on top. A plan may
 * serve several scenes of the same set (decision 0062).
 */
export function ScenePicker({
  store,
  plan,
  scenes,
  style,
  onClose,
}: {
  store: BoardStore;
  plan: PlanElement;
  scenes: readonly SceneElement[];
  style?: CSSProperties;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const linked = new Set(plan.sceneIds ?? []);
  const q = query.trim().toLocaleLowerCase();
  const shown = q ? scenes.filter((s) => sceneLabel(s, t).toLocaleLowerCase().includes(q)) : scenes;
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc, true);
    };
  }, [onClose]);
  const toggle = (id: string) => {
    const next = linked.has(id)
      ? (plan.sceneIds ?? []).filter((s) => s !== id)
      : [...(plan.sceneIds ?? []), id];
    store.undo.stopCapturing();
    updateElement(store.doc, plan.id, { sceneIds: next.length ? next : undefined }, LOCAL);
    store.undo.stopCapturing();
  };
  return (
    <div
      ref={box}
      className="plan-scenes ink-motion-pop"
      role="dialog"
      aria-label={t('board.plan.linkScene')}
      style={style}
      data-chrome=""
    >
      <div className="plan-scenes__title">{t('board.plan.linkScene')}</div>
      <label className="plan-lib__search">
        <Icon name="search" size={13} />
        <input
          type="search"
          aria-label={t('board.plan.searchScene')}
          placeholder={t('board.plan.searchScene')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <ul className="plan-scenes__list">
        {shown.map((s) => (
          <li key={s.id}>
            <label className="plan-scenes__item">
              <Checkbox checked={linked.has(s.id)} onChange={() => toggle(s.id)} />
              <span>{sceneLabel(s, t)}</span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="plan-lib__hint">{t('board.plan.noScenes')}</li>}
      </ul>
    </div>
  );
}

/**
 * "Pianta del set" on a scene: opens its plan, or a menu when the scene has several. Nothing
 * when it has none.
 */
export function ScenePlanButton({
  plans,
  compact,
}: {
  plans: readonly PlanElement[];
  /** The short chip of the schedule. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { openPlan } = usePlanNav();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  if (plans.length === 0) return null;
  const name = (p: PlanElement) =>
    p.title ? `${t('board.plan.name')} · ${p.title}` : t('board.plan.name');
  return (
    <>
      <Button
        {...(compact ? {} : { icon: 'map' as const })}
        className={compact ? 'plan-chip' : undefined}
        onClick={(e) => {
          const [only] = plans;
          if (plans.length === 1 && only) openPlan(only.id);
          else {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 4 });
          }
        }}
      >
        {compact && <Icon name="map" size={12} />}
        {compact ? t('board.plan.short') : t('board.plan.name')}
      </Button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={plans.map((p) => ({ label: name(p), action: () => openPlan(p.id) }))}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
