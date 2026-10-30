// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The logo printed on exports, kept in this browser per project (decision 0038): storing it on
 * the server would need a contract change.
 */
export const MAX_LOGO_BYTES = 256 * 1024;
const LOGO_TYPES = new Set(['image/png', 'image/jpeg']);

const key = (projectId: string) => `inkadra.export.logo.${projectId}`;

export function readLogo(projectId: string): string | null {
  try {
    const value = localStorage.getItem(key(projectId));
    return value?.startsWith('data:image/') ? value : null;
  } catch {
    return null;
  }
}

/** Keeps the logo; null when the file is not a small PNG or JPEG or storage is full. */
export async function saveLogo(projectId: string, file: File): Promise<string | null> {
  if (!LOGO_TYPES.has(file.type) || file.size > MAX_LOGO_BYTES) return null;
  const url = await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
  if (!url) return null;
  try {
    localStorage.setItem(key(projectId), url);
  } catch {
    return null;
  }
  return url;
}

export function removeLogo(projectId: string) {
  try {
    localStorage.removeItem(key(projectId));
  } catch {
    // Nothing kept, nothing to remove.
  }
}
