// SPDX-License-Identifier: AGPL-3.0-only
// A stand-in mail server for the end-to-end tests (audit F-20): it accepts every message over
// plain SMTP (no TLS, no AUTH) on E2E_SMTP_PORT and lists them as JSON on E2E_MAIL_PORT
// (`GET /messages?to=<address>`, newest last, bodies decoded). Only node: modules, so the e2e
// run needs no container. Messages live in memory until the process stops.
// shortcut: decodes only quoted-printable and base64 parts; enough for the server's own mails.
import { createServer as createHttp } from 'node:http';
import { createServer as createTcp } from 'node:net';

const smtpPort = Number(process.env.E2E_SMTP_PORT ?? 3125);
const httpPort = Number(process.env.E2E_MAIL_PORT ?? 3126);
const messages = [];

function decodePart(headers, body) {
  const encoding = /content-transfer-encoding:\s*([\w-]+)/i.exec(headers)?.[1]?.toLowerCase();
  if (encoding === 'base64') return Buffer.from(body.replace(/\s/g, ''), 'base64').toString();
  if (encoding === 'quoted-printable')
    return Buffer.from(
      body
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16))),
      'latin1',
    ).toString();
  return body;
}

/** The decoded text of every leaf part, joined: what a test searches for a link. */
function decode(raw) {
  const split = raw.indexOf('\r\n\r\n');
  if (split < 0) return raw;
  const headers = raw.slice(0, split);
  const body = raw.slice(split + 4);
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(headers)?.[1];
  if (!/content-type:\s*multipart\//i.test(headers) || !boundary) return decodePart(headers, body);
  return body
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((part) => decode(part.replace(/^\r\n/, '')))
    .join('\n');
}

createTcp((socket) => {
  let buffer = '';
  let envelope = { to: [] };
  let data = false;
  const reply = (line) => socket.write(`${line}\r\n`);
  reply('220 inkadra-e2e-mail ESMTP');
  socket.on('error', () => {});
  socket.on('data', (chunk) => {
    buffer += chunk.toString('latin1');
    for (;;) {
      if (data) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end < 0) return;
        const raw = Buffer.from(buffer.slice(0, end).replace(/^\.\./gm, '.'), 'latin1').toString();
        buffer = buffer.slice(end + 5);
        data = false;
        const subject = /^subject:\s*(.*)$/im.exec(raw)?.[1] ?? '';
        messages.push({ to: envelope.to, subject, text: decode(raw) });
        envelope = { to: [] };
        reply('250 queued');
        continue;
      }
      const end = buffer.indexOf('\r\n');
      if (end < 0) return;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const verb = line.slice(0, 4).toUpperCase();
      if (verb === 'EHLO') reply('250-inkadra-e2e-mail\r\n250 8BITMIME');
      else if (verb === 'HELO') reply('250 inkadra-e2e-mail');
      else if (verb === 'MAIL') {
        envelope = { to: [] };
        reply('250 ok');
      } else if (verb === 'RCPT') {
        envelope.to.push((/<([^>]*)>/.exec(line)?.[1] ?? '').toLowerCase());
        reply('250 ok');
      } else if (verb === 'DATA') {
        data = true;
        reply('354 end with <CRLF>.<CRLF>');
      } else if (verb === 'RSET') {
        envelope = { to: [] };
        reply('250 ok');
      } else if (verb === 'QUIT') {
        reply('221 bye');
        socket.end();
        return;
      } else if (verb === 'NOOP') reply('250 ok');
      else reply('502 command not implemented');
    }
  });
}).listen(smtpPort, '127.0.0.1');

createHttp((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${httpPort}`);
  const to = url.searchParams.get('to')?.toLowerCase();
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(to ? messages.filter((m) => m.to.includes(to)) : messages));
}).listen(httpPort, '127.0.0.1');
