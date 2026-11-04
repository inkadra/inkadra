import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker, { Meter, collectFiles, contentsBody, fenced, ipPrefix, issueBody, issueTitle, powOk, leadingZeroBits, sanitizeReport, verify } from '../src/worker.js';

/** A Durable Object's `ctx.storage.sql`, on Node's SQLite. */
function sqlStorage() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    exec(query, ...bindings) {
      if (!bindings.length && query.includes(';')) {
        db.exec(query);
        return { toArray: () => [] };
      }
      const rows = db.prepare(query).all(...bindings);
      return { toArray: () => rows };
    },
  };
}

/** The `METER` namespace with its one global instance; calls go through a promise, as over RPC. */
function meterNamespace() {
  const sql = sqlStorage();
  const instance = new Meter({ storage: { sql } }, {});
  const stub = {
    status: async (...a) => instance.status(...a),
    claim: async (...a) => instance.claim(...a),
  };
  return { sql, idFromName: (name) => name, get: () => stub };
}

function env() {
  return { METER: meterNamespace(), GITHUB_TOKEN: 'gh', TICKET_SECRET: 'secret', REPO: 'o/r', POW_BITS: '4', DAILY_LIMIT: '30' };
}

const INSTALL = '0123456789abcdef0123456789abcdef';
const OTHER_INSTALL = 'fedcba9876543210fedcba9876543210';
const IP = '203.0.113.7';

async function solve(seed, bits) {
  for (let n = 0; ; n++) if (await powOk(seed, String(n), bits)) return String(n);
}

function mockGitHub() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    // File uploads arrive as a stream of JSON, everything else as a string.
    const text = init.body == null ? null : await new Response(init.body).text();
    calls.push({ url, method: init.method, body: text ? JSON.parse(text) : null });
    if (init.method === 'GET' && url === 'https://api.github.com/repos/o/r') return Response.json({private: true, full_name: 'o/r'});
    if (init.method === 'GET') return new Response('{}', { status: 404 });
    if (url.endsWith('/git/trees')) return Response.json({ sha: 'tree' }, { status: 201 });
    if (url.endsWith('/git/commits')) return Response.json({ sha: 'commit' }, { status: 201 });
    if (url.endsWith('/issues')) return Response.json({ html_url: 'https://github.com/o/r/issues/7', number: 7 }, { status: 201 });
    return Response.json({}, { status: 201 });
  };
  return calls;
}

const post = (path, body, headers = {}) => new Request(`https://relay.test${path}`, { method: 'POST', body, headers });

async function challengeRes(e, installId = INSTALL, ip = IP) {
  return worker.fetch(post('/challenge', JSON.stringify({ installId }), { 'content-type': 'application/json', 'cf-connecting-ip': ip }), e);
}

async function ticketFor(e, installId = INSTALL, ip = IP) {
  const res = await challengeRes(e, installId, ip);
  assert.equal(res.status, 200);
  return res.json();
}

function reportForm(t, nonce, extra = {}, installId = INSTALL) {
  const form = new FormData();
  form.set('report', JSON.stringify({
    installId, ticket: t.ticket, powNonce: nonce, kind: 'problem', title: 'Inbox stops syncing',
    description: 'After waking from sleep', device: { App: '0.1.0', Device: 'Pixel' }, screens: ['12:00 Inbox'],
    logExcerpt: 'W boom', ...extra,
  }));
  form.set('screenshot', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'screenshot.png');
  form.set('logs', new Blob(['all the logs'], { type: 'text/plain' }), 'logs.txt');
  return form;
}

const sendReport = (e, form, ip = IP) => worker.fetch(post('/report', form, { 'cf-connecting-ip': ip }), e);

/** Runs `fn` with the clock moved forward by `ms`. */
async function later(ms, fn) {
  const realNow = Date.now;
  Date.now = () => realNow() + ms;
  try {
    return await fn();
  } finally {
    Date.now = realNow;
  }
}

