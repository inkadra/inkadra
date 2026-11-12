// SPDX-License-Identifier: MPL-2.0

/**
 * A file size as every client prints it, in binary steps (1 KB = 1024 B): 4,2 MB in Italian,
 * 4.2 MB in English; one decimal under ten, none above; whole bytes under 1 KB.
 */
export function formatBytes(bytes: number, locale?: string): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v < 10 ? 1 : 0;
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(v);
  return `${number} ${units[i]}`;
}
