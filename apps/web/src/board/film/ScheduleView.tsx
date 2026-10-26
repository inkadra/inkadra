// SPDX-License-Identifier: AGPL-3.0-only
import { type DragEvent, useMemo, useState } from 'react';
import type { BoardStore } from '../store.ts';
import { CallSheetModal } from './CallSheetModal.tsx';

interface ScheduleBlock {
  id: string;
  day: number;
  type: 'call' | 'setup' | 'scene' | 'meal' | 'move' | 'wrap' | 'slot';
  title: string;
  scene?: string;
  subtitle?: string;
  details?: string;
  startHour: number; // e.g. 18.5 for 18:30
  durationHours: number;
  accentColor?: string;
  badge?: { text: string; bg: string; color: string };
  warning?: boolean;
  planned?: string;
  estimated?: string;
  location?: string;
  locationNotes?: string;
  cast?: Array<{ name: string; actor: string; call: string; pickup?: string }>;
  shots?: Array<{ code: string; desc: string; duration: string }>;
  departments?: string[];
}

const DEFAULT_BLOCKS: ScheduleBlock[] = [
  // Day 1: Mer 22 ottobre
  {
    id: 'd1-call',
    day: 1,
    type: 'call',
    title: '18:30 Convocazione troupe',
    startHour: 18.5,
    durationHours: 0.5,
  },
  {
    id: 'd1-setup',
    day: 1,
    type: 'setup',
    title: 'Allestimento luci',
    subtitle: 'Binario 21 · setup 1 di 3',
    details: 'Gaffer + 3 elettricisti',
    startHour: 19.0,
    durationHours: 2.0,
    accentColor: '#3A3A40',
    planned: '2h 00',
    estimated: '1h 50',
    location: 'Stazione Centrale, binario 21',
  },
  {
    id: 'd1-sc4a',
    day: 1,
    type: 'scene',
    title: 'Sc.4 · Il binario',
    scene: 'Scena 4 · EST notte',
    subtitle: '4A–4C · 3 setup · 6 inq.',
    details: 'AN · SA   stimato 3h20 / 3h30',
    startHour: 21.0,
    durationHours: 3.5,
    accentColor: '#9DB8F2',
    planned: '3h 30',
    estimated: '3h 20',
    location: 'Stazione Centrale, binario 21',
    cast: [
      { name: 'Antonio', actor: 'Marco R.', call: '20:45', pickup: '19:00' },
      { name: 'La cliente', actor: 'Sara L.', call: '21:00', pickup: '19:15' },
    ],
    shots: [
      { code: '4A', desc: 'Arrivo taxi al binario', duration: '0:35' },
      { code: '4B', desc: 'Antonio scende con la valigia', duration: '0:45' },
      { code: '4C', desc: 'Controcampo la cliente nel taxi', duration: '0:40' },
    ],
    departments: ['Alexa Mini · 24/35', 'Luce practical stazione'],
  },
  {
    id: 'd1-meal',
    day: 1,
    type: 'meal',
    title: 'Pausa pasto · 45 min',
    startHour: 24.5,
    durationHours: 0.75,
  },
  {
    id: 'd1-sc4b',
    day: 1,
    type: 'scene',
    title: 'Sc.4 · Il binario',
    scene: 'Scena 4 · EST notte',
    subtitle: '4D–4F · 2 setup · 5 inq.',
    details: 'AN · LB   stimato 3h05 / 2h45',
    startHour: 25.25,
    durationHours: 2.75,
    accentColor: '#9DB8F2',
    badge: { text: '+20 min', bg: '#3A2418', color: '#F2B08A' },
    planned: '2h 45',
    estimated: '3h 05',
    location: 'Stazione Centrale, binario 21',
  },
  {
    id: 'd1-wrap',
    day: 1,
    type: 'wrap',
    title: 'Smontaggio e rientro',
    startHour: 28.0,
    durationHours: 1.0,
  },

  // Day 2: Gio 23 ottobre
  {
    id: 'd2-call',
    day: 2,
    type: 'call',
    title: '19:00 Convocazione troupe',
    startHour: 19.0,
    durationHours: 0.5,
  },
  {
    id: 'sc3',
    day: 2,
    type: 'scene',
    title: 'Sc.3 · Bar Lume',
    scene: 'Scena 3 · INT notte',
    subtitle: '3A–3E · 2 setup · 5 inq.',
    details: 'AN · SA   stimato 3h10 / 3h30',
    startHour: 20.0,
    durationHours: 3.5,
    accentColor: '#C3B2F2',
    planned: '3h 30',
    estimated: '3h 10',
    location: 'Bar Lume, via Ferrante 12',
    locationNotes: 'Parcheggio furgoni sul retro · corrente 32A',
    cast: [
      { name: 'Antonio', actor: 'Marco R.', call: '19:30', pickup: '19:00' },
      { name: 'La cliente', actor: 'Sara L.', call: '19:45' },
    ],
    shots: [
      { code: '3A', desc: 'Insegna, campo lungo', duration: '0:35' },
      { code: '3B', desc: 'Antonio al bancone', duration: '0:45' },
      { code: '3C', desc: 'Controcampo, la cliente', duration: '0:40' },
      { code: '3D', desc: 'Mani sul bicchiere', duration: '0:30' },
      { code: '3E', desc: 'Uscita, neon sul viso', duration: '0:40' },
    ],
    departments: ['Neon practical', 'Alexa Mini · 35/50', 'Fumo leggero'],
  },
  {
    id: 'd2-move',
    day: 2,
    type: 'move',
    title: '⇢ Spostamento · 12 min',
    startHour: 23.5,
    durationHours: 0.25,
  },
  {
    id: 'd2-sc5',
    day: 2,
    type: 'scene',
    title: 'Sc.5 · Strada bagnata',
    scene: 'Scena 5 · EST notte',
    subtitle: '5A–5C · 2 setup · 4 inq.',
    details: 'AN · pioggia artificiale',
    startHour: 23.75,
    durationHours: 3.25,
    accentColor: '#F2B08A',
    badge: { text: '! Cast', bg: '#3D1E1A', color: '#F2A99A' },
    warning: true,
    planned: '3h 15',
    estimated: '3h 00',
    location: 'via Ferrante 12',
    cast: [{ name: 'Antonio', actor: 'Marco R.', call: '23:45' }],
    shots: [
      { code: '5A', desc: 'Strada allagata, pozzanghere', duration: '0:30' },
      { code: '5B', desc: 'Taxi arriva sotto la pioggia', duration: '0:40' },
      { code: '5C', desc: 'Primo piano tergicristalli', duration: '0:25' },
    ],
    departments: ['Pioggia artificiale', 'Camion cisterna', 'Protezioni antipioggia'],
  },
  {
    id: 'd2-wrap',
    day: 2,
    type: 'wrap',
    title: 'Smontaggio',
    startHour: 27.0,
    durationHours: 1.0,
  },

  // Day 3: Ven 24 ottobre
  {
    id: 'd3-call',
    day: 3,
    type: 'call',
    title: '18:30 Convocazione troupe',
    startHour: 18.5,
    durationHours: 0.5,
  },
  {
    id: 'd3-sc6',
    day: 3,
    type: 'scene',
    title: 'Sc.6 · Il taxi, interno',
    scene: 'Scena 6 · INT notte',
    subtitle: '6A–6D · car rig · 4 inq.',
    details: 'AN · SA   stimato 3h / 3h30',
    startHour: 19.5,
    durationHours: 3.5,
    accentColor: '#F2B08A',
    planned: '3h 30',
    estimated: '3h 00',
    location: 'Car rig taxi, circonvallazione',
    cast: [
      { name: 'Antonio', actor: 'Marco R.', call: '19:00', pickup: '18:00' },
      { name: 'La cliente', actor: 'Sara L.', call: '19:30', pickup: '18:30' },
    ],
  },
  {
    id: 'd3-meal',
    day: 3,
    type: 'meal',
    title: 'Pausa pasto · 45 min',
    startHour: 23.0,
    durationHours: 0.75,
  },
  {
    id: 'd3-sc7',
    day: 3,
    type: 'scene',
    title: 'Sc.7 · Alba',
    scene: 'Scena 7 · EST alba',
    subtitle: 'finestra 06:50–07:21',
    details: 'luce naturale · 2 inq.',
    startHour: 28.8,
    durationHours: 1.5,
    accentColor: '#C3B2F2',
    planned: '1h 30',
    estimated: '1h 15',
    location: 'Navigli, ponte pedonale',
  },
];

