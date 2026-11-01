// @vitest-environment happy-dom
import type { Asset } from '@inkadra/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FileFooter } from './FileCard.tsx';
import { FontSpecimen, ModelTile } from './FontSpecimen.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('3D and font cards', () => {
  it('uses the shared card footer and a cube for models', () => {
    const html = renderToStaticMarkup(
      <>
        <ModelTile />
        <FileFooter name="cube.glb" family="3d" badge="GLB" meta={['12 polygons']} />
      </>,
    );
    expect(html).toContain('fbadge--3d');
    expect(html).toContain('12 polygons');
    expect(html).toContain('model-tile');
  });
  it('shows Aa and escapes the uploaded family name; the viewer has editable text', () => {
    const asset = {
      url: '/api/v1/assets/font/file',
      size: 42,
      exif: { filePreview: { family: '<script>test</script>' } },
    } as unknown as Asset;
    const html = renderToStaticMarkup(<FontSpecimen asset={asset} />);
    expect(html).toContain('Aa');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(renderToStaticMarkup(<FontSpecimen asset={asset} editable />)).toContain('<textarea');
  });
});

it.each([false, true])(
  'applies a loaded upload font directly to the specimen (editable: %s)',
  async (editable) => {
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const add = vi.fn();
    const remove = vi.fn();
    const fonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add, delete: remove },
    });
    const load = vi.fn().mockResolvedValue(undefined);
    const construct = vi.fn();
    vi.stubGlobal(
      'FontFace',
      class {
        load = load;
        constructor(...args: unknown[]) {
          construct(...args);
        }
      },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.close();
          },
        }),
      }),
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <FontSpecimen
            asset={{ url: '/api/v1/assets/font/file', size: 3 } as Asset}
            editable={editable}
          />,
        );
      });
      expect(load).toHaveBeenCalledOnce();
      expect(add).toHaveBeenCalledOnce();
      const glyphs = container.querySelector(
        editable ? 'textarea' : '.font-specimen > span',
      ) as HTMLElement;
      const [family, bytes] = construct.mock.calls[0] ?? [];
      expect(family).toMatch(/^inkadra-font-[a-zA-Z0-9-]+$/);
      expect(bytes).toBeInstanceOf(ArrayBuffer);
      expect(glyphs.style.fontFamily).toContain(family);
      expect(container.querySelector('.font-specimen')?.getAttribute('data-font-loaded')).toBe(
        'true',
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
      if (fonts) Object.defineProperty(document, 'fonts', fonts);
      else Reflect.deleteProperty(document, 'fonts');
    }
    expect(remove).toHaveBeenCalledOnce();
  },
);
