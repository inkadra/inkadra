// @vitest-environment happy-dom
import type { TFunction } from 'i18next';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardStore } from '../board/store.ts';
import { matchRank, rankActions, useContextActions, useRegisterActions } from './actions.ts';
import { appActions } from './app-actions.ts';
import { canvasActions, framePanelActions } from './board-actions.ts';

const host = document.createElement('div');
let root = createRoot(host);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  vi.restoreAllMocks();
});

describe('action matching', () => {
  it('ranks a label prefix before a word start before a substring, ignoring case and accents', () => {
    expect(matchRank('Attività', 'attivita')).toBe(3);
    expect(matchRank('Nuova attività', 'ATT')).toBe(2);
    expect(matchRank('Switch theme', 'eme')).toBe(1);
    expect(matchRank('New board', 'db')).toBe(0);
    const labels = ['Open theme settings', 'Switch theme', 'Theme'].map((label) => ({ label }));
    expect(rankActions(labels, 'theme').map((a) => a.label)).toEqual([
      'Theme',
      'Open theme settings',
      'Switch theme',
    ]);
    expect(rankActions(labels, '  ')).toEqual(labels);
  });
});

const run = vi.fn();
let invoke: (() => void) | undefined;
function Owner({ allowed, selection }: { allowed: boolean; selection: string }) {
  useRegisterActions(
    allowed ? [{ id: 'duplicate', label: 'Duplicate', run: () => run(selection) }] : [],
  );
  return null;
}
function Reader() {
  const actions = useContextActions();
  invoke = actions[0]?.run;
  return <span>{actions.length}</span>;
}

it('updates handlers without stale selection and removes commands when permission is revoked or owners unmount', async () => {
  const render = (allowed: boolean, selection: string) =>
    act(async () =>
      root.render(
        <>
          <Owner allowed={allowed} selection={selection} />
          <Reader />
        </>,
      ),
    );
  await render(true, 'first');
  const original = invoke;
  expect(host.textContent).toBe('1');
  await render(true, 'second');
  original?.();
  expect(run).toHaveBeenLastCalledWith('second');
  await render(false, 'second');
  expect(host.textContent).toBe('0');
  original?.();
  expect(run).toHaveBeenCalledTimes(1);
  await render(true, 'third');
  await act(async () => root.render(<Reader />));
  expect(host.textContent).toBe('0');
});

it('warns in development when two owners register the same action id', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await act(async () =>
    root.render(
      <>
        <Owner allowed selection="a" />
        <Owner allowed selection="b" />
        <Reader />
      </>,
    ),
  );
  expect(host.textContent).toBe('1');
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('"duplicate"'));
});

const t = ((key: string) => key) as unknown as TFunction;
const store = {} as BoardStore;

describe('permission gating', () => {
  const app = (admin: boolean, canCreateBoard: boolean) =>
    appActions({
      t,
      admin,
      canCreateBoard,
      theme: 'light',
      navigate: vi.fn(),
      newProject: vi.fn(),
      newBoard: vi.fn(),
      toggleTheme: vi.fn(),
      openInbox: vi.fn(),
    }).map((a) => a.id);

  it('offers Team to admins only and New board only with an editable project', () => {
    expect(app(true, true)).toEqual(expect.arrayContaining(['team', 'new-board']));
    expect(app(false, false)).not.toContain('team');
    expect(app(false, false)).not.toContain('new-board');
  });

  const canvas = (opts: { readOnly?: boolean; guest?: boolean; framePanelOpen?: boolean }) =>
    canvasActions({
      readOnly: false,
      guest: false,
      framePanelOpen: false,
      selection: new Set(['f1']),
      selectedFrame: 'f1',
      add: [{ id: 'add-note', label: 'Add note', run: vi.fn() }],
      duplicate: vi.fn(),
      store,
      t,
      duplicateHint: '⌘D',
      ...opts,
    }).map((a) => a.id);

  it('gives viewers and guests no canvas or frame panel actions', () => {
    expect(canvas({ readOnly: true })).toEqual([]);
    expect(canvas({ guest: true })).toEqual([]);
    expect(
      framePanelActions({ readOnly: true, store, frameId: 'f1', duplicate: vi.fn(), t }),
    ).toEqual([]);
  });

  it('lets the open frame panel own duplicate and status instead of the canvas', () => {
    expect(canvas({})).toEqual(
      expect.arrayContaining(['add-note', 'duplicate', 'frame-status-ready']),
    );
    expect(canvas({ framePanelOpen: true })).toEqual(['add-note']);
    expect(
      framePanelActions({ readOnly: false, store, frameId: 'f1', duplicate: vi.fn(), t }).map(
        (a) => a.id,
      ),
    ).toEqual(expect.arrayContaining(['duplicate', 'frame-status-ready']));
  });
});
