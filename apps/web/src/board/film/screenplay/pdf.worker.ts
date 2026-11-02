import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseFountain } from './fountain.ts';
import { HEADING, MAX_SCRIPT_BYTES, ScriptError } from './script.ts';

GlobalWorkerOptions.workerSrc = workerUrl;
// No remote fonts, CMaps, URLs, actions or attachments are read. Only inline PDF bytes.
// pdf.js runs in its fake-worker mode inside this disposable dedicated worker.
// Block resource fetches even if a future pdf.js default enables one. Module imports stay local.
self.fetch = async () => {
  throw new ScriptError('unsafe');
};
self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const file = event.data;
    if (file.size > MAX_SCRIPT_BYTES) throw new ScriptError('tooLarge');
    const task = getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      useSystemFonts: true,
      disableFontFace: true,
      useWorkerFetch: false,
      disableAutoFetch: true,
      stopAtErrors: true,
    });
    const pdf = await task.promise;
    if (pdf.numPages > 300) throw new ScriptError('tooManyPages');
    let text = '';
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      if (content.items.length > 100_000) throw new ScriptError('tooLarge');
      const lines: Array<{ x: number; y: number; height: number; text: string }> = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const x = item.transform[4] ?? 0;
        const y = item.transform[5] ?? 0;
        const last = lines.at(-1);
        if (last && Math.abs(last.y - y) < 2) last.text += ` ${item.str}`;
        else lines.push({ x, y, height: Math.abs(item.height) || 12, text: item.str });
      }
      let previous: (typeof lines)[number] | undefined;
      for (const line of lines) {
        // Numbered shooting scripts put the scene number in both page margins.
        const numbered = /^(\d+[A-Z]?)\s+(.+)$/.exec(line.text.trim());
        if (numbered?.[2] && HEADING.test(numbered[2])) {
          line.text = `${numbered[2].replace(new RegExp(`\\s+${numbered[1]}$`), '')} #${numbered[1]}#`;
        }
        // Keep paragraph gaps and indentation; Fountain recognises indented cues/dialogue.
        if (previous && Math.abs(previous.y - line.y) > line.height * 1.5) text += '\n';
        text += `${' '.repeat(Math.min(80, Math.max(0, Math.round(line.x / 6))))}${line.text}\n`;
        if (text.length > MAX_SCRIPT_BYTES) throw new ScriptError('tooLarge');
        previous = line;
      }
      text += '\n';
      page.cleanup();
    }
    await task.destroy();
    if (!text.trim()) throw new ScriptError('noText');
    self.postMessage({ kind: 'screenplay', script: parseFountain(text) });
  } catch (error) {
    self.postMessage({
      kind: 'screenplay',
      error: error instanceof ScriptError ? error.code : 'invalid',
    });
  }
};
