import { describe, expect, it } from 'vitest';
import { parseQuery } from '../../routes/SearchDialog.tsx';
import { commandFor } from '../shortcuts.ts';
import { normaliseTag } from '../tags.tsx';
import { exifRows, shutterText } from '../viewer.tsx';
import { aspectLabel } from './aspect.ts';
import { parseSeconds, secondsText } from './fields.tsx';
import { getFrameKanbanColumn, getFrameStatus } from './film-status.ts';
import { toCsv } from './ShotList.tsx';
import { KANBAN_COLUMNS } from './ShotlistKanban.tsx';
import { pathOf } from './strokes.ts';

const key = (k: string) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
});

describe('film helpers', () => {
  it('reads durations typed in seconds, with a comma or a dot', () => {
    expect(parseSeconds('2,5')).toBe(2500);
    expect(parseSeconds(' 4 ')).toBe(4000);
    expect(parseSeconds('')).toBeUndefined();
    expect(parseSeconds('-1')).toBeUndefined();
    expect(parseSeconds('abc')).toBeUndefined();
    expect(secondsText(2500)).toBe('2.5');
    expect(secondsText(undefined)).toBe('');
  });

  it('labels aspect ratios', () => {
    expect(aspectLabel('2.39')).toBe('2.39 : 1');
    expect(aspectLabel('16:9')).toBe('16 : 9');
  });

  it('draws a smooth path through the points', () => {
    expect(pathOf([], 562.5)).toBe('');
    expect(
      pathOf(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        500,
      ),
    ).toBe('M0 0L1000 500');
    expect(
      pathOf(
        [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.5 },
          { x: 1, y: 0 },
        ],
        100,
      ),
    ).toMatch(/^M0 0Q500 50 /);
  });

  it('exports CSV that spreadsheets read as text', () => {
    expect(
      toCsv([
        ['a"b', '=SUM(A1)'],
        ['', '-2'],
      ]),
    ).toBe('"a""b","\'=SUM(A1)"\r\n"","\'-2"');
  });
});

it('maps kanban columns and derives frame statuses', () => {
  expect(KANBAN_COLUMNS.map((c) => c.key)).toEqual(['todo', 'ready', 'shot', 'retake', 'approved']);
  expect(getFrameKanbanColumn({ status: 'draft' })).toBe('todo');
  expect(getFrameKanbanColumn({ status: 'todo' })).toBe('todo');
  expect(getFrameKanbanColumn({})).toBe('todo');
  expect(getFrameKanbanColumn({ status: 'ready' })).toBe('ready');
  expect(getFrameKanbanColumn({ status: 'shot' })).toBe('shot');
  expect(getFrameKanbanColumn({ status: 'retake' })).toBe('retake');
  expect(getFrameKanbanColumn({ approved: true })).toBe('approved');
  expect(getFrameKanbanColumn({ status: 'todo', approved: true })).toBe('approved');

  expect(getFrameStatus({ approved: true })).toBe('approved');
  expect(getFrameStatus({ status: 'shot', approved: true })).toBe('approved');
  expect(getFrameStatus({ status: 'shot' })).toBe('shot');
  expect(getFrameStatus({})).toBe('draft');
});

describe('search, tags and viewer', () => {
  it('splits a #tag from the words', () => {
    expect(parseQuery('#notte binario')).toEqual({ q: 'binario', tag: 'notte' });
    expect(parseQuery('binario')).toEqual({ q: 'binario' });
    expect(parseQuery('b')).toEqual({});
    expect(parseQuery('#luce')).toEqual({ tag: 'luce' });
  });

  it('stores tags trimmed and in lower case', () => {
    expect(normaliseTag('  #Notte   Esterna ')).toBe('notte esterna');
    expect(normaliseTag('x'.repeat(60))).toHaveLength(40);
  });

  it('shows the shooting data a photographer reads', () => {
    const rows = exifRows(
      {
        Make: 'FUJIFILM',
        Model: 'X-T5',
        LensModel: 'XF23mmF1.4 R LM WR',
        FocalLength: 23,
        FocalLengthIn35mmFormat: 35,
        FNumber: 2,
        ExposureTime: 0.004,
        ISO: 640,
      },
      'it',
    );
    expect(rows).toEqual([
      { key: 'camera', value: 'FUJIFILM X-T5' },
      { key: 'lens', value: 'XF23mmF1.4 R LM WR' },
      { key: 'focal', value: '23 mm (35 mm eq.)' },
      { key: 'aperture', value: 'ƒ/2' },
      { key: 'shutter', value: '1/250 s' },
      { key: 'iso', value: '640' },
    ]);
    expect(exifRows(null, 'it')).toEqual([]);
    expect(shutterText(2.5)).toBe('2.5 s');
  });

  it('has keys for the arrow tool, frames and storyboards', () => {
    expect(commandFor(key('a'), false)).toEqual({ kind: 'tool', tool: 'arrow' });
    expect(commandFor(key('f'), false)).toEqual({ kind: 'add', type: 'frame' });
    expect(commandFor(key('s'), false)).toEqual({ kind: 'add', type: 'storyboard' });
  });
});

it('includes schedule, review and moodboard views in board views', async () => {
  const { VIEWS } = await import('../BoardPage.tsx');
  expect(VIEWS.map((v) => v.view)).toEqual([
    'storyboard',
    'shotlist',
    'schedule',
    'review',
    'moodboard',
    'canvas',
  ]);
  const scheduleView = VIEWS.find((v) => v.view === 'schedule');
  expect(scheduleView?.icon).toBe('calendar');
  const reviewView = VIEWS.find((v) => v.view === 'review');
  expect(reviewView?.icon).toBe('people');
  const moodboardView = VIEWS.find((v) => v.view === 'moodboard');
  expect(moodboardView?.icon).toBe('image');
});
