// SPDX-License-Identifier: MPL-2.0
import { InkadraApi } from './api.ts';
import { childBoards, searchBoards, startingBoards } from './boards.ts';
import { boardUrl, type ClipContent, type ImageFetcher, saveClip } from './clip.ts';
import { ClipperError, serializeError } from './errors.ts';
import { errorText, t } from './i18n.ts';
import { whileClipping } from './keep-alive.ts';
import { createRouter, type Handlers, type SavedClip } from './messages.ts';
import { type PageToast, readImageInPage, showToastInPage } from './page-scripts.ts';
import {
  type BoardRef,
  type Connection,
  forgetBoard,
  getConnection,
  getLastBoard,
  getRecentBoards,
  markRevoked,
  rememberBoard,
  toBoardRef,
} from './storage.ts';

// Content scripts the clipper injects into pages must never read the token.
void chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });

const MENU = {
  image: 'save-image',
  selection: 'save-selection',
  link: 'save-link',
  page: 'save-page',
} as const;

async function connected(): Promise<{ api: InkadraApi; connection: Connection }> {
  const connection = await getConnection();
  if (!connection) throw new ClipperError('not_connected');
  if (!connection.token) throw new ClipperError('unauthorized');
  return {
    api: new InkadraApi({ baseUrl: connection.serverUrl, token: connection.token }),
    connection,
  };
}

async function handleFailure(err: unknown, board?: BoardRef): Promise<void> {
  if (!(err instanceof ClipperError)) return;
  if (err.kind === 'unauthorized') await markRevoked();
  // The board was deleted or moved out of reach: stop offering it.
  if (err.kind === 'not_found' && board) await forgetBoard(board.id);
}

/**
 * From the extension itself: data: addresses, CDNs that allow CORS, and the tab's own origin
 * (activeTab). Without cookies, since `Access-Control-Allow-Origin: *` refuses credentials;
 * pictures behind a login are read in the page first.
 */
function directImageFetcher(): ImageFetcher {
  return async (srcUrl) => {
    const res = await fetch(srcUrl, { credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.type.startsWith('image/') || srcUrl.startsWith('data:image/') ? blob : null;
  };
}

function pageImageFetcher(tabId: number, frameId: number, maxBytes: number): ImageFetcher {
  return async (srcUrl) => {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: readImageInPage,
      args: [srcUrl, maxBytes],
    });
    const result = injection?.result;
    if (!result) return null;
    if ('tooLarge' in result) throw new ClipperError('too_large');
    if ('failed' in result) return null;
    return (await fetch(result.dataUrl)).blob();
  };
}

async function clipTo(
  board: BoardRef,
  content: ClipContent,
  options: {
    columnId?: string;
    note?: string;
    tags?: string[];
    tab?: chrome.tabs.Tab;
    frameId?: number;
  } = {},
): Promise<SavedClip> {
  return whileClipping(async () => {
    const { api, connection } = await connected();
    const imageFetchers: ImageFetcher[] = [];
    if (content.kind === 'image') {
      if (options.tab?.id !== undefined)
        imageFetchers.push(
          pageImageFetcher(options.tab.id, options.frameId ?? 0, connection.uploadMaxBytes),
        );
      imageFetchers.push(directImageFetcher());
    }
    try {
      const result = await saveClip(
        { api, imageFetchers, uploadMaxBytes: connection.uploadMaxBytes },
        { boardId: board.id, columnId: options.columnId, note: options.note, tags: options.tags },
        content,
      );
      await rememberBoard(board);
      return {
        board,
        boardUrl: boardUrl(connection.serverUrl, board),
        elementId: result.elementId,
      };
    } catch (err) {
      await handleFailure(err, board);
      if (err instanceof ClipperError && err.kind === 'too_large')
        throw new ClipperError(err.kind, err.message, {
          ...err,
          uploadMaxBytes: connection.uploadMaxBytes,
        });
      throw err;
    }
  });
}

// Feedback for the menus and the shortcut, which have no window of their own ---------------

