// SPDX-License-Identifier: AGPL-3.0-only
import {
  alignItems,
  attachRole,
  catalogueKind,
  categoryOf,
  circuitOf,
  DEFAULT_LENS,
  detachIcon,
  iconCentre,
  iconCone,
  iconSize,
  isLight,
  isSized,
  itemFrame,
  itemLocked,
  layerOf,
  linkedCharacter,
  linkedLabel,
  linkedShot,
  modifiersOn,
  normalizeRotation,
  PLAN_CATEGORIES,
  PLAN_GRIP,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanAlign,
  type PlanGroupName,
  type PlanItem,
  SEATS,
  SYMBOL_PERCENT,
  shownAngle,
  symbolPercent,
  toggleGroup,
  withPercent,
} from '@inkadra/canvas-core';
import {
  PLAN_CAMERA_SUPPORTS,
  PLAN_LAYERS,
  PLAN_LIGHT_ROLES,
  PLAN_LIGHT_STANDS,
  type PlanIcon,
  type PlanIconKind,
  type PlanSensor,
  type PlanShape,
  type PlanStep,
} from '@inkadra/doc-schema';
import { Button, Checkbox, Icon, IconButton, type IconName, Select, Slider } from '@inkadra/ui';
import { type CSSProperties, type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu, type MenuItem } from '../chrome.tsx';
import { type Ed, isIcon, MAX_UNITS } from './editing.ts';
import { itemName, SEAT_SURFACES, seatsLine, selectionMix, supportText } from './elements.ts';
import { wattsText } from './kit.ts';
import { NumberField } from './NumberField.tsx';
import { selectionMenu } from './PlanCanvas.tsx';
import { measureText, PLAN_COLORS, PlanGlyph, planCss, TEXT_SIZES } from './PlanDrawing.tsx';
import { CharacterLink, LocationLink, needsSun, ShotLink, SunSection } from './PlanLinks.tsx';
import { PlanWallProperties } from './PlanWallProperties.tsx';

/** Lens presets of a camera, as on the mockup; Other takes any focal length. */
const LENSES = [24, 35, 50, 85];
/** Colour temperature presets, and the slider's range. */
const KELVINS = [3200, 4300, 5600];
const KELVIN_RANGE = [2000, 10000] as const;
/** The colour temperature track: warm to daylight to cool (decision 0104, slider "C"). */
const KELVIN_TRACK =
  'linear-gradient(90deg, var(--ink-tag-orange), color-mix(in srgb, var(--ink-tag-orange) 30%, white) 35%, white 50%, var(--ink-tag-blue))';
/** Gels most crews ask for; anything else is typed. */
/** The colour of the track at `kelvin`: warm below daylight, cool above. */
function kelvinColour(kelvin: number): string {
  if (kelvin <= 5600) {
    const warm = Math.round(Math.max(0, Math.min(1, (5600 - kelvin) / 3600)) * 100);
    return `color-mix(in srgb, var(--ink-tag-orange) ${warm}%, white)`;
  }
  const cool = Math.round(Math.max(0, Math.min(1, (kelvin - 5600) / 4400)) * 100);
  return `color-mix(in srgb, var(--ink-tag-blue) ${cool}%, white)`;
}
const GELS = [
  'CTO ¼',
  'CTO ½',
  'CTO full',
  'CTB ¼',
  'CTB ½',
  'CTB full',
  '216',
  '250',
  'Plus green',
  'Minus green',
];
const LIGHT_KINDS = PLAN_CATEGORIES.find((c) => c.id === 'lights')?.kinds ?? [];
const MODIFIER_KINDS =
  PLAN_CATEGORIES.flatMap((c) => c.groups).find((g) => g.id === 'modifiers')?.kinds ?? [];
const POSED = new Set<PlanIconKind>(['actor', 'support', 'extra', 'stunt', 'child']);

/** A labelled control in a column, as the mockup's fields. */
function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child.
    <label className={`plan-prop${wide ? ' plan-prop--wide' : ''}`}>
      <span className="plan-prop__label">{label}</span>
      {children}
    </label>
  );
}

