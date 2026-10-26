// SPDX-License-Identifier: AGPL-3.0-only
import { Icon } from '@inkadra/ui';
import { useCallback, useEffect, useState } from 'react';

export interface CallSheetModalProps {
  day?: number;
  projectName?: string;
  onClose: () => void;
}

export function CallSheetModal({
  day = 1,
  projectName = 'Ultima corsa',
  onClose,
}: CallSheetModalProps) {
  const [selectedDay, setSelectedDay] = useState(day);
  const [zoom, setZoom] = useState(70);

  // Section visibility switches
  const [switches, setSwitches] = useState({
    generalTimes: true,
    schedule: true,
    castCall: true,
    contacts: true,
    deptNotes: true,
    thumbnails: false,
  });

  const toggle = (key: keyof typeof switches) => {
    setSwitches((s) => ({ ...s, [key]: !s[key] }));
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const daysData = [
    {
      num: 1,
      date: 'Mer 22 ottobre',
      title: 'Giorno 1 di 3 · Mer 22 ottobre',
      generalCall: '18:30',
      firstShot: '21:00',
      wrapTime: '05:00',
      weather: '12°, nuvoloso, pioggia 20%\nVento 10 km/h da nord',
      hospital: 'Pronto soccorso, Ospedale Centrale\nvia Roma 12 · 1,4 km · 6 min\nEmergenze 112',
      location: 'Stazione Centrale, binario 21 · permesso 01:00–04:30',
      locationNotes:
        "Ingresso troupe: piazzale Est, cancello 3\nParcheggio camion: via Ferrante · Base: sala d'attesa 2\nCorrente 32A sul binario · bagni sala d'attesa",
      schedule: [
        {
          time: '19:00',
          scene: '–',
          desc: 'Allestimento luci binario 21, practical sul tabellone',
          shots: '–',
          cast: '–',
          pages: '–',
        },
        {
          time: '21:00',
          scene: '4',
          desc: 'EST NOTTE · Il taxi entra nel binario vuoto, Antonio scende',
          shots: '4A–4C',
          cast: '1, 2',
          pages: '1 2/8',
        },
        {
          time: '00:30',
          scene: '–',
          desc: "Pausa pasto, sala d'attesa 2",
          shots: '–',
          cast: '–',
          pages: '–',
        },
        {
          time: '01:15',
          scene: '4',
          desc: 'EST NOTTE · Il tabellone, il capotreno, il taxi riparte',
          shots: '4D–4F',
          cast: '1, 3',
          pages: '1 4/8',
        },
        {
          time: '04:00',
          scene: '–',
          desc: 'Smontaggio, rientro mezzi entro le 05:00',
          shots: '–',
          cast: '–',
          pages: '–',
        },
      ],
      cast: [
        {
          id: '1',
          character: 'Antonio',
          actor: 'Marco R.',
          pickup: '19:00',
          makeup: '19:30',
          onSet: '20:45',
        },
        {
          id: '2',
          character: 'La cliente',
          actor: 'Sara L.',
          pickup: '19:15',
          makeup: '19:45',
          onSet: '21:00',
        },
        {
          id: '3',
          character: 'Capotreno',
          actor: 'Luca B.',
          pickup: '23:00',
          makeup: '23:30',
          onSet: '01:15',
        },
      ],
    },
    {
      num: 2,
      date: 'Gio 23 ottobre',
      title: 'Giorno 2 di 3 · Gio 23 ottobre',
      generalCall: '19:00',
      firstShot: '20:00',
      wrapTime: '04:00',
      weather: '11°, coperto, pioggia 40%\nVento 15 km/h da est',
      hospital:
        'Pronto soccorso, Ospedale San Paolo\nvia di Rudinì 8 · 2,1 km · 8 min\nEmergenze 112',
      location: 'Bar Lume, via Ferrante 12 · Strada bagnata',
      locationNotes:
        'Parcheggio furgoni sul retro · corrente 32A\nPermesso pioggia artificiale via Ferrante fino alle 03:00',
      schedule: [
        {
          time: '19:00',
          scene: '–',
          desc: 'Convocazione troupe, allestimento neon pratici',
          shots: '–',
          cast: '–',
          pages: '–',
        },
        {
          time: '20:00',
          scene: '3',
          desc: 'INT NOTTE · Bar Lume, Antonio al bancone e la cliente',
          shots: '3A–3E',
          cast: '1, 2',
          pages: '2 1/8',
        },
        {
          time: '23:30',
          scene: '–',
          desc: '⇢ Spostamento in via Ferrante · 12 min',
          shots: '–',
          cast: '–',
          pages: '–',
        },
        {
          time: '23:45',
          scene: '5',
          desc: 'EST NOTTE · Strada bagnata, pioggia artificiale, pozzanghera',
          shots: '5A–5C',
          cast: '1',
          pages: '1 1/8',
        },
        {
          time: '03:00',
          scene: '–',
          desc: 'Smontaggio e rientro mezzi',
          shots: '–',
          cast: '–',
          pages: '–',
        },
      ],
      cast: [
        {
          id: '1',
          character: 'Antonio',
          actor: 'Marco R.',
          pickup: '19:00',
          makeup: '19:30',
          onSet: '19:50',
        },
        {
          id: '2',
          character: 'La cliente',
          actor: 'Sara L.',
          pickup: '19:15',
          makeup: '19:45',
          onSet: '20:00',
        },
      ],
    },
    {
      num: 3,
      date: 'Ven 24 ottobre',
      title: 'Giorno 3 di 3 · Ven 24 ottobre',
      generalCall: '18:30',
      firstShot: '19:30',
      wrapTime: '07:30',
      weather: '10°, sereno verso l’alba\nVento calmo · Tramonto 18:12 · Alba 07:21',
      hospital: 'Pronto soccorso, Ospedale Centrale\nvia Roma 12 · 1,8 km · 7 min\nEmergenze 112',
      location: 'Car rig taxi, circonvallazione & rimessa',
      locationNotes:
        'Partenza car rig via Ferrante. Rientro rimessa per alba 06:50 con luce naturale.',
      schedule: [
        {
          time: '18:30',
          scene: '–',
          desc: 'Convocazione troupe e montaggio camera car',
          shots: '–',
          cast: '–',
          pages: '–',
        },
        {
          time: '19:30',
          scene: '6',
          desc: 'INT/EST NOTTE · Il taxi, dialogo e corsa nella notte',
          shots: '6A–6D',
          cast: '1, 2',
          pages: '3 2/8',
        },
        {
          time: '23:00',
          scene: '–',
          desc: 'Pausa pasto · 45 min',
          shots: '–',
          cast: '–',
          pages: '–',
        },
        {
          time: '00:00',
          scene: '7',
          desc: 'EST NOTTE · Taxi riparte, riflessi nella pioggia',
          shots: '7A',
          cast: '1',
          pages: '0 4/8',
        },
        {
          time: '06:50',
          scene: '7',
          desc: 'EST ALBA · Luce naturale, Antonio scende dal taxi',
          shots: '7A–7B',
          cast: '1',
          pages: '1 0/8',
        },
      ],
      cast: [
        {
          id: '1',
          character: 'Antonio',
          actor: 'Marco R.',
          pickup: '18:00',
          makeup: '18:30',
          onSet: '19:20',
        },
        {
          id: '2',
          character: 'La cliente',
          actor: 'Sara L.',
          pickup: '18:30',
          makeup: '19:00',
          onSet: '19:30',
        },
      ],
    },
  ];

  const current = daysData.find((d) => d.num === selectedDay) ?? daysData[0];

  if (!current) return null;

  return (
    <div
      className="callsheet-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Call sheet"
    >
      <div className="callsheet-modal" role="document">
        {/* Top bar */}
        <div className="callsheet-topbar">
          <div className="callsheet-topbar__title">
            <span style={{ fontWeight: 600 }}>{projectName}</span>
            <span className="mut">/</span>
            <span>Call sheet</span>
          </div>
          <div className="callsheet-topbar__tabs" role="tablist">
            {daysData.map((d) => (
              <button
                key={d.num}
                type="button"
                role="tab"
                aria-selected={selectedDay === d.num}
                className={`callsheet-topbar__tab ${selectedDay === d.num ? 'is-active' : ''}`}
                onClick={() => setSelectedDay(d.num)}
              >
                Giorno {d.num}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <div className="callsheet-topbar__controls">
            <span>Pagina 1 di 1</span>
            <span className="mut">|</span>
            <button
              type="button"
              className="callsheet-zoom-btn"
              onClick={() => setZoom((z) => Math.max(50, z - 10))}
              aria-label="Riduci zoom"
            >
              −
            </button>
            <span>{zoom}%</span>
            <button
              type="button"
              className="callsheet-zoom-btn"
              onClick={() => setZoom((z) => Math.min(120, z + 10))}
              aria-label="Aumenta zoom"
            >
              +
            </button>
            <span className="mut">|</span>
            <span>A4 verticale</span>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handlePrint}
              style={{ marginLeft: 8 }}
            >
              <Icon name="download" size={14} />
              Stampa / Esporta
            </button>
            <button
              type="button"
              className="ib callsheet-close-btn"
              onClick={onClose}
              aria-label="Chiudi"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>

        {/* Modal body */}
        <div className="callsheet-body">
          {/* Left options sidebar */}
          <section className="callsheet-sidebar" aria-label="Opzioni call sheet">
            <div className="callsheet-sidebar__sec">
              <div className="lbl" style={{ marginBottom: 8 }}>
                Sezioni
              </div>
              <div className="callsheet-chk">
                <span>Orari generali</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={switches.generalTimes}
                  aria-label="Orari generali"
                  className={`sw ${switches.generalTimes ? '' : 'off'}`}
                  onClick={() => toggle('generalTimes')}
                />
              </div>
              <div className="callsheet-chk">
                <span>Scaletta riprese</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={switches.schedule}
                  aria-label="Scaletta riprese"
                  className={`sw ${switches.schedule ? '' : 'off'}`}
                  onClick={() => toggle('schedule')}
                />
              </div>
              <div className="callsheet-chk">
                <span>Convocazione cast</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={switches.castCall}
                  aria-label="Convocazione cast"
                  className={`sw ${switches.castCall ? '' : 'off'}`}
                  onClick={() => toggle('castCall')}
                />
              </div>
              <div className="callsheet-chk">
                <span>Contatti</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={switches.contacts}
                  aria-label="Contatti"
                  className={`sw ${switches.contacts ? '' : 'off'}`}
                  onClick={() => toggle('contacts')}
                />
              </div>
              <div className="callsheet-chk">
                <span>Note dei reparti</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={switches.deptNotes}
                  aria-label="Note dei reparti"
                  className={`sw ${switches.deptNotes ? '' : 'off'}`}
                  onClick={() => toggle('deptNotes')}
                />
              </div>
              <div className="callsheet-chk">
                <span>
                  Miniature storyboard{' '}
                  <span style={{ fontSize: 11, color: '#808086' }}>· aggiunge 2 pagine</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={switches.thumbnails}
                  aria-label="Miniature storyboard"
                  className={`sw ${switches.thumbnails ? '' : 'off'}`}
                  onClick={() => toggle('thumbnails')}
                />
              </div>
            </div>

            <div className="callsheet-sidebar__sec">
              <div className="lbl" style={{ marginBottom: 8 }}>
                Destinatari
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Troupe</span>
                  <span className="mut">14 persone</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Cast</span>
                  <span className="mut">3 persone · solo i loro orari</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    color: '#808086',
                  }}
                >
                  <span>Cliente Nordeen</span>
                  <span>escluso</span>
                </div>
              </div>
            </div>

            <div style={{ flex: 1 }} />

            <div className="callsheet-tips">
              <div className="kl">
                <b>1</b>
                <span>
                  Le sezioni si aggiornano da sole se cambi il piano riprese; la versione sale a
                  ogni invio.
                </span>
              </div>
              <div className="kl">
                <b>2</b>
                <span>Ogni attore riceve una copia con solo i suoi orari evidenziati.</span>
              </div>
              <div className="kl">
                <b>3</b>
                <span>
                  L&apos;ospedale più vicino viene calcolato dall&apos;indirizzo della location.
                </span>
              </div>
            </div>
          </section>

          {/* Paper preview */}
          <div className="callsheet-preview-area">
            <article
              className="pg callsheet-paper"
              aria-label="Anteprima call sheet"
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
            >
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-end',
                  borderBottom: '2px solid #141414',
                  paddingBottom: 8,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 600,
                      letterSpacing: '-0.02em',
                      color: '#141414',
                    }}
                  >
                    {projectName}
                  </div>
                  <div style={{ fontSize: 9, color: '#55554F', marginTop: 2 }}>
                    Cortometraggio · Regia Matteo M. · Produzione Andrea F.
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: '0.1em',
                      color: '#141414',
                    }}
                  >
                    CALL SHEET
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      marginTop: 2,
                      color: '#141414',
                    }}
                  >
                    {current.title}
                  </div>
                </div>
              </div>

              {/* General times & weather */}
              {switches.generalTimes && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.1fr 1fr 1fr',
                    gap: 14,
                  }}
                >
                  <div
                    style={{
                      background: '#141414',
                      color: '#F4F4F2',
                      borderRadius: 3,
                      padding: '10px 12px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 7.5,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        opacity: 0.7,
                      }}
                    >
                      Convocazione generale
                    </div>
                    <div
                      style={{
                        fontSize: 26,
                        fontWeight: 600,
                        letterSpacing: '-0.02em',
                        marginTop: 2,
                      }}
                    >
                      {current.generalCall}
                    </div>
                    <div style={{ fontSize: 8.5, opacity: 0.8, marginTop: 2 }}>
                      Prima ripresa {current.firstShot} · Fine {current.wrapTime}
                    </div>
                  </div>
                  <div>
                    <div className="h">Luce e meteo</div>
                    <div
                      style={{
                        fontSize: 9,
                        lineHeight: 1.6,
                        whiteSpace: 'pre-line',
                        color: '#141414',
                      }}
                    >
                      Tramonto 18:12 · Alba 07:21
                      {'\n'}
                      {current.weather}
                    </div>
                  </div>
                  <div>
                    <div className="h">Ospedale più vicino</div>
                    <div
                      style={{
                        fontSize: 9,
                        lineHeight: 1.6,
                        whiteSpace: 'pre-line',
                        color: '#141414',
                      }}
                    >
                      {current.hospital}
                    </div>
                  </div>
                </div>
              )}

              {/* Location & Map sketch */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.6fr 1fr',
                  gap: 14,
                }}
              >
                <div>
                  <div className="h">Location</div>
                  <div style={{ fontSize: 9, lineHeight: 1.6, color: '#141414' }}>
                    <b style={{ fontWeight: 600 }}>{current.location}</b>
                    <br />
                    <span style={{ whiteSpace: 'pre-line', color: '#55554F' }}>
                      {current.locationNotes}
                    </span>
                  </div>
                </div>
                <svg
                  role="img"
                  aria-label="Mappa della location"
                  viewBox="0 0 160 80"
                  style={{
                    width: '100%',
                    height: 72,
                    background: '#E6E6E1',
                    borderRadius: 3,
                  }}
                >
                  <path
                    d="M0 50 L160 30 M40 0 L60 80 M100 0 L120 80"
                    stroke="#FFFFFF"
                    strokeWidth="5"
                  />
                  <path d="M0 62 L160 44" stroke="#C9C9C2" strokeWidth="2" strokeDasharray="4 3" />
                  <circle cx="84" cy="40" r="5" fill="#141414" />
                  <circle cx="118" cy="62" r="3" fill="#6B6B66" />
                </svg>
              </div>

              {/* Scaletta table */}
              {switches.schedule && (
                <div>
                  <div className="h">Scaletta</div>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>Ora</th>
                        <th style={{ width: 26 }}>Sc.</th>
                        <th>Descrizione</th>
                        <th style={{ width: 42 }}>Inq.</th>
                        <th style={{ width: 52 }}>Cast</th>
                        <th style={{ width: 40 }}>Pagine</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.schedule.map((row) => (
                        <tr key={`${row.time}-${row.scene}-${row.desc}`}>
                          <td>{row.time}</td>
                          <td>
                            <b>{row.scene}</b>
                          </td>
                          <td>{row.desc}</td>
                          <td>{row.shots}</td>
                          <td>{row.cast}</td>
                          <td>{row.pages}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Cast table */}
              {switches.castCall && (
                <div>
                  <div className="h">Cast</div>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 16 }}>#</th>
                        <th>Personaggio</th>
                        <th>Interprete</th>
                        <th>Pickup</th>
                        <th>Trucco</th>
                        <th>Sul set</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.cast.map((c) => (
                        <tr key={c.id}>
                          <td>{c.id}</td>
                          <td>{c.character}</td>
                          <td>{c.actor}</td>
                          <td>{c.pickup}</td>
                          <td>{c.makeup}</td>
                          <td>{c.onSet}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Dept notes */}
              {switches.deptNotes && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px 14px',
                    fontSize: 8.5,
                    lineHeight: 1.5,
                    color: '#141414',
                  }}
                >
                  <div>
                    <b style={{ fontWeight: 600 }}>Fotografia</b> · Alexa Mini, serie 24/35/85.
                    Nessun fill dal lato camera.
                  </div>
                  <div>
                    <b style={{ fontWeight: 600 }}>Suono</b> · Ambiente stazione 5 min a fine notte.
                  </div>
                  <div>
                    <b style={{ fontWeight: 600 }}>Scenografia</b> · Tabellone con orari fittizi,
                    controllare il binario.
                  </div>
                  <div>
                    <b style={{ fontWeight: 600 }}>Produzione</b> · Pettorine alta visibilità per
                    tutti sul binario.
                  </div>
                </div>
              )}

              <div style={{ flex: 1 }} />

              {/* Contacts */}
              {switches.contacts && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 14,
                    borderTop: '1px solid #141414',
                    paddingTop: 8,
                    fontSize: 8.5,
                    lineHeight: 1.5,
                    color: '#141414',
                  }}
                >
                  <div>
                    <b style={{ fontWeight: 600 }}>Produzione</b>
                    <br />
                    Andrea F. · 333 000 0000
                  </div>
                  <div>
                    <b style={{ fontWeight: 600 }}>Aiuto regia</b>
                    <br />
                    Giulia L. · 333 000 0001
                  </div>
                  <div>
                    <b style={{ fontWeight: 600 }}>Location manager</b>
                    <br />
                    Paolo C. · 333 000 0002
                  </div>
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 7.5,
                  color: '#8A8A84',
                }}
              >
                <span>Generato da Inkadra · v4 · 21 ott 22:40</span>
                <span>Riservato alla troupe</span>
              </div>
            </article>
          </div>
        </div>
      </div>
    </div>
  );
}
