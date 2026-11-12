// SPDX-License-Identifier: AGPL-3.0-only
import {
  addVariant,
  frameLabels,
  lensMillimetres,
  type PlanElement,
  storyboardOf,
  variantFamily,
} from '@inkadra/canvas-core';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsPhone } from '../../lib/phone.ts';
import { useBoardAspect } from '../film/aspect.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { PlanEditor } from './PlanEditor.tsx';
import { PlanViewer } from './PlanViewer.tsx';
import { useOtherKits } from './project-kit.ts';
import { usePlanNav, useTakeParam } from './scenes.tsx';

const isPlan = (e: { type: string }): e is PlanElement => e.type === 'plan';

/**
 * A scene's set plan opened on its own, from the storyboard or the schedule: the same editor as
 * on the canvas, without the canvas around it, since a storyboard has none (decision 0121).
 * Readers get the viewer. `?plan=<id>` opens it, as on the canvas.
 */
export function ScenePlan({
  store,
  projectId,
  boardId,
  userId,
  readOnly,
  ready,
}: {
  store: BoardStore;
  projectId: string;
  boardId: string;
  userId: string;
  readOnly: boolean;
  ready: boolean;
}) {
  const { t } = useTranslation();
  const [param, takeParam] = useTakeParam('plan');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (!param || !ready) return;
    takeParam();
    setOpenId(param);
  }, [param, ready, takeParam]);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const phone = useIsPhone();
  const { openScene } = usePlanNav();
  const boardAspect = useBoardAspect(store.doc);
  const found = openId ? snap.byId.get(openId) : undefined;
  const plan = found && isPlan(found) ? found : null;
  const all = useMemo(() => [...snap.byId.values()], [snap]);
  const groups = useMemo(() => storyboardOf(all), [all]);
  const labels = useMemo(() => frameLabels(groups), [groups]);
  const scenes = useMemo(() => groups.flatMap((g) => (g.scene ? [g.scene] : [])), [groups]);
  const plans = useMemo(() => all.filter(isPlan), [all]);
  const otherKits = useOtherKits(projectId, boardId, readOnly || !plan);
  // The lenses of the frames of its scenes, proposed for its cameras, as on the canvas.
  const lenses = useMemo(() => {
    const sceneIds = new Set(plan?.sceneIds ?? []);
    return all.flatMap((e) => {
      if (e.type !== 'frame' || !e.parent || !sceneIds.has(e.parent)) return [];
      const mm = lensMillimetres(e.lens);
      return mm ? [{ label: labels.get(e.id) ?? '', mm }] : [];
    });
  }, [plan, all, labels]);
  if (!plan) return null;
  const baseEl = plan.variantOf ? snap.byId.get(plan.variantOf) : undefined;
  const base = baseEl && isPlan(baseEl) ? baseEl : undefined;
  const family = variantFamily(snap.byId.values(), plan);
  const close = () => setOpenId(null);
  if (readOnly)
    return (
      <PlanViewer
        plan={plan}
        base={base}
        family={family}
        phone={phone}
        store={store}
        onSwitch={setOpenId}
        onClose={close}
      />
    );
  return (
    <PlanEditor
      key={plan.id}
      store={store}
      plan={plan}
      phone={phone}
      scenes={scenes}
      lenses={lenses}
      cards={snap.byId}
      labels={labels}
      kitPlans={plans}
      otherKits={otherKits}
      base={base}
      family={family}
      onSwitch={setOpenId}
      onNewVariant={() => {
        store.undo.stopCapturing();
        const id = addVariant(
          store.doc,
          plan,
          t('board.plan.variantName', { n: family.length + 1 }),
          { userId, origin: LOCAL },
        );
        store.undo.stopCapturing();
        setOpenId(id);
      }}
      onOpenScene={(id) => {
        close();
        openScene(id);
      }}
      projectId={projectId}
      boardId={boardId}
      boardAspect={boardAspect}
      onClose={close}
    />
  );
}
