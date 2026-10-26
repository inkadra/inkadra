// SPDX-License-Identifier: AGPL-3.0-only
import { Icon } from '@inkadra/ui';
import { type MouseEvent, useCallback, useState } from 'react';
import type { BoardStore } from '../store.ts';

interface ShotReviewItem {
  code: string;
  size: string;
  lens: string;
  movement: string;
  duration: string;
  action: string;
  status: 'approved' | 'changes_requested' | 'unreviewed';
  statusLabel: string;
  statusColor: string;
}

const DEFAULT_SHOTS: ShotReviewItem[] = [
  {
    code: '4A',
    size: 'Campo lungo',
    lens: '24mm',
    movement: 'Fissa',
    duration: '0:35',
    action: 'Binario vuoto, entra il taxi nella stazione.',
    status: 'approved',
    statusLabel: 'Approvata',
    statusColor: '#9FE0B4',
  },
  {
    code: '4B',
    size: 'Mezza figura',
    lens: '35mm',
    movement: 'Pan',
    duration: '0:45',
    action: 'Antonio guarda il tabellone con gli orari fittizi.',
    status: 'approved',
    statusLabel: 'Approvata',
    statusColor: '#9FE0B4',
  },
  {
    code: '4C',
    size: 'Primo piano',
    lens: '85mm',
    movement: 'Fissa',
    duration: '0:06',
    action: 'Antonio guarda il tabellone, il neon gli colora il volto.',
    status: 'changes_requested',
    statusLabel: 'Modifiche richieste',
    statusColor: '#F2B08A',
  },
  {
    code: '4D',
    size: 'Campo medio',
    lens: '35mm',
    movement: 'Carrello',
    duration: '0:40',
    action: 'Il taxi riparte lungo il marciapiede del binario.',
    status: 'approved',
    statusLabel: 'Approvata',
    statusColor: '#9FE0B4',
  },
  {
    code: '4E',
    size: 'Controcampo',
    lens: '50mm',
    movement: 'Fissa',
    duration: '0:30',
    action: 'La cliente nel taxi osserva dal finestrino bagnato.',
    status: 'approved',
    statusLabel: 'Approvata',
    statusColor: '#9FE0B4',
  },
  {
    code: '4F',
    size: 'Dettaglio',
    lens: '100mm',
    movement: 'Fissa',
    duration: '0:20',
    action: 'Riflesso dei neon sulle pozzanghere del marciapiede.',
    status: 'unreviewed',
    statusLabel: 'Da vedere',
    statusColor: '#4A4A4E',
  },
];

interface CommentItem {
  id: string;
  author: string;
  role?: string;
  time: string;
  badge?: string;
  pin?: number;
  text: string;
  avatar: string;
  avatarBg: string;
  indent?: boolean;
}

const INITIAL_COMMENTS: CommentItem[] = [
  {
    id: 'c1',
    author: 'Laura',
    time: 'v1 · 14 ott',
    pin: 1,
    text: 'Possiamo stringere sul volto? Ora si perde lo sguardo.',
    avatar: 'LR',
    avatarBg: '#F2B08A',
  },
  {
    id: 'c2',
    author: 'Matteo',
    role: 'studio',
    time: '15 ott',
    badge: 'risolto',
    text: 'Fatto in v2: 85mm invece di 50, camera più vicina.',
    avatar: 'MV',
    avatarBg: '#8A8A90',
    indent: true,
  },
  {
    id: 'c3',
    author: 'Laura',
    time: 'ora',
    pin: 2,
    text: "Meglio. Il neon però è troppo rosa per il nostro brand, si può scaldare verso l'arancio?",
    avatar: 'LR',
    avatarBg: '#F2B08A',
  },
];

