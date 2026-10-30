import { Button, Checkbox, Dialog, DialogActions, Icon, kindStyle, Select } from '@inkadra/ui';
import { type DragEvent, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { type Script, ScriptError } from './script.ts';
import './screenplay.css';

export type ImportTarget = 'append' | 'new';

/**
 * Pick or drop a Fountain or Final Draft file, check what was read, choose how many frames,
 * import. The file never leaves the browser; the caller writes the plan.
 */
export function ScreenplayImportDialog({
  targets,
  confirmLabel,
  onImport,
  onClose,
}: {
  /** `append` adds to the open storyboard; both offer the choice. */
  targets: readonly ImportTarget[];
  confirmLabel?: string;
  onImport: (plan: ImportPlan, target: ImportTarget) => void | Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [file, setFile] = useState<{ name: string; script: Script } | null>(null);
  const [options, setOptions] = useState<ImportOptions | null>(null);
  const [target, setTarget] = useState<ImportTarget>(targets[0] ?? 'new');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
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

  async function read(picked: File | undefined) {
    if (!picked) return;
    setError(null);
    setBusy(true);
    try {
      const script = await readScreenplay(picked);
      setFile({ name: picked.name, script });
      setOptions(defaultOptions(script));
    } catch (e) {
      setError(t(`screenplay.errors.${e instanceof ScriptError ? e.code : 'read'}`));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function submit() {
    if (!plan || plan.scenes.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onImport(plan, target);
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

  const script = file?.script;
  const chosen = options?.scenes.size ?? 0;
  const total = script?.scenes.length ?? 0;
  return (
    <div className="phone-sheet">
      <Dialog open title={t('screenplay.title')} onClose={onClose}>
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
          </div>
        ) : (
          <div className="script-import">
            <header className="script-import__head">
              <div className="script-import__file">
                <strong className="script-import__name">{script.title || file.name}</strong>
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
            {script.characters.length > 0 && (
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
                      set('scenes', new Set(e.target.checked ? script.scenes.map((_, i) => i) : []))
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
                {targets.length > 1 && (
                  <Segmented
                    label={t('screenplay.target')}
                    value={target}
                    options={targets.map((v) => [
                      v,
                      t(v === 'append' ? 'screenplay.targetAppend' : 'screenplay.targetNew'),
                    ])}
                    onChange={(v) => setTarget(v as ImportTarget)}
                  />
                )}
              </div>
            </div>
            {plan && (
              <p id={listId} className="script-import__summary" role="status">
                {t(plan.truncated ? 'screenplay.truncated' : 'screenplay.summary', {
                  scenes: count('scenes', plan.scenes.length),
                  frames: count('framesCount', plan.frameCount),
                })}
              </p>
            )}
          </div>
        )}
        {error && (
          <p className="export__hint export__hint--error" role="alert">
            {error}
          </p>
        )}
        <DialogActions>
          <Button variant="ghost" onClick={onClose}>
            {t('screenplay.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!plan || plan.scenes.length === 0 || busy}
            aria-busy={busy || undefined}
            onClick={() => void submit()}
          >
            {confirmLabel ?? t('screenplay.submit')}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