test('too early is refused with retry-after', async () => {
  const e = env();
  const t = await ticketFor(e);
  const res = await sendReport(e, reportForm(t, await solve(t.seed, t.bits)));
  assert.equal(res.status, 403);
  assert.ok(Number(res.headers.get('retry-after')) > 0);
});

test('proof of work difficulty is clamped to the supported range', async () => {
  for (const [configured, expected] of [[undefined, 16], ['-5', 0], ['0', 0], ['16', 16], ['32', 32], ['999', 32]]) {
    const e = env();
    e.POW_BITS = configured;
    const t = await ticketFor(e);
    assert.equal(t.bits, expected);
    assert.equal((await verify(e, t.ticket)).bits, expected);
  }
});

test('invalid proof of work configuration cannot issue unusable tickets', async () => {
  for (const configured of ['invalid', '3.5']) {
    const e = env();
    e.POW_BITS = configured;
    const response = await challengeRes(e);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'invalid POW_BITS' });
  }
});

test('oversized forms are rejected before parsing, regardless of Content-Length', async () => {
  const maxForm = 33 * 1024 * 1024;
  for (const length of [undefined, '0', '1', 'not-a-number', String(maxForm + 1)]) {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const headers = { 'cf-connecting-ip': IP, 'content-type': 'multipart/form-data; boundary=test' };
    if (length !== undefined) headers['content-length'] = length;
    const request = new Request('https://relay.test/report', { method: 'POST', body, headers, duplex: 'half' });
    const response = await worker.fetch(request, env());
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'too large' });
    if (length === String(maxForm + 1)) {
      assert.equal(pulls, 0);
    } else {
      assert.equal(pulls, 34);
      assert.equal(cancelled, true);
    }
  }
});

test('malformed multipart forms return a client error', async () => {
  const response = await worker.fetch(post('/report', 'not multipart', {
    'cf-connecting-ip': IP,
    'content-type': 'multipart/form-data; boundary=test',
  }), env());
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'form' });
});

test('a valid report creates the issue with its attachments, once', async () => {
  const e = env();
  const calls = mockGitHub();
  const t = await ticketFor(e);
  await later(10_000, async () => {
    const form = reportForm(t, await solve(t.seed, t.bits));
    const res = await sendReport(e, form);
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { url: 'https://github.com/o/r/issues/7', number: 7 });
    const puts = calls.filter((c) => c.method === 'PUT');
    assert.equal(puts.length, 2);
    assert.ok(puts.every((c) => c.body.branch === 'feedback-assets'));
    const issue = calls.find((c) => c.url.endsWith('/issues')).body;
    assert.equal(issue.title, 'Inbox stops syncing');
    assert.deepEqual(issue.labels, ['from-app', 'bug', 'area:other']);
    assert.match(issue.body.replaceAll('\\', ''), /!\[screenshot\.png\]\(https:\/\/github\.com\/o\/r\/blob\/feedback-assets\/reports\/.+\/screenshot\.png\?raw=true\)/);
    assert.match(issue.body.replaceAll('\\', ''), /logs\.txt/);
    assert.match(issue.body.replaceAll('\\', ''), /W boom/);
    // The same ticket can't be used twice.
    const again = await sendReport(e, reportForm(t, await solve(t.seed, t.bits)));
    assert.equal(again.status, 409);
    // And the next report from this installation waits longer.
    const t2 = await ticketFor(e);
    assert.ok(t2.nbf - Date.now() > 5_000);
  });
});

