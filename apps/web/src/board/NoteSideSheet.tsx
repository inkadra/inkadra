import type { Element, NoteElement } from '@inkadra/canvas-core';
import { useEffect, useState } from 'react';
import './note-sheet.css';

interface TaskItem {
  id: string;
  text: string;
  completed: boolean;
}

interface NoteComment {
  id: string;
  author: string;
  avatar: string;
  avatarColor: string;
  time: string;
  text: string;
  replies?: number;
  highlightY: number; // Y offset of connected line
}

export function NoteSideSheet({
  element,
  projectName: _projectName = 'Ultima corsa',
  onClose,
  onOpenStoryboard,
}: {
  element?: Element | null;
  projectName?: string;
  onClose: () => void;
  onOpenStoryboard?: () => void;
}) {
  const [slashOpen, setSlashOpen] = useState(false);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(4); // Default on "Inquadratura"
  const [slashQuery] = useState('');
  const [tasks, setTasks] = useState<TaskItem[]>([
    { id: 't-1', text: 'Chiudere il finale con Giulia', completed: true },
    { id: 't-2', text: 'Rileggere i dialoghi della scena 6', completed: false },
  ]);
  const [resolvedCount, setResolvedCount] = useState(4);
  const [comments, setComments] = useState<NoteComment[]>([
    {
      id: 'nc-1',
      author: 'Matteo',
      avatar: 'MV',
      avatarColor: '#8A8A90',
      time: 'ieri',
      text: '"Carriera" o "vita"? Il cliente non deve sapere che è l\'ultimo.',
      replies: 1,
      highlightY: 147,
    },
    {
      id: 'nc-2',
      author: 'Andrea',
      avatar: 'AF',
      avatarColor: '#C9B27C',
      time: '3 h',
      text: 'La stazione chiusa esiste: binario 21, permesso già chiesto.',
      highlightY: 285,
    },
  ]);

  const slashOptions = [
    { icon: 'H', label: 'Titolo', shortcut: '#' },
    { icon: '•', label: 'Elenco', shortcut: '-' },
    { icon: '☐', label: 'To-do', shortcut: '[]' },
    { icon: '▣', label: 'Immagine', shortcut: '' },
    { icon: '▭', label: 'Inquadratura', shortcut: '↵' },
    { icon: '▦', label: 'Tabella', shortcut: '' },
    { icon: '↗', label: 'Link a board', shortcut: '[[' },
  ];

  const filteredSlash = slashOptions.filter((opt) =>
    opt.label.toLowerCase().includes(slashQuery.toLowerCase()),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (slashOpen) {
          e.preventDefault();
          setSlashOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slashOpen, onClose]);

  const toggleTask = (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)));
  };

  const resolveComment = (id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
    setResolvedCount((r) => r + 1);
  };

  const addSlashBlock = (label: string) => {
    if (label === 'To-do') {
      const newTask = prompt('Nuovo task:');
      if (newTask?.trim()) {
        setTasks((prev) => [
          ...prev,
          { id: `t-${Date.now()}`, text: newTask.trim(), completed: false },
        ]);
      }
    }
    setSlashOpen(false);
  };

  const noteTitle = (element as NoteElement)?.title || 'Logline e trattamento';

  return (
    <aside
      className="note-sidesheet"
      role="dialog"
      aria-label={`Nota: ${noteTitle}`}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* Top Header Bar */}
      <div className="note-sidesheet__header">
        <button
          type="button"
          className="ib"
          aria-label="Apri a tutta pagina"
          style={{ width: 26, height: 26 }}
          onClick={() => alert('Modalità a tutta pagina')}
        >
          <svg
            className="ico"
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={{ width: 15, height: 15 }}
          >
            <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
          </svg>
        </button>
        <div className="note-sidesheet__author">
          <span className="note-sidesheet__av" style={{ background: '#7CC4C9' }}>
            GL
          </span>
          <span>Modificata 2 min fa da Giulia</span>
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="btn"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <svg
            className="ico"
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={{ width: 14, height: 14 }}
          >
            <path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4M12 8v4l3 2" />
          </svg>
          Cronologia · v12
        </button>
        <button
          type="button"
          className="btn"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => alert('Condivisione nota')}
        >
          Condividi
        </button>
        <button type="button" className="ib" aria-label="Altro" style={{ width: 26, height: 26 }}>
          ⋯
        </button>
        <button
          type="button"
          className="ib"
          aria-label="Chiudi"
          style={{ width: 26, height: 26 }}
          onClick={onClose}
        >
          <svg
            className="ico"
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={{ width: 15, height: 15 }}
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="note-sidesheet__content">
        {/* Document Article */}
        <article className="note-sidesheet__doc">
          <h1 className="note-sidesheet__title">{noteTitle}</h1>

          <div className="note-sidesheet__meta-row">
            <button
              type="button"
              className="note-sidesheet__storyboard-link"
              onClick={onOpenStoryboard}
            >
              <svg
                className="ico"
                viewBox="0 0 24 24"
                aria-hidden="true"
                style={{ width: 13, height: 13, color: '#9DB8F2' }}
              >
                <rect x="2" y="7" width="9" height="6" rx="1" />
                <rect x="13" y="7" width="9" height="6" rx="1" />
              </svg>
              Storyboard · Scena 4<span className="ink-muted">↗</span>
            </button>
            <span className="pill" style={{ background: '#1E2A44', color: '#9DB8F2' }}>
              Script
            </span>
            <span className="pill" style={{ background: '#3A2418', color: '#F2B08A' }}>
              In revisione
            </span>
          </div>

          <h2 className="note-sidesheet__h2">Logline</h2>
          <p className="note-sidesheet__p">
            Un tassista notturno accompagna{' '}
            <span className="note-highlight-blue">l'ultimo cliente della sua carriera</span>{' '}
            attraverso una città che non riconosce più.
          </p>

          <h2 className="note-sidesheet__h2">Trattamento</h2>
          <p className="note-sidesheet__p">
            Antonio guida da trentadue anni. Nell'ultima notte prima della pensione carica un uomo
            che chiede di andare{' '}
            <span className="note-highlight-purple">in una stazione chiusa dal 1998</span>.{' '}
            <span className="note-mention">@Giulia</span> propone di girarla tutta in tempo reale.
          </p>

          {/* Linked reference card */}
          <figure className="note-sidesheet__figure-card">
            <svg
              role="img"
              aria-label="Segnaposto: stazione di notte"
              viewBox="0 0 300 150"
              preserveAspectRatio="xMidYMid slice"
              className="note-sidesheet__figure-svg"
            >
              <rect width="300" height="150" fill="#1B222B" />
              <path
                d="M50 122 L50 50 L250 50 L250 122 M80 50 L150 18 L220 50"
                fill="none"
                stroke="#4E5864"
                strokeWidth="2"
              />
              <g fill="#C9A36A">
                <rect x="88" y="70" width="20" height="28" />
                <rect x="140" y="70" width="20" height="28" />
                <rect x="192" y="70" width="20" height="28" />
              </g>
            </svg>
            <figcaption className="note-sidesheet__figure-caption">
              <span style={{ fontWeight: 500, color: '#ededed' }}>
                Stazione Centrale, binario 21
              </span>
              <span className="ink-muted" style={{ fontSize: 12 }}>
                Da Location · aggiornata con il board
              </span>
            </figcaption>
          </figure>

          {/* Interactive To-Do List */}
          <div className="note-sidesheet__tasks">
            {tasks.map((task) => (
              <label
                key={task.id}
                className={`note-task-label ${task.completed ? 'is-completed' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => toggleTask(task.id)}
                  className="note-task-chk"
                />
                <span>{task.text}</span>
              </label>
            ))}
          </div>

          {/* Slash command input trigger */}
          <div className="note-sidesheet__slash-row">
            <button
              type="button"
              className="note-slash-trigger-btn"
              onClick={() => setSlashOpen((s) => !s)}
            >
              <span style={{ color: '#ededed' }}>/</span>
              <span className="note-slash-cursor" />
              <span style={{ color: '#4A4A4E', marginLeft: 6 }}>Scrivi o premi / per inserire</span>
            </button>

            {/* Slash command block popover */}
            {slashOpen && (
              <div role="listbox" aria-label="Inserisci blocco" className="note-slash-popover">
                <div className="note-slash-popover__title">Blocchi</div>
                {filteredSlash.map((opt, idx) => (
                  <button
                    type="button"
                    key={opt.label}
                    role="option"
                    aria-selected={idx === selectedSlashIndex}
                    className={`note-slash-option ${idx === selectedSlashIndex ? 'is-selected' : ''}`}
                    onClick={() => addSlashBlock(opt.label)}
                    onMouseEnter={() => setSelectedSlashIndex(idx)}
                  >
                    <span className="note-slash-option__icon">{opt.icon}</span>
                    <span>{opt.label}</span>
                    {opt.shortcut && (
                      <span className="note-slash-option__shortcut">{opt.shortcut}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </article>

        {/* Marginal Comments Column */}
        <aside className="note-sidesheet__comments-margin" aria-label="Commenti">
          <div className="note-comments-header">
            <span>{comments.length} commenti aperti</span>
            <span style={{ cursor: 'pointer' }}>Risolti ({resolvedCount})</span>
          </div>

          {comments.map((cm) => (
            <div
              key={cm.id}
              className="note-comment-card"
              style={{
                borderColor: cm.id === 'nc-1' ? '#3B7CF6' : '#26262A',
              }}
            >
              {/* Connector line to highlight */}
              <div
                className="note-comment-connector"
                style={{
                  background: cm.id === 'nc-1' ? '#3B7CF6' : '#C3B2F2',
                }}
              />
              <div className="note-comment-head">
                <span className="note-comment-av" style={{ background: cm.avatarColor }}>
                  {cm.avatar}
                </span>
                <b>{cm.author}</b>
                <span className="ink-muted" style={{ fontSize: 11 }}>
                  {cm.time}
                </span>
              </div>
              <p className="note-comment-text">{cm.text}</p>
              <div className="note-comment-actions">
                {cm.replies ? <span>{cm.replies} risposta · Rispondi</span> : <span>Rispondi</span>}
                <button
                  type="button"
                  className="note-comment-resolve-btn"
                  onClick={() => resolveComment(cm.id)}
                >
                  · Risolvi
                </button>
              </div>
            </div>
          ))}

          {/* Bottom Shortcuts / Legend */}
          <div className="note-sidesheet__legend">
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="note-legend-badge">1</span>
              <span>
                Digita <span className="kc">/</span> per inserire blocchi; un'inquadratura inserita
                resta collegata allo storyboard.
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="note-legend-badge">2</span>
              <span>
                Evidenzia il testo e premi <span className="kc">⌘</span>
                <span className="kc">⇧</span>
                <span className="kc">M</span> per commentare.
              </span>
            </div>
          </div>
        </aside>
      </div>
    </aside>
  );
}
