// SPDX-License-Identifier: AGPL-3.0-only
import type { FrameElement, SceneGroup } from '@inkadra/canvas-core';
import { SHOT_MOVEMENTS, SHOT_SIZES } from '@inkadra/doc-schema';
import { Button, Icon, IconButton, KeyCap } from '@inkadra/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBoardAspect } from './film/aspect.ts';
import { FramePicture } from './film/FramePicture.tsx';
import { usePresetText } from './film/fields.tsx';
import './presentation.css';
import { isTyping } from './shortcuts.ts';
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
  groups,
  labels,
  boardTitle,
  projectTitle,
  onClose,
}: {
  store: BoardStore;
  /** Only the scenes the viewer may see and has not filtered out. */
  groups: readonly SceneGroup[];
  labels: Map<string, string>;
  boardTitle: string;
  projectTitle?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const boardAspect = useBoardAspect(store.doc);
  const getPreset = usePresetText();
  const [index, setIndex] = useState(0);
  const [showNotes, setShowNotes] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  );
  const rootRef = useRef<HTMLDialogElement>(null);
  // Whatever had focus when the presentation opened gets it back when it closes.
  const opener = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    const el = opener.current;
    return () => {
      if (el instanceof HTMLElement && el.isConnected) el.focus();
    };
  }, []);

  // Timer for presentation elapsed time and wall-clock
  useEffect(() => {
    const timer = setInterval(() => {
      if (!paused) setElapsed((s) => s + 1);
      setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, [paused]);

  // Modal dialog: the page behind is inert and Tab stays inside.
  useEffect(() => {
    const el = rootRef.current;
    if (el && !el.open) el.showModal();
    el?.focus();
    return () => {
      if (el?.open) el.close();
    };
  }, []);

  // Leaving the presentation also leaves fullscreen.
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  const slides = useMemo(() => {
    const list: SlideItem[] = [];

    for (const group of groups) {
      const scene = group.scene;
      const headingParts = [
        scene ? t('film.scene.heading', { number: scene.number }).toUpperCase() : undefined,
        scene?.title ? scene.title.toUpperCase() : undefined,
        scene?.setting ? scene.setting.toUpperCase() : undefined,
        scene?.time ? scene.time.toUpperCase() : undefined,
      ].filter(Boolean);
      const sceneHeading = headingParts.join(' · ');

      for (const frame of group.frames) {
        const label = labels.get(frame.id) ?? frame.label ?? String(list.length + 1);
        list.push({
          id: frame.id,
          type: 'frame',
          label,
          sceneHeading: sceneHeading || undefined,
          location: scene?.location || frame.location,
          action: frame.action || frame.notes || '',
          specs: {
            shot: frame.shot ? getPreset('film.shot', SHOT_SIZES, frame.shot) : undefined,
            lens: frame.lens,
            movement: frame.movement
              ? getPreset('film.movement', SHOT_MOVEMENTS, frame.movement)
              : undefined,
            duration: frame.durationMs ? `${Math.round(frame.durationMs / 1000)} s` : undefined,
            audio: frame.audio ? t('present.audio', { value: frame.audio }) : undefined,
          },
          notes: frame.notes || scene?.synopsis || '',
          frame,
        });
      }
    }

    return list;
  }, [groups, labels, getPreset, t]);

  const total = slides.length;
  const safeIndex = Math.min(index, Math.max(0, total - 1));
  const current = slides[safeIndex] ?? null;
  const nextSlide = slides[safeIndex + 1] ?? null;

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(total - 1, i + 1));
  }, [total]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Keys are captured here so the board canvas behind never sees them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.code === 'Space') {
        // Space presses a focused button instead.
        if (e.key !== 'ArrowRight' && e.target instanceof Element && e.target.closest('button'))
          return;
        goNext();
      } else if (e.key === 'ArrowLeft') goPrev();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, goNext, goPrev]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      rootRef.current?.requestFullscreen?.().catch(() => {});
    }
  };

  const progressPercent = total > 0 ? ((safeIndex + 1) / total) * 100 : 0;
  const slideAria = t('present.slideAria', { current: safeIndex + 1, total });

  return (
    <dialog
      ref={rootRef}
      className="present-view"
      tabIndex={-1}
      aria-label={t('present.title')}
      onCancel={(e) => e.preventDefault()}
    >
      <header className="present-header">
        <button type="button" className="present-header__btn" onClick={onClose}>
          <Icon name="arrow" size={14} style={{ transform: 'rotate(180deg)' }} />
          <span>{t('present.exit')}</span>
          <KeyCap>Esc</KeyCap>
        </button>
        <span className="present-header__sep">/</span>
        <span className="present-header__title">
          {projectTitle ? `${projectTitle} · ` : ''}
          {boardTitle}
        </span>
        <div className="present-header__spacer" />
      </header>

      <div className="present-body">
        <main className="present-main">
          {current ? (
            <section className="present-stage" aria-label={slideAria}>
              <p className="present-sr-only" aria-live="polite">
                {`${slideAria} · ${current.label}`}
              </p>
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
              <h2>{t('present.noSlides')}</h2>
              <Button onClick={onClose}>{t('present.exit')}</Button>
            </div>
          )}

          <footer className="present-bottom">
            {total > 1 && (
              <nav className="present-strip" aria-label={t('present.slides')}>
                {slides.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`present-thumb${i === safeIndex ? ' is-active' : ''}`}
                    aria-label={t('present.slideLabel', { n: i + 1, label: s.label })}
                    aria-current={i === safeIndex ? 'true' : undefined}
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

            <div role="toolbar" className="present-toolbar" aria-label={t('present.toolbar')}>
              <IconButton
                icon="chevronRight"
                style={{ transform: 'rotate(180deg)' }}
                label={t('present.prev')}
                disabled={safeIndex <= 0}
                onClick={goPrev}
              />
              <span className="present-toolbar__count">
                {t('present.slideCounter', { current: total > 0 ? safeIndex + 1 : 0, total })}
              </span>
              <IconButton
                icon="chevronRight"
                label={t('present.next')}
                disabled={safeIndex >= total - 1}
                onClick={goNext}
              />
              <span className="present-toolbar__hint">
                <KeyCap>←</KeyCap>
                <KeyCap>→</KeyCap>
                <span>{t('present.keysHint')}</span>
              </span>

              <div style={{ flex: 1 }} />

              <button
                type="button"
                className={`present-toolbar__btn${showNotes ? ' is-active' : ''}`}
                aria-pressed={showNotes}
                onClick={() => setShowNotes((v) => !v)}
              >
                <span>{t('present.speakerNotes')}</span>
              </button>

              <IconButton
                icon="fit"
                label={fullscreen ? t('present.exitFullscreen') : t('present.fullscreen')}
                onClick={toggleFullscreen}
              />
            </div>
          </footer>
        </main>

        {showNotes && (
          <aside className="present-sidebar" aria-label={t('present.speakerNotes')}>
            <div className="present-sidebar__head">
              <span className="present-sidebar__title">{t('present.speakerNotes')}</span>
              <IconButton
                icon="close"
                label={t('present.closeNotes')}
                onClick={() => setShowNotes(false)}
              />
            </div>

            <div className="present-sidebar__timer-box">
              <div>
                <span className="present-sidebar__label">{t('present.timer')}</span>
                <span className="present-sidebar__clock">{formatElapsed(elapsed)}</span>
                <button
                  type="button"
                  className="present-toolbar__btn"
                  aria-pressed={paused}
                  onClick={() => setPaused((v) => !v)}
                >
                  {paused ? t('present.timerResume') : t('present.timerPause')}
                </button>
                <button
                  type="button"
                  className="present-toolbar__btn"
                  disabled={elapsed === 0}
                  onClick={() => setElapsed(0)}
                >
                  {t('present.timerReset')}
                </button>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="present-sidebar__label">{t('present.clock')}</span>
                <span style={{ fontSize: 13, color: 'var(--ink-text-muted)' }}>{clock}</span>
              </div>
            </div>

            <div className="present-sidebar__notes">
              <span className="present-sidebar__label">
                {t('present.slideLabel', { n: safeIndex + 1, label: current?.label ?? '' })}
              </span>
              {current?.notes ? (
                <p style={{ margin: 0 }}>{current.notes}</p>
              ) : (
                <p style={{ margin: 0, color: 'var(--ink-text-muted)', fontStyle: 'italic' }}>
                  {t('present.noNotes')}
                </p>
              )}
            </div>

            {nextSlide && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span className="present-sidebar__label">
                  {t('present.nextSlide')} · {nextSlide.label}
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
                  <span style={{ fontSize: 12, color: 'var(--ink-text-muted)' }}>
                    {nextSlide.specs.shot}
                    {nextSlide.specs.lens ? ` · ${nextSlide.specs.lens}` : ''}
                  </span>
                )}
              </div>
            )}
          </aside>
        )}
      </div>
    </dialog>
  );
}
