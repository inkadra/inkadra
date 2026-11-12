import type { SceneGroup } from '@inkadra/canvas-core';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  type DialogHandle,
  Icon,
  kindStyle,
  Select,
} from '@inkadra/ui';
import { type DragEvent, useId, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useIsPhone } from '../../../lib/phone.ts';
import { Check, Field, Segmented } from '../../export/fields.tsx';
import { readScreenplay, SCRIPT_EXTENSIONS } from './parse.ts';
import {
  castName,
  defaultOptions,
  FRAME_CAPS,
  type FrameCap,
  type FramesMode,
  type ImportOptions,
  type ImportPlan,
  planImport,
  sceneNumbers,
} from './plan.ts';
import { RevisionList } from './RevisionList.tsx';
import {
  type MatchOverrides,
  matchRevision,
  type RevisionOptions,
  type RevisionRow,
  revisionCounts,
} from './revision.ts';
import { type Script, ScriptError } from './script.ts';
import './screenplay.css';

/** `revise` lays a new draft over the storyboard's scenes (decision 0082). */
export type ImportTarget = 'append' | 'revise' | 'new';

/** What an update from a revision writes, for the caller to apply. */
export interface RevisionChoice {
  rows: RevisionRow[];
  options: RevisionOptions;
  /** Name of the version saved first, or null. */
  version: string | null;
}

/** "Draft 3" from the title page, else the file name without its extension. */
export function draftName(script: Script, fileName: string): string {
  const page = script.titlePage;
  const named = page.draft || page.revision || page['draft date'];
  return (named?.split('\n')[0]?.trim() || fileName.replace(/\.[^.]+$/, '')).slice(0, 100);
}
const TARGET_LABELS: Record<ImportTarget, string> = {
  append: 'screenplay.targetAppend',
  revise: 'screenplay.targetRevise',
  new: 'screenplay.targetNew',
};
const fold = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Pick or drop a Fountain or Final Draft file, check what was read, choose how many frames,
 * import. The file never leaves the browser; the caller writes the plan.
 */
