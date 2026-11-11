// SPDX-License-Identifier: AGPL-3.0-only
import {
  addPlanCircuit,
  type CircuitLoad,
  type PlanElement,
  planPower,
  removePlanCircuits,
  updatePlanCircuits,
  variantView,
} from '@inkadra/canvas-core';
import { MAX_PLAN_CIRCUITS, type PlanCircuit, type PlanIcon } from '@inkadra/doc-schema';
import { Button, IconButton, Segmented } from '@inkadra/ui';
import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCAL } from '../store.ts';
import type { Ed } from './editing.ts';
import { itemName } from './elements.ts';
import { KIT_GROUPS, kitList } from './kit.ts';
import { NumberField } from './NumberField.tsx';

/** "2.5 kW · 10.8 A": a power and the amperes it draws, in the way of this language. */
export function powerText(watts: number, amps: number, lang: string): string {
  const kw = watts >= 1000;
  const n = (v: number, d: number) => v.toLocaleString(lang, { maximumFractionDigits: d });
  return `${kw ? `${n(watts / 1000, 1)} kW` : `${n(watts, 0)} W`} · ${n(amps, 1)} A`;
}

/** The kit of a setup as it is shown and counted: the setup over its base's Set. */
export function setupKit(
  plan: PlanElement,
  base: PlanElement | undefined,
  t: TFunction,
  lang: string,
) {
  const merged = base ? variantView(plan, base) : plan;
  return kitList(merged, t, lang);
}

/** The name of a setup: "1 · Master", the base first. */
export function setupName(p: PlanElement, family: readonly PlanElement[], t: TFunction): string {
  const n =
    Math.max(
      0,
      family.findIndex((f) => f.id === p.id),
    ) + 1;
  const name = p.variantOf ? p.variant || t('board.plan.variant') : t('board.plan.base');
  return `${n} · ${name}`;
}

/**
 * The Kit tab (decision 0104): the kit of the setup counted from the plan by section, with the
 * modifiers, gels and stands; the power per circuit at the plan's voltage (a circuit turns orange
 * above 80 % of its breaker and red above it), the circuits written here; the list copied as text
 * or put on the call sheet, which prints the kit of the plans of its scenes.
 */
