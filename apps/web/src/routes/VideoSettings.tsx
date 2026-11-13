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
import { Checkbox, ChoiceTile, Icon } from '@inkadra/ui';
import { useCallback, useEffect, useState } from 'react';
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
  return { view, setView, error, save };
}

/** Settings → Server → Video (decision 0128). */
export function VideoSettings() {
  const { t, i18n } = useTranslation();
  const { view, error, save } = useVideoSettings();
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
  const chosen = VIDEO_RUNGS.filter((r) => settings.rungs[r] !== 'off');
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
  const setRung = (rung: VideoRung, on: boolean) => {
    const next = { ...settings.rungs, [rung]: on ? 'stored' : 'off' } as const;
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
                {hardware ? t('videoSettings.encoder.hardware') : t('videoSettings.encoder.cpuOnly')}
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
                onChange={(e) => setRung(r, e.currentTarget.checked)}
              />
            }
            label={<span id={`video-rung-${r}`}>{t(`videoSettings.rungs.${r}`)}</span>}
            help={t(`videoSettings.rungs.${r}Help`)}
          >
            <span className="settings-value num">
              {t('videoSettings.mbPerMinuteAbout', {
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
                  <span className="video-examples__src">{t(`videoSettings.examples.${e.key}`)}</span>
                  <span className="video-examples__size">
                    {t('videoSettings.examples.copies', { original: size(e.mb), copies: size(copies) })}
                  </span>
                  <span className={plus > 100 ? 'video-examples__plus is-over' : 'video-examples__plus'}>
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
