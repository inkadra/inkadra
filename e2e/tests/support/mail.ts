// SPDX-License-Identifier: AGPL-3.0-only
/** Mail the server sent to the stand-in sink (scripts/mail-sink.mjs), with E2E_AUTH_PROVIDERS=1. */
import { expect } from '@playwright/test';

interface SentMail {
  to: string[];
  subject: string;
  text: string;
}

/**
 * Waits for the `count`-th mail to `to` whose text has a link to `path`, and returns that link.
 * The server sends mail detached from the request, so it may arrive a moment later.
 */
export async function linkInMail(to: string, path: string, count = 1): Promise<string> {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`https?://[^\\s"'<>]*${escaped}[^\\s"'<>]*`);
  let links: string[] = [];
  await expect
    .poll(
      async () => {
        const res = await fetch(
          `${process.env.E2E_MAIL_URL}/messages?to=${encodeURIComponent(to)}`,
        );
        if (!res.ok) throw new Error(`mail sink answered ${res.status}`);
        const mails = (await res.json()) as SentMail[];
        links = mails.flatMap((m) => pattern.exec(m.text)?.[0] ?? []);
        return links.length;
      },
      { message: `mail to ${to} with a link to ${path}`, timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(count);
  // One pass, so an escaped `&amp;#38;` stays `&#38;`.
  return (links[count - 1] as string).replace(/&(?:amp|#38);/g, '&');
}
