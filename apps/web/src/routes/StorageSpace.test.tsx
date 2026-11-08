// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { storageRefusal } from '../board/uploads.ts';
import { formatBinarySize, joinSize, splitSize } from './StorageLimitsSettings.tsx';
import { SpaceMeter, spaceTone } from './StorageSpace.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, string>) => (o ? `${key} ${JSON.stringify(o)}` : key),
    i18n: { language: 'en' },
  }),
}));

describe('storage limits in the app (decision 0081)', () => {
  it('turns orange at the warning share and red at the limit', () => {
    expect(spaceTone(3e9, 5e9, 80)).toBe('ok');
    expect(spaceTone(4e9, 5e9, 80)).toBe('warn');
    expect(spaceTone(5e9, 5e9, 80)).toBe('danger');
    expect(spaceTone(9e9, null, 80)).toBe('ok');
  });

  it('reads and writes sizes in powers of 1000', () => {
    expect(splitSize(5e9)).toEqual({ amount: '5', unit: 'GB' });
    expect(splitSize(1.5e12)).toEqual({ amount: '1.5', unit: 'TB' });
    expect(splitSize(100e6)).toEqual({ amount: '100', unit: 'MB' });
    expect(splitSize(1.1e6, 'it')).toEqual({ amount: '1,1', unit: 'MB' });
    expect(formatBinarySize(20 * 1024 ** 3, 'en')).toBe('20 GB');
    expect(joinSize('2,5', 'GB')).toBe(2.5e9);
    expect(joinSize('0', 'GB')).toBeNull();
    expect(joinSize('abc', 'GB')).toBeNull();
  });

  it('draws a meter with both tones that assistive technology reads as a size', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() =>
      root.render(
        <SpaceMeter originals={2.6e9} derived={0.6e9} limit={5e9} tone="ok" label="Space" />,
      ),
    );
    const meter = host.querySelector('[role=meter]');
    expect(meter?.getAttribute('aria-valuenow')).toBe(String(3.2e9));
    expect(meter?.getAttribute('aria-valuemax')).toBe(String(5e9));
    expect(meter?.getAttribute('aria-valuetext')).toContain('3.2 GB');
    expect(meter?.querySelectorAll('span')).toHaveLength(2);
    act(() => root.unmount());
  });

  it('tells a refusal for lack of space from any other 413', () => {
    const response = (status: number, body: string) => ({
      originalResponse: { getStatus: () => status, getBody: () => body },
    });
    const full = { code: 'storage_full', scope: 'user', remaining: 120e6, limit: 5e9 };
    expect(storageRefusal(response(413, JSON.stringify(full)))).toEqual(full);
    expect(storageRefusal(response(413, 'Maximum size exceeded'))).toBeNull();
    expect(storageRefusal(response(500, JSON.stringify(full)))).toBeNull();
    expect(storageRefusal(new Error('offline'))).toBeNull();
  });
});
