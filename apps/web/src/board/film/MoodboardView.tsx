import { useCallback, useEffect, useState } from 'react';
import './film.css';

export interface MoodboardItem {
  id: string;
  filename: string;
  title: string;
  subtitle: string;
  author: string;
  authorAvatar: string;
  authorColor: string;
  date: string;
  tag: string;
  camera: string;
  lens: string;
  exposure: string;
  iso: string;
  wb: string;
  dimensions: string;
  shotAt: string;
  palette: string[];
  tags: string[];
  sourceUrl: string;
  sourceLabel: string;
  usedIn: Array<{ label: string; link?: string }>;
  comments: Array<{
    id: string;
    author: string;
    avatar: string;
    avatarColor: string;
    time: string;
    target?: string;
    text: string;
  }>;
}

const DEFAULT_ITEMS: MoodboardItem[] = [
  {
    id: 'mb-1',
    filename: 'taxi_notturno_esterni.arw',
    title: 'Taxi in corsa, corso Buenos Aires',
    subtitle: 'riferimento luce pratica su carrozzeria',
    author: 'Andrea',
    authorAvatar: 'AF',
    authorColor: '#C9B27C',
    date: '12 ott',
    tag: 'Atmosfera',
    camera: 'Sony A7S III',
    lens: 'Sony 35mm f/1.4 GM',
    exposure: '1/50 s · f/1.8',
    iso: '3200',
    wb: '3800 K',
    dimensions: '4240 × 2832 · 16,2 MB',
    shotAt: '12 ott, 23:40',
    palette: ['#0A0D12', '#1E1416', '#3D2018', '#C9A36A', '#E07A6E'],
    tags: ['Atmosfera', 'Taxi', 'Notte'],
    sourceUrl: 'drive.studio/ultima-corsa/references',
    sourceLabel: 'drive.studio/…/references',
    usedIn: [{ label: 'Storyboard 2A ↗' }],
    comments: [
      {
        id: 'c-1',
        author: 'Andrea',
        avatar: 'AF',
        avatarColor: '#C9B27C',
        time: '2 giorni fa',
        text: 'La scia rossa posteriore funziona molto bene con lenti anamorfiche.',
      },
    ],
  },
  {
    id: 'mb-2',
    filename: 'volto_antonio_ombra.dng',
    title: 'Antonio, test specchietto retrovisore',
    subtitle: 'illuminazione viso da cruscotto verde/ambra',
    author: 'Giulia',
    authorAvatar: 'GL',
    authorColor: '#7CC4C9',
    date: '13 ott',
    tag: 'Casting',
    camera: 'ARRI Alexa Mini LF',
    lens: 'Cooke S4/i 50mm T2.0',
    exposure: '1/48 s · T2.0',
    iso: '1600',
    wb: '3200 K',
    dimensions: '4448 × 3096 · 24,1 MB',
    shotAt: '13 ott, 01:15',
    palette: ['#08090C', '#1A1820', '#2E2B38', '#8A6D4B', '#C9A36A'],
    tags: ['Casting', 'Antonio', 'Specchietto'],
    sourceUrl: 'drive.studio/ultima-corsa/casting',
    sourceLabel: 'drive.studio/…/casting',
    usedIn: [{ label: 'Storyboard 3B ↗' }],
    comments: [
      {
        id: 'c-2',
        author: 'Giulia',
        avatar: 'GL',
        avatarColor: '#7CC4C9',
        time: 'ieri',
        text: 'Confermata la luce ambra calda sul profilo destro.',
      },
    ],
  },
  {
    id: 'mb-3',
    filename: 'binario21_notte.arw',
    title: 'Stazione Centrale, binario 21',
    subtitle: 'sopralluogo notturno',
    author: 'Andrea',
    authorAvatar: 'AF',
    authorColor: '#C9B27C',
    date: '14 ott',
    tag: 'Location',
    camera: 'Sony A7S III',
    lens: 'Sigma 24mm f/1.4 DG DN',
    exposure: '1/50 s · f/1.4',
    iso: '6400',
    wb: '3200 K',
    dimensions: '4240 × 2832 · 18,4 MB',
    shotAt: '14 ott, 02:14',
    palette: ['#0E1319', '#1B222B', '#4E5864', '#C9A36A', '#E0B878'],
    tags: ['Location', 'Notte', 'Luce al sodio'],
    sourceUrl: 'drive.studio/ultima-corsa/sopralluoghi',
    sourceLabel: 'drive.studio/ultima-corsa/sopralluoghi',
    usedIn: [{ label: 'Storyboard 4C ↗' }, { label: 'Location' }],
    comments: [
      {
        id: 'c-3',
        author: 'Giulia',
        avatar: 'GL',
        avatarColor: '#7CC4C9',
        time: '12 min',
        target: 'su punto 1',
        text: 'Il fanale qui è perfetto per il controcampo di 4C.',
      },
      {
        id: 'c-4',
        author: 'Matteo',
        avatar: 'MV',
        avatarColor: '#8A8A90',
        time: '3 min',
        text: 'Teniamolo, chiedo a Andrea se resta acceso.',
      },
    ],
  },
  {
    id: 'mb-4',
    filename: 'ponte_luci_sodio.raw',
    title: 'Cavalcavia Serra, vapori di sodio',
    subtitle: 'continuità visiva scena 5',
    author: 'Andrea',
    authorAvatar: 'AF',
    authorColor: '#C9B27C',
    date: '14 ott',
    tag: 'Luce',
    camera: 'Sony A7S III',
    lens: 'Sigma 35mm f/1.4',
    exposure: '1/50 s · f/1.4',
    iso: '5000',
    wb: '2800 K',
    dimensions: '4240 × 2832 · 17,9 MB',
    shotAt: '14 ott, 03:20',
    palette: ['#0F1316', '#2A3038', '#5A6470', '#C9A36A', '#E0B878'],
    tags: ['Luce', 'Ponte', 'Notte'],
    sourceUrl: 'drive.studio/ultima-corsa/luci',
    sourceLabel: 'drive.studio/…/luci',
    usedIn: [{ label: 'Storyboard 5A ↗' }],
    comments: [],
  },
  {
    id: 'mb-5',
    filename: 'cruscotto_neon_dettaglio.arw',
    title: 'Cruscotto Mercedes taxi d’epoca',
    subtitle: 'tachimetro meccanico e luce radio verde',
    author: 'Matteo',
    authorAvatar: 'MV',
    authorColor: '#8A8A90',
    date: '15 ott',
    tag: 'Dettagli',
    camera: 'Fujifilm X-T5',
    lens: 'XF 33mm f/1.4 R LM WR',
    exposure: '1/60 s · f/1.4',
    iso: '1600',
    wb: '4000 K',
    dimensions: '6240 × 4160 · 22,0 MB',
    shotAt: '15 ott, 19:10',
    palette: ['#0B0D10', '#161A20', '#2A3038', '#547A60', '#9FE0B4'],
    tags: ['Dettagli', 'Taxi', 'Cruscotto'],
    sourceUrl: 'drive.studio/ultima-corsa/oggetti',
    sourceLabel: 'drive.studio/…/oggetti',
    usedIn: [{ label: 'Storyboard 1B ↗' }],
    comments: [],
  },
  {
    id: 'mb-6',
    filename: 'vetrina_pioggia_bokeh.dng',
    title: 'Riflessi pioggia su parabrezza',
    subtitle: 'sfocatura gocce d’acqua e neon bar',
    author: 'Giulia',
    authorAvatar: 'GL',
    authorColor: '#7CC4C9',
    date: '15 ott',
    tag: 'Colore',
    camera: 'Sony A7S III',
    lens: 'Sony 85mm f/1.4 GM',
    exposure: '1/50 s · f/1.4',
    iso: '3200',
    wb: '3400 K',
    dimensions: '4240 × 2832 · 18,1 MB',
    shotAt: '15 ott, 21:30',
    palette: ['#1A1418', '#2D1E26', '#E07A6E', '#C3B2F2', '#EDEDED'],
    tags: ['Colore', 'Pioggia', 'Bokeh'],
    sourceUrl: 'drive.studio/ultima-corsa/color',
    sourceLabel: 'drive.studio/…/color',
    usedIn: [{ label: 'Storyboard 3A ↗' }],
    comments: [],
  },
  {
    id: 'mb-7',
    filename: 'banchina_vuota_prospettiva.arw',
    title: 'Banchina binario tronca',
    subtitle: 'linee di fuga verso l’oscurità',
    author: 'Andrea',
    authorAvatar: 'AF',
    authorColor: '#C9B27C',
    date: '15 ott',
    tag: 'Inquadratura',
    camera: 'Sony A7S III',
    lens: 'Sigma 14-24mm f/2.8 DG DN',
    exposure: '1/40 s · f/2.8',
    iso: '6400',
    wb: '3200 K',
    dimensions: '4240 × 2832 · 19,0 MB',
    shotAt: '15 ott, 23:55',
    palette: ['#0A0C0E', '#18202A', '#3A4552', '#808086', '#EDEDED'],
    tags: ['Inquadratura', 'Prospettiva', 'Banchina'],
    sourceUrl: 'drive.studio/ultima-corsa/sopralluoghi',
    sourceLabel: 'drive.studio/…/sopralluoghi',
    usedIn: [{ label: 'Storyboard 4D ↗' }],
    comments: [],
  },
  {
    id: 'mb-8',
    filename: 'semaforo_riflesso_asfalto.arw',
    title: 'Semaforo giallo bagnato',
    subtitle: 'colore d’accento strada vuota',
    author: 'Matteo',
    authorAvatar: 'MV',
    authorColor: '#8A8A90',
    date: '16 ott',
    tag: 'Colore',
    camera: 'Sony A7S III',
    lens: 'Sony 50mm f/1.2 GM',
    exposure: '1/50 s · f/1.4',
    iso: '2000',
    wb: '3600 K',
    dimensions: '4240 × 2832 · 17,5 MB',
    shotAt: '16 ott, 01:40',
    palette: ['#120E0A', '#2E2214', '#5E4424', '#C9A36A', '#F2B08A'],
    tags: ['Colore', 'Semaforo', 'Giallo'],
    sourceUrl: 'drive.studio/ultima-corsa/color',
    sourceLabel: 'drive.studio/…/color',
    usedIn: [{ label: 'Storyboard 5B ↗' }],
    comments: [],
  },
  {
    id: 'mb-9',
    filename: 'stazione_binario_panoramica.arw',
    title: 'Campata volta in ferro',
    subtitle: 'tettoia stazione stile liberty',
    author: 'Andrea',
    authorAvatar: 'AF',
    authorColor: '#C9B27C',
    date: '16 ott',
    tag: 'Location',
    camera: 'Sony A7S III',
    lens: 'Sigma 24mm f/1.4 DG DN',
    exposure: '1/50 s · f/1.8',
    iso: '4000',
    wb: '3400 K',
    dimensions: '4240 × 2832 · 18,7 MB',
    shotAt: '16 ott, 02:30',
    palette: ['#0E1318', '#202A36', '#48586A', '#9DB8F2', '#EDEDED'],
    tags: ['Location', 'Architettura', 'Ferro'],
    sourceUrl: 'drive.studio/ultima-corsa/sopralluoghi',
    sourceLabel: 'drive.studio/…/sopralluoghi',
    usedIn: [{ label: 'Storyboard 4A ↗' }],
    comments: [],
  },
];

