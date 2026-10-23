// SPDX-License-Identifier: MPL-2.0
import { ClipperError, type SerializedError, serializeError } from './errors.ts';
import type { BoardRef } from './storage.ts';

/** A board in the picker; `depth` indents sub-boards under their project. */
export interface BoardOption extends BoardRef {
  section: 'recent' | 'project' | 'shared' | 'search';
  depth: number;
  /** Its sub-boards can be listed with `boards` and `parent`. */
  expandable: boolean;
}

export interface Status {
  connected: boolean;
  /** The server answered 401: the token was revoked or has expired. */
  revoked: boolean;
  serverUrl: string | null;
  user: { name: string; email: string } | null;
  lastBoard: BoardRef | null;
}

export interface SavedClip {
  board: BoardRef;
  boardUrl: string;
  elementId: string;
}

export interface SavePageInput {
  board: BoardRef;
  url: string;
  note?: string;
  tags?: string[];
}

/** Requests the popup and the options page send to the service worker. */
export interface MessageMap {
  status: { request: Record<string, never>; response: Status };
  boards: {
    request: { query?: string; parent?: BoardRef };
    response: BoardOption[];
  };
  'save-page': { request: SavePageInput; response: SavedClip };
}

export type MessageType = keyof MessageMap;
export type Message<K extends MessageType = MessageType> = { type: K } & MessageMap[K]['request'];
export type Reply<T> = { ok: true; data: T } | { ok: false; error: SerializedError };

export type Handlers = {
  [K in MessageType]: (message: Message<K>) => Promise<MessageMap[K]['response']>;
};

export interface RouterOptions {
  /** Our own extension id: messages from anywhere else are ignored. */
  extensionId: string;
  /** Called with every failure, e.g. to forget a revoked token. */
  onError?: (err: unknown) => void | Promise<void>;
}

function isMessage(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && typeof (value as Message).type === 'string';
}

/**
 * A chrome.runtime.onMessage listener that dispatches on `type` and always answers with a
 * Reply, so the pages never wait on a message nobody handles.
 */
export function createRouter(handlers: Handlers, options: RouterOptions) {
  return (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (reply: Reply<unknown>) => void,
  ): boolean => {
    if (sender.id !== options.extensionId) return false;
    if (!isMessage(message) || !Object.hasOwn(handlers, message.type)) {
      sendResponse({ ok: false, error: { kind: 'bad_request', message: 'Unknown message.' } });
      return false;
    }
    const handler = handlers[message.type] as (m: Message) => Promise<unknown>;
    handler(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch(async (err: unknown) => {
        try {
          await options.onError?.(err);
        } catch {
          // The hook is best effort: the page still needs its answer.
        }
        sendResponse({ ok: false, error: serializeError(err) });
      });
    // Keeps the channel open for the asynchronous answer.
    return true;
  };
}

/** Sends a request to the service worker and unwraps the Reply. */
export async function send<K extends MessageType>(
  type: K,
  request: MessageMap[K]['request'],
): Promise<MessageMap[K]['response']> {
  const reply = (await chrome.runtime.sendMessage({ ...request, type })) as
    | Reply<MessageMap[K]['response']>
    | undefined;
  if (!reply) throw new ClipperError('server', 'No answer from the extension.');
  if (!reply.ok) throw new ClipperError(reply.error.kind, reply.error.message);
  return reply.data;
}
