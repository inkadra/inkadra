// SPDX-License-Identifier: AGPL-3.0-only
import {
  catalogueKind,
  type FrameElement,
  linkedCharacter,
  linkedLocation,
  linkedScenes,
  linkedShot,
  storyboardOf,
  unlinkCharacter,
  updateElement,
  updatePlanItems,
} from '@inkadra/canvas-core';
import type { Element, PlanIcon } from '@inkadra/doc-schema';
import {
  castNameKey,
  locationCoords,
  sunBearingByClock,
  sunDate,
  sunFrom,
  sunHeight,
  sunPosition,
  sunRotation,
} from '@inkadra/shared';
import { Button, Icon, Select, Slider } from '@inkadra/ui';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pickVariant, useAsset } from '../assets.ts';
import { FramePicture } from '../film/FramePicture.tsx';
import { usePresetText } from '../film/fields.tsx';
import { LOCAL, REPAIR } from '../store.ts';
import type { Ed } from './editing.ts';
import { NumberField } from './NumberField.tsx';
import { PlanGlyph, planCss } from './PlanDrawing.tsx';
import { northWay, sunDays, useScheduleDays, useSunDays } from './sun-days.ts';
import './links.css';

type Character = Extract<Element, { type: 'character' }>;
type Location = Extract<Element, { type: 'location' }>;

interface Option {
  id: string;
  label: string;
  sub?: string | undefined;
  /** Proposed first: the cast of the plan's scenes, their location, their frames. */
  first?: boolean;
}

/** Where a picker opens and the button that opened it, which gets the focus back. */
export interface PickerAt {
  style: CSSProperties;
  opener: HTMLElement;
}

/**
 * A list to link an item to a card (decision 0104): a search on top, the proposed cards first.
 * Closes on Escape and on a press outside, as the scene picker does, and gives the focus back
 * to the button that opened it, if that button is still there.
 */