export function ScreenplayImportDialog({
  targets,
  initialFile,
  confirmLabel,
  storyboard,
  scenesOnly = false,
  onImport,
  onClose,
}: {
  /** `append` and `revise` work on the open storyboard; more than one offers the choice. */
  targets: readonly ImportTarget[];
  initialFile?: { name: string; script: Script };
  confirmLabel?: string;
  /** The open storyboard, for `revise`: its title and its scenes with their frames. */
  storyboard?: { title: string; groups: readonly SceneGroup[] };
  /** Scenes without frames, as cards of an ordinary board: Storyboard is off (decision 0121). */
  scenesOnly?: boolean;
  onImport: (
    plan: ImportPlan,
    target: ImportTarget,
    revision?: RevisionChoice,
  ) => void | Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const [file, setFile] = useState<{ name: string; script: Script } | null>(initialFile ?? null);
  const optionsFor = (script: Script): ImportOptions =>
    scenesOnly ? { ...defaultOptions(script), frames: 'none' } : defaultOptions(script);
  const [options, setOptions] = useState<ImportOptions | null>(
    initialFile ? optionsFor(initialFile.script) : null,
  );
  // A draft whose title is the storyboard's is most likely a revision of it.
  const targetFor = (script: Script | undefined): ImportTarget =>
    targets.includes('revise') &&
    script?.title &&
    storyboard &&
    fold(castName(script.title)) === fold(storyboard.title)
      ? 'revise'
      : (targets[0] ?? 'new');
  const [target, setTarget] = useState<ImportTarget>(() => targetFor(initialFile?.script));
  const [overrides, setOverrides] = useState<MatchOverrides>(new Map());
  const [revise, setRevise] = useState<RevisionOptions & { version: boolean }>({
    details: true,
    omit: true,
    version: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<DialogHandle>(null);
  const listId = useId();
  const count = (key: string, n: number) => t(`screenplay.${key}`, { count: n });
  const plan = useMemo(
    () =>
      file && options
        ? planImport(
            file.script,
            options,
            (names) => t('screenplay.charactersLine', { names: names.join(', ') }),
            t('screenplay.prelude'),
          )
        : null,
    [file, options, t],
  );
  const numbers = useMemo(() => (file ? sceneNumbers(file.script.scenes) : []), [file]);
  // Frames each listed scene would get, for the counts beside them.
  const perScene = useMemo(() => {
    if (!file || !options) return [];
    const all = { ...options, scenes: new Set(file.script.scenes.map((_, i) => i)) };
    return planImport(file.script, all, () => '').scenes.map((s) => s.frames.length);
  }, [file, options]);
  const scenes = useMemo(
    () => storyboard?.groups.flatMap((g) => (g.scene ? [g.scene] : [])) ?? [],
    [storyboard],
  );
  // A revision covers every scene of the draft. Its fields are compared as a frame-per-scene
  // import writes them, so the characters line of a frameless import is no change.
  const revision = useMemo(() => {
    if (target !== 'revise' || !file || !options) return null;
    const all = { ...options, scenes: new Set(file.script.scenes.map((_, i) => i)), cast: true };
    const line = (names: string[]) => t('screenplay.charactersLine', { names: names.join(', ') });
    const plan = planImport(file.script, all, line, t('screenplay.prelude'));
    const fields = planImport(
      file.script,
      { ...all, frames: 'one' },
      line,
      t('screenplay.prelude'),
    );
    plan.scenes = plan.scenes.map((s, i) => ({ ...fields.scenes[i], frames: s.frames }));
    plan.characters = [];
    return { plan, rows: matchRevision(plan.scenes, scenes, overrides) };
  }, [target, file, options, scenes, overrides, t]);
  const counts = revision ? revisionCounts(revision.rows, revision.plan.scenes, revise) : null;
  const draft = file ? draftName(file.script, file.name) : '';

  async function read(picked: File | undefined) {
    if (!picked) return;
    setError(null);
    setBusy(true);
    try {
      const script = await readScreenplay(picked);
      setFile({ name: picked.name, script });
      setOptions(optionsFor(script));
      setOverrides(new Map());
      setTarget(targetFor(script));
    } catch (e) {
      setError(t(`screenplay.errors.${e instanceof ScriptError ? e.code : 'read'}`));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const nothing = revision
    ? !counts || counts.updated + counts.added + counts.omitted === 0
    : !plan || plan.scenes.length === 0;
  async function submit() {
    if (nothing || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (revision)
        await onImport(revision.plan, 'revise', {
          rows: revision.rows,
          options: { details: revise.details, omit: revise.omit },
          version: revise.version
            ? t('screenplay.revision.versionName', { draft }).slice(0, 120)
            : null,
        });
      else if (plan) await onImport(plan, target);
      onClose();
    } catch {
      setError(t('screenplay.failed'));
      setBusy(false);
    }
  }

  const set = <K extends keyof ImportOptions>(key: K, value: ImportOptions[K]) =>
    setOptions((o) => (o ? { ...o, [key]: value } : o));
  const toggle = (i: number, on: boolean) =>
    setOptions((o) => {
      if (!o) return o;
      const scenes = new Set(o.scenes);
      if (on) scenes.add(i);
      else scenes.delete(i);
      return { ...o, scenes };
    });
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void read(e.dataTransfer.files[0]);
  };

  const intoHint =
    target === 'revise'
      ? t(phone ? 'screenplay.revision.hintShort' : 'screenplay.revision.hint', {
          title: storyboard?.title ?? '',
        })
      : undefined;
  const script = file?.script;
  const chosen = options?.scenes.size ?? 0;
  const total = script?.scenes.length ?? 0;
  return (
    <div className="phone-sheet">
      <Dialog
        ref={dialog}
        open
        // A file that is read but not imported yet: the choices made on it would be lost.
        dirty={!!file && !busy}
        title={t('screenplay.title')}
        onClose={onClose}
      >
        <input
          ref={input}
          type="file"
          hidden
          accept={SCRIPT_EXTENSIONS.join(',')}
          aria-label={t('screenplay.choose')}
          onChange={(e) => void read(e.target.files?.[0])}
        />
        {!script || !options ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: dropping a file is a shortcut for the button inside
          <div
            className={`script-import__drop${over ? ' is-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <span className="script-import__tile" style={kindStyle('storyboard')} aria-hidden>
              <Icon name="storyboard" size={20} />
            </span>
            <p className="script-import__drop-title">{t('screenplay.drop')}</p>
            <Button icon="upload" disabled={busy} onClick={() => input.current?.click()}>
              {t('screenplay.choose')}
            </Button>
            <p className="export__hint">
              {busy ? t('screenplay.reading') : t('screenplay.formats')}
            </p>
            {error && (
              <div className="script-import__error" role="alert">
                <Icon name="warning" size={18} />
                <div>
                  <strong>{error}</strong>
                  {error === t('screenplay.errors.noText') && <p>{t('screenplay.noTextDetail')}</p>}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="script-import">
            <header className="script-import__head">
              <div className="script-import__file">
                <strong className="script-import__name">
                  {/* An update names the draft it brings: "The Long Night · Draft 3". */}
                  {[script.title, revision && draft !== file.name.replace(/\.[^.]+$/, '') && draft]
                    .filter(Boolean)
                    .join(' · ') || file.name}
                </strong>
                <span className="export__hint">
                  {[
                    script.titlePage.author &&
                      t('screenplay.by', { author: script.titlePage.author }),
                    count('scenes', total),
                    count('characters', script.characters.length),
                    script.title ? file.name : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <Button variant="ghost" disabled={busy} onClick={() => input.current?.click()}>
                {t('screenplay.another')}
              </Button>
            </header>
            {targets.length > 1 &&
              (phone ? (
                <div>
                  <Field label={t('screenplay.target')}>
                    {(id) => (
                      <Select
                        id={id}
                        className="ink-input"
                        value={target}
                        onChange={(v) => setTarget(v as ImportTarget)}
                      >
                        {targets.map((v) => (
                          <option key={v} value={v}>
                            {t(TARGET_LABELS[v])}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  {intoHint && <p className="export__hint">{intoHint}</p>}
                </div>
              ) : (
                <Segmented
                  label={t('screenplay.target')}
                  hideLabel={false}
                  value={target}
                  options={targets.map((v) => [v, t(TARGET_LABELS[v])])}
                  onChange={(v) => setTarget(v as ImportTarget)}
                  hint={intoHint}
                />
              ))}
            {!revision && script.characters.length > 0 && (
              <ul
                className="script-import__cast"
                aria-label={count('characters', script.characters.length)}
              >
                {script.characters.map((c) => (
                  <li key={c} className="script-import__chip">
                    {castName(c)}
                  </li>
                ))}
              </ul>
            )}
            {revision ? (
              <div className="script-import__body">
                <RevisionList
                  key={file.name}
                  rows={revision.rows}
                  draft={revision.plan.scenes}
                  script={script}
                  groups={storyboard?.groups ?? []}
                  draftName={draft}
                  omit={revise.omit}
                  phone={phone}
                  onPick={(d, id) => setOverrides((o) => new Map(o).set(d, id))}
                />
                {/* The phone sheet keeps the defaults (PhoneRevision mockup). */}
                {!phone && (
                  <div className="script-import__options">
                    <Segmented
                      label={t('screenplay.revision.frames')}
                      hideLabel={false}
                      value={options.frames}
                      options={[
                        ['none', t('screenplay.framesNone')],
                        ['one', t('screenplay.framesOne')],
                        ['action', t('screenplay.revision.framesAction')],
                      ]}
                      onChange={(v) => set('frames', v as FramesMode)}
                    />
                    <Check
                      checked={revise.details}
                      onChange={(v) => setRevise((r) => ({ ...r, details: v }))}
                      hint={t('screenplay.revision.detailsHint')}
                    >
                      {t('screenplay.revision.details')}
                    </Check>
                    <Check
                      checked={revise.omit}
                      onChange={(v) => setRevise((r) => ({ ...r, omit: v }))}
                      hint={t('screenplay.revision.omitHint')}
                    >
                      {t('screenplay.revision.omit')}
                    </Check>
                    <Check
                      checked={revise.version}
                      onChange={(v) => setRevise((r) => ({ ...r, version: v }))}
                      hint={t('screenplay.revision.versionHint', {
                        name: t('screenplay.revision.versionName', { draft }),
                      })}
                    >
                      {t('screenplay.revision.version')}
                    </Check>
                  </div>
                )}
              </div>
            ) : (
              <div className="script-import__body">
                <fieldset className="script-import__scenes" aria-describedby={listId}>
                  <legend className="export__label">{t('screenplay.sceneList')}</legend>
                  <label className="script-import__row script-import__row--all">
                    <Checkbox
                      checked={chosen === total}
                      ref={(el) => {
                        if (el) el.indeterminate = chosen > 0 && chosen < total;
                      }}
                      onChange={(e) =>
                        set(
                          'scenes',
                          new Set(e.target.checked ? script.scenes.map((_, i) => i) : []),
                        )
                      }
                    />
                    <span className="script-import__heading">{t('screenplay.all')}</span>
                    <span className="script-import__count">{count('scenes', chosen)}</span>
                  </label>
                  <ul className="script-import__list" data-scroll>
                    {script.scenes.map((scene, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: scenes have no identity but their order
                      <li key={i}>
                        <label className="script-import__row">
                          <Checkbox
                            checked={options.scenes.has(i)}
                            onChange={(e) => toggle(i, e.target.checked)}
                          />
                          <span className="script-import__number">{numbers[i] ?? '–'}</span>
                          <span className="script-import__heading">
                            {scene.prelude
                              ? t('screenplay.prelude')
                              : scene.heading.toLocaleUpperCase() || t('screenplay.noHeading')}
                          </span>
                          {options.frames !== 'none' && (
                            <span className="script-import__count">
                              {count('framesCount', perScene[i] ?? 0)}
                            </span>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
                <div className="script-import__options">
                  {!scenesOnly && (
                  <Segmented
                    label={t('screenplay.frames')}
                    value={options.frames}
                    options={[
                      ['none', t('screenplay.framesNone')],
                      ['one', t('screenplay.framesOne')],
                      ['action', t('screenplay.framesAction')],
                    ]}
                    onChange={(v) => set('frames', v as FramesMode)}
                    hint={t(`screenplay.framesHint.${options.frames}`)}
                  />
                  )}
                  {options.frames === 'action' && (
                    <Field label={t('screenplay.maxFrames')}>
                      {(id) => (
                        <Select
                          id={id}
                          className="ink-input script-import__cap"
                          value={options.maxFrames}
                          onChange={(e) => set('maxFrames', Number(e) as FrameCap)}
                        >
                          {FRAME_CAPS.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  )}
                  {options.frames !== 'none' && (
                    <Check
                      checked={options.cast}
                      onChange={(v) => set('cast', v)}
                      hint={t('screenplay.castHint')}
                    >
                      {t('screenplay.cast')}
                    </Check>
                  )}
                  {script.characters.length > 0 && (
                    <Check
                      checked={options.characterCards}
                      onChange={(v) => set('characterCards', v)}
                      hint={t('screenplay.characterCardsHint')}
                    >
                      {t('screenplay.characterCards')}
                    </Check>
                  )}
                </div>
              </div>
            )}
            {revision && counts ? (
              <p id={listId} className="script-import__summary script-rev__summary" role="status">
                <Trans
                  i18nKey={
                    phone ? 'screenplay.revision.summaryPhone' : 'screenplay.revision.summary'
                  }
                  values={{
                    updated: t('screenplay.revision.updated', { count: counts.updated }),
                    added: t('screenplay.revision.added', { count: counts.added }),
                    frames: t('screenplay.framesCount', { count: counts.frames }),
                    omitted: t('screenplay.revision.omitted', { count: counts.omitted }),
                    kept: t('screenplay.framesCount', {
                      count: (storyboard?.groups ?? []).reduce((n, g) => n + g.frames.length, 0),
                    }),
                  }}
                  components={{ b: <b /> }}
                />
              </p>
            ) : (
              plan && (
                <p id={listId} className="script-import__summary" role="status">
                  {t(plan.truncated ? 'screenplay.truncated' : 'screenplay.summary', {
                    scenes: count('scenes', plan.scenes.length),
                    frames: count('framesCount', plan.frameCount),
                  })}
                </p>
              )
            )}
          </div>
        )}
        {file && error && (
          <p className="export__hint export__hint--error" role="alert">
            {error}
          </p>
        )}
        <DialogActions>
          <Button variant="ghost" onClick={() => dialog.current?.requestClose()}>
            {t('screenplay.cancel')}
          </Button>
          <Button variant="primary" disabled={nothing} busy={busy} onClick={() => void submit()}>
            {revision ? t('screenplay.revision.submit') : (confirmLabel ?? t('screenplay.submit'))}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
