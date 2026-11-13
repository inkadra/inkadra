import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseScreenplay } from './parse.ts';
import { castName, defaultOptions, placeName, planImport } from './plan.ts';
import { similarity } from './revision.ts';
import { finishScript } from './script.ts';

/**
 * A device set to Turkish: the host's `toLocale*Case` follow it, so I ↔ ı and i ↔ İ.
 * Node's ICU cannot change its default locale once started, so the methods are stubbed.
 */
function turkishDevice() {
  const upper = String.prototype.toLocaleUpperCase;
  const lower = String.prototype.toLocaleLowerCase;
  vi.spyOn(String.prototype, 'toLocaleUpperCase').mockImplementation(function (this: string) {
    return upper.call(this, 'tr');
  });
  vi.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(function (this: string) {
    return lower.call(this, 'tr');
  });
}

const cue = (character: string) => ({
  kind: 'dialogue' as const,
  character,
  lines: [{ text: 'Hi.' }],
});

describe('screenplay casing on a Turkish device', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads names and headings as on any other device', () => {
    turkishDevice();
    expect('i'.toLocaleUpperCase()).toBe('İ');
    expect(castName('TIM')).toBe('Tim');
    expect(castName('LINDA')).toBe('Linda');
    expect(placeName('LIGHTHOUSE IN THE BAY')).toBe('Lighthouse in the Bay');
    const script = finishScript('fdx', {}, [
      { heading: 'INT. KITCHEN - NIGHT', blocks: [cue('TIM'), cue('Tim')], characters: [] },
    ]);
    expect(script.characters).toEqual(['TIM']);
    expect(similarity({ title: 'INT. KITCHEN' }, { title: 'int. kitchen' })).toBe(1);
  });

  it('detects the cues and makes one card per character', () => {
    turkishDevice();
    const fountain = 'INT. KITCHEN - NIGHT\n\nTIM\nHi.\n\nLINDA\nHi, Tim.\n\nTim\nBye.\n';
    const script = parseScreenplay('k.fountain', fountain);
    expect(script.characters).toEqual(['TIM', 'LINDA']);
    const options = { ...defaultOptions(script), characterCards: true };
    const plan = planImport(script, options, (names) => names.join(', '));
    expect(plan.characters.map((c) => c.name)).toEqual(['Tim', 'Linda']);
  });
});

/** Recorded from the version with a regex lookbehind, before it was rewritten for Hermes. */
const PLACE_NAMES: [string, string][] = [
  ['FARO, SCALA A CHIOCCIOLA', 'Faro, Scala a Chiocciola'],
  ['STANZA DELLA LAMPADA', 'Stanza della Lampada'],
  ['LA SCOGLIERA', 'La Scogliera'],
  ['HOUSE OF THE RISING SUN', 'House of the Rising Sun'],
  ['THE END OF THE ROAD', 'The End of the Road'],
  ['Casa Di Mario', 'Casa Di Mario'],
  ['OF', 'Of'],
  ['OF THE', 'Of The'],
  ['A OF OF OF B', 'A of of of B'],
  ['DAVANTI ALLA CASA DEL NONNO', 'Davanti alla Casa del Nonno'],
  ['CASA  DI   MARIO', 'Casa  di   Mario'],
  ['CASA\tDI\u00a0MARIO', 'Casa\tdi\u00a0Mario'],
  ['ROOM 12 OF THE HOTEL', 'Room 12 of the Hotel'],
  ['STAIRS, OF THE TOWER', 'Stairs, Of the Tower'],
  ['STAIRS ,OF THE TOWER', 'Stairs ,of the Tower'],
  ['TOWER OF', 'Tower Of'],
  ['TOWER OF ', 'Tower of '],
  [' OF THE TOWER', ' Of the Tower'],
  ['MAISON DU PÈRE ET DE LA MÈRE', 'Maison du Père et de la Mère'],
  ['CAFÉ DE LA GARE', 'Café de la Gare'],
  ['CAFE\u0301 DE LA GARE', 'Cafe\u0301 De la Gare'],
  ['SCHLOSS AM SEE UND IM WALD', 'Schloss am See und im Wald'],
  ['CASA DOS AVÓS', 'Casa dos Avós'],
  ['PIER 9 AND THE DOCKS', 'Pier 9 and the Docks'],
  ['Β ΚΑΙ THE Ω', 'Β Και the Ω'],
  ['𝐀 OF THE 𝐁', '𝐀 of the 𝐁'],
  ['X-RAY ROOM OF DR. NO', 'X-Ray Room of Dr. No'],
  ["O'NEIL'S BAR AND GRILL", "O'Neil'S Bar and Grill"],
  ["L'ANGOLO DEL BAR", "L'Angolo del Bar"],
  ['A', 'A'],
  ['', ''],
];

describe('placeName', () => {
  it.each(PLACE_NAMES)('%j → %j, as before', (name, expected) => {
    expect(placeName(name)).toBe(expected);
  });
});
