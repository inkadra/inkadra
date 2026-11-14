import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { noteBlocks } from './export/note-text.ts';
import { parseTrigger } from './NotePhoneTools.tsx';
import { isEmpty } from './note.tsx';
import { plainText } from './note-text.ts';
import { type Peer, typingIn } from './presence.ts';

describe('the phone note (#110)', () => {
  it('opens the menus only for @ and / at the start of a word', () => {
    expect(parseTrigger('Ask @Giu')).toEqual({ char: '@', query: 'Giu' });
    expect(parseTrigger('/')).toEqual({ char: '/', query: '' });
    expect(parseTrigger('line /to')).toEqual({ char: '/', query: 'to' });
    expect(parseTrigger('mail@example')).toBeNull();
    expect(parseTrigger('24/7')).toBeNull();
    expect(parseTrigger('@Giulia done')).toBeNull();
  });

  it('shows each person typing in the note once, never viewers', () => {
    const peer = (clientId: number, id: string, extra: Partial<Peer>): Peer => ({
      clientId,
      color: '',
      user: { id, name: id, image: null },
      readOnly: false,
      cursor: null,
      selection: [],
      editing: 'noteAAAAAAAAA',
      typing: true,
      ...extra,
    });
    const people = typingIn(
      [
        peer(1, 'giulia', {}),
        peer(2, 'giulia', {}),
        peer(3, 'marco', { typing: false }),
        peer(4, 'anna', { readOnly: true }),
        peer(5, 'luca', { editing: 'noteBBBBBBBBB' }),
      ],
      'noteAAAAAAAAA',
    );
    expect(people.map((p) => p.user.id)).toEqual(['giulia']);
  });

  it('reads mentions as names, and a note with only a picture is not empty', () => {
    const doc = new Y.Doc();
    const body = doc.getXmlFragment('body');
    const p = new Y.XmlElement('paragraph');
    const mention = new Y.XmlElement('mention');
    mention.setAttribute('id', 'user-1');
    mention.setAttribute('label', 'Giulia');
    p.insert(0, [new Y.XmlText('Ask '), mention]);
    body.insert(0, [p]);
    expect(plainText(body)).toBe('Ask @Giulia');
    expect(noteBlocks(body)).toEqual([{ kind: 'p', text: 'Ask @Giulia' }]);

    const only = doc.getXmlFragment('picture');
    const picture = new Y.XmlElement('noteImage');
    picture.setAttribute('assetId', 'asset-1');
    only.insert(0, [new Y.XmlElement('paragraph'), picture]);
    expect(isEmpty(only)).toBe(false);
    expect(noteBlocks(only)).toEqual([{ kind: 'p', text: '' }]);
  });
});
