// SPDX-License-Identifier: AGPL-3.0-only
import { type FrameElement, type SceneGroup, variantView } from '@inkadra/canvas-core';
import type { ExportSettings } from '@inkadra/shared';
import { Button, Icon, IconButton, KeyCap } from '@inkadra/ui';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchExportSettings, logoUrl } from './export/settings.ts';
import { useBoardAspect } from './film/aspect.ts';
import { FramePicture } from './film/FramePicture.tsx';
import { usePresetText } from './film/fields.tsx';
import { PlanDrawing, type PlanLike } from './plan/PlanDrawing.tsx';
import { plansOfScene } from './plan/scenes.tsx';
import './presentation.css';
import { isTyping } from './shortcuts.ts';
import type { BoardStore } from './store.ts';
import { headingFamily, loadHeadingFont, resolveTheme, screenAccent } from './theme.ts';

export interface SlideItem {
  id: string;
  type: 'frame' | 'card' | 'scene';
  title?: string;
  label: string;
  action?: string;
  /** Shot, lens, movement and audio on one line. */
  specs?: string;
  notes?: string;
  frame?: FrameElement;
  /** A scene slide (round 6, i): the scene's frames on the left, its set plan on the right. */
  plan?: PlanLike;
  frames?: readonly FrameElement[];
}

/** The bars and the strip step aside after this long without moving the mouse. */
const IDLE_MS = 3000;

