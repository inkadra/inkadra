// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import corpus from './fixtures/fdx-corpus.json';
import { parseScreenplay } from './parse.ts';
import { ScriptError } from './script.ts';
import { MAX_XML_DEPTH } from './xml.ts';

interface Case {
  id: string;
  name: string;
  text: string;
  /** What main's parser gave in Chromium, with the browser's DOMParser. */
  expected: { script: unknown } | { error: string };
}

const read = (name: string, text: string) => {
  try {
    return { script: JSON.parse(JSON.stringify(parseScreenplay(name, text))) as unknown };
  } catch (error) {
    if (error instanceof ScriptError) return { error: error.code };
    throw error;
  }
};

describe('Final Draft without the DOM', () => {
  it('runs where there is no DOMParser', () => {
    expect(typeof (globalThis as { DOMParser?: unknown }).DOMParser).toBe('undefined');
  });

  it.each((corpus as unknown as Case[]).map((c) => [c.id, c] as const))(
    'reads %s as the browser did',
    (_, c) => {
      expect(read(c.name, c.text)).toEqual(c.expected);
    },
  );

  it('reads nesting up to its limit and refuses deeper files', () => {
    const nest = (n: number) =>
      `<FinalDraft><Content><Paragraph Type="Scene Heading"><Text>${'<b>'.repeat(n)}INT. A - DAY${'</b>'.repeat(n)}</Text></Paragraph></Content></FinalDraft>`;
    expect(read('deep.fdx', nest(MAX_XML_DEPTH - 4))).toMatchObject({
      script: { scenes: [{ location: 'A' }] },
    });
    expect(read('deep.fdx', nest(50_000))).toEqual({ error: 'invalid' });
  });
});
