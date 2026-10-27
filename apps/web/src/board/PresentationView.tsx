// SPDX-License-Identifier: AGPL-3.0-only
import { type FrameElement, frameLabels, storyboardOf } from '@inkadra/canvas-core';
import { SHOT_MOVEMENTS, SHOT_SIZES } from '@inkadra/doc-schema';
import { Avatar, Button, Icon, IconButton, KeyCap } from '@inkadra/ui';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Animatic } from './film/Animatic.tsx';
import { useBoardAspect } from './film/aspect.ts';
import { FramePicture } from './film/FramePicture.tsx';
import { usePresetText } from './film/fields.tsx';
import type { Peer } from './presence.ts';
import './presentation.css';
import type { BoardStore } from './store.ts';

export interface SlideItem {
  id: string;
  type: 'frame' | 'card';
  title?: string;
  sceneHeading?: string;
  location?: string;
  label: string;
  action?: string;
  specs?: {
    shot?: string;
    lens?: string;
    movement?: string;
    duration?: string;
    audio?: string;
  };
  notes?: string;
  frame?: FrameElement;
}

/** Formats elapsed seconds as mm:ss */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function PresentationView({
  store,
  boardTitle,
  projectTitle,
  peers = [],
  readOnly = false,
  onClose,
  onShareClient,
}: {
  store: BoardStore;
  boardTitle: string;
  projectTitle?: string;
  peers?: readonly Peer[];
  readOnly?: boolean;
  onClose: () => void;
  onShareClient?: () => void;
}) {
  const { t } = useTranslation();
  const boardAspect = useBoardAspect(store.doc);
  const getPreset = usePresetText();
  const [index, setIndex] = useState(0);
  const [showNotes, setShowNotes] = useState(true);
  const [playingAnimatic, setPlayingAnimatic] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  );
  const rootRef = useRef<HTMLElement>(null);

  // Timer for presentation elapsed time and wall-clock
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed((s) => s + 1);
      setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Subscribe to board store elements to build slide items
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { slides, frames, labels } = useMemo(() => {
    const elements = [...snap.byId.values()];
    const groups = storyboardOf(elements);
    const labelsMap = frameLabels(groups);
    const frameList: FrameElement[] = [];
    const list: SlideItem[] = [];

    for (const group of groups) {
      const scene = group.scene;
      const headingParts = [
        scene ? `SCENA ${scene.number}` : undefined,
        scene?.title ? scene.title.toUpperCase() : undefined,
        scene?.setting ? scene.setting.toUpperCase() : undefined,
        scene?.time ? scene.time.toUpperCase() : undefined,
      ].filter(Boolean);
      const sceneHeading = headingParts.join(' · ');

      for (const frame of group.frames) {
        frameList.push(frame);
        const label = labelsMap.get(frame.id) ?? frame.label ?? String(list.length + 1);
        list.push({
          id: frame.id,
          type: 'frame',
          label,
          sceneHeading: sceneHeading || undefined,
          location: scene?.location || frame.location,
          action: frame.action || frame.notes || '',
          specs: {
            shot: frame.shot ? getPreset('film.shots', SHOT_SIZES, frame.shot) : undefined,
            lens: frame.lens,
            movement: frame.movement
              ? getPreset('film.movements', SHOT_MOVEMENTS, frame.movement)
              : undefined,
            duration: frame.durationMs ? `${Math.round(frame.durationMs / 1000)} s` : undefined,
            audio: frame.audio
              ? frame.audio.toLowerCase().startsWith('audio')
                ? frame.audio
                : `Audio: ${frame.audio}`
              : undefined,
          },
          notes: frame.notes || scene?.synopsis || '',
          frame,
        });
      }
    }

    return { slides: list, frames: frameList, labels: labelsMap };
  }, [snap, getPreset]);

  const total = slides.length;
  const current = slides[index] ?? null;
  const nextSlide = slides[index + 1] ?? null;

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(total - 1, i + 1));
  }, [total]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Keyboard navigation: Escape to exit, Arrows/Space to step
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (playingAnimatic) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'Space') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goNext, goPrev, playingAnimatic]);

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      rootRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const progressPercent = total > 0 ? ((index + 1) / total) * 100 : 0;
  const firstWatcher = peers[0];

  return (
    <section ref={rootRef} className="present-view" aria-label={t('present.title', 'Presenta')}>
      <header className="present-header">
        <button type="button" className="present-header__btn" onClick={onClose}>
          <Icon name="arrow" size={14} style={{ transform: 'rotate(180deg)' }} />
          <span>{t('present.exit', 'Esci')}</span>
          <KeyCap>Esc</KeyCap>
        </button>
        <span className="present-header__sep">/</span>
        <span className="present-header__title">
          {projectTitle ? `${projectTitle} · ` : ''}
          {boardTitle}
        </span>
        <div className="present-header__spacer" />
        {firstWatcher && (
          <span className="present-header__watching">
            <Avatar name={firstWatcher.user.name} size={20} />
            <span className="present-header__dot" />
            <span>{`${firstWatcher.user.name} ${t('present.isWatching', 'sta guardando')}`}</span>
          </span>
        )}
        {onShareClient && (
          <button type="button" className="present-header__btn" onClick={onShareClient}>
            <Icon name="link" size={14} />
            <span>{t('present.clientLink', 'Link cliente')}</span>
          </button>
        )}
      </header>

      <div className="present-body">
        <main className="present-main">
          {current ? (
            <section
              className="present-stage"
              aria-label={t('present.slideAria', 'Slide {{current}} di {{total}}', {
                current: index + 1,
                total,
              })}
            >
              <div className="present-stage__meta">
                <span className="present-stage__heading">{current.sceneHeading}</span>
                {current.location && (
                  <span className="present-stage__location">{current.location}</span>
                )}
              </div>

              <div className="present-stage__canvas">
                {current.frame && (
                  <FramePicture
                    assetId={current.frame.assetId}
                    aspect={current.frame.aspect}
                    boardAspect={boardAspect}
                    strokes={current.frame.strokes}
                    shapes={current.frame.shapes}
                    referenceOpacity={current.frame.referenceOpacity}
                    pixels={1920}
                  />
                )}
              </div>

              <div className="present-stage__footer">
                <span className="present-stage__shot-label">{current.label}</span>
                <div className="present-stage__content">
                  {current.action && <p className="present-stage__action">{current.action}</p>}
                  {current.specs && (
                    <div className="present-stage__specs">
                      {current.specs.shot && <span>{current.specs.shot}</span>}
                      {current.specs.lens && <span>{current.specs.lens}</span>}
                      {current.specs.movement && <span>{current.specs.movement}</span>}
                      {current.specs.duration && <span>{current.specs.duration}</span>}
                      {current.specs.audio && <span>{current.specs.audio}</span>}
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : (
            <div className="present-empty">
              <Icon name="frame" size={48} />
              <h2>{t('present.noSlides', 'Nessuna inquadratura o scheda da presentare')}</h2>
              <Button onClick={onClose}>{t('present.exit', 'Esci')}</Button>
            </div>
          )}

          <footer className="present-bottom">
            {total > 1 && (
              <nav className="present-strip" aria-label={t('present.slides', 'Slide')}>
                {slides.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`present-thumb${i === index ? ' is-active' : ''}`}
                    aria-label={`Slide ${i + 1} · ${s.label}`}
                    aria-current={i === index ? 'true' : undefined}
                    onClick={() => setIndex(i)}
                  >
                    <span className="present-thumb__pic">
                      {s.frame && (
                        <FramePicture
                          assetId={s.frame.assetId}
                          aspect={s.frame.aspect}
                          boardAspect={boardAspect}
                          strokes={s.frame.strokes}
                          shapes={s.frame.shapes}
                          referenceOpacity={s.frame.referenceOpacity}
                          pixels={200}
                        />
                      )}
                    </span>
                    <span className="present-thumb__name">
                      {i + 1} · {s.label}
                    </span>
                  </button>
                ))}
              </nav>
            )}

            <div className="present-progress">
              <div className="present-progress__bar" style={{ width: `${progressPercent}%` }} />
            </div>

            <div
              role="toolbar"
              className="present-toolbar"
              aria-label={t('present.toolbar', 'Controlli presentazione')}
            >
              <IconButton
                icon="chevronRight"
                style={{ transform: 'rotate(180deg)' }}
                label={t('present.prev', 'Slide precedente')}
                disabled={index <= 0}
                onClick={goPrev}
              />
              <span className="present-toolbar__count">
                {total > 0 ? `${index + 1} / ${total}` : '0 / 0'}
              </span>
              <IconButton
                icon="chevronRight"
                label={t('present.next', 'Slide successiva')}
                disabled={index >= total - 1}
                onClick={goNext}
              />
              <span className="present-toolbar__hint">
                <KeyCap>←</KeyCap>
                <KeyCap>→</KeyCap>
                <span>{t('present.keysHint', 'per cambiare slide')}</span>
              </span>

              <div style={{ flex: 1 }} />

              {frames.length > 0 && (
                <button
                  type="button"
                  className="present-toolbar__btn"
                  onClick={() => setPlayingAnimatic(true)}
                >
                  <Icon name="play" size={14} />
                  <span>{t('present.playAnimatic', 'Riproduci animatic')}</span>
                </button>
              )}

              <button
                type="button"
                className={`present-toolbar__btn${showNotes ? ' is-active' : ''}`}
                aria-pressed={showNotes}
                onClick={() => setShowNotes((v) => !v)}
              >
                <span>{t('present.speakerNotes', 'Note del relatore')}</span>
              </button>

              <IconButton
                icon="fit"
                label={t('present.fullscreen', 'Schermo intero')}
                onClick={toggleFullscreen}
              />
            </div>
          </footer>
        </main>

        {showNotes && (
          <aside
            className="present-sidebar"
            aria-label={t('present.speakerNotes', 'Note del relatore')}
          >
            <div className="present-sidebar__head">
              <span className="present-sidebar__title">
                {t('present.speakerNotes', 'Note del relatore')}
              </span>
              <IconButton
                icon="close"
                label={t('present.closeNotes', 'Comprimi pannello')}
                onClick={() => setShowNotes(false)}
              />
            </div>

            <div className="present-sidebar__timer-box">
              <div>
                <span className="present-sidebar__label">{t('present.timer', 'Tempo')}</span>
                <span className="present-sidebar__clock">{formatElapsed(elapsed)}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="present-sidebar__label">{t('present.clock', 'Ora')}</span>
                <span style={{ fontSize: 13, color: '#71717a' }}>{clock}</span>
              </div>
            </div>

            <div className="present-sidebar__notes">
              <span className="present-sidebar__label">
                Slide {index + 1} · {current?.label}
              </span>
              {current?.notes ? (
                <p style={{ margin: 0 }}>{current.notes}</p>
              ) : (
                <p style={{ margin: 0, color: '#71717a', fontStyle: 'italic' }}>
                  {t('present.noNotes', 'Nessuna nota per questa slide')}
                </p>
              )}
            </div>

            {nextSlide && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span className="present-sidebar__label">
                  {t('present.nextSlide', 'Prossima')} · {nextSlide.label}
                </span>
                <div className="present-sidebar__preview-pic">
                  {nextSlide.frame && (
                    <FramePicture
                      assetId={nextSlide.frame.assetId}
                      aspect={nextSlide.frame.aspect}
                      boardAspect={boardAspect}
                      strokes={nextSlide.frame.strokes}
                      shapes={nextSlide.frame.shapes}
                      referenceOpacity={nextSlide.frame.referenceOpacity}
                      pixels={300}
                    />
                  )}
                </div>
                {nextSlide.specs?.shot && (
                  <span style={{ fontSize: 12, color: '#71717a' }}>
                    {nextSlide.specs.shot}
                    {nextSlide.specs.lens ? ` · ${nextSlide.specs.lens}` : ''}
                  </span>
                )}
              </div>
            )}

            <div style={{ flex: 1 }} />

            <div className="present-sidebar__spectators">
              <span className="present-sidebar__label">
                {t('present.spectators', 'Spettatori')} · {peers.length}
              </span>
              {peers.map((p) => (
                <div key={p.user.id} className="present-sidebar__spec-row">
                  <Avatar name={p.user.name} size={20} />
                  <span>{p.user.name}</span>
                  <span className="present-sidebar__spec-status">
                    {`${t('present.spectatorOn', 'sulla slide')} ${index + 1}`}
                  </span>
                </div>
              ))}
              <span className="present-sidebar__notice">
                {t('present.notesPrivate', 'Gli ospiti vedono solo le slide, mai queste note.')}
              </span>
            </div>
          </aside>
        )}
      </div>

      {playingAnimatic && (
        <Animatic
          store={store}
          frames={frames}
          labels={labels}
          boardAspect={boardAspect}
          readOnly={readOnly}
          present
          onClose={() => setPlayingAnimatic(false)}
        />
      )}
    </section>
  );
}
