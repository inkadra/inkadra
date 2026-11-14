import {
  ladderFor,
  type UpdateVideoSettings,
  VIDEO_AUDIO_KBPS,
  VIDEO_BITRATE_MAX,
  VIDEO_BITRATE_MIN,
  VIDEO_LIVE_SESSIONS_MAX,
  VIDEO_QUALITY_MAX,
  VIDEO_RUNGS,
  VIDEO_TARGET_KBPS,
  type VideoQuality,
  type VideoRung,
  type VideoRungCustom,
  type VideoSettingsView,
} from '@inkadra/shared';
import { Button, Checkbox, ChoiceTile, Dialog, DialogActions, Icon, Switch } from '@inkadra/ui';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { refetchVideosWithoutCopy } from '../board/assets.ts';
import { api } from '../lib/api.ts';
import { trackSave } from './settings-save.ts';
import { Badge, Card, Row, Segmented, Summary, Tile } from './settings-ui.tsx';
import './video-settings.css';

const QUALITIES: VideoQuality[] = ['light', 'balanced', 'high'];

type Custom = VideoSettingsView['settings']['custom'];

/** Target kbit/s of a rung: the admin's when set (Advanced), else the preset's. */
const targetKbps = (quality: VideoQuality, rung: VideoRung, custom?: Custom) =>
  custom?.[rung]?.target !== undefined
    ? (custom[rung]?.target as number) / 1000
    : VIDEO_TARGET_KBPS[quality][rung];

/** Megabytes a minute of `rung`, up to 30 fps or above (the video part grows by 40 %). */
const mbPerMinute = (quality: VideoQuality, rung: VideoRung, fast = false, custom?: Custom) =>
  ((targetKbps(quality, rung, custom) * (fast ? 1.4 : 1) + VIDEO_AUDIO_KBPS) * 60) / 8 / 1000;

/** Megabytes a minute of the copies of a source of shorter side `side` (decision 0128). */
export function copiesMbPerMinute(
  quality: VideoQuality,
  rungs: VideoRung[],
  side = 2160,
  fast = false,
  custom?: Custom,
) {
  return ladderFor(rungs, side).reduce((sum, r) => sum + mbPerMinute(quality, r, fast, custom), 0);
}

/**
 * Megabytes the copies of the whole library would take with these choices: `rungs` are kept
 * for every video, `liveRungs` (set to live only) also for the videos this server cannot
 * encode live.
 */
export function libraryMb(
  view: VideoSettingsView,
  quality: VideoQuality,
  rungs: VideoRung[],
  custom?: Custom,
  liveRungs: VideoRung[] = [],
) {
  const stored = [...rungs, ...liveRungs];
  const mb = (on: VideoRung[], side: number, minutes: number, fast: number) =>
    (minutes - fast) * copiesMbPerMinute(quality, on, side, false, custom) +
    fast * copiesMbPerMinute(quality, on, side, true, custom);
  return view.library.reduce((sum, row) => {
    const side = Number(row.side);
    const noLive = row.noLiveMinutes ?? 0;
    const noLiveFast = row.noLiveFastMinutes ?? 0;
    return (
      sum +
      mb(rungs, side, row.minutes - noLive, row.fastMinutes - noLiveFast) +
      mb(stored, side, noLive, noLiveFast)
    );
  }, 0);
}

/** One minute of these originals, and what its copies add (the examples of the page). */
const EXAMPLES: Array<{ key: string; mb: number; side: number }> = [
  { key: 'prores', mb: 5530, side: 2160 },
  { key: 'mirrorless', mb: 750, side: 2160 },
  { key: 'iphone4k', mb: 170, side: 2160 },
  { key: 'iphoneHd', mb: 60, side: 1080 },
];

const BACKENDS: Record<NonNullable<VideoSettingsView['encoder']>['backend'], string> = {
  qsv: 'Intel Quick Sync',
  nvenc: 'NVIDIA NVENC',
  vaapi: 'VAAPI',
  software: '',
};

export function useVideoSettings() {
  const [view, setView] = useState<VideoSettingsView | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .get<VideoSettingsView>('/instance/video-settings')
      .then((data) => alive && setView(data))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);
  const save = useCallback(async (patch: UpdateVideoSettings) => {
    try {
      setView(await trackSave(api.patch<VideoSettingsView>('/instance/video-settings', patch)));
    } catch {
      setError(true);
    }
  }, []);
  const running = view?.backfill?.status === 'running' || view?.benchmark?.running === true;
  // While a regeneration runs, its progress comes back every few seconds.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      api
        .get<VideoSettingsView>('/instance/video-settings')
        .then(setView)
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [running]);
  return { view, setView, error, save };
}