/** Short exclusive choices as pills: a group of toggle buttons. */
function Pills<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: T | undefined;
  options: ReadonlyArray<{ value: T; label: string }>;
  onPick: (value: T) => void;
}) {
  return (
    <fieldset className="plan-pills" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="plan-pill"
          aria-pressed={value === o.value}
          onClick={() => onPick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * The properties of what is selected, in the right panel (decision 0104): one inspector per kind
 * of item as the approved mockup draws them, several items together, or, with nothing selected,
 * what the next strokes and icons get.
 */
export function PlanProperties({
  ed,
  onMeasure,
  compact = false,
  onMore,
}: {
  ed: Ed;
  /** The phone's sheet: show every property. */
  onMore?: () => void;
  /** Opens the number of a measure (on the canvas). */
  onMeasure: (id: string) => void;
  /** The phone's sheet: the item's main controls; More shows the rest. */
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const groupName = (g: PlanGroupName) =>
    g === PLAN_GRIP ? t('board.plan.gripGroup') : t(`board.plan.layers.${g}`);
  const [otherLens, setOtherLens] = useState(false);
  const [otherGel, setOtherGel] = useState(false);
  const [palette, setPalette] = useState<CSSProperties | null>(null);
  const [menu, setMenu] = useState<{
    items: MenuItem[];
    style: CSSProperties;
    label: string;
  } | null>(null);
  const colourButton = useRef<HTMLButtonElement>(null);
  const { item, many, drawn, icons } = ed;
  const scale = drawn.scale;
  const stopCapturing = () => ed.store.undo.stopCapturing();
  const fieldEvents = { onFocus: stopCapturing, onBlur: stopCapturing };
  const lang = i18n.language;
  const num = (v: number, digits = 1) => v.toLocaleString(lang, { maximumFractionDigits: digits });

  const openMenu = (items: MenuItem[], label: string, at: HTMLElement) => {
    const r = at.getBoundingClientRect();
    setMenu({
      items,
      label,
      style: {
        position: 'fixed',
        right: Math.max(8, window.innerWidth - r.right),
        top: r.bottom + 6,
      },
    });
  };
  const colorName = (hex: string) =>
    t(`board.plan.colors.${PLAN_COLORS.find((c) => c.hex === hex)?.name ?? 'ink'}`);
  const swatch = (hex: string) => (
    <button
      ref={colourButton}
      type="button"
      className="plan-swatch"
      aria-label={t('board.plan.tagColour', { name: colorName(hex) })}
      data-ink-tooltip={t('board.plan.tagColour', { name: colorName(hex) })}
      aria-haspopup="menu"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setPalette(
          palette
            ? null
            : { position: 'fixed', right: window.innerWidth - r.right, top: r.bottom + 6 },
        );
      }}
    >
      <i style={{ background: planCss(hex) }} />
    </button>
  );
  const paletteMenu = palette && (
    <ContextMenu
      className="plan-menu"
      label={t('board.plan.color')}
      style={palette}
      anchor={colourButton}
      items={PLAN_COLORS.map((c) => ({
        label: t(`board.plan.colors.${c.name}`),
        content: (
          <span className="plan-colour-item">
            <i style={{ background: `var(--ink-${c.token})` }} />
            {t(`board.plan.colors.${c.name}`)}
          </span>
        ),
        checked:
          (many[0] ?? item)?.color === c.hex || (!item && !many.length && ed.penColor === c.hex),
        action: () => ed.pickColor(c.hex),
      }))}
      onClose={() => setPalette(null)}
    />
  );
  const popups = (
    <>
      {paletteMenu}
      {menu && (
        <ContextMenu
          className="plan-menu"
          label={menu.label}
          style={menu.style}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );

  /** Locked on its own (decision 0114): its fields are shown, not edited, and it stays. */
  const frozen = many.length <= 1 && itemLocked(item);
  /** Duplicate, Lock, Delete; for a locked item they are drawn after its disabled fields. */
  const actions = (target: PlanItem, after = false) => {
    if (frozen && !after) return null;
    const isLocked = itemLocked(target);
    return (
      <div className="plan-props__actions plan-props__actions--foot">
        <Button onClick={ed.duplicate}>{t('board.plan.duplicate')}</Button>
        <Button
          aria-pressed={isLocked}
          data-ink-tooltip={t(isLocked ? 'board.plan.unlockItemHint' : 'board.plan.lockItemHint')}
          onClick={() => ed.toggleItemLock()}
        >
          {t(isLocked ? 'board.plan.unlock' : 'board.plan.lock')}
        </Button>
        <Button variant="danger" disabled={isLocked} onClick={() => ed.remove()}>
          {t('board.plan.delete')}
        </Button>
      </div>
    );
  };
  /** The selection's menu (as a right click on the plan), in the head: layer, order, turn. */
  const moreButton = (
    <IconButton
      icon="more"
      label={t('board.plan.selectionMenu')}
      aria-haspopup="menu"
      onClick={(e) =>
        openMenu(selectionMenu(ed, t), t('board.plan.selectionMenu'), e.currentTarget)
      }
    />
  );

  /** Name field of an icon: its label; an actor's follows the character it plays. */
  const head = (icon: PlanIcon, sub?: string) => {
    const played = linkedCharacter(icon, ed.cards);
    return (
      <div className="plan-props__head">
        <span className="plan-props__tile" style={{ color: planCss(icon.color) }}>
          <PlanGlyph kind={icon.kind} size={30} />
        </span>
        {compact ? (
          <span className="plan-props__name">
            <b>{linkedLabel(icon, ed.cards) || t(`board.plan.icons.${icon.kind}`)}</b>
            {sub && <small>{sub}</small>}
          </span>
        ) : (
          <input
            className="plan-field plan-field--strong"
            aria-label={t('board.plan.nameField')}
            placeholder={t(`board.plan.icons.${icon.kind}`)}
            maxLength={60}
            value={played?.name ?? icon.label ?? ''}
            readOnly={!!played}
            title={played ? t('board.plan.nameFollows') : undefined}
            {...fieldEvents}
            onChange={(e) => ed.edit(icon, { label: e.target.value.slice(0, 60) })}
          />
        )}
        {!compact && !played && swatch(icon.color)}
        {!compact && played && (
          // A linked actor takes its character's colour (decision 0111): shown, not picked.
          <span
            className="plan-swatch plan-swatch--static"
            role="img"
            aria-label={t('board.plan.tagColourFollows')}
            data-ink-tooltip={t('board.plan.tagColourFollows')}
          >
            <i
              style={{
                background: planCss(
                  ed.linked.icons?.find((i) => i.id === icon.id)?.color ?? icon.color,
                ),
              }}
            />
          </span>
        )}
        {!compact && !frozen && moreButton}
        {compact && <IconButton icon="more" label={t('board.plan.moreProps')} onClick={onMore} />}
      </div>
    );
  };
  const note = (icon: PlanIcon) => (
    <Field label={t('board.plan.note')}>
      <input
        className="plan-field"
        maxLength={200}
        value={icon.note ?? ''}
        {...fieldEvents}
        onChange={(e) => ed.edit(icon, { note: e.target.value })}
      />
    </Field>
  );
  const range = (
    label: string,
    value: number,
    min: number,
    max: number,
    unit: string,
    set: (v: number) => void,
    opts: {
      step?: number;
      meaning?: { gradient: string; thumbColor: string };
      chipMin?: number;
      chipMax?: number;
    } = {},
  ) => (
    <div className="plan-range">
      <div className="plan-range__head">
        <span className="plan-prop__label">{label}</span>
        <NumberField
          value={value}
          min={opts.chipMin ?? min}
          max={opts.chipMax ?? max}
          step={opts.step ?? 1}
          unit={unit}
          label={t('board.typedValue', { label })}
          onCommit={(v) => {
            stopCapturing();
            set(v);
            stopCapturing();
          }}
        />
      </div>
      <Slider
        className="plan-range__slider"
        aria-label={label}
        min={min}
        max={max}
        step={opts.step ?? 1}
        value={Math.max(min, Math.min(max, value))}
        {...(opts.meaning ? { meaning: opts.meaning } : {})}
        onPointerDown={stopCapturing}
        onPointerUp={stopCapturing}
        onChange={set}
      />
    </div>
  );
  /** The size of a symbol in metres with a scale, in percent without. */
  const sizeField = (icon: PlanIcon, label = t('board.plan.dimension')) => {
    const long = Math.max(iconSize(icon).w, iconSize(icon).h);
    return scale ? (
      <Field label={label}>
        <NumberField
          value={Math.round((long / scale) * 100) / 100}
          min={0.05}
          max={MAX_UNITS / scale}
          step={0.01}
          nudge={0.1}
          unit="m"
          label={label}
          onCommit={(m) => ed.write(withPercent(icon, (symbolPercent(icon) * m * scale) / long))}
        />
      </Field>
    ) : (
      <Field label={label}>
        <NumberField
          value={symbolPercent(icon)}
          min={SYMBOL_PERCENT.min}
          max={SYMBOL_PERCENT.max}
          unit="%"
          label={label}
          onCommit={(v) => ed.write(withPercent(icon, v))}
        />
      </Field>
    );
  };
  const angleField = (target: PlanItem, label = t('board.plan.angleField')) => (
    <Field label={label}>
      <NumberField
        value={shownAngle(target)}
        min={-360}
        max={360}
        unit="°"
        label={label}
        onCommit={(deg) => ed.rotate(normalizeRotation(deg - shownAngle(target)))}
      />
    </Field>
  );
  const baseOf = (icon: PlanIcon) => (icon.on ? icons.find((i) => i.id === icon.on) : undefined);
  // "Dolly on track", as the mockup's Support field; Elements says how long the track is.
  const supportName = (base: PlanIcon) => supportText(base, icons, t);
  /** "On Stool · Detach": where an attached icon sits. */
  const onRow = (icon: PlanIcon) => {
    const base = baseOf(icon);
    if (!base) return null;
    return (
      <div className="plan-props__on">
        <Icon name="link" size={14} />
        <span>
          {t('board.plan.onBase', { name: base.label || t(`board.plan.icons.${base.kind}`) })}
        </span>
        <Button variant="ghost" onClick={() => ed.write(detachIcon(icons, icon.id))}>
          {t('board.plan.detach')}
        </Button>
      </div>
    );
  };
  const positions = (icon: PlanIcon, title: string) => (
    <>
      <div className="plan-props__sep" />
      <div className="plan-props__row">
        <span className="plan-props__cap">{title}</span>
        <Button variant="ghost" onClick={() => ed.startRoute(icon)}>
          {t('board.plan.addPosition')}
        </Button>
      </div>
      {(icon.steps?.length ?? 0) > 0 && (
        <ol className="plan-props__steps">
          {[...(icon.steps ?? []), null].map((stepAt, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a position is its place in the order.
            <li key={i}>
              <span
                className="plan-props__num"
                // In the item's colour, as its badges on the plan (a linked actor's is its card's).
                style={
                  {
                    '--plan-tag': planCss(
                      ed.linked.icons?.find((x) => x.id === icon.id)?.color ?? icon.color,
                    ),
                  } as CSSProperties
                }
              >
                {i + 1}
              </span>
              <input
                className="plan-field"
                aria-label={t('board.plan.stepNote', { number: i + 1 })}
                placeholder={t('board.plan.stepPlaceholder')}
                maxLength={200}
                // The last position has a note of its own, apart from the item's (0119).
                value={(stepAt ? stepAt.note : icon.stepNote) ?? ''}
                {...fieldEvents}
                onChange={(e) => {
                  const text = e.target.value;
                  const next: PlanIcon = { ...icon, steps: [...(icon.steps ?? [])] };
                  if (stepAt) {
                    const edited: PlanStep = { ...stepAt, note: text };
                    if (!text) delete edited.note;
                    (next.steps as PlanStep[])[i] = edited;
                  } else if (text) next.stepNote = text;
                  else delete next.stepNote;
                  ed.writeItems([next]);
                }}
              />
            </li>
          ))}
        </ol>
      )}
      {(icon.steps?.length ?? 0) > 0 && (
        <div className="plan-props__row">
          <span className="plan-prop__label">{t('board.plan.pathLine')}</span>
          <Pills
            label={t('board.plan.pathLine')}
            value={icon.dashed ? 'dashed' : 'solid'}
            options={[
              { value: 'solid', label: t('board.plan.solid') },
              { value: 'dashed', label: t('board.plan.dashed') },
            ]}
            onPick={(v) =>
              ed.write(
                v === 'dashed'
                  ? { ...icon, dashed: true }
                  : (() => {
                      const n = { ...icon };
                      delete n.dashed;
                      return n;
                    })(),
              )
            }
          />
        </div>
      )}
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the checkbox is the child. */}
      <label className="plan-props__check">
        <Checkbox checked={ed.ghosts} onChange={(e) => ed.setGhosts(e.target.checked)} />
        {t('board.plan.ghosts')}
      </label>
    </>
  );

  // Inspectors -------------------------------------------------------------------------
  const light = (icon: PlanIcon) => {
    const watts = icon.watts;
    const mods = modifiersOn(icon, icons);
    const base = baseOf(icon);
    const kelvin = icon.kelvin ?? 5600;
    const gelOther = otherGel || (!!icon.gel && !GELS.includes(icon.gel));
    const sub = [
      icon.power || (watts ? wattsText(watts, lang) : ''),
      mods.map((m) => t(`board.plan.icons.${m.kind}`)).join(', '),
    ]
      .filter(Boolean)
      .join(' · ');
    const sliders = (
      <>
        <div className="plan-range">
          {range(
            t('board.plan.kelvin'),
            kelvin,
            KELVIN_RANGE[0],
            KELVIN_RANGE[1],
            'K',
            (v) => ed.edit(icon, { kelvin: Math.round(v) }),
            {
              step: 100,
              meaning: { gradient: KELVIN_TRACK, thumbColor: kelvinColour(kelvin) },
              chipMin: 1000,
              chipMax: 20000,
            },
          )}
          <Pills
            label={t('board.plan.kelvinPresets')}
            value={icon.kelvin ? String(icon.kelvin) : undefined}
            options={KELVINS.map((k) => ({ value: String(k), label: String(k) }))}
            onPick={(v) => ed.write({ ...icon, kelvin: Number(v) })}
          />
        </div>
        {range(
          t('board.plan.intensity'),
          Math.round((icon.intensity ?? 0.8) * 100),
          0,
          100,
          '%',
          (v) => ed.edit(icon, { intensity: v / 100 }),
        )}
        {iconCone(icon)?.beam &&
          range(t('board.plan.beam'), icon.beam ?? 30, 5, 180, '°', (v) =>
            ed.edit(icon, { beam: Math.round(v) }),
          )}
      </>
    );
    if (compact)
      return (
        <>
          {head(icon, sub)}
          {sliders}
          <div className="plan-pills">
            <span className="plan-pill">
              {t('board.plan.modifierCount', { count: mods.length })}
            </span>
            {(base || icon.stand) && (
              <span className="plan-pill">
                {base ? t(`board.plan.icons.${base.kind}`) : t(`board.plan.stands.${icon.stand}`)}
              </span>
            )}
            {icon.height !== undefined && <span className="plan-pill">{num(icon.height)} m</span>}
          </div>
        </>
      );
    return (
      <>
        {head(icon)}
        <Pills
          label={t('board.plan.role')}
          value={icon.role}
          options={PLAN_LIGHT_ROLES.map((r) => ({ value: r, label: t(`board.plan.roles.${r}`) }))}
          onPick={(r) =>
            ed.write(
              icon.role === r
                ? (() => {
                    const n = { ...icon };
                    delete n.role;
                    return n;
                  })()
                : { ...icon, role: r },
            )
          }
        />
        <div className="plan-props__grid plan-props__grid--fixture">
          <Field label={t('board.plan.fixture')}>
            <Select
              aria-label={t('board.plan.fixture')}
              value={catalogueKind(icon.kind)}
              onChange={(v) => ed.write({ ...icon, kind: v as PlanIconKind })}
              options={LIGHT_KINDS.map((k) => ({ value: k, label: t(`board.plan.icons.${k}`) }))}
            />
          </Field>
          <Field label={t('board.plan.power')}>
            <NumberField
              value={watts ?? 0}
              min={0}
              max={1_000_000}
              unit="W"
              label={t('board.plan.power')}
              onCommit={(w) => {
                const next = { ...icon, watts: Math.round(w) };
                // The watts are the number now; the old text goes with it.
                delete next.power;
                if (!w) delete (next as Partial<PlanIcon>).watts;
                ed.write(next);
              }}
            />
          </Field>
        </div>
        <Field label={t('board.plan.make')}>
          <input
            className="plan-field"
            maxLength={80}
            placeholder={t('board.plan.makePlaceholder')}
            value={icon.make ?? ''}
            {...fieldEvents}
            onChange={(e) => ed.edit(icon, { make: e.target.value })}
          />
        </Field>
        <div className="plan-prop">
          <span className="plan-prop__label">{t('board.plan.onLight')}</span>
          <div className="plan-pills">
            {mods.map((m) => (
              <button
                key={m.id}
                type="button"
                className="plan-pill"
                aria-label={t('board.plan.removeModifier', {
                  name: t(`board.plan.icons.${m.kind}`),
                })}
                onClick={() => ed.remove([m.id])}
              >
                {m.label || t(`board.plan.icons.${m.kind}`)}
                <Icon name="close" size={12} />
              </button>
            ))}
            <button
              type="button"
              className="plan-pill plan-pill--add"
              aria-haspopup="menu"
              onClick={(e) =>
                openMenu(
                  MODIFIER_KINDS.map((k) => ({
                    label: t(`board.plan.icons.${k}`),
                    content: (
                      <span className="plan-colour-item">
                        <PlanGlyph kind={k} size={20} />
                        {t(`board.plan.icons.${k}`)}
                      </span>
                    ),
                    action: () => {
                      const c = iconCentre(icon);
                      ed.placeIcon(
                        k,
                        { x: c.x / PLAN_VIEW_W, y: c.y / PLAN_VIEW_H },
                        { keep: true, on: icon.id },
                      );
                    },
                  })),
                  t('board.plan.addModifier'),
                  e.currentTarget,
                )
              }
            >
              <Icon name="plus" size={12} />
              {t('board.plan.modifier')}
            </button>
          </div>
        </div>
        <div className="plan-props__grid">
          <Field label={t('board.plan.gel')}>
            <Select
              aria-label={t('board.plan.gel')}
              value={gelOther ? 'other' : (icon.gel ?? '')}
              onChange={(v) => {
                if (v === 'other') setOtherGel(true);
                else {
                  setOtherGel(false);
                  ed.write(
                    v
                      ? { ...icon, gel: v }
                      : (() => {
                          const n = { ...icon };
                          delete n.gel;
                          return n;
                        })(),
                  );
                }
              }}
              options={[
                { value: '', label: t('board.plan.noGel') },
                ...GELS.map((g) => ({ value: g, label: g })),
                { value: 'other', label: t('board.plan.otherGel') },
              ]}
            />
          </Field>
          {base ? (
            <Field label={t('board.plan.stand')}>
              <span className="plan-field plan-field--static">
                {base.label || t(`board.plan.icons.${base.kind}`)}
              </span>
            </Field>
          ) : (
            <Field label={t('board.plan.stand')}>
              <Select
                aria-label={t('board.plan.stand')}
                value={icon.stand ?? ''}
                onChange={(v) =>
                  ed.write(
                    v
                      ? { ...icon, stand: v as PlanIcon['stand'] }
                      : (() => {
                          const n = { ...icon };
                          delete n.stand;
                          return n;
                        })(),
                  )
                }
                options={[
                  { value: '', label: t('board.plan.noStand') },
                  ...PLAN_LIGHT_STANDS.map((s) => ({
                    value: s,
                    label: t(`board.plan.stands.${s}`),
                  })),
                ]}
              />
            </Field>
          )}
        </div>
        {gelOther && (
          <Field label={t('board.plan.otherGel')}>
            <input
              className="plan-field"
              maxLength={40}
              value={icon.gel ?? ''}
              {...fieldEvents}
              onChange={(e) => ed.edit(icon, { gel: e.target.value })}
            />
          </Field>
        )}
        {onRow(icon)}
        {sliders}
        {/* Height, tilt and circuit on one row, so the light's panel fits as the mockup's. */}
        <div className="plan-props__grid plan-props__grid--three">
          <Field label={t('board.plan.height')}>
            <NumberField
              value={icon.height ?? 0}
              min={0}
              max={100}
              step={0.1}
              nudge={0.1}
              unit="m"
              label={t('board.plan.height')}
              onCommit={(m) => ed.write({ ...icon, height: Math.round(m * 100) / 100 })}
            />
          </Field>
          <Field label={t('board.plan.tilt')}>
            <NumberField
              value={icon.tilt ?? 0}
              min={-90}
              max={90}
              unit="°"
              label={t('board.plan.tilt')}
              onCommit={(d) => ed.write({ ...icon, tilt: Math.round(d) })}
            />
          </Field>
          <Field label={t('board.plan.circuit')}>
            <Select
              aria-label={t('board.plan.circuit')}
              // A circuit since removed reads "On no circuit", as the power does.
              value={circuitOf(icon, drawn.circuits)?.id ?? ''}
              onChange={(v) =>
                ed.write(
                  v
                    ? { ...icon, circuit: v }
                    : (() => {
                        const n = { ...icon };
                        delete n.circuit;
                        return n;
                      })(),
                )
              }
              options={[
                { value: '', label: t('board.plan.noCircuit') },
                ...(drawn.circuits ?? []).map((c) => ({
                  value: c.id,
                  label: `${c.name} · ${num(c.amps, 0)} A`,
                })),
              ]}
            />
          </Field>
        </div>
        {note(icon)}
        {actions(icon)}
      </>
    );
  };

  const reachUnit = scale ?? ed.step;
  const camera = (icon: PlanIcon) => {
    const shot = icon.frameId ? linkedShot(icon, ed.cards, ed.labels) : null;
    const lens = icon.lens ?? shot?.frameLens ?? DEFAULT_LENS;
    // The cone of the lens shown: the plan's own, else the linked frame's (decision 0111).
    const cone = iconCone({ ...icon, lens }, ed.plan.sensor);
    const base = baseOf(icon);
    // The frame's lens among the presets, as the mockup's 24 · 32 · 50 · 85 (decision 0111).
    const presets = [
      ...new Set([...LENSES.filter((mm) => mm !== DEFAULT_LENS), shot?.frameLens ?? DEFAULT_LENS]),
    ].sort((a, b) => a - b);
    const other = otherLens || !presets.includes(lens);
    const lensRow = (
      <div className="plan-prop">
        <div className="plan-range__head">
          <span className="plan-prop__label">{t('board.plan.lens')}</span>
          {cone && (
            <span className="plan-chip">
              {t('board.plan.angleValue', { angle: Math.round(cone.angle) })}
            </span>
          )}
        </div>
        <Pills
          label={t('board.plan.lens')}
          value={other ? 'other' : String(lens)}
          options={[
            ...presets.map((mm) => ({ value: String(mm), label: String(mm) })),
            { value: 'other', label: t('board.plan.otherLens') },
          ]}
          onPick={(v) => {
            if (v === 'other') setOtherLens(true);
            else {
              setOtherLens(false);
              ed.write({ ...icon, lens: Number(v) });
            }
          }}
        />
        {other && (
          <NumberField
            value={lens}
            min={4}
            max={2000}
            unit="mm"
            label={t('board.plan.focalOther')}
            onCommit={(mm) => ed.write({ ...icon, lens: Math.round(mm) })}
          />
        )}
      </div>
    );
    const reachRange =
      cone &&
      range(
        t('board.plan.viewLength'),
        Math.round((cone.reach / reachUnit) * 100) / 100,
        scale ? 1 : 1,
        scale ? 10 : 20,
        scale ? 'm' : t('board.plan.squares'),
        (v) => ed.edit(icon, { reach: Math.round(Math.min(MAX_UNITS, v * reachUnit) * 100) / 100 }),
        { step: scale ? 0.1 : 1, chipMin: 20 / reachUnit, chipMax: MAX_UNITS / reachUnit },
      );
    if (compact)
      return (
        <>
          {head(icon, `${lens} mm`)}
          {lensRow}
          {reachRange}
        </>
      );
    return (
      <>
        {head(icon)}
        <ShotLink ed={ed} icon={icon} />
        {lensRow}
        <div className="plan-props__grid">
          <Field label={t('board.plan.sensor')}>
            <Select
              aria-label={t('board.plan.sensor')}
              value={ed.plan.sensor ?? 's35'}
              onChange={(v) => ed.editPlan({ sensor: v === 's35' ? undefined : (v as PlanSensor) })}
              options={(['s35', 'ff', 'm43', 's16'] as const).map((v) => ({
                value: v,
                label: t(`board.plan.sensors.${v}`),
              }))}
            />
          </Field>
          {base ? (
            <Field label={t('board.plan.support')}>
              {/* What it stands on, and Detach to take it off (decision 0104). */}
              <Select
                aria-label={t('board.plan.support')}
                value="on"
                onChange={(v) => {
                  if (v === 'detach') ed.write(detachIcon(icons, icon.id));
                  else if (v === 'select') ed.setSelection([{ kind: 'icons', id: base.id }]);
                }}
                options={[
                  { value: 'on', label: supportName(base) },
                  {
                    value: 'select',
                    label: t('board.plan.selectNamed', {
                      name: base.label || t(`board.plan.icons.${base.kind}`),
                    }),
                  },
                  { value: 'detach', label: t('board.plan.detach') },
                ]}
              />
            </Field>
          ) : (
            <Field label={t('board.plan.support')}>
              <Select
                aria-label={t('board.plan.support')}
                value={icon.support ?? ''}
                onChange={(v) =>
                  ed.write(
                    v
                      ? { ...icon, support: v as PlanIcon['support'] }
                      : (() => {
                          const n = { ...icon };
                          delete n.support;
                          return n;
                        })(),
                  )
                }
                options={[
                  { value: '', label: t('board.plan.noSupport') },
                  ...PLAN_CAMERA_SUPPORTS.map((s) => ({
                    value: s,
                    label: t(`board.plan.supports.${s}`),
                  })),
                ]}
              />
            </Field>
          )}
          <Field label={t('board.plan.height')}>
            <NumberField
              value={icon.height ?? 0}
              min={0}
              max={100}
              step={0.1}
              nudge={0.1}
              unit="m"
              label={t('board.plan.height')}
              onCommit={(m) => ed.write({ ...icon, height: Math.round(m * 100) / 100 })}
            />
          </Field>
          {angleField(icon)}
        </div>
        {reachRange}
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the checkbox is the child. */}
        <label className="plan-props__check">
          <Checkbox
            checked={!!icon.showLens}
            onChange={(e) =>
              ed.write(
                e.target.checked
                  ? { ...icon, showLens: true }
                  : (() => {
                      const n = { ...icon };
                      delete n.showLens;
                      return n;
                    })(),
              )
            }
          />
          {t('board.plan.showLens')}
        </label>
        {positions(icon, t('board.plan.positionsTitle'))}
        {actions(icon)}
      </>
    );
  };

  const person = (icon: PlanIcon) => {
    const posed = POSED.has(catalogueKind(icon.kind));
    const poses = posed && (
      <div className="plan-prop">
        <span className="plan-prop__label">{t('board.plan.pose')}</span>
        <Pills
          label={t('board.plan.pose')}
          value={icon.pose ?? 'standing'}
          options={(['standing', 'seated', 'lying'] as const).map((p) => ({
            value: p,
            label: t(`board.plan.poses.${p}`),
          }))}
          onPick={(p) =>
            ed.write(
              p === 'standing'
                ? (() => {
                    const n = { ...icon };
                    delete n.pose;
                    return n;
                  })()
                : { ...icon, pose: p },
            )
          }
        />
      </div>
    );
    if (compact)
      return (
        <>
          {head(icon, icon.note)}
          {poses}
        </>
      );
    return (
      <>
        {head(icon)}
        <CharacterLink ed={ed} icon={icon} />
        {poses}
        {onRow(icon)}
        <div className="plan-props__grid">
          {angleField(icon, t('board.plan.facing'))}
          {sizeField(icon)}
        </div>
        {positions(icon, t('board.plan.movement'))}
        {/* With positions, the last one's note is the item's note (decision 0104): one field. */}
        {note(icon)}
        {actions(icon)}
      </>
    );
  };

  const prop = (icon: PlanIcon) => {
    const frame = itemFrame(icon);
    const seats = SEATS[catalogueKind(icon.kind)];
    const seated = icons.filter((i) => i.on === icon.id && attachRole(i.kind) === 'seated').length;
    const unit = scale ?? ed.step;
    const dim = (label: string, value: number, set: (v: number) => PlanIcon) => (
      <Field label={label}>
        <NumberField
          value={Math.round((value / unit) * 100) / 100}
          min={0.01}
          max={MAX_UNITS / unit}
          step={0.01}
          nudge={scale ? 0.1 : 1}
          unit={scale ? 'm' : t('board.plan.squares')}
          label={label}
          onCommit={(v) => ed.write(set(v * unit))}
        />
      </Field>
    );
    if (compact) return head(icon);
    return (
      <>
        {head(icon)}
        <div className="plan-props__grid">
          {frame && dim(t('board.plan.width'), frame.w, (w) => ({ ...icon, w, h: frame.h }))}
          {frame && dim(t('board.plan.depth'), frame.h, (h) => ({ ...icon, w: frame.w, h }))}
          {angleField(icon)}
          {seats !== undefined && (
            <Field label={t('board.plan.seats')}>
              <span className="plan-field plan-field--static">
                {t('board.plan.seatsTaken', { count: seats, taken: seated })}
              </span>
            </Field>
          )}
          {SEAT_SURFACES.has(catalogueKind(icon.kind)) && (
            <Field label={t('board.plan.seats')}>
              <span className="plan-field plan-field--static">
                {(() => {
                  const line = seatsLine(icon, icons);
                  return line.kind
                    ? t(`board.plan.seatsOf.${line.kind}`, { count: line.count })
                    : t('board.plan.seatsAround', { count: line.count });
                })()}
              </span>
            </Field>
          )}
        </div>
        {note(icon)}
        {actions(icon)}
      </>
    );
  };

  const other = (icon: PlanIcon) => {
    if (compact) return head(icon);
    return (
      <>
        {head(icon)}
        {onRow(icon)}
        <div className="plan-props__grid">
          {sizeField(icon)}
          {angleField(icon)}
        </div>
        {iconCone(icon)?.beam &&
          range(t('board.plan.beam'), icon.beam ?? 30, 5, 180, '°', (v) =>
            ed.edit(icon, { beam: Math.round(v) }),
          )}
        {positions(icon, t('board.plan.movement'))}
        {/* With positions, the last one's note is the item's note (decision 0104): one field. */}
        {note(icon)}
        {actions(icon)}
      </>
    );
  };

  const shape = (target: PlanItem) => {
    const isText = 'x0' in target && target.kind === 'text';
    const isMeasure = 'x0' in target && target.kind === 'measure';
    const textStep = (dir: -1 | 1) => {
      if (!('x0' in target)) return null;
      const sizes = Object.values(TEXT_SIZES) as number[];
      return (
        (dir > 0 ? sizes.find((v) => v > target.width) : sizes.findLast((v) => v < target.width)) ??
        null
      );
    };
    return (
      <>
        <div className="plan-props__head">
          <span className="plan-props__tile" style={{ color: planCss(target.color) }}>
            <Icon name={isText ? 'text' : isMeasure ? 'ruler' : 'pen'} size={20} />
          </span>
          <span className="plan-props__name">
            <b>{itemName(target, t)}</b>
          </span>
          {swatch(target.color)}
        </div>
        {isText && (
          <Field label={t('film.pen.textField')}>
            <input
              className="plan-field"
              data-plan-field="text"
              maxLength={500}
              value={(target as PlanShape).text ?? ''}
              {...fieldEvents}
              onChange={(e) => ed.writeItems([{ ...target, text: e.target.value } as PlanItem])}
            />
          </Field>
        )}
        {isText && (
          <div className="plan-props__row">
            <span className="plan-prop__label">{t('board.plan.textSize')}</span>
            <span>
              {([-1, 1] as const).map((dir) => {
                const next = textStep(dir);
                return (
                  <IconButton
                    key={dir}
                    icon={dir > 0 ? 'plus' : 'minus'}
                    label={t(dir > 0 ? 'board.plan.bigger' : 'board.plan.smaller')}
                    disabled={next === null}
                    onClick={() =>
                      next !== null && ed.write({ ...target, width: next } as PlanItem)
                    }
                  />
                );
              })}
            </span>
          </div>
        )}
        {isMeasure && (
          <Field label={t('board.plan.shapes.measure')}>
            <Button onClick={() => onMeasure(target.id)}>
              {measureText(target as PlanShape, scale, lang) || t('board.plan.writeMeasure')}
            </Button>
          </Field>
        )}
        {itemFrame(target) && <div className="plan-props__grid">{angleField(target)}</div>}
        {actions(target)}
      </>
    );
  };

  const several = () => {
    const align = (how: PlanAlign) => ed.write(alignItems(many, how));
    const grouped = many.every((i) => i.group && i.group === many[0]?.group);
    const allLocked = many.every(itemLocked);
    const colour = many.every((i) => i.color === many[0]?.color) ? (many[0]?.color ?? '') : 'mixed';
    const layers = new Set(many.map(layerOf));
    const alignIcons: Array<[PlanAlign, IconName]> = [
      ['left', 'alignLeft'],
      ['centre', 'alignCenter'],
      ['top', 'alignTop'],
      ['distribute', 'distribute'],
    ];
    return (
      <>
        <div className="plan-props__row">
          <b>{t('board.plan.selectedCount', { count: many.length })}</b>
          <span className="plan-props__buttons">
            <span className="plan-prop__label">{selectionMix(many, t)}</span>
            {moreButton}
          </span>
        </div>
        <div className="plan-props__row">
          <span className="plan-prop__label">{t('board.plan.alignLabel')}</span>
          <span className="plan-props__buttons">
            {alignIcons.map(([how, icon]) => (
              <IconButton
                key={how}
                className="plan-props__bordered"
                icon={icon}
                label={t(`board.plan.align.${how}`)}
                disabled={allLocked}
                onClick={() => align(how)}
              />
            ))}
          </span>
        </div>
        <div className="plan-props__grid">
          <Field label={t('board.plan.layer')}>
            <Select
              aria-label={t('board.plan.layer')}
              disabled={allLocked}
              value={layers.size === 1 ? ([...layers][0] as string) : 'mixed'}
              onChange={(v) => v !== 'mixed' && ed.moveToLayer(v as never)}
              options={[
                ...(layers.size > 1
                  ? [{ value: 'mixed', label: t('board.plan.mixed'), disabled: true }]
                  : []),
                ...PLAN_LAYERS.filter((l) => !(ed.base && l === 'set')).map((l) => ({
                  value: l,
                  label: t(`board.plan.layers.${l}`),
                })),
              ]}
            />
          </Field>
          <Field label={t('board.plan.tag')}>
            <Select
              aria-label={t('board.plan.tag')}
              disabled={allLocked}
              value={colour}
              onChange={(v) => v !== 'mixed' && ed.pickColor(v)}
              options={[
                ...(colour === 'mixed'
                  ? [{ value: 'mixed', label: t('board.plan.mixed'), disabled: true }]
                  : []),
                ...PLAN_COLORS.map((c) => ({
                  value: c.hex,
                  label: t(`board.plan.colors.${c.name}`),
                })),
              ]}
            />
          </Field>
        </div>
        <div className="plan-props__actions plan-props__actions--foot">
          <Button disabled={allLocked} onClick={() => ed.write(toggleGroup(many))}>
            {t(grouped ? 'board.plan.ungroup' : 'board.plan.group')}
          </Button>
          <Button onClick={ed.duplicate}>{t('board.plan.duplicate')}</Button>
          {/* Lock and Unlock are in the menu above, as the mockup keeps three buttons. */}
          <Button variant="danger" disabled={allLocked} onClick={() => ed.remove()}>
            {t('board.plan.delete')}
          </Button>
        </div>
      </>
    );
  };

  const nothing = () => (
    <>
      {ed.lockedWall ? (
        <div className="plan-props__locked" role="status">
          <Icon name="lock" size={16} />
          <span>{t('board.plan.lockedAs.set')}</span>
          <Button
            onClick={() => {
              ed.toggleLocked('set');
              ed.setLockedWall(false);
            }}
          >
            {t('board.plan.unlock')}
          </Button>
        </div>
      ) : ed.hiddenItem && ed.hiddenLayers.has(ed.hiddenItem.group) ? (
        // Picked in Elements on a hidden layer or group: out of reach on the plan, shown here
        // with the way back (decision 0119).
        <div className="plan-props__locked" role="status">
          <Icon name="eyeOff" size={16} />
          <span>{t('board.plan.hiddenItem', { layer: groupName(ed.hiddenItem.group) })}</span>
          <Button
            onClick={() => {
              ed.toggleHidden((ed.hiddenItem as { group: PlanGroupName }).group);
              ed.setHiddenItem(null);
            }}
          >
            {t('board.plan.showLayer', { layer: groupName(ed.hiddenItem.group) })}
          </Button>
        </div>
      ) : ed.lockedItem ? (
        <div className="plan-props__locked" role="status">
          <Icon name="lock" size={16} />
          <span>{t(`board.plan.lockedAs.${layerOf(ed.lockedItem)}`)}</span>
          <Button
            onClick={() => {
              const layer = layerOf(ed.lockedItem as PlanItem);
              ed.toggleLocked(layer);
              ed.setLockedItem(null);
            }}
          >
            {t('board.plan.unlock')}
          </Button>
        </div>
      ) : (
        <p className="plan-props__hint">{t('board.plan.nothingSelected')}</p>
      )}
      <div className="plan-props__row">
        <span className="plan-prop__label">{t('board.plan.nextColor')}</span>
        {swatch(ed.penColor ?? PLAN_COLORS[0].hex)}
      </div>
      <LocationLink ed={ed} />
      {needsSun(ed) && <SunSection ed={ed} />}
    </>
  );

  let body: ReactNode;
  if (ed.wallSel) body = <PlanWallProperties ed={ed} />;
  else if (many.length > 1) body = several();
  else if (!item) body = nothing();
  else if (!isIcon(item)) body = shape(item);
  else {
    const kind = catalogueKind(item.kind);
    // The sun turns with the time of day (decision 0111): its section takes the light's place.
    if (kind === 'sun')
      body = compact ? (
        head(item)
      ) : (
        <>
          {head(item)}
          <SunSection ed={ed} />
          {note(item)}
          {actions(item)}
        </>
      );
    else if (isLight(kind)) body = light(item);
    else if (kind === 'camera') body = camera(item);
    else if (categoryOf(kind).id === 'people' && attachRole(kind) === 'seated') body = person(item);
    else if (isSized(kind)) body = prop(item);
    else body = other(item);
  }
  return (
    <div
      className={`plan-props${compact ? ' plan-props--compact' : ''}`}
      data-tour="plan-properties"
    >
      {frozen && item ? (
        <>
          <div className="plan-props__locked" role="status">
            <Icon name="lock" size={16} />
            <span>{t('board.plan.itemLocked')}</span>
          </div>
          <fieldset className="plan-props__fields" disabled>
            {body}
          </fieldset>
          {actions(item, true)}
        </>
      ) : (
        body
      )}
      {popups}
    </div>
  );
}
