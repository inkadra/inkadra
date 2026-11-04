import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CreateFeedback } from '@inkadra/shared';
import { expect, it } from 'vitest';
import type { Config } from './config.ts';
import {
  errorSignature,
  GitHubFeedback,
  GitHubRefused,
  inertText,
  issueBody,
  issueTitle,
  markdownText,
  repeatComment,
} from './feedback.ts';

const context = {
  reporter: '@person (member)',
  instance: 'Inkadra',
  publicUrl: 'https://instance.test',
  id: 'local-id',
  signature: 'abc123',
  expires: new Date('2027-02-01T00:00:00Z'),
};
const report: CreateFeedback = {
  requestId: '00000000-0000-4000-8000-000000000001',
  type: 'bug',
  area: 'board',
  title: '@maintainer https://evil.test #42',
  description:
    '@maintainer @org/team fixes #42 GH-7 owner/repo#3 abcdef1234567 &#64;entity\n```\n</details><img src="https://evil.test">\n[click](https://evil.test) ![x](https://evil.test) <!-- hidden --> www.evil.test | a | b |',
  diagnostics: {
    environment: 'Inkadra 0.8 | build x\nChrome 142 · Windows 11',
    console: 'TypeError: broken at 123 @nobody\n```\n@escaped #99\n````\n@again',
    network: 'POST /api/v1/x 409',
  },
  attachments: [
    {
      id: 'a'.repeat(64),
      kind: 'screenshot',
      name: 'screenshot.png',
      bytes: 2048,
      mime: 'image/png',
      redactedAreas: 2,
    },
    {
      id: 'b'.repeat(64),
      kind: 'video',
      name: 'recording.webm',
      bytes: 12478054,
      mime: 'video/webm',
      seconds: 38,
    },
    {
      id: 'c'.repeat(64),
      kind: 'file',
      name: '@x](https://evil.test).pdf',
      bytes: 348160,
      mime: 'application/pdf',
    },
  ],
};

