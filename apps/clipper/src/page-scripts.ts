// SPDX-License-Identifier: MPL-2.0
/*
 * Functions run inside the page with chrome.scripting.executeScript. They are serialised on
 * their own, so they must not use anything from outside their body.
 */

export type PageImage = { dataUrl: string } | { tooLarge: true } | { failed: string };

/**
 * Reads an image with the page's own cookies and referrer, so pictures behind a login can be
 * saved. Cross-origin images without CORS fail here and are tried from the extension instead.
 */
export async function readImageInPage(srcUrl: string, maxBytes: number): Promise<PageImage> {
  try {
    const res = await fetch(srcUrl, { credentials: 'include' });
    if (!res.ok) return { failed: `HTTP ${res.status}` };
    const blob = await res.blob();
    if (maxBytes > 0 && blob.size > maxBytes) return { tooLarge: true };
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return { dataUrl };
  } catch (err) {
    return { failed: err instanceof Error ? err.message : String(err) };
  }
}

export interface PageToast {
  text: string;
  tone: 'ok' | 'error';
  linkText?: string;
  linkUrl?: string;
}

/** A small toast in the corner of the page. Styled through CSSOM so page CSPs allow it. */
export function showToastInPage(toast: PageToast): void {
  const id = 'inkadra-clipper-toast';
  document.getElementById(id)?.remove();
  const host = document.createElement('div');
  host.id = id;
  const root = host.attachShadow({ mode: 'closed' });
  const box = document.createElement('div');
  box.setAttribute('role', 'status');
  Object.assign(box.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    maxWidth: '360px',
    padding: '10px 14px',
    borderRadius: '10px',
    background: '#1F1F23',
    color: '#EDEDED',
    border: `1px solid ${toast.tone === 'error' ? '#3A2326' : '#34343A'}`,
    boxShadow: '0 8px 24px rgba(0,0,0,.35)',
    font: '500 13px/1.4 Inter, system-ui, sans-serif',
  } satisfies Partial<CSSStyleDeclaration>);
  const dot = document.createElement('span');
  Object.assign(dot.style, {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flex: 'none',
    background: toast.tone === 'error' ? '#E5484D' : '#46A758',
  });
  const text = document.createElement('span');
  text.textContent = toast.text;
  box.append(dot, text);
  if (toast.linkText && toast.linkUrl) {
    const link = document.createElement('a');
    link.textContent = toast.linkText;
    link.href = toast.linkUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    Object.assign(link.style, { color: '#9DB8F2', textDecoration: 'none', whiteSpace: 'nowrap' });
    box.append(link);
  }
  root.append(box);
  document.documentElement.append(host);
  setTimeout(() => host.remove(), 5000);
}
