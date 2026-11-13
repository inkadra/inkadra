import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  MAX_SCRIPT_BYTES,
  type PdfPage,
  parseFountain,
  pdfPagesToFountain,
  ScriptError,
} from '@inkadra/canvas-core/screenplay';

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
    const pages: PdfPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      if (content.items.length > 100_000) throw new ScriptError('tooLarge');
      const [left = 0, , right = 612] = page.view;
      pages.push({
        width: right - left,
        items: content.items.flatMap((item) =>
          'str' in item
            ? [
                {
                  str: item.str,
                  x: item.transform[4] ?? 0,
                  y: item.transform[5] ?? 0,
                  height: item.height,
                },
              ]
            : [],
        ),
      });
      page.cleanup();
    }
    const text = pdfPagesToFountain(pages);
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