interface UnplannedShot {
  code: string;
  sceneNum: string;
  sceneTitle: string;
  desc: string;
  meta: string;
  accent: string;
  placed?: boolean;
}

const DEFAULT_UNPLANNED: UnplannedShot[] = [
  {
    code: '5D',
    sceneNum: 'Sc.5',
    sceneTitle: 'Strada bagnata',
    desc: 'Taxi riparte, riflessi',
    meta: 'PM · 35mm · 0:25',
    accent: '#F2B08A',
  },
  {
    code: '5E',
    sceneNum: 'Sc.5',
    sceneTitle: 'Strada bagnata',
    desc: 'Pozzanghera, insegna',
    meta: 'Dett. · 85mm · 0:15',
    accent: '#F2B08A',
  },
  {
    code: '7A',
    sceneNum: 'Sc.7',
    sceneTitle: 'Il finale',
    desc: 'Antonio scende, alba',
    meta: 'CL · 24mm · 0:40',
    accent: '#C3B2F2',
    placed: true, // Shown placed/dashed in mockup
  },
  {
    code: '7B',
    sceneNum: 'Sc.7',
    sceneTitle: 'Il finale',
    desc: 'Il taxi vuoto',
    meta: 'CLL · 18mm · 0:30',
    accent: '#C3B2F2',
  },
  {
    code: '8A',
    sceneNum: 'Sc.8',
    sceneTitle: 'Epilogo',
    desc: 'Rimessa, motore spento',
    meta: 'PP · 50mm · 0:30',
    accent: '#9DB8F2',
  },
  {
    code: '8B',
    sceneNum: 'Sc.8',
    sceneTitle: 'Epilogo',
    desc: 'Chiavi sul cruscotto',
    meta: 'Dett. · 100mm · 0:20',
    accent: '#9DB8F2',
  },
];

