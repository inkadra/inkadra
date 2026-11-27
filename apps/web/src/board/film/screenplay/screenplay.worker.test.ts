import fountain from '@inkadra/canvas-core/fixtures/last-train.fountain?raw';
import { parseScreenplay } from '@inkadra/canvas-core/screenplay/parse';
import { beforeAll, expect, it, vi } from 'vitest';

// The worker's side of the protocol: one File in, one `screenplay` message out.
const postMessage = vi.fn();
let onmessage: (event: { data: File }) => Promise<void>;
beforeAll(async () => {
  const scope = { postMessage } as unknown as { onmessage: typeof onmessage };
  vi.stubGlobal('self', scope);
  await import('./screenplay.worker.ts');
  onmessage = scope.onmessage;
});
async function respond(file: File) {
  postMessage.mockClear();
  await onmessage({ data: file });
  expect(postMessage).toHaveBeenCalledOnce();
  return postMessage.mock.calls[0]?.[0];
}

it('parses Fountain to the same structured-clone friendly script as the main thread did', async () => {
  const reply = await respond(new File([fountain], 'last-train.fountain'));
  expect(reply).toEqual({ kind: 'screenplay', script: parseScreenplay('x.fountain', fountain) });
  expect(structuredClone(reply)).toEqual(reply);
});
it('parses FDX, also a misnamed one', async () => {
  const fdx =
    '<?xml version="1.0"?><FinalDraft><Content><Paragraph Type="Scene Heading"><Text>INT. ROOM - DAY</Text></Paragraph></Content></FinalDraft>';
  const reply = await respond(new File([fdx], 'script.txt'));
  expect(reply.script.scenes[0].heading).toBe('INT. ROOM - DAY');
});
it('forwards ScriptError codes', async () => {
  expect(await respond(new File(['   '], 'x.fountain'))).toEqual({
    kind: 'screenplay',
    error: 'empty',
  });
  expect(await respond(new File(['x'], 'x.doc'))).toEqual({
    kind: 'screenplay',
    error: 'unsupported',
  });
  const big = { name: 'x.fountain', size: 5 * 1024 * 1024 + 1 } as File;
  expect(await respond(big)).toEqual({ kind: 'screenplay', error: 'tooLarge' });
});
it('reports any other failure as invalid', async () => {
  const broken = { name: 'x.fountain', size: 1, text: () => Promise.reject(new Error()) };
  expect(await respond(broken as unknown as File)).toEqual({
    kind: 'screenplay',
    error: 'invalid',
  });
});