/** Seconds of video a minute of encoding makes, by encoder, before any copy measured it. */
const DEFAULT_SPEED = { qsv: 3.5, nvenc: 8, vaapi: 3, software: 0.6 } as const;

/** Hours a regeneration of the whole library takes with these choices. */
export function regenerationHours(view: VideoSettingsView, rungs: VideoRung[]) {
  const concurrency = view.encoder?.concurrency ?? 1;
  const minutes = view.library.reduce((sum, row) => sum + row.minutes, 0);
  if (view.speed) {
    // Measured per rung: each rung of each video costs its own share.
    const rungMinutes = view.library.reduce(
      (sum, row) => sum + row.minutes * ladderFor(rungs, Number(row.side)).length,
      0,
    );
    return (rungMinutes * 60) / view.speed / 3600 / concurrency;
  }
  const speed = DEFAULT_SPEED[view.encoder?.backend ?? 'software'];
  return (minutes * 60) / speed / 3600 / concurrency;
}

/** "Video esistenti": regenerate the copies made otherwise, with the estimate first. */
function ExistingVideos({
  view,
  setView,
  number,
}: {
  view: VideoSettingsView;
  setView: (view: VideoSettingsView) => void;
  number: (n: number, digits?: number) => string;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const [scope, setScope] = useState<'outdated' | 'missing'>('outdated');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const chosen = VIDEO_RUNGS.filter((r) => view.settings.rungs[r] === 'stored');
  const liveOnly = VIDEO_RUNGS.filter((r) => view.settings.rungs[r] === 'live');
  const after =
    libraryMb(view, view.settings.quality, chosen, view.settings.custom, liveOnly) * 1e6;
  const growth = Math.max(0, after - view.copiesBytes);
  const room = view.freeBytes === null || growth < view.freeBytes;
  const hours = Math.max(1, Math.round(regenerationHours(view, chosen)));
  const run = view.backfill?.status === 'running' ? view.backfill : null;
  const act = async (call: () => Promise<VideoSettingsView>) => {
    setBusy(true);
    setFailed(false);
    try {
      setView(await call());
      setAsking(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const gb = (bytes: number) => number(bytes / 1e9);
  return (
    <Card anchor="video.existing" tour="video-existing" title={t('videoSettings.existing.title')}>
      <Row
        className="settings-row--stack"
        leading={<Tile icon="repeat" tone="accent" />}
        label={
          view.outdated > 0
            ? t('videoSettings.existing.outdated', { count: view.outdated })
            : t('videoSettings.existing.upToDate')
        }
        help={
          room
            ? t('videoSettings.existing.help')
            : t('videoSettings.existing.noRoom', { size: `${gb(growth)} GB` })
        }
      >
        {!run && (
          <Button
            variant="secondary"
            disabled={!view.enabled || view.outdated === 0 || !room}
            onClick={() => setAsking(true)}
          >
            {t('videoSettings.existing.regenerate')}
          </Button>
        )}
      </Row>
      {run ? (
        <div className="settings-card__pad video-run">
          <div className="video-run__line">
            <span role="status">
              <b className="num">
                {t('videoSettings.existing.progress', {
                  done: number(run.done),
                  total: number(run.total),
                })}
              </b>
              {view.queue.processing > 0 &&
                ` · ${t('videoSettings.existing.running', { count: view.queue.processing })}`}
            </span>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void act(() => api.delete<VideoSettingsView>('/instance/video-settings/reprocess'))
              }
            >
              {t('videoSettings.existing.stop')}
            </Button>
          </div>
          <div
            className="video-meter"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={run.total}
            aria-valuenow={run.done}
            aria-label={t('videoSettings.existing.meter')}
          >
            <i
              style={{ width: `${run.total ? Math.min(100, (run.done / run.total) * 100) : 0}%` }}
            />
          </div>
          <div className="video-run__line">
            <span>{t('videoSettings.existing.first')}</span>
          </div>
        </div>
      ) : (
        <div className="settings-card__pad">
          <dl className="video-totals num">
            <div>
              <dt>{t('videoSettings.existing.space')}</dt>
              <dd>
                {gb(view.copiesBytes)} <small>{t('videoSettings.existing.toAbout')}</small>{' '}
                {gb(after)} <small>GB</small>
              </dd>
            </div>
            <div>
              <dt>{t('videoSettings.existing.time')}</dt>
              <dd>
                {t('videoSettings.about')} {number(hours)}{' '}
                <small>{t('videoSettings.existing.hours', { count: hours })}</small>
              </dd>
            </div>
            {view.freeBytes !== null && (
              <div>
                <dt>{t('videoSettings.existing.free')}</dt>
                <dd>
                  {gb(view.freeBytes)} <small>GB</small>
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
      {failed && (
        <p className="settings-card__pad" role="alert">
          {t('auth.errors.generic')}
        </p>
      )}
      <Dialog
        open={asking}
        title={t('videoSettings.existing.dialogTitle')}
        onClose={() => setAsking(false)}
      >
        <div className="settings-form">
          <p>{t('videoSettings.existing.dialogBody')}</p>
          <Segmented
            label={t('videoSettings.existing.scope')}
            name="video-backfill-scope"
            value={scope}
            options={(['outdated', 'missing'] as const).map((value) => ({
              value,
              label: t(`videoSettings.existing.scopes.${value}`),
            }))}
            onChange={setScope}
          />
          <DialogActions>
            <Button disabled={busy} onClick={() => setAsking(false)}>
              {t('project.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const next = await api.post<VideoSettingsView>(
                    '/instance/video-settings/reprocess',
                    { scope },
                  );
                  // Cards of this tab still hold the videos without copies as they were.
                  refetchVideosWithoutCopy();
                  return next;
                })
              }
            >
              {t('videoSettings.existing.start')}
            </Button>
          </DialogActions>
        </div>
      </Dialog>
    </Card>
  );
}

/**
 * "Riproduzione al volo" (decision 0128, mockup v2): rungs the graphics card encodes while
 * someone watches, right after an upload and for those not kept on disk.
 */
function LiveCard({
  view,
  save,
  lock,
  number,
}: {
  view: VideoSettingsView;
  save: (patch: UpdateVideoSettings) => Promise<void>;
  lock: (name: string) => ReactNode;
  number: (n: number, digits?: number) => string;
}) {
  const { t } = useTranslation();
  const { live, rungs, quality, custom } = view.settings;
  const status = view.liveStatus;
  const available = status?.available === true;
  const on = available && live.enabled && live.maxSessions > 0;
  const chosen = VIDEO_RUNGS.filter((r) => rungs[r] !== 'off');
  const off = () => {
    // Rungs offered only live would be offered nowhere: they are kept on disk instead.
    const next = Object.fromEntries(
      VIDEO_RUNGS.map((r) => [r, rungs[r] === 'live' ? 'stored' : rungs[r]]),
    ) as UpdateVideoSettings['rungs'];
    void save({ live: { enabled: false }, rungs: next });
  };
  const help = !available
    ? t(`videoSettings.live.reasons.${status?.reason ?? 'no-gpu'}`)
    : live.maxSessions === 0
      ? t('videoSettings.live.zero')
      : t('videoSettings.live.upTo', { count: live.maxSessions });
  return (
    <Card
      anchor="video.live"
      tour="video-live"
      title={t('videoSettings.live.title')}
      body={t('videoSettings.live.body')}
      action={
        <>
          {view.locked.live && lock('VIDEO_LIVE')}
          <Badge tone={!available ? 'warn' : on ? 'ok' : 'neutral'}>
            {!available
              ? t('videoSettings.live.unavailable')
              : on
                ? t('videoSettings.live.on')
                : t('videoSettings.live.off')}
          </Badge>
        </>
      }
    >
      <Row
        className="settings-row--stack"
        leading={<Tile icon="play" tone="purple" />}
        label={<span id="video-live-label">{t('videoSettings.live.enabled')}</span>}
        help={<span id="video-live-help">{help}</span>}
      >
        <Switch
          checked={available && live.enabled}
          disabled={!available || view.locked.live}
          aria-labelledby="video-live-label"
          aria-describedby="video-live-help"
          onChange={(e) =>
            e.currentTarget.checked ? void save({ live: { enabled: true } }) : off()
          }
        />
      </Row>
      {on && (
        <div className="settings-card__pad video-live__rungs">
          <p className="settings-row__help">{t('videoSettings.live.rungsHelp')}</p>
          {chosen.map((r) => (
            <Row
              key={r}
              className="video-live__rung"
              label={<span id={`video-live-${r}`}>{t(`videoSettings.rungs.${r}`)}</span>}
              help={
                rungs[r] === 'live'
                  ? t('videoSettings.live.noSpace')
                  : t('videoSettings.live.onDisk', {
                      size: number(mbPerMinute(quality, r, false, custom), r === '2160' ? 0 : 1),
                    })
              }
            >
              <Segmented
                label={t('videoSettings.live.modeLabel', { rung: t(`videoSettings.rungs.${r}`) })}
                name={`video-rung-mode-${r}`}
                value={rungs[r] === 'live' ? 'live' : 'stored'}
                disabled={view.locked.rungs}
                options={(['stored', 'live'] as const).map((value) => ({
                  value,
                  label: t(`videoSettings.live.modes.${value}`),
                }))}
                onChange={(mode) => void save({ rungs: { ...rungs, [r]: mode } })}
              />
            </Row>
          ))}
        </div>
      )}
      <div className="settings-card__pad">
        <p className="settings-row__help video-live__never">{t('videoSettings.live.never')}</p>
      </div>
    </Card>
  );
}

type RungField = 'target' | 'peak' | 'quality';
const KBIT_MIN = VIDEO_BITRATE_MIN / 1000;
const KBIT_MAX = VIDEO_BITRATE_MAX / 1000;

/** The problems of one row of the table, as the server would find them (decision 0128). */
export function rungProblems(target: number, peak: number, quality: number) {
  const out: Partial<Record<RungField, 'range' | 'belowTarget' | 'quality'>> = {};
  const inRange = (n: number) => Number.isFinite(n) && n >= KBIT_MIN && n <= KBIT_MAX;
  if (!inRange(target)) out.target = 'range';
  if (!inRange(peak)) out.peak = 'range';
  else if (inRange(target) && peak < target) out.peak = 'belowTarget';
  if (!(Number.isInteger(quality) && quality >= 0 && quality <= VIDEO_QUALITY_MAX))
    out.quality = 'quality';
  return out;
}

/** One rung of "Bitrate e qualità per risoluzione": kbit/s and the encoder's quality value. */
function RungValues({
  rung,
  chosen,
  preset,
  own,
  qualityLabel,
  onSave,
}: {
  rung: VideoRung;
  chosen: boolean;
  preset: { target: number; peak: number; quality: number };
  own: VideoRungCustom | undefined;
  qualityLabel: string;
  onSave: (value: VideoRungCustom | null) => void;
}) {
  const { t } = useTranslation();
  const value = {
    target: (own?.target ?? preset.target) / 1000,
    peak: (own?.peak ?? preset.peak) / 1000,
    quality: own?.quality ?? preset.quality,
  };
  const [draft, setDraft] = useState(() => ({
    target: String(value.target),
    peak: String(value.peak),
    quality: String(value.quality),
  }));
  const key = `${value.target}/${value.peak}/${value.quality}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new saved value resets the fields
  useEffect(() => {
    setDraft({
      target: String(value.target),
      peak: String(value.peak),
      quality: String(value.quality),
    });
  }, [key]);
  const read = (s: string) => (s.trim() === '' ? Number.NaN : Number(s.replace(',', '.')));
  const n = { target: read(draft.target), peak: read(draft.peak), quality: read(draft.quality) };
  const problems = rungProblems(n.target, n.peak, n.quality);
  const commit = () => {
    if (Object.keys(problems).length > 0) return;
    if (n.target === value.target && n.peak === value.peak && n.quality === value.quality) return;
    // Only what differs from the preset is kept: the rest follows the preset.
    const next: VideoRungCustom = {};
    const target = Math.round(n.target * 1000);
    const peak = Math.round(n.peak * 1000);
    if (target !== preset.target) next.target = target;
    if (peak !== preset.peak) next.peak = peak;
    if (n.quality !== preset.quality) next.quality = n.quality;
    onSave(Object.keys(next).length > 0 ? next : null);
  };
  const changed = own !== undefined && Object.keys(own).length > 0;
  const name = t(`videoSettings.rungs.${rung}`);
  const cell = (field: RungField, label: string, unit?: string) => {
    const problem = problems[field];
    const errorId = `video-rung-${rung}-${field}-error`;
    return (
      <td data-l={label}>
        <span className="video-rtable__field">
          <input
            className="ink-input"
            type="number"
            inputMode="numeric"
            step={1}
            value={draft[field]}
            aria-label={`${label} ${name}`}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? errorId : undefined}
            onChange={(e) => {
              const text = e.currentTarget.value;
              setDraft((d) => ({ ...d, [field]: text }));
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
            }}
          />
          {unit && <span className="video-rtable__unit">{unit}</span>}
        </span>
        {problem && (
          <span id={errorId} className="video-rtable__error">
            {t(`videoSettings.advanced.errors.${problem}`)}
          </span>
        )}
      </td>
    );
  };
  return (
    <tr className={chosen ? undefined : 'is-off'}>
      <td className="video-rtable__rung">
        {name}
        {changed && <Badge tone="accent">{t('videoSettings.advanced.custom')}</Badge>}
        {!chosen && (
          <span className="settings-row__help"> {t('videoSettings.advanced.notChosen')}</span>
        )}
      </td>
      {cell('target', t('videoSettings.advanced.target'), 'kbit/s')}
      {cell('peak', t('videoSettings.advanced.peak'), 'kbit/s')}
      {cell('quality', qualityLabel)}
      <td>
        {changed && (
          <button type="button" className="video-link" onClick={() => onSave(null)}>
            {t('videoSettings.advanced.reset')}
          </button>
        )}
      </td>
    </tr>
  );
}

/** The live sessions of Avanzate: 0 (off) to 16, over the measurement with a warning. */
function SessionsField({
  view,
  patch,
}: {
  view: VideoSettingsView;
  patch: (body: UpdateVideoSettings) => Promise<void>;
}) {
  const { t } = useTranslation();
  const status = view.liveStatus;
  const measured = status?.measured ?? null;
  const sessions = view.settings.live.maxSessions;
  const [draft, setDraft] = useState(String(sessions));
  useEffect(() => setDraft(String(sessions)), [sessions]);
  const commit = () => {
    const n = Math.round(Number(draft));
    if (draft.trim() === '' || !Number.isFinite(n)) return setDraft(String(sessions));
    const next = Math.max(0, Math.min(VIDEO_LIVE_SESSIONS_MAX, n));
    setDraft(String(next));
    if (next === sessions) return;
    void patch({ live: { maxSessions: next === measured ? null : next } });
  };
  return (
    <Card title={t('videoSettings.advanced.sessions')}>
      <Row
        className="settings-row--stack"
        label={t('videoSettings.advanced.sessionsLabel')}
        help={t('videoSettings.advanced.sessionsHelp', {
          measured: measured ?? '–',
          max: VIDEO_LIVE_SESSIONS_MAX,
        })}
        htmlFor="video-sessions"
      >
        <input
          id="video-sessions"
          className="ink-input video-advanced__number"
          type="number"
          inputMode="numeric"
          min={0}
          max={VIDEO_LIVE_SESSIONS_MAX}
          step={1}
          value={draft}
          disabled={status?.locked}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
        {status?.locked ? (
          <span className="space-chip">
            <Icon name="lock" size={12} />
            <code>VIDEO_LIVE_MAX_SESSIONS</code>
          </span>
        ) : (
          measured !== null &&
          sessions !== measured && (
            <button
              type="button"
              className="video-link"
              onClick={() => void patch({ live: { maxSessions: null } })}
            >
              {t('videoSettings.advanced.reset')}
            </button>
          )
        )}
      </Row>
      {measured !== null && sessions > measured && (
        <div className="settings-card__pad">
          <p className="video-advanced__warn" role="status">
            <Icon name="warning" size={14} />
            <span>{t('videoSettings.advanced.overMeasured')}</span>
          </p>
        </div>
      )}
    </Card>
  );
}

/** About how long the performance test takes (decision 0128): five seconds of 1080p and the setup. */
const BENCHMARK_MS = 10_000;

/**
 * "Avanzate" (decision 0128, mockup v2), collapsed by default, for expert admins: the
 * performance test again, live sessions over or under the measurement, and the target, peak
 * and quality value of each rung over the preset. No ffmpeg arguments and no backend choice:
 * VIDEO_PROXY_HWACCEL forces one.
 */
function AdvancedCard({
  view,
  setView,
}: {
  view: VideoSettingsView;
  setView: (view: VideoSettingsView) => void;
}) {
  const { t, i18n } = useTranslation();
  const [problem, setProblem] = useState<string | null>(null);
  const { settings } = view;
  const status = view.liveStatus;
  const gpu = view.encoder !== null && view.encoder.backend !== 'software';
  const presets = view.presetValues?.[settings.quality];
  const param = view.qualityParam ?? 'crf';
  const qualityName =
    param === 'crf'
      ? 'crf'
      : param === 'cq'
        ? 'cq'
        : view.encoder?.backend === 'vaapi'
          ? 'vaapi'
          : 'qsv';
  const qualityLabel = param === 'global_quality' ? 'global_quality' : param.toUpperCase();
  const running = view.benchmark?.running === true;
  // "Misurato adesso" once a test asked from this page has ended.
  const [fresh, setFresh] = useState(false);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) setFresh(true);
    wasRunning.current = running;
  }, [running]);
  const patch = async (body: UpdateVideoSettings) => {
    setProblem(null);
    try {
      setView(await trackSave(api.patch<VideoSettingsView>('/instance/video-settings', body)));
    } catch (err) {
      // The server checks every value: its reason is shown under the table.
      setProblem(err instanceof Error && err.message ? err.message : t('auth.errors.generic'));
    }
  };
  const benchmark = async () => {
    setProblem(null);
    try {
      setView(await api.post<VideoSettingsView>('/instance/video-settings/benchmark', {}));
    } catch (err) {
      setProblem(err instanceof Error && err.message ? err.message : t('auth.errors.generic'));
    }
  };
  const measured = status?.measured ?? null;
  const customised =
    Object.keys(settings.custom ?? {}).length > 0 ||
    (measured !== null && !status?.locked && settings.live.maxSessions !== measured);
  const elapsed = view.benchmark?.startedAt
    ? Date.now() - new Date(view.benchmark.startedAt).getTime()
    : 0;
  const percent = Math.max(5, Math.min(95, Math.round((elapsed / BENCHMARK_MS) * 100)));
  const benchTitle = !gpu
    ? t('videoSettings.advanced.noGpu')
    : running
      ? t('videoSettings.advanced.benchmarkRunning')
      : measured === null
        ? t('videoSettings.advanced.neverMeasured')
        : t(
            fresh ? 'videoSettings.advanced.measuredNow' : 'videoSettings.advanced.measuredAtStart',
            {
              count: measured,
            },
          );
  const benchHelp = !gpu
    ? t('videoSettings.advanced.noGpuHelp')
    : running
      ? t('videoSettings.advanced.benchmarkRunningHelp')
      : status?.speed && status.measuredAt
        ? t('videoSettings.advanced.speedAt', {
            speed: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(
              status.speed,
            ),
            time: new Date(status.measuredAt).toLocaleString(i18n.language, {
              dateStyle: 'short',
              timeStyle: 'short',
            }),
          })
        : null;
  return (
    <section
      className="settings-block video-advanced"
      aria-label={t('videoSettings.advanced.title')}
      data-tour="video-advanced"
      data-setting="video.advanced"
    >
      <details className="settings-fold video-advanced__fold">
        <summary className="settings-row">
          <Tile icon="settings" />
          <span className="settings-row__text">
            <span className="settings-row__label">
              {t('videoSettings.advanced.title')}{' '}
              {customised && <Badge tone="accent">{t('videoSettings.advanced.customised')}</Badge>}
            </span>
          </span>
          <Icon name="chevronRight" size={14} className="settings-fold__chevron" />
        </summary>
        <div className="video-advanced__body">
          <p className="video-advanced__intro">{t('videoSettings.advanced.intro')}</p>

          <Card title={t('videoSettings.advanced.benchmark')}>
            <div className="settings-card__pad video-bench">
              <div className="video-bench__text">
                <span className="settings-row__label" aria-live="polite">
                  {benchTitle}
                </span>
                {benchHelp && <span className="settings-row__help num">{benchHelp}</span>}
              </div>
              <Button
                variant="secondary"
                disabled={!gpu || running || !view.enabled}
                onClick={() => void benchmark()}
              >
                {running
                  ? t('videoSettings.advanced.benchmarkBusy')
                  : t('videoSettings.advanced.rerun')}
              </Button>
              {running && (
                <div
                  className="video-meter video-bench__meter"
                  role="progressbar"
                  aria-label={t('videoSettings.advanced.benchmark')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                >
                  <i style={{ width: `${percent}%` }} />
                </div>
              )}
            </div>
          </Card>

          {gpu && status?.reason !== 'no-gpu' && <SessionsField view={view} patch={patch} />}

          {presets && (
            <Card
              title={t('videoSettings.advanced.rates')}
              body={`${t('videoSettings.advanced.ratesHelp')} ${t(
                'videoSettings.advanced.qualityHelp',
                {
                  name: t(`videoSettings.advanced.qualityNames.${qualityName}`),
                },
              )}`}
            >
              <div className="settings-card__pad">
                <table className="video-rtable">
                  <thead>
                    <tr>
                      <th scope="col">{t('videoSettings.advanced.rung')}</th>
                      <th scope="col">{t('videoSettings.advanced.target')}</th>
                      <th scope="col">{t('videoSettings.advanced.peak')}</th>
                      <th scope="col">{qualityLabel}</th>
                      <th scope="col">
                        <span className="ink-sr-only">{t('videoSettings.advanced.reset')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {VIDEO_RUNGS.map((rung) => (
                      <RungValues
                        key={rung}
                        rung={rung}
                        chosen={settings.rungs[rung] !== 'off'}
                        preset={presets[rung]}
                        own={settings.custom?.[rung]}
                        qualityLabel={qualityLabel}
                        onSave={(value) => void patch({ custom: { [rung]: value } })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {problem && (
            <p className="video-advanced__problem" role="alert">
              {problem}
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

/** Settings → Server → Video (decision 0128). */
export function VideoSettings() {
  const { t, i18n } = useTranslation();
  const { view, setView, error, save } = useVideoSettings();
  if (error) return <p role="alert">{t('auth.errors.generic')}</p>;
  if (!view) return null;
  const number = (n: number, digits = 0) =>
    new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  const size = (mb: number) =>
    mb >= 1000 ? `${number(mb / 1000, 1)} GB` : `${number(Math.round(mb))} MB`;
  const { settings, locked, encoder } = view;
  // Space counts the rungs kept on disk, and those set to live only for videos this server
  // cannot encode live (`liveOnly`, kept for them all the same).
  const liveOnly = VIDEO_RUNGS.filter((r) => settings.rungs[r] === 'live');
  const chosen = VIDEO_RUNGS.filter((r) => settings.rungs[r] !== 'off');
  const custom = settings.custom;
  const customised = Object.keys(custom ?? {}).length > 0;
  const perMinute = copiesMbPerMinute(settings.quality, chosen, 2160, false, custom);
  const all = libraryMb(
    view,
    settings.quality,
    VIDEO_RUNGS.filter((r) => settings.rungs[r] === 'stored'),
    custom,
    liveOnly,
  );
  const videos = view.library.reduce((sum, r) => sum + r.videos, 0);
  const minutes = Math.round(view.library.reduce((sum, r) => sum + r.minutes, 0));
  const hardware = encoder !== null && encoder.backend !== 'software';
  const lock = (name: string) => (
    <span className="space-chip">
      <Icon name="lock" size={12} />
      <code>{name}</code>
    </span>
  );
  const setRung = (rung: VideoRung, mode: 'stored' | 'live' | 'off') => {
    const next = { ...settings.rungs, [rung]: mode };
    // At least one resolution stays chosen.
    if (VIDEO_RUNGS.every((r) => next[r] === 'off')) return;
    void save({ rungs: next });
  };
  return (
    <div className="video-settings">
      <Summary
        tour="video-encoder"
        anchor="video.encoder"
        tone={!view.enabled ? 'warn' : hardware ? 'ok' : 'warn'}
        icon="film"
        title={
          !view.enabled || !encoder
            ? t('videoSettings.encoder.off')
            : hardware
              ? BACKENDS[encoder.backend]
              : t('videoSettings.encoder.cpu')
        }
        text={
          !view.enabled || !encoder
            ? t('videoSettings.encoder.offText')
            : hardware
              ? t('videoSettings.encoder.gpuText', { count: encoder.concurrency })
              : t('videoSettings.encoder.cpuText')
        }
        action={
          encoder && (
            <>
              <Badge tone={hardware ? 'ok' : 'warn'}>
                {hardware
                  ? t('videoSettings.encoder.hardware')
                  : t('videoSettings.encoder.cpuOnly')}
              </Badge>
              {encoder.av1 && <Badge tone="accent">{t('videoSettings.encoder.av1')}</Badge>}
            </>
          )
        }
      />

      <Card
        anchor="video.quality"
        tour="video-presets"
        title={t('videoSettings.quality.title')}
        body={t('videoSettings.quality.body')}
        action={locked.quality && lock('VIDEO_QUALITY')}
      >
        <div
          className="video-presets"
          role="radiogroup"
          aria-label={t('videoSettings.quality.title')}
        >
          {QUALITIES.map((q) => (
            <ChoiceTile
              key={q}
              variant="card"
              name="video-quality"
              value={q}
              checked={settings.quality === q}
              disabled={locked.quality}
              onChange={() => void save({ quality: q })}
            >
              <span className="video-preset__name">
                {t(`videoSettings.quality.${q}`)}
                {q === 'balanced' && <Badge>{t('videoSettings.quality.recommended')}</Badge>}
              </span>
              <span className="video-preset__desc">{t(`videoSettings.quality.${q}Help`)}</span>
              <span className="video-preset__size num">
                {number(
                  copiesMbPerMinute(
                    q,
                    chosen,
                    2160,
                    false,
                    q === settings.quality ? custom : undefined,
                  ),
                )}{' '}
                <small>{t('videoSettings.mbPerMinute')}</small>
              </span>
              <span className="video-preset__hour num">
                {t('videoSettings.gbPerHour', {
                  size: number(
                    (copiesMbPerMinute(
                      q,
                      chosen,
                      2160,
                      false,
                      q === settings.quality ? custom : undefined,
                    ) *
                      60) /
                      1000,
                    1,
                  ),
                })}
              </span>
            </ChoiceTile>
          ))}
        </div>
      </Card>
      {customised && (
        <p className="video-note video-custom-note">
          <Badge tone="accent">{t('videoSettings.advanced.customPreset')}</Badge>{' '}
          {t('videoSettings.advanced.customNote')}{' '}
          <button
            type="button"
            className="video-link"
            onClick={() =>
              void save({
                custom: Object.fromEntries(
                  VIDEO_RUNGS.map((r) => [r, null]),
                ) as UpdateVideoSettings['custom'],
              })
            }
          >
            {t('videoSettings.advanced.resetAll')}
          </button>
        </p>
      )}

      <Card
        anchor="video.renditions"
        title={t('videoSettings.rungs.title')}
        action={locked.rungs && lock('VIDEO_RENDITIONS')}
      >
        {VIDEO_RUNGS.map((r) => (
          <Row
            key={r}
            leading={
              <Checkbox
                checked={settings.rungs[r] !== 'off'}
                disabled={locked.rungs}
                aria-labelledby={`video-rung-${r}`}
                onChange={(e) => setRung(r, e.currentTarget.checked ? 'stored' : 'off')}
              />
            }
            label={<span id={`video-rung-${r}`}>{t(`videoSettings.rungs.${r}`)}</span>}
            help={t(`videoSettings.rungs.${r}Help`)}
          >
            {settings.rungs[r] === 'live' ? (
              <span className="live-tag">{t('videoSettings.live.onlyLive')}</span>
            ) : (
              <span className="settings-value num">
                {t('videoSettings.mbPerMinuteAbout', {
                  size: number(
                    mbPerMinute(settings.quality, r, false, custom),
                    r === '2160' ? 0 : 1,
                  ),
                })}
              </span>
            )}
          </Row>
        ))}
        <div className="settings-card__pad">
          <dl className="video-totals num" aria-live="polite">
            <div>
              <dt>{t('videoSettings.totals.minute')}</dt>
              <dd>
                {number(perMinute)} <small>MB</small>
              </dd>
            </div>
            <div>
              <dt>{t('videoSettings.totals.hour')}</dt>
              <dd>
                {number((perMinute * 60) / 1000, 1)} <small>GB</small>
              </dd>
            </div>
            <div>
              <dt>
                {t('videoSettings.totals.library', {
                  count: videos,
                  duration: t('videoSettings.totals.duration', {
                    hours: Math.floor(minutes / 60),
                    minutes: minutes % 60,
                  }),
                })}
              </dt>
              <dd>
                {t('videoSettings.about')} {number(all / 1000)} <small>GB</small>
              </dd>
            </div>
          </dl>
          {liveOnly.length > 0 && (
            <p className="settings-row__help">{t('videoSettings.totals.liveNote')}</p>
          )}
        </div>
      </Card>
      <p className="video-note">{t('videoSettings.rungs.note')}</p>

      <Card anchor="video.playable" title={t('videoSettings.examples.title')}>
        <div className="settings-card__pad">
          <ul className="video-examples num">
            {EXAMPLES.map((e) => {
              const copies = copiesMbPerMinute(settings.quality, chosen, e.side, false, custom);
              const plus = (copies / e.mb) * 100;
              return (
                <li key={e.key}>
                  <span className="video-examples__src">
                    {t(`videoSettings.examples.${e.key}`)}
                  </span>
                  <span className="video-examples__size">
                    {t('videoSettings.examples.copies', {
                      original: size(e.mb),
                      copies: size(copies),
                    })}
                  </span>
                  <span
                    className={plus > 100 ? 'video-examples__plus is-over' : 'video-examples__plus'}
                  >
                    +{number(plus, plus < 10 ? 1 : 0)}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <Row
          className="settings-row--stack"
          label={t('videoSettings.playable.label')}
          help={t('videoSettings.playable.help')}
        >
          <Segmented
            label={t('videoSettings.playable.label')}
            name="video-playable"
            value={settings.playable}
            options={(['heavy', 'always', 'never'] as const).map((value) => ({
              value,
              label: t(`videoSettings.playable.${value}`),
            }))}
            onChange={(playable) => void save({ playable })}
          />
        </Row>
      </Card>

      <ExistingVideos view={view} setView={setView} number={number} />

      <LiveCard view={view} save={save} lock={lock} number={number} />

      <AdvancedCard view={view} setView={setView} />

      <Card
        title={t('videoSettings.encoding.title')}
        action={
          <span className="space-chip">
            <Icon name="clock" size={12} />
            {t('videoSettings.encoding.detected')}
          </span>
        }
      >
        <Row
          className="settings-row--stack"
          leading={<Tile icon="settings" tone="purple" />}
          label={t('videoSettings.encoding.encoder')}
          help={encoder?.label ?? t('videoSettings.encoder.offText')}
        >
          {encoder && <code>VIDEO_PROXY_HWACCEL={encoder.requested}</code>}
        </Row>
        <Row
          className="settings-row--stack"
          leading={<Tile icon="film" />}
          label={t('videoSettings.encoding.format')}
          help={
            encoder?.av1
              ? `${t('videoSettings.encoding.h264')} ${t('videoSettings.encoding.av1')}`
              : t('videoSettings.encoding.h264')
          }
        >
          <Badge>H.264 · AAC</Badge>
        </Row>
      </Card>
    </div>
  );
}
