import {
  ladderFor,
  rungMbPerMinute,
  type UpdateVideoSettings,
  VIDEO_AUDIO_KBPS,
  VIDEO_RUNGS,
  VIDEO_TARGET_KBPS,
  type VideoQuality,
  type VideoRung,
  type VideoSettingsView,
} from '@inkadra/shared';
import {
  Button,
  Checkbox,
  ChoiceTile,
  Dialog,
  DialogActions,
  Icon,
  Select,
  Switch,
} from '@inkadra/ui';
import { type ReactNode, useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { trackSave } from './settings-save.ts';
import { Badge, Card, Row, Segmented, Summary, Tile } from './settings-ui.tsx';
import './video-settings.css';

const QUALITIES: VideoQuality[] = ['light', 'balanced', 'high'];

/** Megabytes a minute of `rung` above 30 fps: the video part grows by 40 %. */
const fastMbPerMinute = (quality: VideoQuality, rung: VideoRung) =>
  ((VIDEO_TARGET_KBPS[quality][rung] * 1.4 + VIDEO_AUDIO_KBPS) * 60) / 8 / 1000;

/** Megabytes a minute of the copies of a source of shorter side `side` (decision 0128). */
export function copiesMbPerMinute(
  quality: VideoQuality,
  rungs: VideoRung[],
  side = 2160,
  fast = false,
) {
  return ladderFor(rungs, side).reduce(
    (sum, r) => sum + (fast ? fastMbPerMinute(quality, r) : rungMbPerMinute(quality, r)),
    0,
  );
}

/** Megabytes the copies of the whole library would take with these choices. */
export function libraryMb(view: VideoSettingsView, quality: VideoQuality, rungs: VideoRung[]) {
  return view.library.reduce((sum, row) => {
    const side = Number(row.side);
    const slow = row.minutes - row.fastMinutes;
    return (
      sum +
      slow * copiesMbPerMinute(quality, rungs, side) +
      row.fastMinutes * copiesMbPerMinute(quality, rungs, side, true)
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
  const running = view?.backfill?.status === 'running';
  // While a regeneration runs, its progress comes back every few seconds.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      api
        .get<VideoSettingsView>('/instance/video-settings')
        .then(setView)
        .catch(() => {});
    }, 5000);
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
  const after = libraryMb(view, view.settings.quality, chosen) * 1e6;
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
                void act(() =>
                  api.post<VideoSettingsView>('/instance/video-settings/reprocess', { scope }),
                )
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
 * "Riproduzione al volo" (decision 0128): rungs encoded while someone watches, right after an
 * upload and for those not kept on disk, within limits of sessions at once.
 */
function LiveCard({
  view,
  save,
  lock,
}: {
  view: VideoSettingsView;
  save: (patch: UpdateVideoSettings) => Promise<void>;
  lock: (name: string) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { live } = view.settings;
  const maxId = useId();
  const perId = useId();
  const status = view.liveStatus;
  // Only on a GPU fast enough (decision 0128): otherwise the reason, and no switch.
  if (!status?.available)
    return (
      <Card
        anchor="video.live"
        tour="video-live"
        title={t('videoSettings.live.title')}
        body={t('videoSettings.live.body')}
      >
        <Row
          leading={<Tile icon="play" tone="neutral" />}
          label={t('videoSettings.live.unavailable')}
          help={t(`videoSettings.live.reasons.${status?.reason ?? 'no-gpu'}`)}
        >
          <Badge>{t('videoSettings.live.off')}</Badge>
        </Row>
      </Card>
    );
  const measured =
    status.speed !== null && !status.locked
      ? t('videoSettings.live.measured', {
          count: status.sessions,
          speed: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(
            status.speed,
          ),
        })
      : null;
  const off = () => {
    // Rungs offered only live would be offered nowhere: they are kept on disk instead.
    const rungs = Object.fromEntries(
      VIDEO_RUNGS.map((r) => [
        r,
        view.settings.rungs[r] === 'live' ? 'stored' : view.settings.rungs[r],
      ]),
    ) as UpdateVideoSettings['rungs'];
    void save({ live: { enabled: false }, rungs });
  };
  return (
    <Card
      anchor="video.live"
      tour="video-live"
      title={t('videoSettings.live.title')}
      body={t('videoSettings.live.body')}
      action={view.locked.live && lock('VIDEO_LIVE')}
    >
      <Row
        leading={<Tile icon="play" tone="teal" />}
        label={<span id="video-live-label">{t('videoSettings.live.enabled')}</span>}
        help={t('videoSettings.live.enabledHelp')}
      >
        <Switch
          checked={live.enabled}
          disabled={view.locked.live}
          aria-labelledby="video-live-label"
          onChange={(e) =>
            e.currentTarget.checked ? void save({ live: { enabled: true } }) : off()
          }
        />
      </Row>
      {live.enabled && (
        <>
          <Row
            label={t('videoSettings.live.maxSessions')}
            help={
              <>
                {t('videoSettings.live.maxSessionsHelp')}
                {measured && <> {measured}</>}
              </>
            }
            htmlFor={maxId}
          >
            <Select
              id={maxId}
              className="ink-input space-limit__unit"
              value={String(live.maxSessions)}
              disabled={status.locked}
              onChange={(v) => void save({ live: { maxSessions: Number(v) } })}
            >
              {/* Never more than measured: the admin can only lower it. */}
              {Array.from({ length: status.sessions }, (_, i) => i + 1).map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </Select>
          </Row>
          <Row
            label={t('videoSettings.live.perViewer')}
            help={t('videoSettings.live.perViewerHelp')}
            htmlFor={perId}
          >
            <Select
              id={perId}
              className="ink-input space-limit__unit"
              value={String(live.perViewer)}
              onChange={(v) => void save({ live: { perViewer: Number(v) } })}
            >
              {[1, 2, 3, 4]
                .filter((n) => n <= live.maxSessions)
                .map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
            </Select>
          </Row>
        </>
      )}
    </Card>
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
  // Space counts only the rungs kept on disk: live ones take none.
  const chosen = VIDEO_RUNGS.filter((r) => settings.rungs[r] === 'stored');
  const perMinute = copiesMbPerMinute(settings.quality, chosen);
  const all = libraryMb(view, settings.quality, chosen);
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
                {number(copiesMbPerMinute(q, chosen))}{' '}
                <small>{t('videoSettings.mbPerMinute')}</small>
              </span>
              <span className="video-preset__hour num">
                {t('videoSettings.gbPerHour', {
                  size: number((copiesMbPerMinute(q, chosen) * 60) / 1000, 1),
                })}
              </span>
            </ChoiceTile>
          ))}
        </div>
      </Card>

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
            {settings.live.enabled && settings.rungs[r] !== 'off' && (
              <Segmented
                label={t('videoSettings.live.modeLabel', { rung: t(`videoSettings.rungs.${r}`) })}
                name={`video-rung-mode-${r}`}
                value={settings.rungs[r] === 'live' ? 'live' : 'stored'}
                disabled={locked.rungs}
                options={(['stored', 'live'] as const).map((value) => ({
                  value,
                  label: t(`videoSettings.live.modes.${value}`),
                }))}
                onChange={(mode) => setRung(r, mode)}
              />
            )}
            <span className="settings-value num">
              {settings.rungs[r] === 'live'
                ? t('videoSettings.live.noSpace')
                : t('videoSettings.mbPerMinuteAbout', {
                    size: number(rungMbPerMinute(settings.quality, r), r === '2160' ? 0 : 1),
                  })}
            </span>
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
        </div>
      </Card>
      <p className="video-note">{t('videoSettings.rungs.note')}</p>

      <Card anchor="video.playable" title={t('videoSettings.examples.title')}>
        <div className="settings-card__pad">
          <ul className="video-examples num">
            {EXAMPLES.map((e) => {
              const copies = copiesMbPerMinute(settings.quality, chosen, e.side);
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

      <LiveCard view={view} save={save} lock={lock} />

      <ExistingVideos view={view} setView={setView} number={number} />

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