export function ClientReviewView({
  store: _store,
  projectName = 'Ultima corsa',
}: {
  store: BoardStore;
  projectName?: string;
  projectId?: string;
  boardId?: string;
  userId?: string;
  readOnly?: boolean;
}) {
  const [shots, setShots] = useState<ShotReviewItem[]>(DEFAULT_SHOTS);
  const [activeShotCode, setActiveShotCode] = useState('4C');
  const [activeScene, setActiveScene] = useState('sc4');
  const [compareMode, setCompareMode] = useState<'v1' | 'both' | 'v2'>('both');
  const [splitPercent, setSplitPercent] = useState(46);
  const [comments, setComments] = useState<CommentItem[]>(INITIAL_COMMENTS);
  const [newComment, setNewComment] = useState('');
  const [showMention, setShowMention] = useState(false);
  const [savedStatus, setSavedStatus] = useState<string | null>('Le tue note sono state salvate');

  const activeIndex = shots.findIndex((s) => s.code === activeShotCode);
  const currentShot = shots[activeIndex >= 0 ? activeIndex : 2];

  const approvedCount = shots.filter((s) => s.status === 'approved').length;
  const changesCount = shots.filter((s) => s.status === 'changes_requested').length;
  const unreviewedCount = shots.filter((s) => s.status === 'unreviewed').length;

  const setDecision = (status: 'approved' | 'changes_requested') => {
    setShots((prev) =>
      prev.map((s) =>
        s.code === activeShotCode
          ? {
              ...s,
              status,
              statusLabel: status === 'approved' ? 'Approvata' : 'Modifiche richieste',
              statusColor: status === 'approved' ? '#9FE0B4' : '#F2B08A',
            }
          : s,
      ),
    );
    setSavedStatus('Decisione aggiornata in bozza');
  };

  const handlePrev = () => {
    const previous = shots[activeIndex - 1];
    if (previous) setActiveShotCode(previous.code);
  };

  const handleNext = () => {
    const next = shots[activeIndex + 1];
    if (next) setActiveShotCode(next.code);
  };

  const handleSliderClick = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const percent = Math.round((x / rect.width) * 100);
    setSplitPercent(percent);
  };

  const handleSendComment = () => {
    if (!newComment.trim()) return;
    const item: CommentItem = {
      id: `c-${Date.now()}`,
      author: 'Laura',
      time: 'adesso',
      text: newComment.trim(),
      avatar: 'LR',
      avatarBg: '#F2B08A',
    };
    setComments((prev) => [...prev, item]);
    setNewComment('');
    setShowMention(false);
    setSavedStatus('Commento inviato');
  };

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  if (!currentShot) return null;

  return (
    <div className="review-view">
      {/* Top Header */}
      <header className="review-header">
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: '#EDEDED',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <rect x="3" y="7" width="8" height="10" rx="1.5" fill="#0E0E10" />
            <rect x="13" y="7" width="8" height="10" rx="1.5" fill="#0E0E10" opacity="0.55" />
          </svg>
        </span>
        <span style={{ fontWeight: 600 }}>Studio Maraffio</span>
        <span style={{ color: '#4A4A4E' }}>×</span>
        <span style={{ fontWeight: 600 }}>Nordeen</span>

        <div style={{ flex: 1 }} />

        <div className="review-revision-progress">
          <span style={{ display: 'flex', gap: 4 }}>
            <span style={{ width: 36, height: 4, borderRadius: 2, background: '#9A9A9A' }} />
            <span style={{ width: 36, height: 4, borderRadius: 2, background: '#3B7CF6' }} />
            <span style={{ width: 36, height: 4, borderRadius: 2, background: '#2A2A2E' }} />
          </span>
          <span style={{ fontSize: 12 }}>
            Revisione <b style={{ fontWeight: 600 }}>2 di 3</b>
          </span>
          <span className="mut" style={{ fontSize: 12 }}>
            · entro ven 24 ott
          </span>
        </div>

        <div style={{ flex: 1 }} />

        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: '#9A9A9A',
          }}
        >
          <span className="av" style={{ background: '#F2B08A' }}>
            LR
          </span>
          Accesso ospite · Laura
        </span>

        <button type="button" className="btn" onClick={handlePrint}>
          <Icon name="download" size={14} />
          Scarica PDF
        </button>
      </header>

      {/* Main Workspace */}
      <div className="review-body">
        <main className="review-stage">
          {/* Subbar: Scenes and Compare */}
          <div className="review-subbar">
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="mut" style={{ fontSize: 11 }}>
                {projectName} · Storyboard
              </span>
              <span style={{ fontSize: 16, fontWeight: 600 }}>Scena 4 · Il binario</span>
            </span>

            <div role="tablist" aria-label="Scene" className="review-scene-tabs">
              <button
                type="button"
                role="tab"
                aria-selected={activeScene === 'sc3'}
                className={`tab ${activeScene === 'sc3' ? 'is-active' : ''}`}
                onClick={() => setActiveScene('sc3')}
              >
                <span style={{ color: '#9FE0B4' }}>✓</span>Scena 3
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeScene === 'sc4'}
                className={`tab ${activeScene === 'sc4' ? 'is-active' : ''}`}
                onClick={() => setActiveScene('sc4')}
              >
                Scena 4
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeScene === 'sc5'}
                className={`tab ${activeScene === 'sc5' ? 'is-active' : ''}`}
                onClick={() => setActiveScene('sc5')}
              >
                Scena 5
              </button>
            </div>

            <div style={{ flex: 1 }} />

            <fieldset
              aria-label="Versione"
              className="review-compare-tabs"
              style={{ border: 0, padding: 0, margin: 0 }}
            >
              <span className="mut" style={{ fontSize: 12 }}>
                Confronta
              </span>
              <div className="review-compare-pills">
                <button
                  type="button"
                  className={`tab ${compareMode === 'v1' ? 'is-active' : ''}`}
                  onClick={() => setCompareMode('v1')}
                >
                  v1
                </button>
                <button
                  type="button"
                  className={`tab ${compareMode === 'both' ? 'is-active' : ''}`}
                  onClick={() => setCompareMode('both')}
                >
                  v1 / v2
                </button>
                <button
                  type="button"
                  className={`tab ${compareMode === 'v2' ? 'is-active' : ''}`}
                  onClick={() => setCompareMode('v2')}
                >
                  v2
                </button>
              </div>
            </fieldset>
          </div>

          {/* Interactive Comparison Stage */}
          <figure className="review-canvas">
            {/* Base layer: Version 2 (85mm neon close-up) */}
            <svg
              role="img"
              aria-label={`Inquadratura ${currentShot.code}, versione 2: primo piano stretto di Antonio, luce del neon`}
              viewBox="0 0 1012 424"
              className="review-canvas__base"
            >
              <rect width="1012" height="424" fill="#16171B" />
              <path d="M0 0 L1012 0 L1012 424 L0 424 Z" fill="url(#neon2)" />
              <defs>
                <radialGradient id="neon2" cx="0.78" cy="0.3" r="0.6">
                  <stop offset="0" stopColor="#5A2A30" stopOpacity="0.7" />
                  <stop offset="1" stopColor="#16171B" stopOpacity="0" />
                </radialGradient>
              </defs>
              <g fill="none" stroke="#CFCFD4" strokeWidth="2.2" strokeLinecap="round">
                <path d="M420 424 Q420 300 520 280 Q640 300 640 424" />
                <path d="M455 170 a70 85 0 1 0 140 0 a70 85 0 1 0 -140 0" />
                <path d="M500 175 q10 -6 20 0 M555 175 q10 -6 20 0 M530 205 q8 14 0 22 M510 245 q25 12 50 0" />
              </g>
            </svg>

            {/* Split overlay: Version 1 (50mm wide angle) */}
            {(compareMode === 'both' || compareMode === 'v1') && (
              <div
                aria-hidden="true"
                className="review-canvas__split"
                style={{ width: compareMode === 'v1' ? '100%' : `${splitPercent}%` }}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 1012 424"
                  className="review-canvas__split-inner"
                >
                  <rect width="1012" height="424" fill="#121317" />
                  <g fill="none" stroke="#8A8A90" strokeWidth="2" strokeLinecap="round">
                    <path d="M330 424 Q330 330 440 310 Q560 330 560 424" />
                    <path d="M390 210 a50 60 0 1 0 100 0 a50 60 0 1 0 -100 0" />
                    <path d="M0 330 L1012 330" />
                  </g>
                </svg>
              </div>
            )}

            {/* Split slider handle */}
            {compareMode === 'both' && (
              <button
                type="button"
                aria-label="Regola divisione confronto"
                className="review-canvas__handle"
                style={{ left: `calc(${splitPercent}% - 14px)` }}
                onClick={handleSliderClick}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') setSplitPercent((p) => Math.max(0, p - 5));
                  if (e.key === 'ArrowRight') setSplitPercent((p) => Math.min(100, p + 5));
                }}
              >
                ⇆
              </button>
            )}

            {/* Version labels */}
            <span className="pill review-canvas__badge-left">v1 · 50mm · 12 ott</span>
            <span className="pill review-canvas__badge-right">v2 · 85mm · 20 ott</span>

            {/* Numbered Pins */}
            <span className="pin" style={{ left: '55%', top: '35%' }}>
              1
            </span>
            <span
              className="pin"
              style={{
                left: '81%',
                top: '16%',
                background: '#2563EB',
                color: '#FFFFFF',
                boxShadow: '0 0 0 4px rgba(59,124,246,.25)',
              }}
            >
              2
            </span>

            {/* Navigation arrows */}
            <button
              type="button"
              className="ib review-canvas__nav-left"
              onClick={handlePrev}
              disabled={activeIndex === 0}
              aria-label="Inquadratura precedente"
            >
              <svg
                className="ico"
                viewBox="0 0 24 24"
                aria-hidden="true"
                style={{ width: 16, height: 16 }}
              >
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <button
              type="button"
              className="ib review-canvas__nav-right"
              onClick={handleNext}
              disabled={activeIndex === shots.length - 1}
              aria-label="Inquadratura successiva"
            >
              <svg
                className="ico"
                viewBox="0 0 24 24"
                aria-hidden="true"
                style={{ width: 16, height: 16 }}
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </figure>

          {/* Current Frame Meta */}
          <div className="review-shot-meta">
            <b style={{ fontWeight: 600 }}>{currentShot.code}</b>
            <span>{currentShot.size}</span>
            <span className="mut">
              {currentShot.lens} · {currentShot.movement} · {currentShot.duration}
            </span>
            <span className="mut" style={{ flex: 1 }}>
              {currentShot.action}
            </span>
            <span
              className="pill"
              style={{
                background: currentShot.status === 'approved' ? '#1F3A2A' : '#3A2418',
                color: currentShot.statusColor,
              }}
            >
              {currentShot.statusLabel}
            </span>
            <span className="mut" style={{ fontSize: 12 }}>
              {activeIndex + 1} di {shots.length}
            </span>
          </div>

          {/* Bottom Thumbnails Strip */}
          <nav aria-label="Inquadrature della scena" className="review-carousel">
            {shots.map((s) => {
              const isActive = s.code === activeShotCode;
              return (
                <button
                  key={s.code}
                  type="button"
                  className={`review-carousel__item ${isActive ? 'is-active' : ''}`}
                  onClick={() => setActiveShotCode(s.code)}
                >
                  <svg aria-hidden="true" viewBox="0 0 240 100" className="review-carousel__thumb">
                    <path
                      d="M0 70 L240 70 M60 70 L60 30 L180 30 L180 70 M80 30 L120 12 L160 30"
                      fill="none"
                      stroke="#9A9A9A"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="review-carousel__foot">
                    <span
                      className="pill review-carousel__dot"
                      style={{ background: s.statusColor }}
                    />
                    <b style={{ fontWeight: 600 }}>{s.code}</b>
                    <span style={{ color: '#8A8A90' }}>{s.statusLabel}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Bottom Footer Guide & Saved Status */}
          <div className="review-footer-bar">
            <div className="review-tips">
              <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <span className="co">1</span>
                <span>
                  Trascina la maniglia per confrontare la versione 1 con la 2. Tasti ← → per
                  scorrere.
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <span className="co">2</span>
                <span>
                  Clic sull&apos;immagine per lasciare un segnaposto numerato collegato al commento.
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <span className="co">3</span>
                <span>Le decisioni restano bozze finché non premi Invia revisione.</span>
              </div>
            </div>

            {savedStatus && (
              <div role="status" className="review-saved-status">
                <span className="review-saved-icon">✓</span>
                {savedStatus}
                <button
                  type="button"
                  className="review-undo-btn"
                  onClick={() => setSavedStatus(null)}
                >
                  Annulla
                </button>
              </div>
            )}
          </div>
        </main>

        {/* Right Drawer: Comments & Approvals */}
        <aside className="review-drawer" aria-label="Commenti e approvazioni">
          <div className="review-drawer__head">
            <span style={{ fontSize: 15, fontWeight: 600 }}>Inquadratura {currentShot.code}</span>
            <span className="mut" style={{ fontSize: 11 }}>
              La tua decisione
            </span>
          </div>

          <div className="review-decision-group">
            <button
              type="button"
              aria-pressed={currentShot.status === 'approved'}
              className={`tab review-decision-btn ${
                currentShot.status === 'approved' ? 'is-approved' : ''
              }`}
              onClick={() => setDecision('approved')}
            >
              <span style={{ color: '#9FE0B4' }}>✓</span>
              Approva
            </button>
            <button
              type="button"
              aria-pressed={currentShot.status === 'changes_requested'}
              className={`tab review-decision-btn ${
                currentShot.status === 'changes_requested' ? 'is-changes' : ''
              }`}
              onClick={() => setDecision('changes_requested')}
            >
              Richiedi modifiche
            </button>
          </div>

          <div className="review-comments-list">
            {comments.map((c) => (
              <div
                key={c.id}
                className="review-comment-item"
                style={{ paddingLeft: c.indent ? 36 : 0 }}
              >
                <span className="av" style={{ background: c.avatarBg }}>
                  {c.avatar}
                </span>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}
                >
                  <span style={{ fontSize: 12 }}>
                    <b style={{ fontWeight: 600 }}>{c.author}</b>{' '}
                    {c.role && <span className="mut">· {c.role}</span>}{' '}
                    <span style={{ color: '#808086' }}>{c.time}</span>
                    {c.pin && (
                      <span
                        className="pill"
                        style={{ background: '#1C1C1F', color: '#9A9A9A', marginLeft: 4 }}
                      >
                        {c.pin}
                      </span>
                    )}
                    {c.badge && (
                      <span
                        className="pill"
                        style={{ background: '#1A3324', color: '#9FE0B4', marginLeft: 4 }}
                      >
                        {c.badge}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 13, lineHeight: 1.45, color: '#D4D4D8' }}>{c.text}</span>
                </div>
              </div>
            ))}
          </div>

          {/* New Comment Field with Mention */}
          <div className="review-new-comment-box">
            {showMention && (
              <div className="review-mention-popover">
                <button
                  type="button"
                  className="review-mention-item is-selected"
                  onClick={() => {
                    setNewComment((prev) => `${prev} @studio `);
                    setShowMention(false);
                  }}
                >
                  <span className="av" style={{ width: 22, height: 22, background: '#EDEDED' }}>
                    SM
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                    <span style={{ fontSize: 12, fontWeight: 500 }}>@studio</span>
                    <span style={{ fontSize: 10, color: '#8A8A90' }}>Tutto lo Studio Maraffio</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="review-mention-item"
                  onClick={() => {
                    setNewComment((prev) => `${prev} @Matteo `);
                    setShowMention(false);
                  }}
                >
                  <span className="av" style={{ width: 22, height: 22, background: '#8A8A90' }}>
                    MV
                  </span>
                  <span style={{ fontSize: 12 }}>@Matteo · regia</span>
                </button>
              </div>
            )}

            <div className="review-textarea-wrapper">
              <textarea
                rows={2}
                placeholder="Scrivi qui… digita @ per menzionare"
                value={newComment}
                onChange={(e) => {
                  setNewComment(e.target.value);
                  if (e.target.value.endsWith('@')) setShowMention(true);
                  else if (!e.target.value.includes('@')) setShowMention(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendComment();
                  }
                }}
                className="review-textarea"
              />
              <div className="review-textarea-foot">
                <span>Segnaposto 2 collegato</span>
                <button type="button" className="review-send-btn" onClick={handleSendComment}>
                  ⏎ invia
                </button>
              </div>
            </div>
          </div>

          {/* Drawer footer with summary and Submit button */}
          <div className="review-drawer__footer">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                marginBottom: 8,
              }}
            >
              <span>
                <b style={{ fontWeight: 600 }}>
                  {approvedCount} di {shots.length}
                </b>{' '}
                approvate
              </span>
              <span className="mut">
                {changesCount} con modifiche · {unreviewedCount} da vedere
              </span>
            </div>
            <div aria-hidden="true" style={{ display: 'flex', gap: 3, marginBottom: 14 }}>
              <span
                style={{ flex: approvedCount, height: 4, borderRadius: 2, background: '#9FE0B4' }}
              />
              <span
                style={{ flex: changesCount, height: 4, borderRadius: 2, background: '#F2B08A' }}
              />
              <span
                style={{ flex: unreviewedCount, height: 4, borderRadius: 2, background: '#2A2A2E' }}
              />
            </div>
            <button
              type="button"
              className="btn btn--primary"
              style={{
                width: '100%',
                height: 38,
                justifyContent: 'center',
                background: '#2563EB',
                borderColor: '#2563EB',
                color: '#FFFFFF',
                fontSize: 13,
              }}
              onClick={() => setSavedStatus('Revisione inviata con successo allo studio!')}
            >
              Invia revisione allo studio
            </button>
            <div className="mut" style={{ fontSize: 11, textAlign: 'center', marginTop: 8 }}>
              Matteo e Giulia riceveranno una notifica
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