export function ScheduleView({
  store: _store,
  projectName = 'Ultima corsa',
  readOnly = false,
}: {
  store: BoardStore;
  boardTitle?: string;
  projectName?: string;
  projectId?: string;
  boardId?: string;
  userId?: string;
  readOnly?: boolean;
}) {
  const [activeInterval, setActiveInterval] = useState<'day' | '3days' | 'week'>('3days');
  const [selectedBlockId, setSelectedBlockId] = useState<string>('sc3');
  const [conflictResolved, setConflictResolved] = useState(false);
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const [callSheetModalDay, setCallSheetModalDay] = useState<number | null>(null);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>(DEFAULT_BLOCKS);
  const [unplanned, setUnplanned] = useState<UnplannedShot[]>(DEFAULT_UNPLANNED);
  const [scheduledSlot7A, setScheduledSlot7A] = useState(true);

  const unplannedCount = unplanned.filter((u) => !u.placed).length;

  const selectedBlock = useMemo(
    () => blocks.find((b) => b.id === selectedBlockId) ?? blocks.find((b) => b.id === 'sc3'),
    [blocks, selectedBlockId],
  );

  const resolveConflict = () => {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id === 'd2-sc5') {
          return {
            ...b,
            startHour: 24.5, // 00:30
            badge: undefined,
            warning: false,
          };
        }
        return b;
      }),
    );
    setConflictResolved(true);
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>, code: string) => {
    e.dataTransfer.setData('text/plain', code);
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleDropOnSlot = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const code = e.dataTransfer.getData('text/plain');
    if (code) {
      setScheduledSlot7A(true);
      setUnplanned((prev) => prev.map((u) => (u.code === code ? { ...u, placed: true } : u)));
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  // Convert hour (18.0 to 30.0 for 06:00 next day) to timeline pixel top
  const hourToY = (h: number) => {
    return Math.round((h - 18) * 50);
  };
  const durationToHeight = (hours: number) => {
    return Math.max(20, Math.round(hours * 50 - 4));
  };

  const hours = [
    { label: '18:00', h: 18 },
    { label: '19:00', h: 19 },
    { label: '20:00', h: 20 },
    { label: '21:00', h: 21 },
    { label: '22:00', h: 22 },
    { label: '23:00', h: 23 },
    { label: '00:00', h: 24 },
    { label: '01:00', h: 25 },
    { label: '02:00', h: 26 },
    { label: '03:00', h: 27 },
    { label: '04:00', h: 28 },
    { label: '05:00', h: 29 },
    { label: '06:00', h: 30 },
  ];

  const daysInfo = [
    { num: 1, label: 'Mer 22', month: 'ottobre', desc: 'Giorno 1 · Stazione Centrale' },
    { num: 2, label: 'Gio 23', month: 'ottobre', desc: 'Giorno 2 · Bar Lume, via Ferrante' },
    { num: 3, label: 'Ven 24', month: 'ottobre', desc: 'Giorno 3 · Car rig, rimessa' },
  ];

  return (
    <div className="schedule-view">
      {/* Top Header / Bar */}
      <header className="schedule-header">
        <nav aria-label="Percorso" className="schedule-header__crumbs">
          <span className="mut">{projectName}</span>
          <span className="crumb__sep">/</span>
          <span className="mut">Riprese</span>
          <span className="crumb__sep">/</span>
          <span style={{ fontWeight: 600 }}>Piano riprese</span>
        </nav>

        <div className="tabs" role="tablist" aria-label="Intervallo">
          <button
            type="button"
            className="tab"
            role="tab"
            aria-selected={activeInterval === 'day'}
            style={activeInterval === 'day' ? { background: '#1C1C1F', color: '#EDEDED' } : {}}
            onClick={() => setActiveInterval('day')}
          >
            Giorno
          </button>
          <button
            type="button"
            className="tab"
            role="tab"
            aria-selected={activeInterval === '3days'}
            style={activeInterval === '3days' ? { background: '#1C1C1F', color: '#EDEDED' } : {}}
            onClick={() => setActiveInterval('3days')}
          >
            3 giorni
          </button>
          <button
            type="button"
            className="tab"
            role="tab"
            aria-selected={activeInterval === 'week'}
            style={activeInterval === 'week' ? { background: '#1C1C1F', color: '#EDEDED' } : {}}
            onClick={() => setActiveInterval('week')}
          >
            Settimana
          </button>
        </div>

        <span className="schedule-date-nav">
          <button
            type="button"
            className="ib"
            aria-label="Precedente"
            style={{ width: 24, height: 24 }}
          >
            ‹
          </button>
          <span style={{ fontWeight: 500 }}>22 – 24 ottobre</span>
          <button
            type="button"
            className="ib"
            aria-label="Successivo"
            style={{ width: 24, height: 24 }}
          >
            ›
          </button>
        </span>

        <div style={{ flex: 1 }} />

        <span className="mut schedule-weather-info">
          <span>Tramonto 18:12</span>
          <span>Alba 07:21</span>
          <span>Pioggia 40% gio</span>
        </span>

        {!conflictResolved && !conflictDismissed && (
          <button
            type="button"
            className="btn schedule-conflict-chip"
            onClick={() => setSelectedBlockId('d2-sc5')}
          >
            <span className="dot" style={{ background: '#E5765F' }} />1 conflitto
          </button>
        )}

        <button
          type="button"
          className="btn"
          onClick={() => setCallSheetModalDay(selectedBlock?.day ?? 1)}
        >
          Call sheet
        </button>

        <span style={{ display: 'flex' }}>
          <span
            className="av"
            style={{ width: 24, height: 24, background: '#7CC4C9', border: '2px solid #0E0E10' }}
          >
            GL
          </span>
          <span
            className="av"
            style={{
              width: 24,
              height: 24,
              background: '#C9B27C',
              border: '2px solid #0E0E10',
              marginLeft: -8,
            }}
          >
            AF
          </span>
        </span>

        <button
          type="button"
          className="btn"
          style={{ background: '#2563EB', borderColor: '#2563EB', color: '#FFFFFF' }}
        >
          Condividi
        </button>
      </header>

      {/* Main workspace container */}
      <main className="schedule-main">
        {/* Left column: Da pianificare */}
        <section className="schedule-unplanned" aria-label="Da pianificare">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontWeight: 600 }}>Da pianificare</span>
            <span className="cnt">{unplannedCount} · 2h40</span>
          </div>
          <div className="mut" style={{ fontSize: 11, lineHeight: 1.45, marginTop: -4 }}>
            Trascina un&apos;inquadratura su una notte per fissarla.
          </div>

          <div className="schedule-unplanned__list">
            {unplanned.map((shot, idx) => (
              <div key={shot.code}>
                {(idx === 0 || unplanned[idx - 1].sceneNum !== shot.sceneNum) && (
                  <div
                    className="lbl"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginTop: idx === 0 ? 4 : 10,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        width: 3,
                        height: 10,
                        borderRadius: 2,
                        background: shot.accent,
                      }}
                    />
                    {shot.sceneNum} · {shot.sceneTitle}
                  </div>
                )}
                <button
                  type="button"
                  draggable={!shot.placed && !readOnly}
                  onDragStart={(e) => handleDragStart(e, shot.code)}
                  className={`schedule-unplanned__card ${shot.placed ? 'is-placed' : ''}`}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 48 20"
                    style={{
                      width: 48,
                      height: 20,
                      borderRadius: 3,
                      background: '#26262A',
                      flex: 'none',
                    }}
                  >
                    <path
                      d="M0 15 L48 15 M10 15 L10 7 L30 7 L30 15"
                      fill="none"
                      stroke="#6E6E72"
                      strokeWidth="1"
                    />
                  </svg>
                  <span
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    <span style={{ fontSize: 12 }}>
                      <b style={{ fontWeight: 600 }}>{shot.code}</b>{' '}
                      <span className="mut">{shot.desc}</span>
                    </span>
                    <span style={{ fontSize: 10, color: '#808086' }}>{shot.meta}</span>
                  </span>
                </button>
              </div>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          <div className="schedule-unplanned__tips">
            <div className="kl">
              <b>1</b>
              <span>
                Trascini dall&apos;elenco: il blocco si adatta alla durata stimata e rispetta setup
                e pause.
              </span>
            </div>
            <div className="kl">
              <b>2</b>
              <span>
                Stimato contro pianificato: se il blocco sfora, il resto della notte scala.
              </span>
            </div>
            <div className="kl">
              <b>3</b>
              <span>Conflitti di cast e location segnalati prima di generare il call sheet.</span>
            </div>
          </div>
        </section>

        {/* Center Grid: Time axis + 3 Days */}
        <div className="schedule-calendar-area">
          {/* Day column headers */}
          <div className="schedule-days-header">
            {daysInfo.map((d) => (
              <div key={d.num} className="schedule-day-head">
                <div style={{ fontWeight: 600 }}>
                  {d.label}{' '}
                  <span className="mut" style={{ fontWeight: 400 }}>
                    {d.month}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: '#808086',
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {d.desc}
                </div>
              </div>
            ))}
          </div>

          {/* Time grid container */}
          <div className="schedule-grid">
            {/* Hour lines & labels */}
            <div className="schedule-grid__hours">
              {hours.map((hr) => (
                <div
                  key={hr.label}
                  className="schedule-grid__hour-row"
                  style={{ top: hourToY(hr.h) }}
                >
                  <span className="schedule-grid__hour-label">{hr.label}</span>
                  <span className="schedule-grid__hour-line" />
                </div>
              ))}
              {/* Sunrise dashed golden line at 07:21 (h = 31.35) */}
              <div className="schedule-sunrise-line" style={{ top: hourToY(31.35) }}>
                <span className="schedule-sunrise-label">Alba 07:21</span>
              </div>
            </div>

            {/* 3 Day columns */}
            <div className="schedule-day-columns">
              {daysInfo.map((d) => {
                const dayBlocks = blocks.filter((b) => b.day === d.num);
                return (
                  <div key={d.num} className="schedule-day-column">
                    {dayBlocks.map((b) => {
                      const top = hourToY(b.startHour);
                      const height = durationToHeight(b.durationHours);
                      const isSelected = selectedBlockId === b.id;

                      if (
                        b.type === 'call' ||
                        b.type === 'meal' ||
                        b.type === 'move' ||
                        b.type === 'wrap'
                      ) {
                        return (
                          <button
                            key={b.id}
                            type="button"
                            className={`schedule-minor-block ${isSelected ? 'is-selected' : ''}`}
                            style={{ top, height: Math.min(height, 32) }}
                            onClick={() => setSelectedBlockId(b.id)}
                          >
                            {b.title}
                          </button>
                        );
                      }

                      return (
                        <button
                          key={b.id}
                          type="button"
                          className={`schedule-block ${isSelected ? 'is-selected' : ''} ${
                            b.warning ? 'has-warning' : ''
                          }`}
                          style={{
                            top,
                            height,
                            borderLeftColor: b.accentColor ?? '#3A3A40',
                          }}
                          onClick={() => setSelectedBlockId(b.id)}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              gap: 6,
                              fontSize: 12,
                            }}
                          >
                            <b
                              style={{
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {b.title}
                            </b>
                            {b.badge && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: b.badge.color,
                                  background: b.badge.bg,
                                  borderRadius: 4,
                                  padding: '1px 5px',
                                  flex: 'none',
                                }}
                              >
                                {b.badge.text}
                              </span>
                            )}
                          </div>
                          {b.subtitle && (
                            <span style={{ fontSize: 11, color: '#9A9A9A' }}>{b.subtitle}</span>
                          )}
                          {b.details && (
                            <span style={{ fontSize: 10, color: '#808086' }}>{b.details}</span>
                          )}
                        </button>
                      );
                    })}

                    {/* Day 3 drop target / slotted 7A frame matching mockup */}
                    {d.num === 3 && (
                      <>
                        <section
                          aria-label="Drop target"
                          className="schedule-drop-slot"
                          style={{
                            top: hourToY(24.0),
                            height: durationToHeight(0.66),
                          }}
                          onDragOver={handleDragOver}
                          onDrop={handleDropOnSlot}
                        >
                          00:00 – 00:40 · 7A
                        </section>

                        {scheduledSlot7A && (
                          <div
                            className="schedule-floating-card-dragged"
                            style={{
                              top: hourToY(24.0) + 30,
                              left: 28,
                            }}
                          >
                            <b style={{ fontWeight: 600 }}>7A</b>{' '}
                            <span className="mut">Antonio scende, alba</span>
                            <div style={{ fontSize: 10, color: '#808086', marginTop: 2 }}>
                              CL · 24mm · 0:40
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Conflict Note Callout on Day 2 */}
            {!conflictResolved && !conflictDismissed && (
              <div
                role="note"
                className="schedule-conflict-note"
                style={{
                  top: hourToY(24.4),
                  left: 210,
                }}
              >
                <b style={{ fontWeight: 600, color: '#F2A99A' }}>Antonio convocato in due posti</b>
                <br />
                <span className="mut">
                  Bar Lume fino alle 23:30, via Ferrante alle 23:45. Lo spostamento dura 12 min:
                  serve un pickup.
                </span>
                <div style={{ display: 'flex', gap: 10, marginTop: 6, color: '#9DB8F2' }}>
                  <button type="button" className="schedule-conflict-act" onClick={resolveConflict}>
                    Sposta a 00:30
                  </button>
                  <button
                    type="button"
                    className="schedule-conflict-act mut"
                    onClick={() => setConflictDismissed(true)}
                  >
                    Ignora
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Inspector Drawer: Blocco selezionato */}
        {selectedBlock && (
          <aside className="schedule-inspector" aria-label="Blocco selezionato">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 3,
                    height: 14,
                    borderRadius: 2,
                    background: selectedBlock.accentColor ?? '#C3B2F2',
                  }}
                />
                <span className="lbl">{selectedBlock.scene ?? selectedBlock.title}</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 6 }}>
                {selectedBlock.title}
              </div>
              <div className="mut" style={{ fontSize: 12, marginTop: 4 }}>
                {daysInfo[selectedBlock.day - 1]?.label} {daysInfo[selectedBlock.day - 1]?.month} ·{' '}
                {selectedBlock.startHour >= 24
                  ? `0${Math.floor(selectedBlock.startHour - 24)}:${
                      Math.round((selectedBlock.startHour % 1) * 60) === 0 ? '00' : '30'
                    }`
                  : `${Math.floor(selectedBlock.startHour)}:${
                      Math.round((selectedBlock.startHour % 1) * 60) === 0 ? '00' : '30'
                    }`}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="card pad" style={{ padding: '8px 10px' }}>
                <div className="lbl" style={{ fontSize: 10 }}>
                  Pianificato
                </div>
                <div style={{ fontWeight: 600, marginTop: 3 }}>
                  {selectedBlock.planned ?? '2h 00'}
                </div>
              </div>
              <div className="card pad" style={{ padding: '8px 10px' }}>
                <div className="lbl" style={{ fontSize: 10 }}>
                  Stimato
                </div>
                <div style={{ fontWeight: 600, marginTop: 3, color: '#9FE0B4' }}>
                  {selectedBlock.estimated ?? '1h 50'}
                </div>
              </div>
            </div>

            {selectedBlock.location && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="lbl">Location</div>
                <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                  {selectedBlock.location}
                  {selectedBlock.locationNotes && (
                    <>
                      <br />
                      <span className="mut">{selectedBlock.locationNotes}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {selectedBlock.cast && selectedBlock.cast.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="lbl">Cast · convocazione</div>
                {selectedBlock.cast.map((c) => (
                  <div
                    key={c.name}
                    style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}
                  >
                    <span>
                      {c.name} <span className="mut">{c.actor}</span>
                    </span>
                    <span className="mut">
                      {c.call}
                      {c.pickup ? ` · pickup ${c.pickup}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {selectedBlock.shots && selectedBlock.shots.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div className="lbl" style={{ marginBottom: 2 }}>
                  Inquadrature · {selectedBlock.shots.length}
                </div>
                {selectedBlock.shots.map((s) => (
                  <div
                    key={s.code}
                    style={{
                      display: 'flex',
                      gap: 8,
                      fontSize: 12,
                      padding: '3px 0',
                      borderBottom: '1px solid #1C1C1F',
                    }}
                  >
                    <b style={{ fontWeight: 600, width: 22 }}>{s.code}</b>
                    <span style={{ flex: 1 }} className="mut">
                      {s.desc}
                    </span>
                    <span style={{ color: '#808086' }}>{s.duration}</span>
                  </div>
                ))}
              </div>
            )}

            {selectedBlock.departments && selectedBlock.departments.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="lbl">Reparti</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {selectedBlock.departments.map((dept, i) => (
                    <span
                      key={dept}
                      className="pill"
                      style={
                        i === 0
                          ? { background: '#2A2240', color: '#C3B2F2' }
                          : i === 1
                            ? { background: '#1E2A44', color: '#9DB8F2' }
                            : {
                                background: '#1C1C1F',
                                color: '#9A9A9A',
                                border: '1px solid #2A2A2E',
                              }
                      }
                    >
                      {dept}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ flex: 1 }} />

            <button
              type="button"
              className="btn btn--primary"
              style={{
                height: 34,
                background: '#2563EB',
                borderColor: '#2563EB',
                color: '#FFFFFF',
              }}
              onClick={() => setCallSheetModalDay(selectedBlock.day)}
            >
              Genera call sheet del giorno {selectedBlock.day}
            </button>
          </aside>
        )}
      </main>

      {/* Call sheet modal */}
      {callSheetModalDay !== null && (
        <CallSheetModal
          day={callSheetModalDay}
          projectName={projectName}
          onClose={() => setCallSheetModalDay(null)}
        />
      )}
    </div>
  );
}