async function toast(tab: chrome.tabs.Tab | undefined, message: PageToast): Promise<void> {
  if (tab?.id !== undefined) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: showToastInPage,
        args: [message],
      });
      return;
    } catch {
      // chrome:// pages, the Web Store and PDFs do not take scripts: use the badge.
    }
  }
  await chrome.action.setBadgeBackgroundColor({
    color: message.tone === 'ok' ? '#46A758' : '#E5484D',
  });
  await chrome.action.setBadgeText({ text: message.tone === 'ok' ? '✓' : '!' });
  setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 4000);
}

async function clipFromPage(
  content: ClipContent,
  tab: chrome.tabs.Tab | undefined,
  frameId?: number,
): Promise<void> {
  try {
    const board = await getLastBoard();
    if (!board) throw new ClipperError('no_board');
    const saved = await clipTo(board, content, { tab, frameId });
    await toast(tab, {
      tone: 'ok',
      text: t('toast_saved', saved.board.title),
      linkText: t('toast_open_board'),
      linkUrl: saved.boardUrl,
    });
  } catch (err) {
    const { kind } = serializeError(err);
    if (kind === 'not_connected' || kind === 'unauthorized') {
      await chrome.runtime.openOptionsPage();
      return;
    }
    if (kind === 'no_board') {
      // The popup lets the person pick a board; it needs a user gesture on some versions.
      try {
        await chrome.action.openPopup();
        return;
      } catch {
        // Fall through to the toast.
      }
    }
    await toast(tab, { tone: 'error', text: errorText(err) });
  }
}

function pageContent(tab: chrome.tabs.Tab | undefined): ClipContent | null {
  return tab?.url ? { kind: 'link', url: tab.url, title: tab.title } : null;
}

// Wiring ------------------------------------------------------------------------------------

function createMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.image, title: t('menu_image'), contexts: ['image'] });
    chrome.contextMenus.create({
      id: MENU.selection,
      title: t('menu_selection'),
      contexts: ['selection'],
    });
    chrome.contextMenus.create({ id: MENU.link, title: t('menu_link'), contexts: ['link'] });
    chrome.contextMenus.create({ id: MENU.page, title: t('menu_page'), contexts: ['page'] });
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  createMenus();
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL)
    void chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const sourceUrl = info.frameUrl ?? info.pageUrl ?? tab?.url;
  let content: ClipContent | null = null;
  if (info.menuItemId === MENU.image && info.srcUrl)
    content = { kind: 'image', srcUrl: info.srcUrl, sourceUrl };
  else if (info.menuItemId === MENU.selection && info.selectionText)
    content = { kind: 'text', text: info.selectionText, sourceUrl };
  else if (info.menuItemId === MENU.link && info.linkUrl)
    content = { kind: 'link', url: info.linkUrl, sourceUrl };
  else if (info.menuItemId === MENU.page) content = pageContent(tab);
  if (content) void clipFromPage(content, tab, info.frameId);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'save-page') return;
  const content = pageContent(tab);
  if (content) void clipFromPage(content, tab);
});

const handlers: Handlers = {
  async status() {
    const [connection, lastBoard] = await Promise.all([getConnection(), getLastBoard()]);
    return {
      connected: !!connection?.token,
      revoked: !!connection && !connection.token,
      serverUrl: connection?.serverUrl ?? null,
      user: connection?.user ?? null,
      lastBoard,
    };
  },
  async boards({ query, parent }) {
    const { api } = await connected();
    if (parent) return childBoards(api, parent);
    const q = query?.trim();
    if (q) return searchBoards(api, q);
    return startingBoards(api, await getRecentBoards());
  },
  async columns({ boardId }) {
    const { api } = await connected();
    return api.columns(boardId);
  },
  async 'save-page'({ board, url, title, columnId, note, tags }) {
    return clipTo(toBoardRef(board), { kind: 'link', url, title }, { columnId, note, tags });
  },
};

chrome.runtime.onMessage.addListener(
  createRouter(handlers, { extensionId: chrome.runtime.id, onError: (err) => handleFailure(err) }),
);