/** What GitHub would act on, once Markdown has been decoded. */
function active(markdown: string) {
  const decoded = markdown
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  return {
    mentions: decoded.match(/(?<![\w`])@[a-z0-9][a-z0-9-]*/gi) ?? [],
    references: decoded.match(/(?:#|GH-)\d+/gi) ?? [],
    links: decoded.match(/(?:https?:\/\/|www\.)evil/gi) ?? [],
    sha: decoded.match(/\b[0-9a-f]{7,40}\b/g) ?? [],
  };
}

it('leaves nothing in a report that acts on maintainers, in any field', () => {
  const body = issueBody(report, context);
  const decodedActive = active(body);
  expect(decodedActive.mentions).toEqual([]);
  expect(decodedActive.references).toEqual([]);
  expect(decodedActive.links).toEqual([]);
  expect(decodedActive.sha).toEqual([]);
  // Raw markup survives only escaped.
  expect(body).not.toMatch(/(?<!\\)<img/);
  expect(body).not.toMatch(/(?<!\\)<!-- hidden/);
  expect(body).not.toMatch(/(?<!\\)\[click/);
  expect(body).not.toMatch(/(?<!\\)!\[x/);
  expect(body).not.toMatch(/\| a \| b/);
  expect(body).not.toContain('</details><img');
  expect(active(repeatComment(report, context)).mentions).toEqual([]);
  expect(inertText(report.title)).not.toMatch(/@m|#4|https:\/\//);
  expect(markdownText('**bold** 1. _x_')).toBe('\\*\\*bold\\*\\* 1\\. \\_x\\_');
});

it('removes every character a reader cannot see, in every field', () => {
  const hidden =
    '\u00ad\u034f\u061c\u180e\u200b\u200c\u200d\u200e\u200f\u202a\u202e\u2060\u2064\u2066\u2069\u3164\ufe0f\ufeff\u{e0001}\u{e0041}\u{e007f}\u{e0100}';
  const body = issueBody(
    {
      ...report,
      description: `pri${hidden}ma`,
      diagnostics: {
        environment: `Ver${hidden}sion`,
        console: `Err${hidden}or`,
        page: `/p${hidden}`,
      },
      attachments: [
        {
          ...(report.attachments[2] as CreateFeedback['attachments'][number]),
          name: `fi${hidden}le.pdf`,
        },
      ],
    } as CreateFeedback,
    { ...context, reporter: `Giu${hidden}lia`, instance: `Ink${hidden}adra` },
  );
  // Our own separator is the one exception, and it sits after @ and # only.
  expect(body.replace(/(?<=[@#])\u200b/g, '')).not.toMatch(
    /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u,
  );
  for (const word of ['prima', 'Version', 'Error', 'file\\.pdf', 'Giulia', 'Inkadra'])
    expect(body).toContain(word);
  expect(issueTitle(`ti${hidden}tolo`)).toBe('titolo');
});

it('cannot be broken out of the code fence by the logs', () => {
  const body = issueBody(report, context);
  // Four backticks in the log: the fence is five.
  expect(body).toContain('`````text\n');
  expect(body.split('`````').length).toBe(3);
});

it('uses the approved template: English headings, the text as written, no email', () => {
  const body = issueBody(
    { ...report, description: 'Il menu non si apre: è tagliato', attachments: report.attachments },
    context,
  );
  expect(body).toMatch(/^> \[!WARNING\]\n> Reported from the app\./);
  expect(body).toContain('### Description\nIl menu non si apre\\: è tagliato');
  expect(body).toContain(
    `![Screenshot, 2 areas redacted by the reporter](https://instance.test/api/v1/feedback/attachments/${'a'.repeat(64)})\n*Link expires on 2027-02-01.*`,
  );
  expect(body).toContain('recording\\.webm');
  expect(body).toContain(', 0:38, 11.9 MB. *Expires on 2027-02-01.*');
  expect(body).toContain('| Browser and OS | Chrome 142 · Windows 11 |');
  expect(body).toContain('Inkadra 0\\.8 \\| build x');
  expect(body).toContain('<details><summary>Console (5)</summary>');
  expect(body).toContain('<!-- inkadra-signature: abc123 -->');
  const none = issueBody({ ...report, diagnostics: {}, attachments: [] }, context);
  expect(none).toContain('Failed requests: not included by the reporter.');
  expect(none).not.toContain('### Screenshot');
});

it('stays inside what GitHub accepts, whatever the report holds', () => {
  const body = issueBody(
    {
      ...report,
      title: '@'.repeat(160),
      description: '@'.repeat(12000),
      diagnostics: {
        environment: '@'.repeat(4000),
        console: '@'.repeat(16000),
        network: '@'.repeat(8000),
        sync: '@'.repeat(1000),
        flags: '@'.repeat(1000),
        page: '@'.repeat(1000),
      },
    },
    context,
  );
  expect(body.length).toBeLessThanOrEqual(65536);
  // Thousands of lines, each its own table row.
  const rows = issueBody(
    { ...report, diagnostics: { environment: 'x\n'.repeat(2000) }, attachments: [] },
    context,
  );
  expect(rows.match(/\| x \|/g)?.length).toBe(8);
  expect(
    issueBody({ ...report, diagnostics: { environment: '\n'.repeat(4000) } }, context).length,
  ).toBeLessThan(5000);
  expect(issueTitle('@'.repeat(160)).length).toBeLessThanOrEqual(256);
  expect(issueTitle('a\n\nb')).toBe('a b');
});

it('groups reports of one error whatever its numbers', () => {
  expect(errorSignature(report)).toBe(
    errorSignature({ ...report, diagnostics: { console: 'TypeError: broken at 999 @nobody' } }),
  );
  expect(errorSignature({ ...report, type: 'idea' })).toBeNull();
});

it('uses the server token only against a fake GitHub server and rejects public destinations', async () => {
  let privateRepo = false;
  let refuse = false;
  const requests: { url: string; authorization: string | undefined; body: string }[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url ?? '', authorization: req.headers.authorization, body });
    res.setHeader('content-type', 'application/json');
    if (refuse) res.statusCode = 503;
    res.end(
      JSON.stringify(
        req.method === 'GET'
          ? { private: privateRepo, full_name: 'test/feedback' }
          : { number: 142 },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new GitHubFeedback(
      { FEEDBACK_GITHUB_TOKEN: 'fake-test-credential' } as Config,
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    );
    await expect(client.requirePrivate('test/feedback')).rejects.toThrow('private');
    privateRepo = true;
    await client.requirePrivate('test/feedback');
    expect(
      await client.request('test/feedback', '/issues', {
        title: inertText(report.title),
        body: issueBody(report, context),
      }),
    ).toEqual({ number: 142 });
    expect(requests).toHaveLength(3);
    expect(requests[2]?.authorization).toBe('Bearer fake-test-credential');
    expect(requests[2]?.body).not.toContain('fake-test-credential');
    refuse = true;
    const error = await client.request('test/feedback').catch((e) => e);
    expect(error).toBeInstanceOf(GitHubRefused);
    expect(String(error)).not.toContain('fake-test-credential');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
