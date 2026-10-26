// SPDX-License-Identifier: MPL-2.0
import { parseTags, webUrl } from './clip.ts';
import { ColumnPicker } from './columns.ts';
import { serializeError } from './errors.ts';
import { errorText, localize, t } from './i18n.ts';
import { type BoardOption, send } from './messages.ts';
import type { BoardRef } from './storage.ts';
import { applyTokens } from './theme.ts';

applyTokens();
localize();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('clip-form');
const search = $<HTMLInputElement>('board-search');
const list = $<HTMLUListElement>('board-list');
const note = $<HTMLTextAreaElement>('note');
const tags = $<HTMLInputElement>('tags');
const save = $<HTMLButtonElement>('save');
const column = $<HTMLSelectElement>('column');
const columns = new ColumnPicker(
  (state) => {
    column.replaceChildren(
      new Option(t('column_unsorted'), ''),
      ...state.items.map((item) => new Option(item.title || t('column_untitled'), item.id)),
    );
    column.disabled = state.loading || state.items.length === 0;
    updateSelection();
  },
  (boardId) => send('columns', { boardId }),
);
const result = $<HTMLElement>('result');

const SECTION_LABELS: Record<BoardOption['section'], string> = {
  recent: 'section_recent',
  project: 'section_projects',
  shared: 'section_shared',
  search: 'section_search',
};

let pageUrl: string | undefined;
let pageTitle: string | undefined;
let saving = false;
let selected: BoardRef | null = null;
let starting: BoardOption[] = [];
let found: BoardOption[] = [];
const expanded = new Map<string, BoardOption[]>();
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchRun = 0;

function updateSelection() {
  save.disabled = saving || columns.loading || !selected || !pageUrl;
  $('selected-board').textContent = selected ? selected.title : t('board_none_selected');
}

function openOptions() {
  void chrome.runtime.openOptionsPage();
  window.close();
}

function showResult(
  tone: 'ok' | 'error',
  text: string,
  action?: { label: string; run: () => void },
) {
  result.replaceChildren();
  result.dataset.tone = tone;
  const message = document.createElement('span');
  message.textContent = text;
  result.append(message);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'link';
    button.textContent = action.label;
    button.addEventListener('click', action.run);
    result.append(button);
  }
  result.hidden = false;
}

function showError(err: unknown) {
  const { kind } = serializeError(err);
  const reconnect = kind === 'unauthorized' || kind === 'not_connected';
  showResult(
    'error',
    errorText(err),
    reconnect ? { label: t('action_reconnect'), run: openOptions } : undefined,
  );
}

function matches(board: BoardOption, query: string): boolean {
  if (!query) return true;
  const q = query.toLocaleLowerCase();
  return (
    board.title.toLocaleLowerCase().includes(q) ||
    (board.projectName?.toLocaleLowerCase().includes(q) ?? false)
  );
}

/** Starting boards with the expanded sub-boards under their parent, then search results. */
function visibleBoards(): BoardOption[] {
  const query = search.value.trim();
  const seen = new Set<string>();
  const out: BoardOption[] = [];
  const add = (b: BoardOption) => {
    // Recent boards may come back as projects: keep both rows, but only one per section.
    const key = `${b.section}:${b.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(b);
  };
  for (const b of starting) {
    if (matches(b, query)) add(b);
    for (const child of expanded.get(b.id) ?? []) if (matches(child, query)) add(child);
  }
  const listed = new Set(out.map((b) => b.id));
  for (const b of found) if (!listed.has(b.id)) add(b);
  return out;
}

function renderBoards() {
  const boards = visibleBoards();
  list.replaceChildren();
  let section: BoardOption['section'] | null = null;
  for (const board of boards) {
    if (board.depth === 0 && board.section !== section) {
      section = board.section;
      const header = document.createElement('li');
      header.className = 'ink-label board-section';
      header.setAttribute('role', 'presentation');
      header.textContent = t(SECTION_LABELS[section]);
      list.append(header);
    }
    const item = document.createElement('li');
    item.className = selected?.id === board.id ? 'board is-selected' : 'board';
    item.style.setProperty('--depth', String(board.depth));

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'board__pick';
    pick.setAttribute('aria-pressed', String(selected?.id === board.id));
    const title = document.createElement('span');
    title.className = 'board__title';
    title.textContent = board.title;
    pick.append(title);
    if (board.projectName && board.projectName !== board.title && board.depth === 0) {
      const project = document.createElement('span');
      project.className = 'board__project';
      project.textContent = board.projectName;
      pick.append(project);
    }
    pick.addEventListener('click', () => {
      selected = board;
      void columns.select(board.id).catch(showError);
      updateSelection();
      renderBoards();
    });
    item.append(pick);

    if (board.expandable) {
      const open = expanded.has(board.id);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'board__toggle';
      toggle.textContent = open ? '−' : '+';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', t(open ? 'action_collapse' : 'action_expand'));
      toggle.addEventListener('click', () => void toggleBoard(board));
      item.append(toggle);
    }
    list.append(item);
  }
  if (boards.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'board-empty ink-muted';
    empty.textContent = t(search.value.trim() ? 'boards_none_found' : 'boards_none');
    list.append(empty);
  }
}

async function toggleBoard(board: BoardOption) {
  if (expanded.has(board.id)) expanded.delete(board.id);
  else {
    try {
      expanded.set(board.id, await send('boards', { parent: board }));
    } catch (err) {
      showError(err);
      return;
    }
  }
  renderBoards();
}

search.addEventListener('input', () => {
  renderBoards();
  clearTimeout(searchTimer);
  const query = search.value.trim();
  if (query.length < 2) {
    found = [];
    return;
  }
  searchTimer = setTimeout(async () => {
    const run = ++searchRun;
    try {
      const boards = await send('boards', { query });
      if (run !== searchRun) return;
      found = boards;
      renderBoards();
    } catch (err) {
      showError(err);
    }
  }, 250);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selected || !pageUrl || saving || columns.loading) return;
  saving = true;
  updateSelection();
  result.hidden = true;
  try {
    const saved = await send('save-page', {
      board: selected,
      url: pageUrl,
      title: pageTitle,
      columnId: column.value || undefined,
      note: note.value.trim() || undefined,
      tags: parseTags(tags.value),
    });
    note.value = '';
    tags.value = '';
    showResult('ok', t('toast_saved', saved.board.title), {
      label: t('toast_open_board'),
      run: () => {
        void chrome.tabs.create({ url: saved.boardUrl });
        window.close();
      },
    });
  } catch (err) {
    showError(err);
  } finally {
    saving = false;
    updateSelection();
  }
});

$('open-options').addEventListener('click', openOptions);
$('connect').addEventListener('click', openOptions);

async function start() {
  const [status, [tab]] = await Promise.all([
    send('status', {}),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  if (!status.connected) {
    $('disconnected').hidden = false;
    $('disconnected-text').textContent = t(
      status.revoked ? 'error_unauthorized' : 'error_not_connected',
    );
    return;
  }
  form.hidden = false;

  pageUrl = webUrl(tab?.url);
  pageTitle = tab?.title;
  $('page-title').textContent = tab?.title || tab?.url || '';
  $('page-url').textContent = pageUrl ? new URL(pageUrl).host : t('page_not_web');
  if (!pageUrl) save.title = t('page_not_web');

  selected = status.lastBoard;
  if (selected) void columns.select(selected.id).catch(showError);
  updateSelection();
  try {
    starting = await send('boards', {});
  } catch (err) {
    showError(err);
  }
  renderBoards();
  search.focus();
}

void start().catch(showError);