export function LinkPicker({
  title,
  search,
  options,
  at,
  onPick,
  onClose,
}: {
  title: string;
  search: string;
  options: readonly Option[];
  at: PickerAt;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const { style, opener } = at;
  // Closed, the list leaves the focus on nothing: it goes back to its button.
  useEffect(
    () => () => {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && opener.isConnected) opener.focus();
    },
    [opener],
  );
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
  const q = query.trim().toLocaleLowerCase();
  const shown = (q ? options.filter((o) => o.label.toLocaleLowerCase().includes(q)) : options)
    .slice()
    .sort((a, b) => Number(!!b.first) - Number(!!a.first));
  return (
    <div
      ref={box}
      className="plan-scenes ink-motion-pop"
      role="dialog"
      aria-label={title}
      style={style}
      data-chrome=""
    >
      <div className="plan-scenes__title">{title}</div>
      <label className="plan-lib__search">
        <Icon name="search" size={13} />
        <input
          type="search"
          aria-label={search}
          placeholder={search}
          value={query}
          // biome-ignore lint/a11y/noAutofocus: the picker opens to type in it.
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <ul className="plan-scenes__list">
        {shown.map((o, i) => (
          <li key={o.id}>
            {o.first && i === 0 && (
              <span className="plan-scenes__title plan-links__group">
                {t('board.plan.links.proposed')}
              </span>
            )}
            {!o.first && shown[i - 1]?.first && (
              <span className="plan-scenes__title plan-links__group">
                {t('board.plan.links.others')}
              </span>
            )}
            <button type="button" className="plan-scenes__item" onClick={() => onPick(o.id)}>
              <span className="plan-props__name">
                <span>{o.label}</span>
                {o.sub && <small>{o.sub}</small>}
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="plan-lib__hint">{t('board.plan.links.none')}</li>}
      </ul>
    </div>
  );
}

/** Where a picker opens: under the button that asked for it, inside the window. */
function under(at: HTMLElement): PickerAt {
  const r = at.getBoundingClientRect();
  return {
    style: {
      position: 'fixed',
      left: Math.max(8, Math.min(r.left, window.innerWidth - 268)),
      top: Math.min(r.bottom + 6, window.innerHeight - 340),
    },
    opener: at,
  };
}

/** The card of a link: picture, name, a line under it, and the links to open or unlink. */
function LinkCard({
  picture,
  name,
  sub,
  open,
  onOpen,
  onUnlink,
}: {
  picture: ReactNode;
  name: string;
  sub?: string | undefined;
  open: string;
  onOpen?: (() => void) | undefined;
  onUnlink?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="plan-props__card plan-links__card">
      {picture}
      <span className="plan-props__name">
        <b>{name}</b>
        {sub && <small>{sub}</small>}
        <span className="plan-links__actions">
          {onOpen && (
            <button type="button" className="plan-links__link" onClick={onOpen}>
              {open}
            </button>
          )}
          {onUnlink && (
            <button type="button" className="plan-links__link" onClick={onUnlink}>
              {t('board.plan.links.unlink')}
            </button>
          )}
        </span>
      </span>
    </div>
  );
}

/** The scenes a plan serves: its own, else its base's. */
const sceneIdsOf = (ed: Ed) => ed.plan.sceneIds ?? ed.base?.sceneIds ?? [];

/** Names in the cast of the frames of the plan's scenes, as keys. */
function castOfScenes(ed: Ed): Set<string> {
  const scenes = new Set(sceneIdsOf(ed));
  const out = new Set<string>();
  for (const el of ed.cards.values())
    if (el.type === 'frame' && el.parent && scenes.has(el.parent))
      for (const name of el.cast ?? []) out.add(castNameKey(name));
  return out;
}

function CharacterPicture({
  character,
  colour,
}: {
  character: { name: string; assetId?: string };
  colour?: string | undefined;
}) {
  const asset = useAsset(character.assetId);
  const src = asset && asset !== 'missing' ? pickVariant(asset, 80) : '';
  return src ? (
    <img className="plan-links__face" src={src} alt="" />
  ) : (
    <span
      className="plan-props__initial"
      aria-hidden="true"
      style={
        colour
          ? {
              color: planCss(colour),
              background: `color-mix(in srgb, ${planCss(colour)} 18%, var(--ink-surface-1))`,
            }
          : undefined
      }
    >
      {character.name.slice(0, 1).toLocaleUpperCase()}
    </span>
  );
}

/**
 * The character an actor plays (decision 0104): the card it links to, its picture and who plays
 * it, or a list of the characters this person can see, the cast of the plan's scenes first.
 * Linked, the icon's name and colour follow the card; unlinked, the name stays as text.
 */
export function CharacterLink({ ed, icon }: { ed: Ed; icon: PlanIcon }) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState<PickerAt | null>(null);
  const character = linkedCharacter(icon, ed.cards);
  const pick = (id: string) => {
    const c = ed.cards.get(id) as Character | undefined;
    setPicking(null);
    // The id only (decision 0111): the name is read from the card; it is written into the label
    // only when the link breaks (unlink, delete, a paste where the character is not).
    if (c) ed.write({ ...icon, characterId: c.id });
  };
  const options = (): Option[] => {
    const cast = castOfScenes(ed);
    return [...ed.cards.values()]
      .filter((c): c is Character => c.type === 'character')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({
        id: c.id,
        label: c.name,
        sub: c.actor ? t('board.plan.links.playedBy', { actor: c.actor }) : undefined,
        first: cast.has(castNameKey(c.name)),
      }));
  };
  return (
    <>
      <span className="plan-props__cap">{t('board.plan.characterCard')}</span>
      {character ? (
        <LinkCard
          picture={
            <CharacterPicture
              character={character}
              colour={ed.linked.icons?.find((i) => i.id === icon.id)?.color}
            />
          }
          name={t('board.plan.links.fromCharacters', { name: character.name })}
          sub={
            character.actor
              ? t('board.plan.links.playedBy', { actor: character.actor })
              : t('board.plan.nameFollows')
          }
          open={t('board.plan.links.openCharacter')}
          onOpen={ed.onOpenCard && (() => ed.onOpenCard?.(character.id))}
          onUnlink={() => ed.write(unlinkCharacter(icon, ed.cards))}
        />
      ) : (
        <Button
          icon="link"
          data-tour="plan-link-character"
          onClick={(e) => setPicking(under(e.currentTarget))}
        >
          {t('board.plan.links.linkCharacter')}
        </Button>
      )}
      {picking && (
        <LinkPicker
          title={t('board.plan.links.linkCharacter')}
          search={t('board.plan.links.searchCharacter')}
          options={options()}
          at={picking}
          onPick={pick}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  );
}

/** The frames a camera may shoot: the frames of the plan's scenes, else every frame. */
function frameOptions(ed: Ed): { frames: FrameElement[]; first: Set<string> } {
  const groups = storyboardOf([...ed.cards.values()]);
  const frames = groups.flatMap((g) => g.frames);
  const scenes = new Set(sceneIdsOf(ed));
  const first = new Set(frames.filter((f) => f.parent && scenes.has(f.parent)).map((f) => f.id));
  return { frames, first };
}

/**
 * The storyboard frame a camera shoots (decision 0104): its picture, label, shot size,
 * movement and lens. The camera takes the frame's lens unless the plan sets its own, which is
 * never written back to the frame.
 */
export function ShotLink({ ed, icon }: { ed: Ed; icon: PlanIcon }) {
  const { t } = useTranslation();
  const preset = usePresetText();
  const [picking, setPicking] = useState<PickerAt | null>(null);
  const shot = linkedShot(icon, ed.cards, ed.labels);
  const frame = shot ? (ed.cards.get(shot.id) as FrameElement) : null;
  const options = (): Option[] => {
    const { frames, first } = frameOptions(ed);
    return frames.map((f) => ({
      id: f.id,
      label: [ed.labels?.get(f.id) ?? f.label, preset('shotSizes', f.shot)]
        .filter(Boolean)
        .join(' · '),
      sub: f.lens,
      first: first.has(f.id),
    }));
  };
  const own = icon.lens !== undefined;
  return (
    <>
      <span className="plan-props__cap">{t('board.plan.shotCard')}</span>
      {shot && frame ? (
        <>
          <LinkCard
            picture={
              <span className="plan-links__frame">
                <FramePicture
                  assetId={frame.assetId}
                  aspect={frame.aspect}
                  boardAspect={ed.boardAspect ?? '16:9'}
                  strokes={frame.strokes}
                  shapes={frame.shapes}
                  referenceOpacity={frame.referenceOpacity}
                  pixels={192}
                />
              </span>
            }
            // "2A · Master, wide": the frame's action says the shot, else its size.
            name={[
              shot.label,
              frame.action?.split('\n')[0]?.trim() || preset('shotSizes', shot.shot),
            ]
              .filter(Boolean)
              .join(' · ')}
            sub={[
              shot.frameLens ? t('board.plan.lensInFrame', { mm: shot.frameLens }) : '',
              preset('shotMovements', shot.movement),
            ]
              .filter(Boolean)
              .join(' · ')}
            open={t('board.plan.links.openFrame')}
            onOpen={ed.onOpenCard && (() => ed.onOpenCard?.(shot.id))}
            onUnlink={() => {
              const { frameId: _gone, ...rest } = icon;
              ed.write(rest);
            }}
          />
          <p className="plan-props__hint">
            {t('board.plan.lensFollows')}
            {own && shot.frameLens && icon.lens !== shot.frameLens ? (
              <>
                {' '}
                <button
                  type="button"
                  className="plan-links__link"
                  onClick={() => {
                    const { lens: _own, ...rest } = icon;
                    ed.write(rest);
                  }}
                >
                  {t('board.plan.links.followFrame', { mm: shot.frameLens })}
                </button>
              </>
            ) : null}
          </p>
        </>
      ) : (
        <Button
          icon="link"
          data-tour="plan-link-frame"
          onClick={(e) => setPicking(under(e.currentTarget))}
        >
          {t('board.plan.links.linkFrame')}
        </Button>
      )}
      {picking && (
        <LinkPicker
          title={t('board.plan.links.linkFrame')}
          search={t('board.plan.links.searchFrame')}
          options={options()}
          at={picking}
          onPick={(id) => {
            setPicking(null);
            ed.write({ ...icon, frameId: id });
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  );
}

/**
 * The location the set is in (decision 0104), on the base of setups: its name, setting, address
 * and light notes shown as the card says, never its contact or notes. Proposed: the locations
 * the plan's scenes name.
 */
export function LocationLink({ ed }: { ed: Ed }) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState<PickerAt | null>(null);
  const owner = ed.base ?? ed.plan;
  const location = linkedLocation(owner, ed.cards);
  const options = (): Option[] => {
    const named = new Set(
      linkedScenes({ sceneIds: sceneIdsOf(ed) }, ed.cards).flatMap((s) => {
        const scene = ed.cards.get(s.id);
        return scene?.type === 'scene' && scene.location ? [castNameKey(scene.location)] : [];
      }),
    );
    return [...ed.cards.values()]
      .filter((c): c is Location => c.type === 'location')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({
        id: c.id,
        label: c.name,
        sub: c.address,
        first: named.has(castNameKey(c.name)),
      }));
  };
  return (
    <>
      <span className="plan-props__cap">{t('board.plan.links.location')}</span>
      {location ? (
        <LinkCard
          picture={<Icon name="map" size={18} />}
          name={location.name}
          sub={[location.setting && t(`film.scene.settings.${location.setting}`), location.address]
            .filter(Boolean)
            .join(' · ')}
          open={t('board.plan.links.openLocation')}
          onOpen={ed.onOpenCard && (() => ed.onOpenCard?.(location.id))}
          onUnlink={() => ed.editPlan({ locationId: undefined }, owner.id)}
        />
      ) : (
        <Button
          icon="link"
          data-tour="plan-link-location"
          onClick={(e) => setPicking(under(e.currentTarget))}
        >
          {t('board.plan.links.linkLocation')}
        </Button>
      )}
      {location?.light && (
        <p className="plan-props__hint">
          {t('board.plan.links.lightNotes')}: {location.light}
        </p>
      )}
      {picking && (
        <LinkPicker
          title={t('board.plan.links.linkLocation')}
          search={t('board.plan.links.searchLocation')}
          options={options()}
          at={picking}
          onPick={(id) => {
            setPicking(null);
            ed.editPlan({ locationId: id }, owner.id);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  );
}

/** The sun's time of day on the slider: the night dark, sunrise and sunset warm, noon pale. */
const DAY_TRACK =
  'linear-gradient(90deg, var(--ink-tag-blue-bg), var(--ink-tag-orange) 28%, color-mix(in srgb, var(--ink-tag-yellow) 30%, white) 50%, var(--ink-tag-orange) 72%, var(--ink-tag-blue-bg))';
const DEFAULT_SUN = 17 * 60 + 30;

/** The rotation of a sun icon lives in @inkadra/shared (decision 0116). */
export { sunRotation };

/** A plan that shows the sun: scenes outside, a sun icon, or a time already set. */
export function needsSun(ed: Ed): boolean {
  const outside = linkedScenes({ sceneIds: sceneIdsOf(ed) }, ed.cards).some(
    (s) => s.setting === 'ext' || s.setting === 'int-ext',
  );
  return outside || !!ed.plan.sun || ed.icons.some((i) => catalogueKind(i.kind) === 'sun');
}

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * "Sun, for exteriors" (decision 0104): the time of day and the date, and where north is on the
 * drawing. The sun icons of the plan turn as the time changes. With a map link on the linked
 * location the sun's bearing and height are worked out for that place and date; without one the
 * bearing follows the clock alone (`sunBearingByClock`) and no height is shown.
 */
export function SunSection({ ed }: { ed: Ed }) {
  const { t, i18n } = useTranslation();
  const owner = ed.base ?? ed.plan;
  const north = owner.north ?? 0;
  const time = ed.plan.sun?.time ?? DEFAULT_SUN;
  // The sun follows a shooting day by its id (version 26, decision 0119): its live date; the
  // stored date is the last one it had, kept for when the day is gone.
  const dayId = ed.plan.sun?.day;
  const scheduled = useScheduleDays(ed.boardId);
  const sceneKey = sceneIdsOf(ed).join(' ');
  const shotKey = useMemo(() => {
    const scenes = new Set(sceneKey.split(' ').filter(Boolean));
    return [...ed.cards.values()]
      .filter((c) => c.type === 'frame' && !!c.sceneId && scenes.has(c.sceneId))
      .map((c) => c.id)
      .sort()
      .join(' ');
  }, [ed.cards, sceneKey]);
  const { offered, all } = useSunDays(scheduled, shotKey, sceneKey);
  /** `dayGone`: the day it followed is no longer in the schedule; the plan keeps its last date. */
  const { date, day: linked, gone: dayGone } = sunDate(ed.plan.sun, all);
  const location = ed.cards.get(owner.locationId ?? '') as Location | undefined;
  const coords =
    location?.type === 'location'
      ? locationCoords([location.mapUrl, location.address].filter(Boolean).join(' '))
      : null;
  const today = new Date().toISOString().slice(0, 10);
  // shortcut: the device's time zone, not the project's, until the editor knows the project.
  const position = coords ? sunPosition(date ?? today, time, coords.lat, coords.lng) : null;
  const bearing = position?.azimuth ?? sunBearingByClock(time);
  const from = t(`board.plan.links.from.${sunFrom(bearing)}`);
  const height = position ? sunHeight(position.elevation) : null;
  const suns = ed.icons.filter((i) => catalogueKind(i.kind) === 'sun');
  const [otherDate, setOtherDate] = useState(false);
  // A day of the shoot is picked from the list; a date typed by hand stays a date.
  const days = linked && !offered.some((d) => d.id === linked.id) ? [...offered, linked] : offered;
  const picking = days.length > 0 && !otherDate && (!ed.plan.sun?.date || !!linked);
  /**
   * Writes the time, the date (with the shooting day it follows, or none) or north, and turns
   * the sun icons with them.
   */
  const write = (next: {
    time?: number;
    date?: string | undefined;
    day?: string | undefined;
    north?: number;
  }) => {
    const t2 = next.time ?? time;
    const d2 = 'date' in next ? next.date : date;
    const day2 = 'date' in next ? next.day : dayId;
    const n2 = next.north ?? north;
    const p = coords ? sunPosition(d2 ?? today, t2, coords.lat, coords.lng) : null;
    const rotation = sunRotation(p?.azimuth ?? sunBearingByClock(t2), n2);
    ed.doc.transact(() => {
      if (next.north !== undefined)
        updateElement(ed.doc, owner.id, { north: n2 || undefined }, LOCAL);
      if (next.time !== undefined || 'date' in next)
        updateElement(
          ed.doc,
          ed.plan.id,
          { sun: { time: t2, ...(day2 ? { day: day2 } : {}), ...(d2 ? { date: d2 } : {}) } },
          LOCAL,
        );
      ed.writeItems(suns.filter((s) => s.rotation !== rotation).map((s) => ({ ...s, rotation })));
    }, LOCAL);
  };
  /** A date or north: one undo step. The slider is one step per drag, as the other sliders. */
  const set = (next: Parameters<typeof write>[0]) => ed.change(() => write(next));
  return (
    <section
      className="plan-links__sun"
      aria-label={t('board.plan.links.sun')}
      data-tour="plan-sun"
    >
      <span className="plan-props__cap">{t('board.plan.links.sun')}</span>
      <div className="plan-range">
        <div className="plan-range__head">
          <span className="plan-prop__label">{t('board.plan.links.timeOfDay')}</span>
          <span className="plan-chip">{clock(time)}</span>
        </div>
        <Slider
          className="plan-range__slider"
          aria-label={t('board.plan.links.timeOfDay')}
          aria-valuetext={clock(time)}
          min={0}
          max={1439}
          step={15}
          value={time}
          meaning={{ gradient: DAY_TRACK, thumbColor: 'var(--ink-tag-orange)' }}
          onPointerDown={() => ed.store.undo.stopCapturing()}
          onPointerUp={() => ed.store.undo.stopCapturing()}
          onChange={(v) => write({ time: v })}
        />
      </div>
      <div className="plan-props__grid">
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the control is the child. */}
        <label className="plan-prop">
          <span className="plan-prop__label">{t('board.plan.links.date')}</span>
          {picking ? (
            // The shooting days of the plan's scenes, as the schedule numbers them (0119).
            <Select
              aria-label={t('board.plan.links.date')}
              value={linked?.id ?? ''}
              onChange={(v) => {
                if (v === 'other') setOtherDate(true);
                else {
                  const day = days.find((d) => d.id === v);
                  set({ date: day?.date, day: day?.id });
                }
              }}
              options={[
                { value: '', label: t('board.plan.links.today') },
                ...days.map((d) => ({
                  value: d.id,
                  label: t('board.plan.links.shootDay', { n: d.n }),
                  description: new Date(`${d.date}T12:00:00`).toLocaleDateString(i18n.language, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  }),
                })),
                { value: 'other', label: t('board.plan.links.otherDate') },
              ]}
            />
          ) : (
            <input
              className="plan-field"
              type="date"
              value={date ?? ''}
              onChange={(e) => set({ date: e.target.value || undefined, day: undefined })}
            />
          )}
        </label>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the control is the child. */}
        <label className="plan-prop">
          <span className="plan-prop__label">{t('board.plan.links.north')}</span>
          <NumberField
            value={north}
            min={0}
            max={359}
            unit="°"
            lead={t(`board.plan.links.northWay.${northWay(north)}`)}
            label={t('board.plan.links.north')}
            onCommit={(v) => set({ north: ((Math.round(v) % 360) + 360) % 360 })}
          />
        </label>
      </div>
      {dayGone && (
        <p className="plan-props__hint" role="status">
          {t('board.plan.links.dayGone')}
        </p>
      )}
      <div className="plan-props__card plan-links__card">
        <span className="plan-links__sunglyph" aria-hidden="true">
          <PlanGlyph kind="sun" size={30} />
        </span>
        <span className="plan-props__name">
          <b>{height ? `${from}, ${t(`board.plan.links.height.${height}`)}` : from}</b>
          <small>
            {position
              ? t('board.plan.links.sunFromPlace', {
                  place: location?.name ?? '',
                  degrees: position.elevation.toLocaleString(i18n.language),
                })
              : t('board.plan.links.sunByClock')}
          </small>
        </span>
      </div>
    </section>
  );
}

/**
 * Keeps each plan's sun on the shooting day it follows (decision 0119). The schedule is not in
 * the board document, so the plan stores the day's date too: when someone who can read the
 * schedule has the plan open and the day has moved, the stored date and the sun icons' direction
 * follow it in one write, synced as any edit but no step of anyone's undo (REPAIR). Guests,
 * exports and cards read the repaired date; a deleted day leaves the last date it had.
 */
export function useSunDayRepair(ed: Ed) {
  const days = useScheduleDays(ed.boardId);
  const { doc, family, plan, base, cards } = ed;
  useEffect(() => {
    if (!days) return;
    const all = sunDays(days, new Set());
    const owner = base ?? plan;
    const location = cards.get(owner.locationId ?? '') as Location | undefined;
    const coords =
      location?.type === 'location'
        ? locationCoords([location.mapUrl, location.address].filter(Boolean).join(' '))
        : null;
    for (const p of family?.length ? family : [plan]) {
      const sun = p.sun;
      const day = sun?.day ? all.find((d) => d.id === sun.day) : undefined;
      if (!sun || !day || day.date === sun.date) continue;
      const at = coords ? sunPosition(day.date, sun.time, coords.lat, coords.lng) : null;
      const rotation = sunRotation(at?.azimuth ?? sunBearingByClock(sun.time), owner.north ?? 0);
      const turned = (p.icons ?? [])
        .filter((i) => catalogueKind(i.kind) === 'sun' && i.rotation !== rotation)
        .map((i) => ({ ...i, rotation }));
      doc.transact(() => {
        updateElement(doc, p.id, { sun: { ...sun, date: day.date } }, REPAIR);
        if (turned.length) updatePlanItems(doc, p.id, turned, REPAIR);
      }, REPAIR);
    }
  }, [days, doc, family, plan, base, cards]);
}

/** "Scene 2 · INT · Night" (decision 0104): a scene of the plan, read from its card. */
export function sceneChipText(
  s: { number: string; setting?: string | undefined; time?: string | undefined },
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  return [
    t('board.plan.links.scene', { number: s.number || '—' }),
    s.setting && t(`board.plan.links.settings.${s.setting}`),
    s.time && t(`board.plan.links.times.${s.time}`),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The scenes of a plan in the editor's top bar, read-only; each opens its scene. */
export function SceneChips({ ed, onOpen }: { ed: Ed; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const scenes = linkedScenes({ sceneIds: sceneIdsOf(ed) }, ed.cards);
  if (scenes.length === 0) return null;
  return (
    <span className="plan-links__scenes" data-tour="plan-scene-chip">
      {scenes.map((s) => (
        <button
          key={s.id}
          type="button"
          className="plan-links__scene"
          title={t('board.plan.openScene', { number: s.number })}
          onClick={() => onOpen(s.id)}
        >
          {sceneChipText(s, t)}
        </button>
      ))}
    </span>
  );
}