export function PresentationView({
  store,
  projectId,
  groups,
  labels,
  boardTitle,
  projectTitle,
  onClose,
}: {
  store: BoardStore;
  /** Whose theme and logo the slides wear (decision 0057); left out, the app's own look. */
  projectId?: string;
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
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const rootRef = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<ExportSettings | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    fetchExportSettings(projectId).then(
      (loaded) => {
        if (live) setSettings(loaded);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [projectId]);
  const theme = resolveTheme(settings);
  useEffect(() => {
    void loadHeadingFont(theme.headingFont);
  }, [theme.headingFont]);
  // Whatever had focus when the presentation opened gets it back when it closes.
  const opener = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    const el = opener.current;
    return () => {
      if (el instanceof HTMLElement && el.isConnected) el.focus();
    };
  }, []);

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

  // Only the mouse brings them back, so a remote or the arrow keys don't flash them at the audience.
  // The stylesheet keeps them while they hold keyboard focus and where there is no mouse.
  useEffect(() => {
    let timer = 0;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    };
    wake();
    document.addEventListener('mousemove', wake);
    return () => {
      document.removeEventListener('mousemove', wake);
      window.clearTimeout(timer);
    };
  }, []);

  const slides = useMemo(() => {
    const list: SlideItem[] = [];

    for (const group of groups) {
      const scene = group.scene;
      // The plan of the scene first, unless the plan leaves itself out of the slides.
      const plan = scene
        ? plansOfScene(store.getSnapshot().byId.values(), scene.id).find(
            (p) => p.presentation !== false,
          )
        : undefined;
      if (plan && scene) {
        const base = plan.variantOf ? store.getSnapshot().byId.get(plan.variantOf) : undefined;
        list.push({
          id: `scene-${scene.id}`,
          type: 'scene',
          label: t('needed.sceneNumber', { number: scene.number }),
          action: scene.synopsis || '',
          notes: scene.synopsis || '',
          plan: base?.type === 'plan' ? variantView(plan, base) : plan,
          frames: group.frames.slice(0, 4),
        });
      }
      for (const frame of group.frames) {
        const label = labels.get(frame.id) ?? frame.label ?? String(list.length + 1);
        list.push({
          id: frame.id,
          type: 'frame',
          label,
          action: frame.action || frame.notes || '',
          specs: [
            frame.shot ? getPreset('shotSizes', frame.shot) : undefined,
            frame.lens,
            frame.movement ? getPreset('shotMovements', frame.movement) : undefined,
            frame.audio ? t('present.audio', { value: frame.audio }) : undefined,
          ]
            .filter(Boolean)
            .join(' · '),
          notes: frame.notes || scene?.synopsis || '',
          frame,
        });
      }
    }

    return list;
  }, [groups, labels, getPreset, t, store]);

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

  // The arrow keys can walk past the end of the strip: the current slide stays in view.
  const stripRef = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the slide changes.
  useEffect(() => {
    stripRef.current
      ?.querySelector('[aria-current]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [safeIndex]);

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
      className={`present-view${idle && current ? ' is-idle' : ''}`}
      style={
        settings
          ? ({
              '--present-accent': screenAccent(theme.color),
              '--present-heading': headingFamily(theme.headingFont),
            } as CSSProperties)
          : undefined
      }
      tabIndex={-1}
      aria-label={t('present.title')}
      onCancel={(e) => e.preventDefault()}
      // A click puts focus on the dialog. On a button, the next arrow key would make it keyboard
      // focus to the browser, and the bars would stay up for the rest of the presentation.
      onMouseDown={(e) => {
        e.preventDefault();
        e.currentTarget.focus();
      }}
    >
      <div className="present-body">
        <main className="present-main">
          <header className="present-header">
            <button type="button" className="present-header__btn" onClick={onClose}>
              <Icon name="arrow" size={14} style={{ transform: 'rotate(180deg)' }} />
              <span>{t('present.exit')}</span>
              <KeyCap>Esc</KeyCap>
            </button>
            <span className="present-header__sep">/</span>
            {settings?.logo && (
              <img className="present-header__logo" src={logoUrl(settings.logo)} alt="" />
            )}
            <span className="present-header__title">
              {projectTitle ? `${projectTitle} · ` : ''}
              {boardTitle}
            </span>
            <div className="present-header__spacer" />
            {current && (
              <>
                <span className="present-header__count">
                  {t('present.slideCounter', { current: safeIndex + 1, total })}
                </span>
                <button
                  type="button"
                  className={`present-header__btn present-header__notes${showNotes ? ' is-active' : ''}`}
                  aria-pressed={showNotes}
                  onClick={() => setShowNotes((v) => !v)}
                >
                  {t('present.speakerNotes')}
                </button>
              </>
            )}
            <IconButton
              icon="fit"
              label={fullscreen ? t('present.exitFullscreen') : t('present.fullscreen')}
              onClick={toggleFullscreen}
            />
          </header>

          {current ? (
            <section className="present-stage" aria-label={slideAria}>
              <p className="present-sr-only" aria-live="polite">
                {`${slideAria} · ${current.label}`}
              </p>

              <div
                className={`present-stage__canvas${current.plan ? ' present-stage__canvas--scene' : ''}`}
              >
                {current.plan && (
                  <>
                    <div className="present-scene__frames">
                      {current.frames?.map((f) => (
                        <FramePicture
                          key={f.id}
                          assetId={f.assetId}
                          aspect={f.aspect}
                          boardAspect={boardAspect}
                          strokes={f.strokes}
                          shapes={f.shapes}
                          referenceOpacity={f.referenceOpacity}
                          pixels={640}
                        />
                      ))}
                    </div>
                    <div className="present-scene__plan plan">
                      <PlanDrawing plan={current.plan} />
                    </div>
                  </>
                )}
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
                <p className="present-stage__action">{current.action}</p>
                {current.specs && <span className="present-stage__specs">{current.specs}</span>}
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
              <nav ref={stripRef} className="present-strip" aria-label={t('present.slides')}>
                {slides.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`present-thumb${i === safeIndex ? ' is-active' : ''}`}
                    aria-label={t('present.slideLabel', { n: i + 1, label: s.label })}
                    aria-current={i === safeIndex ? 'true' : undefined}
                    onClick={() => setIndex(i)}
                  >
                    {s.plan && <PlanDrawing plan={s.plan} />}
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
                  </button>
                ))}
              </nav>
            )}

            {current && (
              <div className="present-progress">
                <div className="present-progress__bar" style={{ width: `${progressPercent}%` }} />
              </div>
            )}

            {/* Phones have no strip: these are the only buttons to change slide there. */}
            {current && (
              <div role="toolbar" className="present-toolbar" aria-label={t('present.toolbar')}>
                <IconButton
                  icon="chevronRight"
                  style={{ transform: 'rotate(180deg)' }}
                  label={t('present.prev')}
                  disabled={safeIndex <= 0}
                  onClick={goPrev}
                />
                <IconButton
                  icon="chevronRight"
                  label={t('present.next')}
                  disabled={safeIndex >= total - 1}
                  onClick={goNext}
                />
              </div>
            )}
          </footer>
        </main>

        {current && showNotes && (
          <aside className="present-sidebar" aria-label={t('present.speakerNotes')}>
            <div className="present-sidebar__head">
              <span className="present-sidebar__title">{t('present.speakerNotes')}</span>
              <IconButton
                icon="close"
                label={t('present.closeNotes')}
                onClick={() => setShowNotes(false)}
              />
            </div>

            <span className="present-sidebar__label">
              {t('present.slideLabel', { n: safeIndex + 1, label: current.label })}
            </span>
            {current.notes ? (
              <p className="present-sidebar__notes">{current.notes}</p>
            ) : (
              <p className="present-sidebar__notes present-sidebar__notes--empty">
                {t('present.noNotes')}
              </p>
            )}

            {nextSlide && (
              <>
                <span className="present-sidebar__label present-sidebar__label--next">
                  {t('present.nextSlide')} · {nextSlide.label}
                </span>
                <div className="present-sidebar__preview-pic">
                  {nextSlide.plan && <PlanDrawing plan={nextSlide.plan} />}
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
              </>
            )}
          </aside>
        )}
      </div>
    </dialog>
  );
}