export function PlanKit({ ed, onCallSheet }: { ed: Ed; onCallSheet: (at: DOMRect) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [copied, setCopied] = useState(false);
  const { plan, drawn } = ed;
  const family = ed.family ?? [plan];
  const kit = kitList(drawn, t, lang);
  const items = kit.reduce((n, l) => n + l.count, 0);
  const power = planPower(drawn);
  const familyItems = family.reduce(
    (n, p) =>
      n +
      setupKit(
        p,
        p.variantOf ? family.find((f) => f.id === p.variantOf) : undefined,
        t,
        lang,
      ).reduce((m, l) => m + l.count, 0),
    0,
  );
  const circuits = plan.circuits ?? [];
  // One circuit at a time, field by field: two people editing two circuits both keep theirs.
  const editCircuit = (c: PlanCircuit) =>
    ed.change(() => updatePlanCircuits(ed.doc, plan.id, [c], LOCAL));
  const names = (load: CircuitLoad) =>
    load.lights
      .map((id) => drawn.icons?.find((i) => i.id === id))
      .filter((i): i is PlanIcon => !!i)
      .map((i) => itemName(i, t))
      .join(', ');
  const copy = async () => {
    const text = kit.map((l) => `${l.name} ×${l.count}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const scenes = ed.scenes.filter((s) => plan.sceneIds?.includes(s.id));
  return (
    <div className="plan-kit" data-tour="plan-kit">
      <div className="plan-props__row">
        <b>{setupName(plan, family, t)}</b>
        <span className="plan-prop__label">{t('board.plan.items', { count: items })}</span>
      </div>
      {kit.length === 0 && <p className="plan-props__hint">{t('board.plan.kitEmpty')}</p>}
      {KIT_GROUPS.map((g) => {
        const lines = kit.filter((l) => l.group === g);
        if (!lines.length) return null;
        return (
          <section key={g} className="plan-kit__section">
            <span className="plan-props__cap">{t(`board.plan.kitGroups.${g}`)}</span>
            <ul>
              {lines.map((l) => (
                <li key={l.name} className="plan-props__row">
                  <span>{l.name}</span>
                  <span className="plan-kit__n">
                    {l.watts ? `${l.watts} W · ` : ''}×{l.count}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <div className="plan-props__sep" />
      <section className="plan-kit__section" aria-label={t('board.plan.power')}>
        <div className="plan-props__row">
          <span className="plan-props__cap">
            {t('board.plan.powerAt', { volts: power.voltage })}
          </span>
          <span className="plan-kit__n plan-kit__total">
            {powerText(power.watts, power.amps, lang)}
          </span>
        </div>
        {power.circuits.map((c) => {
          const own = c.id ? circuits.find((x) => x.id === c.id) : undefined;
          return (
            <div key={c.id ?? 'none'} className={`plan-kit__circuit is-${c.status}`}>
              {own ? (
                <div className="plan-kit__circuit-head">
                  <CircuitName
                    value={own.name}
                    label={t('board.plan.circuitName')}
                    onCommit={(name) => editCircuit({ ...own, name })}
                  />
                  <NumberField
                    value={own.amps}
                    min={1}
                    max={1000}
                    unit="A"
                    label={t('board.plan.breaker')}
                    onCommit={(amps) => editCircuit({ ...own, amps })}
                  />
                  <IconButton
                    icon="trash"
                    label={t('board.plan.removeCircuit', { name: own.name })}
                    onClick={() =>
                      ed.change(() => removePlanCircuits(ed.doc, plan.id, [own.id], LOCAL))
                    }
                  />
                </div>
              ) : (
                <b>{t('board.plan.noCircuit')}</b>
              )}
              <div className="plan-props__row">
                <span className="plan-prop__label">
                  {c.status === 'over'
                    ? t('board.plan.circuitOver')
                    : c.status === 'warning'
                      ? t('board.plan.circuitWarning')
                      : ''}
                </span>
                <span className="plan-kit__n">
                  {c.amps.toLocaleString(lang, { maximumFractionDigits: 1 })} A
                </span>
              </div>
              {c.breaker && (
                <span className="plan-kit__bar" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, c.load * 100)}%` }} />
                </span>
              )}
              {c.lights.length > 0 && <span className="plan-prop__label">{names(c)}</span>}
            </div>
          );
        })}
        <Button
          variant="ghost"
          icon="plus"
          disabled={circuits.length >= MAX_PLAN_CIRCUITS}
          onClick={() =>
            ed.change(() =>
              addPlanCircuit(
                ed.doc,
                plan.id,
                {
                  name: t('board.plan.circuitNamed', {
                    letter: String.fromCharCode(65 + (circuits.length % 26)),
                  }),
                  amps: power.voltage === 120 ? 20 : 16,
                },
                LOCAL,
              ),
            )
          }
        >
          {t('board.plan.addCircuit')}
        </Button>
        <div className="plan-props__row">
          <span className="plan-prop__label">{t('board.plan.mains')}</span>
          <Segmented
            label={t('board.plan.mains')}
            value={String(power.voltage) as '120' | '230'}
            options={[
              { value: '120', label: '120 V' },
              { value: '230', label: '230 V' },
            ]}
            onChange={(v) => ed.editPlan({ voltage: v === '120' ? 120 : undefined })}
          />
        </div>
      </section>
      <div className="plan-props__sep" />
      {family.length > 1 && (
        <p className="plan-props__hint">{t('board.plan.allSetups', { count: familyItems })}</p>
      )}
      {scenes.length > 0 && (
        <p className="plan-props__hint">
          {t('board.plan.onCallSheet', { scenes: scenes.map((s) => s.number || '—').join(', ') })}
        </p>
      )}
      <div className="plan-props__actions">
        <Button onClick={copy} disabled={!kit.length}>
          {copied ? t('board.plan.copied') : t('board.plan.copyList')}
        </Button>
        <Button
          variant={ed.phone ? 'primary' : 'secondary'}
          onClick={(e) => onCallSheet(e.currentTarget.getBoundingClientRect())}
        >
          {t('board.plan.addToCallSheet')}
        </Button>
      </div>
    </div>
  );
}

/**
 * A circuit's name, written on Enter or blur, as the setup's name and NumberField are: one undo
 * step per name, and a name someone else gives the circuit meanwhile shows when not typing.
 */
function CircuitName({
  value,
  label,
  onCommit,
}: {
  value: string;
  label: string;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  /** Escape blurs without writing, whatever the draft of this render says. */
  const cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const name = draft.trim();
    if (!cancelled.current && name && name !== value) onCommit(name);
    else setDraft(value);
  };
  return (
    <input
      className="plan-field"
      aria-label={label}
      maxLength={40}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelled.current = true;
          e.currentTarget.blur();
          cancelled.current = false;
        }
      }}
    />
  );
}