test('an idea is labelled idea, and files other than images, videos and text are dropped', async () => {
  const e = env();
  const calls = mockGitHub();
  const t = await ticketFor(e);
  await later(10_000, async () => {
    const form = reportForm(t, await solve(t.seed, t.bits), { kind: 'idea', title: 'Pin conversations' });
    form.set('drawing', new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' }), 'drawing.svg');
    form.set('archive', new Blob([new Uint8Array([80, 75, 3, 4])], { type: 'application/zip' }), 'all.zip');
    const res = await sendReport(e, form);
    assert.equal(res.status, 201);
    const puts = calls.filter((c) => c.method === 'PUT');
    assert.deepEqual(puts.map((c) => c.url.split('/').pop()).sort(), ['logs.txt', 'screenshot.png']);
    const issue = calls.find((c) => c.url.endsWith('/issues')).body;
    assert.equal(issue.title, '[Idea] Pin conversations');
    assert.deepEqual(issue.labels, ['from-app', 'idea', 'area:other']);
  });
});

test('an unknown kind is treated as a problem', () => {
  assert.equal(sanitizeReport({ kind: 'feature', title: 'x' }).kind, 'problem');
});

test('the same ticket sent twice in parallel opens one issue', async () => {
  const e = env();
  const calls = mockGitHub();
  const t = await ticketFor(e);
  await later(10_000, async () => {
    const nonce = await solve(t.seed, t.bits);
    const results = await Promise.all([sendReport(e, reportForm(t, nonce)), sendReport(e, reportForm(t, nonce))]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(calls.filter((c) => c.url.endsWith('/issues')).length, 1);
  });
});

test('wrong proof of work or forged ticket is refused', async () => {
  const e = env();
  mockGitHub();
  const t = await ticketFor(e);
  await later(10_000, async () => {
    let bad = '0';
    while (await powOk(t.seed, bad, t.bits)) bad = String(Number(bad) + 1);
    assert.equal((await sendReport(e, reportForm(t, bad))).status, 403);
    const forged = { ...t, ticket: t.ticket.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) };
    assert.equal((await sendReport(e, reportForm(forged, await solve(t.seed, t.bits)))).status, 403);
  });
});

test('daily cap closes the relay', async () => {
  const e = env();
  e.METER.sql.exec('INSERT INTO days (day, total) VALUES (?, ?)', new Date().toISOString().slice(0, 10), 30);
  const res = await challengeRes(e);
  assert.equal(res.status, 503);
  assert.ok(Number(res.headers.get('retry-after')) > 0);
});

test('the daily cap holds for parallel reports', async () => {
  const e = env();
  e.DAILY_LIMIT = '2';
  const calls = mockGitHub();
  // Five installations on five networks, each with a ready ticket.
  const ips = ['198.51.100.1', '198.51.100.2', '198.51.100.3', '198.51.100.4', '198.51.100.5'];
  const installs = ips.map((_, i) => `${'0'.repeat(31)}${i}`);
  const tickets = await Promise.all(installs.map((id, i) => ticketFor(e, id, ips[i])));
  await later(10_000, async () => {
    const forms = await Promise.all(tickets.map(async (t, i) => reportForm(t, await solve(t.seed, t.bits), {}, installs[i])));
    const results = await Promise.all(forms.map((f, i) => sendReport(e, f, ips[i])));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 201, 503, 503, 503]);
    assert.equal(calls.filter((c) => c.url.endsWith('/issues')).length, 2);
  });
});

test('the wait doubles per network even with a fresh install id', async () => {
  const e = env();
  mockGitHub();
  const t = await ticketFor(e);
  await later(10_000, async () => {
    assert.equal((await sendReport(e, reportForm(t, await solve(t.seed, t.bits)))).status, 201);
    // A new install id from the same network still waits for a second report...
    const fresh = await ticketFor(e, OTHER_INSTALL);
    assert.ok(fresh.nbf - Date.now() > 9_000, `waited ${fresh.nbf - Date.now()} ms`);
    // ...while another network starts from the first wait.
    const elsewhere = await ticketFor(e, OTHER_INSTALL, '192.0.2.50');
    assert.ok(elsewhere.nbf - Date.now() <= 5_000);
  });
});