export function MoodboardView({
  projectId: _projectId,
  onClose,
}: {
  projectId: string;
  onClose?: () => void;
}) {
  const [items, setItems] = useState<MoodboardItem[]>(DEFAULT_ITEMS);
  const [activeIdx, setActiveIdx] = useState(2); // Item 3 (binario21_notte.arw) is active by default
  const [compareAB, setCompareAB] = useState(false);
  const [compareSplit, setCompareSplit] = useState(50);
  const [copiedHex, setCopiedHex] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [zoomLevel, setZoomLevel] = useState<'fit' | '100%' | '150%'>('fit');

  const current = items[activeIdx] ?? items[0];
  const compareItem = items[(activeIdx + 1) % items.length];

  const handlePrev = useCallback(() => {
    setActiveIdx((prev) => (prev > 0 ? prev - 1 : items.length - 1));
  }, [items.length]);

  const handleNext = useCallback(() => {
    setActiveIdx((prev) => (prev < items.length - 1 ? prev + 1 : 0));
  }, [items.length]);

  // Keyboard navigation matching mockup:
  // ← / → arrows to cycle, Space to toggle 100% zoom, Esc to close
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setZoomLevel((z) => (z === 'fit' ? '100%' : 'fit'));
      } else if (e.key === 'Escape' && onClose) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePrev, handleNext, onClose]);

  if (!current || !compareItem) return null;

  const copyToClipboard = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopiedHex(hex);
      setTimeout(() => setCopiedHex(null), 2000);
    } catch {
      setCopiedHex(hex);
      setTimeout(() => setCopiedHex(null), 2000);
    }
  };

  const copyAllPalette = async () => {
    try {
      await navigator.clipboard.writeText(current.palette.join(', '));
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    }
  };

  const removeTag = (tagToRemove: string) => {
    setItems((prev) =>
      prev.map((item, i) =>
        i === activeIdx ? { ...item, tags: item.tags.filter((tg) => tg !== tagToRemove) } : item,
      ),
    );
  };

  const addTagPrompt = () => {
    const val = prompt('Nuovo tag:');
    if (val?.trim()) {
      setItems((prev) =>
        prev.map((item, i) =>
          i === activeIdx && !item.tags.includes(val.trim())
            ? { ...item, tags: [...item.tags, val.trim()] }
            : item,
        ),
      );
    }
  };

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    const commentObj = {
      id: `c-${Date.now()}`,
      author: 'Matteo',
      avatar: 'MV',
      avatarColor: '#8A8A90',
      time: 'adesso',
      text: newComment.trim(),
    };
    setItems((prev) =>
      prev.map((item, i) =>
        i === activeIdx ? { ...item, comments: [...item.comments, commentObj] } : item,
      ),
    );
    setNewComment('');
  };

  return (
    <div className="moodboard-view">
      {/* Top Header Bar */}
      <div className="moodboard-topbar">
        <span style={{ fontWeight: 600, fontSize: 13, color: '#ededed' }}>{current.filename}</span>
        <span className="ink-muted" style={{ fontSize: 12 }}>
          {activeIdx + 1} / {items.length}
        </span>
        <span
          className="pill"
          style={{ background: '#3A2418', color: '#F2B08A', marginLeft: 4, fontSize: 10 }}
        >
          {current.tag}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="btn"
          onClick={() => setCompareAB((c) => !c)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: compareAB ? '#1E2A44' : '#1C1C1F',
            color: compareAB ? '#9DB8F2' : '#EDEDED',
            borderColor: compareAB ? '#3B7CF6' : '#2A2A2E',
          }}
        >
          <svg
            className="ico"
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={{ width: 14, height: 14 }}
          >
            <rect x="3" y="5" width="8" height="14" rx="1" />
            <rect x="13" y="5" width="8" height="14" rx="1" />
          </svg>
          Confronta A/B
        </button>
        <button
          type="button"
          className="btn"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => alert(`Download originale: ${current.filename}`)}
        >
          <svg
            className="ico"
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={{ width: 14, height: 14 }}
          >
            <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
          </svg>
          Scarica originale
        </button>
        {onClose && (
          <button
            type="button"
            className="btn"
            aria-label="Chiudi"
            onClick={onClose}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            Chiudi <span className="kbd">esc</span>
          </button>
        )}
      </div>

      <div className="moodboard-body">
        {/* Main Artwork Stage */}
        <div className="moodboard-stage">
          {/* Previous / Next Arrow Floating Buttons */}
          <button
            type="button"
            className="moodboard-nav-btn is-prev"
            aria-label="Immagine precedente"
            onClick={handlePrev}
          >
            <svg
              className="ico"
              viewBox="0 0 24 24"
              aria-hidden="true"
              style={{ width: 18, height: 18 }}
            >
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            className="moodboard-nav-btn is-next"
            aria-label="Immagine successiva"
            onClick={handleNext}
          >
            <svg
              className="ico"
              viewBox="0 0 24 24"
              aria-hidden="true"
              style={{ width: 18, height: 18 }}
            >
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Central Artwork Display */}
          <div className="moodboard-canvas-wrapper">
            <div
              className={`moodboard-canvas-art ${zoomLevel === '100%' ? 'is-zoom-100' : zoomLevel === '150%' ? 'is-zoom-150' : 'is-zoom-fit'}`}
            >
              {compareAB ? (
                <div className="moodboard-split-view">
                  <svg
                    role="img"
                    aria-label={`Riferimento B: ${compareItem.title}`}
                    viewBox="0 0 702 480"
                    preserveAspectRatio="xMidYMid slice"
                    className="moodboard-svg-base"
                  >
                    <rect width="702" height="480" fill={compareItem.palette[0]} />
                    <circle cx="351" cy="240" r="160" fill={compareItem.palette[1]} opacity="0.6" />
                    <path
                      d="M100 400 L350 150 L600 400 Z"
                      fill={compareItem.palette[3]}
                      opacity="0.7"
                    />
                    <text
                      x="30"
                      y="50"
                      fill="#ffffff"
                      fontSize="14"
                      fontFamily="Inter, sans-serif"
                      opacity="0.8"
                    >
                      B: {compareItem.title}
                    </text>
                  </svg>
                  <div
                    className="moodboard-split-overlay"
                    style={{ width: `${compareSplit}%`, overflow: 'hidden' }}
                  >
                    <svg
                      role="img"
                      aria-label={`Riferimento A: ${current.title}`}
                      viewBox="0 0 702 480"
                      preserveAspectRatio="xMidYMid slice"
                      style={{ width: 702, height: 480, display: 'block' }}
                    >
                      <defs>
                        <linearGradient id="skyMbSplit" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0" stopColor={current.palette[0]} />
                          <stop offset="1" stopColor={current.palette[1]} />
                        </linearGradient>
                      </defs>
                      <rect width="702" height="480" fill="url(#skyMbSplit)" />
                      <path
                        d="M90 380 L90 150 L610 150 L610 380 M160 150 L350 40 L540 150"
                        fill="none"
                        stroke={current.palette[2]}
                        strokeWidth="3"
                      />
                      <g fill={current.palette[3]}>
                        <rect x="180" y="210" width="50" height="70" />
                        <rect x="325" y="210" width="50" height="70" />
                        <rect x="470" y="210" width="50" height="70" />
                      </g>
                      <path d="M0 380 L702 380" stroke="#2E3742" strokeWidth="4" />
                      <text
                        x="30"
                        y="50"
                        fill="#ffffff"
                        fontSize="14"
                        fontFamily="Inter, sans-serif"
                        opacity="0.8"
                      >
                        A: {current.title}
                      </text>
                    </svg>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="95"
                    value={compareSplit}
                    onChange={(e) => setCompareSplit(Number(e.target.value))}
                    className="moodboard-split-slider"
                    aria-label="Separatore confronto A/B"
                  />
                  <div className="moodboard-split-handle" style={{ left: `${compareSplit}%` }}>
                    ⇆
                  </div>
                </div>
              ) : (
                <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                  <svg
                    role="img"
                    aria-label={current.title}
                    viewBox="0 0 702 480"
                    preserveAspectRatio="xMidYMid slice"
                    className="moodboard-svg-base"
                  >
                    <defs>
                      <linearGradient id="skyMb" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor={current.palette[0]} />
                        <stop offset="1" stopColor={current.palette[1]} />
                      </linearGradient>
                    </defs>
                    <rect width="702" height="480" fill="url(#skyMb)" />
                    <path
                      d="M90 380 L90 150 L610 150 L610 380 M160 150 L350 40 L540 150"
                      fill="none"
                      stroke={current.palette[2]}
                      strokeWidth="3.2"
                    />
                    <g fill={current.palette[3]}>
                      <rect x="180" y="210" width="50" height="70" />
                      <rect x="325" y="210" width="50" height="70" />
                      <rect x="470" y="210" width="50" height="70" />
                    </g>
                    <g fill={current.palette[3]} opacity="0.14">
                      <rect x="165" y="195" width="80" height="100" />
                      <rect x="310" y="195" width="80" height="100" />
                      <rect x="455" y="195" width="80" height="100" />
                    </g>
                    <path d="M0 380 L702 380" stroke="#2E3742" strokeWidth="4" />
                    <path
                      d="M0 480 L280 380 M702 480 L420 380"
                      stroke="#3A4552"
                      strokeWidth="2.4"
                    />
                    <rect
                      y="380"
                      width="702"
                      height="100"
                      fill={current.palette[0]}
                      opacity="0.85"
                    />
                    <circle cx="350" cy="410" r="4" fill={current.palette[4]} />
                  </svg>
                  {/* Pin marker 1 linked to comment */}
                  <span
                    aria-hidden="true"
                    className="moodboard-pin-marker"
                    style={{ left: '59%', top: '73%' }}
                  >
                    1
                  </span>
                </div>
              )}
            </div>

            {/* Caption & Zoom Controls */}
            <div className="moodboard-caption-bar">
              <span className="ink-muted">
                {current.title} · {current.subtitle}
              </span>
              <div style={{ display: 'flex', gap: 2, alignItems: 'center', color: '#9A9A9A' }}>
                <button
                  type="button"
                  className="ib"
                  aria-label="Riduci zoom"
                  onClick={() => setZoomLevel('fit')}
                  style={{ width: 24, height: 24 }}
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setZoomLevel((z) => (z === 'fit' ? '100%' : z === '100%' ? '150%' : 'fit'))
                  }
                  style={{
                    width: 52,
                    textAlign: 'center',
                    background: 'none',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  {zoomLevel === 'fit' ? 'Adatta' : zoomLevel}
                </button>
                <button
                  type="button"
                  className="ib"
                  aria-label="Ingrandisci zoom"
                  onClick={() => setZoomLevel((z) => (z === 'fit' ? '100%' : '150%'))}
                  style={{ width: 24, height: 24 }}
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {/* Bottom Thumbnails Carousel (9 items) */}
          <div className="moodboard-carousel">
            {items.map((item, idx) => (
              <button
                type="button"
                key={item.id}
                aria-label={`Immagine ${idx + 1} di ${items.length}: ${item.title}`}
                className={`moodboard-thumb-btn ${idx === activeIdx ? 'is-active' : ''}`}
                onClick={() => setActiveIdx(idx)}
              >
                <svg
                  viewBox="0 0 70 40"
                  preserveAspectRatio="xMidYMid slice"
                  aria-hidden="true"
                  style={{ display: 'block', width: '100%', height: '100%' }}
                >
                  <rect width="70" height="40" fill={item.palette[0]} />
                  <circle cx="35" cy="20" r="12" fill={item.palette[3]} opacity="0.6" />
                  <path
                    d="M10 32 L35 12 L60 32"
                    fill="none"
                    stroke={item.palette[4]}
                    strokeWidth="1.6"
                  />
                </svg>
              </button>
            ))}
          </div>

          {/* Keyboard & Feature Hint Footnotes */}
          <div className="moodboard-hints">
            <span className="lg">
              <i>1</i>← → per scorrere, spazio per lo zoom al 100%
            </span>
            <span className="lg">
              <i>2</i>Clic su un colore per copiarne l'esadecimale
            </span>
            <span className="lg">
              <i>3</i>Confronta affianca due riferimenti
            </span>
          </div>
        </div>

        {/* Right Drawer: Dettagli immagine */}
        <aside className="moodboard-drawer" aria-label="Dettagli immagine">
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#ededed' }}>{current.title}</div>
            <div
              className="ink-muted"
              style={{
                fontSize: 11,
                marginTop: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  fontSize: 7,
                  background: current.authorColor,
                  color: '#141414',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 600,
                }}
              >
                {current.authorAvatar}
              </span>
              Caricata da {current.author} · {current.date}
            </div>
          </div>

          {/* Dati di scatto */}
          <section aria-label="Dati di scatto" style={{ fontSize: 12 }}>
            <div className="sec" style={{ padding: '0 0 6px' }}>
              Dati di scatto
            </div>
            <div className="moodboard-exif-row">
              <span className="ink-muted">Fotocamera</span>
              <span>{current.camera}</span>
            </div>
            <div className="moodboard-exif-row">
              <span className="ink-muted">Ottica</span>
              <span>{current.lens}</span>
            </div>
            <div className="moodboard-exif-row">
              <span className="ink-muted">Esposizione</span>
              <span>{current.exposure}</span>
            </div>
            <div className="moodboard-exif-row">
              <span className="ink-muted">ISO</span>
              <span>{current.iso}</span>
            </div>
            <div className="moodboard-exif-row">
              <span className="ink-muted">Bilanciamento</span>
              <span>{current.wb}</span>
            </div>
            <div className="moodboard-exif-row">
              <span className="ink-muted">Dimensioni</span>
              <span>{current.dimensions}</span>
            </div>
            <div className="moodboard-exif-row">
              <span className="ink-muted">Scattata</span>
              <span>{current.shotAt}</span>
            </div>
          </section>

          {/* Palette estratta */}
          <section aria-label="Palette estratta" style={{ position: 'relative' }}>
            <div className="sec" style={{ padding: '0 0 8px' }}>
              Palette estratta
              <button
                type="button"
                onClick={copyAllPalette}
                style={{
                  border: 0,
                  background: 'transparent',
                  color: '#9A9A9A',
                  font: '500 11px Inter, sans-serif',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {copiedAll ? 'Copiato!' : 'Copia tutto'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {current.palette.map((hex) => (
                <button
                  type="button"
                  key={hex}
                  aria-label={`Copia ${hex}`}
                  onClick={() => copyToClipboard(hex)}
                  className="moodboard-color-swatch-btn"
                >
                  <span
                    className="moodboard-color-swatch-box"
                    style={{
                      background: hex,
                      outline: copiedHex === hex ? '1.5px solid #EDEDED' : 'none',
                      outlineOffset: 2,
                    }}
                  />
                  <span style={{ color: copiedHex === hex ? '#EDEDED' : '#9A9A9A' }}>
                    {hex.replace('#', '')}
                  </span>
                </button>
              ))}
            </div>
            {copiedHex && <div className="moodboard-copied-toast">Copiato {copiedHex}</div>}
          </section>

          {/* Tag */}
          <section aria-label="Tag">
            <div className="sec" style={{ padding: '0 0 8px' }}>
              Tag
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {current.tags.map((tg) => (
                <span
                  key={tg}
                  className="pill"
                  style={{
                    background: '#3A2418',
                    color: '#F2B08A',
                    padding: '3px 8px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {tg}
                  <button
                    type="button"
                    onClick={() => removeTag(tg)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'inherit',
                      padding: 0,
                      cursor: 'pointer',
                      fontSize: 12,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={addTagPrompt}
                style={{
                  fontSize: 11,
                  color: '#808086',
                  border: '1px dashed #333338',
                  borderRadius: 99,
                  padding: '2px 9px',
                  background: 'none',
                  cursor: 'pointer',
                }}
              >
                + Aggiungi
              </button>
            </div>
          </section>

          {/* Fonte e utilizzo */}
          <section
            aria-label="Fonte e utilizzo"
            style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span className="ink-muted">Fonte</span>
              <a
                href={`https://${current.sourceUrl}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: '#9DB8F2',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 190,
                }}
              >
                {current.sourceLabel}
              </a>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 10,
                alignItems: 'center',
              }}
            >
              <span className="ink-muted">Usato in</span>
              <span style={{ display: 'flex', gap: 6 }}>
                {current.usedIn.map((u) => (
                  <span
                    key={u.label}
                    className="pill"
                    style={{
                      background: '#1C1C1F',
                      border: '1px solid #2A2A2E',
                      color: '#EDEDED',
                      fontSize: 10,
                    }}
                  >
                    {u.label}
                  </span>
                ))}
              </span>
            </div>
          </section>

          {/* Commenti */}
          <section
            aria-label="Commenti"
            style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}
          >
            <div className="sec" style={{ padding: 0 }}>
              Commenti
              <span className="cnt" style={{ textTransform: 'none' }}>
                {current.comments.length}
              </span>
            </div>
            <div className="moodboard-comments-list">
              {current.comments.map((cm) => (
                <div
                  key={cm.id}
                  style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.45 }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      fontSize: 8,
                      background: cm.avatarColor,
                      color: '#141414',
                      display: 'grid',
                      placeItems: 'center',
                      flex: 'none',
                      fontWeight: 600,
                    }}
                  >
                    {cm.avatar}
                  </span>
                  <div>
                    <b style={{ fontWeight: 600, color: '#ededed' }}>{cm.author}</b>{' '}
                    <span style={{ color: '#808086' }}>
                      · {cm.time} {cm.target && `· ${cm.target}`}
                    </span>
                    <br />
                    <span style={{ color: '#c8c8cc' }}>{cm.text}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="moodboard-comment-input-box">
              <input
                type="text"
                placeholder="Rispondi, @ per menzionare"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddComment();
                  }
                }}
                className="moodboard-comment-input"
              />
              <button
                type="button"
                className="kbd"
                onClick={handleAddComment}
                style={{ cursor: 'pointer', background: 'transparent' }}
              >
                ↵
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
