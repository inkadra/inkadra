import type { NewScene, SceneGroup } from '@inkadra/canvas-core';
import { Segmented, Select } from '@inkadra/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlugline } from '../storyboard-data.ts';
import type { RevisionRow, RevisionStatus } from './revision.ts';
import type { Script } from './script.ts';

export type RevisionFilter = 'changes' | 'changed' | 'new' | 'omitted' | 'all';
const FILTERS: readonly RevisionFilter[] = ['changes', 'changed', 'new', 'omitted', 'all'];
/** The phone keeps the three filters that matter (PhoneRevision mockup). */
const PHONE_FILTERS: readonly RevisionFilter[] = ['changes', 'new', 'omitted'];

const shown = (filter: RevisionFilter, status: RevisionStatus) =>
  filter === 'all' || (filter === 'changes' ? status !== 'same' : filter === status);

/**
 * The scenes of a new draft against the storyboard (decision 0081): what changed, what is new,
 * what the draft left out. An uncertain match offers the scenes it could be, or a new scene.
 */
export function RevisionList({
  rows,
  draft,
  script,
  groups,
  draftName,
  omit,
  phone,
  onPick,
}: {
  rows: readonly RevisionRow[];
  /** Planned scenes of the draft, by draft index. */
  draft: readonly NewScene[];
  script: Script;
  /** The storyboard's scenes with their frames. */
  groups: readonly SceneGroup[];
  draftName: string;
  /** Omitted scenes will be marked. */
  omit: boolean;
  phone: boolean;
  onPick: (draft: number, sceneId: string | null) => void;
}) {
  const { t } = useTranslation();
  const slugline = useSlugline();
  const pickId = useId();
  const [filter, setFilter] = useState<RevisionFilter>('changes');
  const byId = new Map(groups.flatMap((g) => (g.scene ? [[g.scene.id, g] as const] : [])));
  const count = (status: RevisionFilter) => rows.filter((r) => shown(status, r.status)).length;
  const same = rows.filter((r) => r.status === 'same');
  const sameFrames = same.reduce((n, r) => n + (byId.get(r.sceneId ?? '')?.frames.length ?? 0), 0);
  const visible = rows.filter((r) => shown(filter, r.status));
  // Scenes another row already has cannot be picked for this one.
  const taken = new Set(rows.flatMap((r) => (r.sceneId && r.draft !== null ? [r.sceneId] : [])));
  const [picking] = useState(() => new Set(rows.flatMap((r) => (r.uncertain ? [r.draft] : []))));

  const headingOf = (d: number) => {
    const scene = script.scenes[d];
    if (!scene) return '';
    return scene.prelude
      ? t('screenplay.prelude')
      : scene.heading.toLocaleUpperCase() || t('screenplay.noHeading');
  };
  const detail = (row: RevisionRow): string => {
    const old = byId.get(row.sceneId ?? '')?.scene;
    if (row.status === 'omitted')
      return [
        t('screenplay.revision.notIn', { draft: draftName }),
        t(omit ? 'screenplay.revision.markedOmitted' : 'screenplay.revision.keptAsIs'),
      ].join(' · ');
    if (row.status === 'new') {
      const before = row.after === null || row.after === undefined ? null : draft[row.after];
      const cast = script.scenes[row.draft ?? -1]?.characters ?? [];
      return [
        before
          ? t('screenplay.revision.after', { number: before.number ?? '' })
          : t('screenplay.revision.atStart'),
        cast.length ? cast.join(', ').toLocaleUpperCase() : null,
      ]
        .filter(Boolean)
        .join(' · ');
    }
    if (!old) return '';
    const c = new Set(row.changes);
    if (row.uncertain && c.has('number') && (c.has('location') || c.has('title')))
      return t('screenplay.revision.bothChanged');
    return (
      [
        row.restored && t('screenplay.revision.restored'),
        c.has('number') && t('screenplay.revision.wasScene', { number: old.number }),
        c.has('setting') &&
          t('screenplay.revision.was', {
            value: old.setting ? t(`film.scene.settings.${old.setting}`) : '—',
          }),
        c.has('location') &&
          t('screenplay.revision.locationWas', { location: old.location || old.title || '—' }),
        c.has('title') &&
          !c.has('location') &&
          t('screenplay.revision.titleWas', { title: old.title || '—' }),
        c.has('time') &&
          t('screenplay.revision.was', {
            value: old.time ? t(`film.scene.times.${old.time}`).toLocaleUpperCase() : '—',
          }),
        c.has('synopsis') && t('screenplay.revision.synopsis'),
      ]
        .filter(Boolean)
        .join(' · ')
        // "Was DAY · synopsis rewritten": only the first phrase starts with a capital.
        .replace(/^\p{Ll}/u, (ch) => ch.toLocaleUpperCase())
    );
  };
  const frames = (row: RevisionRow) =>
    row.status === 'new'
      ? t('screenplay.revision.newFrames', { count: draft[row.draft ?? -1]?.frames.length ?? 0 })
      : t('screenplay.revision.framesKept', {
          count: byId.get(row.sceneId ?? '')?.frames.length ?? 0,
        });

  return (
    <div className="script-rev">
      <Segmented
        label={t('screenplay.revision.show')}
        value={filter}
        className="script-rev__filter"
        onChange={setFilter}
        options={(phone ? PHONE_FILTERS : FILTERS).map((f) => ({
          value: f,
          label: (
            <>
              {t(`screenplay.revision.filters.${f}`)}{' '}
              <span className="script-rev__n">{count(f)}</span>
            </>
          ),
        }))}
      />
      <div className="script-rev__box">
        <ul className="script-rev__list" aria-label={t('screenplay.revision.list')} data-scroll>
          {visible.map((row) => {
            const old = byId.get(row.sceneId ?? '')?.scene;
            const kind = row.uncertain ? 'check' : row.status;
            const number =
              row.status === 'omitted'
                ? (old?.number ?? '')
                : (draft[row.draft ?? -1]?.number ?? '–');
            const heading =
              row.status === 'omitted' && old
                ? slugline(old) || old.title
                : headingOf(row.draft ?? -1);
            const d = row.draft;
            return (
              <li
                key={row.sceneId ?? `d${row.draft}`}
                className={`script-rev__row${row.status === 'omitted' ? ' is-omitted' : ''}`}
              >
                <span className={`script-rev__badge script-rev__badge--${kind}`}>
                  {t(`screenplay.revision.badges.${kind}`)}
                </span>
                <span className="script-rev__num">{number}</span>
                <span className="script-rev__heading">
                  <b>{heading}</b>
                  {detail(row) && <small>{detail(row)}</small>}
                  {d !== null && picking.has(d) && (
                    <span className="script-rev__pick">
                      <label className="export__hint" htmlFor={`${pickId}-${d}`}>
                        {t('screenplay.revision.sameAs')}
                      </label>
                      <Select
                        id={`${pickId}-${d}`}
                        className="ink-input"
                        value={row.sceneId ?? ''}
                        onChange={(v) => onPick(d, v || null)}
                      >
                        {groups.flatMap(({ scene }) =>
                          scene && (scene.id === row.sceneId || !taken.has(scene.id))
                            ? [
                                <option key={scene.id} value={scene.id}>
                                  {[scene.number, slugline(scene) || scene.title].join(' · ')}
                                </option>,
                              ]
                            : [],
                        )}
                        <option value="">{t('screenplay.revision.asNew')}</option>
                      </Select>
                    </span>
                  )}
                </span>
                <span className="script-import__count">{frames(row)}</span>
              </li>
            );
          })}
          {visible.length === 0 && (
            <li className="script-rev__empty">{t('screenplay.revision.nothing')}</li>
          )}
        </ul>
        {filter === 'changes' && same.length > 0 && (
          <p className="script-rev__more">
            <span className="script-rev__badge script-rev__badge--same">
              {t('screenplay.revision.badges.same')}
            </span>
            {t('screenplay.revision.unchanged', {
              count: same.length,
              frames: t('screenplay.framesCount', { count: sameFrames }),
            })}
          </p>
        )}
      </div>
    </div>
  );
}