test('tickets fetched before a report still wait once it is counted', async () => {
  const e = env();
  mockGitHub();
  // Two tickets taken together carry the first, shortest wait.
  const [a, b] = [await ticketFor(e), await ticketFor(e, OTHER_INSTALL)];
  await later(6_000, async () => {
    assert.equal((await sendReport(e, reportForm(a, await solve(a.seed, a.bits)))).status, 201);
    const res = await sendReport(e, reportForm(b, await solve(b.seed, b.bits), {}, OTHER_INSTALL));
    assert.equal(res.status, 403);
    assert.ok(Number(res.headers.get('retry-after')) > 0);
  });
});

test('the rate limiter answers 429 when it says no', async () => {
  const e = env();
  const keys = [];
  e.RATE_LIMITER = { limit: async ({ key }) => (keys.push(key), { success: false }) };
  const res = await challengeRes(e);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '60');
  assert.equal((await sendReport(e, new FormData())).status, 429);
  // Keyed by a hash of the network, never the bare IP.
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.match(keys[0], /^[0-9a-f]{64}$/);
  e.RATE_LIMITER = { limit: async () => ({ success: true }) };
  assert.equal((await challengeRes(e)).status, 200);
});

test('/health says only that it is up', async () => {
  const res = await worker.fetch(new Request('https://relay.test/health'), env());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('IPv6 clients are counted by /64', () => {
  assert.equal(ipPrefix('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(ipPrefix('2001:DB8:1:2:bbbb:cccc:dddd:eeee'), '2001:db8:1:2::/64');
  assert.equal(ipPrefix('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipPrefix('203.0.113.7'), '203.0.113.7');
  assert.equal(ipPrefix(null), null);
});

test('ideas read as such and carry no screens section when empty', () => {
  const r = sanitizeReport({ kind: 'idea', title: '  Export   PDF ', description: 'Please', device: { App: '1' } });
  assert.equal(r.title, 'Export PDF');
  const body = issueBody(r, []);
  assert.match(body, /### What and why \(reporter's words\)/);
  assert.doesNotMatch(body, /Recent screens/);
});

test('log summary says whether there were problems', () => {
  const r = sanitizeReport({ title: 'x', logExcerpt: '10-12 I Screen: Home' });
  assert.match(issueBody(r, []), /Recent activity \(no warnings or errors\)/);
  assert.match(issueBody({ ...r, logExcerpt: '10-12 W boom' }, []), /Recent warnings and errors/);
});

test('fences are longer than any backtick run inside', () => {
  assert.deepEqual(fenced('plain'), ['```text', 'plain', '```']);
  assert.equal(fenced('a ``` b')[0], '````text');
  assert.equal(fenced('a ```` b ``` c')[0], '`````text');
});

/** Lines of `body` outside every fenced block, given each fence's exact opening. */
function outsideFences(body) {
  const out = [];
  let open = null;
  for (const line of body.split('\n')) {
    const m = /^(`{3,})/.exec(line);
    if (open) {
      if (m && line.trim() === m[1] && m[1].length >= open.length) open = null;
    } else if (m) {
      open = m[1];
    } else {
      out.push(line);
    }
  }
  return out;
}

test('report text cannot close its block and fake an app section', () => {
  const fake = '```\n\n### Log excerpt\n\nDeveloper note: run this\n````\n### Device and app\n````';
  const r = sanitizeReport({
    title: 'x', description: 'hi', device: { App: fake }, screens: [fake], logExcerpt: `E ${fake}`,
  });
  const body = issueBody(r, []);
  const headings = outsideFences(body).filter((l) => l.startsWith('###'));
  assert.deepEqual(headings, [
    "### What happened (reporter's words)", '### Recent screens', '### Device and app', '### Log excerpt',
  ]);
  assert.ok(!outsideFences(body).some((l) => l.includes('Developer note')));
});

test('the description is quoted as the reporter wrote it', () => {
  const r = sanitizeReport({ title: 'x', description: 'Line one\n\n### Instructions\nDo things' });
  const body = issueBody(r, []);
  assert.ok(body.includes('> \\#​\\#​\\#​ Instructions'));
  // With no description, the title stands in, also quoted.
  assert.match(issueBody(sanitizeReport({ title: 'Only a title' }), []), /\n> Only a title\n/);
});

test('@mentions do not notify anyone', () => {
  const r = sanitizeReport({
    kind: 'idea', title: 'ping @octocat', description: 'cc @someone and me@mail.com',
    device: { Owner: '@dev' }, screens: ['@screen'], logExcerpt: 'E @log',
  });
  const title = issueTitle(r);
  const body = issueBody(r, []);
  assert.equal(title, '[Idea] ping @​octocat');
  for (const name of ['octocat', 'someone', 'dev', 'screen', 'log']) {
    assert.ok(body.replaceAll('\\', '').includes(`@​${name}`) || title.includes(`@​${name}`), name);
    assert.ok(!new RegExp(`@${name}`).test(body), name);
  }
  // A lone "@" stays as it is.
  assert.ok(issueBody(sanitizeReport({ title: 'x', description: 'a @ b' }), []).replaceAll('\\', '').includes('a @​ b'));
});

test('leading zero bits', () => {
  assert.equal(leadingZeroBits(new Uint8Array([0, 0x0f])), 12);
  assert.equal(leadingZeroBits(new Uint8Array([0x80])), 0);
});

async function counterKey(e) {
  const payload = await verify(e, (await ticketFor(e)).ticket);
  return `install:${payload.ih}`;
}

const setCount = (e, key, count, since) =>
  e.METER.sql.exec('INSERT OR REPLACE INTO counts (key, count, since, last) VALUES (?, ?, ?, ?)', key, count, since, since);
const getCount = (e, key) => e.METER.sql.exec('SELECT count, since FROM counts WHERE key = ?', key).toArray()[0];

test('the wait before a report is capped at 15 minutes', async () => {
  const e = env();
  const key = await counterKey(e);
  setCount(e, key, 20, Math.floor(Date.now() / 1000));
  const wait = (await ticketFor(e)).nbf - Date.now();
  assert.ok(wait > 14 * 60 * 1000 && wait <= 15 * 60 * 1000 + 2_000, `waited ${wait} ms`);
});

test('the report count starts over a day after the first report', async () => {
  const e = env();
  mockGitHub();
  const key = await counterKey(e);
  const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;
  setCount(e, key, 9, twoDaysAgo);
  // An old window doesn't count towards the wait...
  const t = await ticketFor(e);
  assert.ok(t.nbf - Date.now() <= 5_000);
  // ...and a report now counts as the first of a new day.
  await later(t.nbf - Date.now() + 1_000, async () => {
    assert.equal((await sendReport(e, reportForm(t, await solve(t.seed, t.bits)))).status, 201);
  });
  const v = getCount(e, key);
  assert.equal(v.count, 1);
  assert.ok(v.since > twoDaysAgo);
});

test('attached images show inline and videos are linked under Attachments', async () => {
  const e = env();
  const calls = mockGitHub();
  const t = await ticketFor(e);
  await later(10_000, async () => {
    const form = reportForm(t, await solve(t.seed, t.bits));
    form.set('attachment-1', new Blob([new Uint8Array([71, 73, 70])], { type: 'image/gif' }), 'attachment-1.gif');
    form.set('attachment-2', new Blob([new Uint8Array([0, 0, 0, 24, 1])], { type: 'video/mp4' }), 'attachment-2.mp4');
    form.set('attachment-3', new Blob([new Uint8Array([26, 69, 223])], { type: 'video/webm' }), 'attachment-3.webm');
    form.set('attachment-4', new Blob([new Uint8Array([0, 0, 0, 20])], { type: 'video/quicktime' }), 'attachment-4.mov');
    const res = await sendReport(e, form);
    assert.equal(res.status, 201);
    const puts = calls.filter((c) => c.method === 'PUT');
    assert.deepEqual(puts.map((c) => c.url.split('/').pop()).sort(), [
      'attachment-1.gif', 'attachment-2.mp4', 'attachment-3.webm', 'attachment-4.mov', 'logs.txt', 'screenshot.png',
    ]);
    const mp4 = puts.find((c) => c.url.endsWith('attachment-2.mp4')).body;
    assert.deepEqual([...Buffer.from(mp4.content, 'base64')], [0, 0, 0, 24, 1]);
    assert.equal(mp4.branch, 'feedback-assets');
    const body = calls.find((c) => c.url.endsWith('/issues')).body.body;
    const [images, attachments] = body.split('### Attachments');
    assert.match(images.replaceAll('\\', ''), /!\[attachment-1\.gif\]\(.+attachment-1\.gif\?raw=true\)/);
    for (const name of ['attachment-2.mp4', 'attachment-3.webm', 'attachment-4.mov']) {
      assert.match(attachments.replaceAll('\\', ''), new RegExp(`- \\[${name.replace('.', '\\.')}\\]\\(https://github\\.com/o/r/blob/feedback-assets/`));
      assert.doesNotMatch(images, new RegExp(name.replace('.', '\\.')));
    }
  });
});

test('files over their limits are refused before the ticket is used', async () => {
  const e = env();
  const calls = mockGitHub();
  const t = await ticketFor(e);
  const MiB = 1024 * 1024;
  await later(10_000, async () => {
    const nonce = await solve(t.seed, t.bits);
    const cases = [
      [[['attachment-1', 'image/png', 25 * MiB + 1]], 'file too large'],
      [[['attachment-1', 'video/mp4', 25 * MiB + 1]], 'file too large'],
      [[['attachment-1', 'video/mp4', 25 * MiB], ['attachment-2', 'image/jpeg', 7 * MiB + 1]], 'too large'],
      [Array.from({ length: 7 }, (_, i) => [`attachment-${i + 1}`, 'image/webp', 1]), 'too many files'],
    ];
    for (const [files, error] of cases) {
      const form = reportForm(t, nonce);
      for (const [field, type, size] of files) form.set(field, new Blob([new Uint8Array(size)], { type }), `${field}.bin`);
      const res = await sendReport(e, form);
      assert.equal(res.status, 413);
      assert.deepEqual(await res.json(), { error });
    }
    assert.equal(calls.length, 0);
    // The ticket is still good: the same report without the files goes.
    assert.equal((await sendReport(e, reportForm(t, nonce))).status, 201);
  });
});

test('a video just under its limit fits, and repeated names get their own path', async () => {
  const form = new FormData();
  form.append('a', new Blob([new Uint8Array(25 * 1024 * 1024)], { type: 'video/mp4' }), 'clip.mp4');
  form.append('b', new Blob([new Uint8Array(3)], { type: 'IMAGE/PNG' }), 'clip.mp4');
  form.append('c', new Blob([new Uint8Array(3)], { type: 'image/png' }), '../../x y.png');
  const files = collectFiles(form);
  assert.deepEqual(files.map((f) => [f.name, f.type]), [['clip.mp4', 'video/mp4'], ['2-clip.mp4', 'image/png'], ['.._.._x_y.png', 'image/png']]);
});

test('the contents body streams the file as base64 with its exact length', async () => {
  for (const size of [0, 1, 2, 3, 4, 3 * 256 * 1024, 3 * 256 * 1024 + 1, 2 * 1024 * 1024 + 5]) {
    const bytes = new Uint8Array(size).map((_, i) => (i * 31) & 255);
    const { stream, length } = contentsBody({ message: 'Report attachment: a "b"', branch: 'feedback-assets' }, new Blob([bytes]));
    const raw = new Uint8Array(await new Response(stream).arrayBuffer());
    assert.equal(raw.length, length);
    const json = JSON.parse(new TextDecoder().decode(raw));
    assert.equal(json.message, 'Report attachment: a "b"');
    assert.equal(json.branch, 'feedback-assets');
    assert.deepEqual(new Uint8Array(Buffer.from(json.content, 'base64')), bytes);
    assert.equal(json.content, Buffer.from(bytes).toString('base64'));
  }
});

test('generated duplicate names cannot collide with another submitted name', () => {
  const form = new FormData();
  for (const name of ['clip.mp4', '3-clip.mp4', 'clip.mp4']) {
    form.append('attachment', new Blob(['x'], { type: 'video/mp4' }), name);
  }
  const files = collectFiles(form);
  assert.equal(new Set(files.map((f) => f.name)).size, 3);
});

 test('all invisible input, links, references, markup and hashes are inert at the Worker boundary', () => {
 const hidden = '\u200c\u2060\ufeff\u00ad\u061c\u{e0061}';
 const r = sanitizeReport({title: `a${hidden}b @dev #42 https://evil.test deadbeef`, description: `<img> [go](https://evil.test) ${hidden}`, device: {x: hidden}, logExcerpt: hidden});
 const output = issueTitle(r) + issueBody(r, []);
 for (const c of hidden) assert.ok(!output.includes(c));
 assert.ok(!output.includes('@dev')); assert.ok(!output.includes('https://evil.test')); assert.ok(!output.includes('deadbeef'));
 assert.ok(output.includes('\\<img\\>'));
 });


test('every type an Inkadra server stores survives, codec parameters included', () => {
  const form = new FormData();
  const types = ['video/webm;codecs=vp9', 'image/heic', 'image/tiff', 'image/avif', 'video/x-msvideo', 'video/mpeg', 'video/mp2t', 'application/pdf'];
  types.forEach((type, i) => form.append(`attachment-${i + 1}`, new File(['x'], `f${i}`, { type })));
  const files = collectFiles(form);
  assert.equal(files.length, types.length);
  assert.equal(files.dropped, undefined);
  assert.equal(files[0].type, 'video/webm');
});

test('a dropped file is named in the issue and HEIC is linked, not shown inline', () => {
  const form = new FormData();
  form.append('attachment-1', new File(['x'], 'a.zip', { type: 'application/zip' }));
  const dropped = collectFiles(form);
  const r = sanitizeReport({ kind: 'problem', title: 'T', description: 'D' });
  assert.match(issueBody(r, dropped), /1 attachment\(s\) of an unsupported type were not stored/);
  const heic = issueBody(r, [{ name: 'p.heic', type: 'image/heic', size: 1, url: 'https://x/p' }]);
  assert.doesNotMatch(heic, /!\[/);
  assert.match(heic, /### Attachments/);
});

test('the issue fits GitHub limits however much the text grows when neutralised', () => {
  const r = sanitizeReport({
    kind: 'idea',
    title: '#'.repeat(200),
    description: '#'.repeat(12000),
    device: { a: '@'.repeat(4000) },
    screens: Array(12).fill('#'.repeat(120)),
    logExcerpt: '#'.repeat(24000),
  });
  assert.ok(issueTitle(r).length <= 256);
  assert.ok(issueBody(r, []).length <= 65536);
});

test('distinguishes pre-write failures from ambiguous GitHub writes', async () => {
  for (const duringWrite of [false, true]) {
    const e = env();
    mockGitHub();
    const fakeFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if ((duringWrite && url.endsWith('/issues')) || (!duringWrite && url === 'https://api.github.com/repos/o/r')) return new Response('{}', {status: 500});
      return fakeFetch(url, init);
    };
    const t = await ticketFor(e);
    await later(5000, async () => {
      const response = await sendReport(e, reportForm(t, await solve(t.seed, t.bits)));
      assert.equal(response.status, 502);
      assert.equal((await response.json()).uncertain, duringWrite);
    });
  }
});
