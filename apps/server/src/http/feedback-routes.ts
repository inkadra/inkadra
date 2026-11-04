import { randomBytes } from 'node:crypto';
import {
  API_PREFIX,
  CreateFeedback,
  FEEDBACK_FILE_BYTES,
  FEEDBACK_RETENTION_DAYS,
  FEEDBACK_VIDEO_BYTES,
  FeedbackSettingsInput,
  redactFeedback,
  z,
} from '@inkadra/shared';
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import {
  feedbackAttachment as attachment,
  instanceSetting,
  notification,
  feedbackReport as report,
  user,
} from '../db/schema.ts';
import {
  errorSignature,
  GitHubFeedback,
  GitHubRefused,
  issueBody,
  issueTitle,
  repeatComment,
} from '../feedback.ts';
import { readInstanceSettings } from '../instance-settings.ts';
import { sniffImage } from '../media/heic.ts';
import { sniffVideo } from '../media/video.ts';
import { RateLimiter } from '../rate-limits.ts';
import { DocViews } from '../share-links.ts';
import type { AppDeps } from './app.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';
import { createGuestAuth } from './guest-context.ts';

type Reporter = { owner: string; name: string; role: string; guest: boolean };
const HOUR = 3600000;
const DAY = 24 * HOUR;
const key = (id: string) => `feedback/${id}`;
const defaults = {
  destination: 'off',
  repository: null,
  guests: false,
  retentionDays: FEEDBACK_RETENTION_DAYS,
} as const;
/** The reporter waits this long for GitHub; the sweep finishes a slower delivery. */
const DELIVERY_WAIT_MS = 8000;

export function registerFeedbackRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db, auth, config, storage } = deps;
  const github = new GitHubFeedback(config, deps.feedbackGitHubUrl);
  const guests = createGuestAuth({ ...deps, docs: new DocViews() });
  const uploads = new RateLimiter(30, HOUR);
  const guestUploads = new RateLimiter(6, HOUR);
  const instanceUploads = new RateLimiter(300, HOUR);
  async function settings() {
    const [row] = await db
      .select()
      .from(instanceSetting)
      .where(eq(instanceSetting.key, 'feedback'));
    return {
      ...defaults,
      ...FeedbackSettingsInput.parse(row?.value ?? defaults),
      tokenConfigured: !!config.FEEDBACK_GITHUB_TOKEN,
    };
  }
  async function admin(req: Parameters<typeof requireActor>[1]) {
    const actor = await requireActor(auth, req, db);
    if (actor.role !== 'admin') throw new HttpError('forbidden', 'Administrators only.');
    return actor;
  }
  /** Destination chosen, repository named. A missing token only delays delivery. */
  const enabled = (s: Awaited<ReturnType<typeof settings>>) =>
    s.destination === 'inbox' || (s.destination === 'github' && !!s.repository);
  const receipt = (row: typeof report.$inferSelect, role: string, duplicate = false) => ({
    id: row.id,
    reference: `#${row.issueNumber ?? `local-${row.number}`}`,
    delivery: row.delivery,
    duplicate,
    issueUrl:
      role === 'admin' && row.issueNumber
        ? `https://github.com/${row.repository}/issues/${row.issueNumber}`
        : null,
  });
  /** An earlier report on the same issue: this one was added to it as a comment. */
  async function isRepeat(row: typeof report.$inferSelect) {
    if (!row.issueNumber) return false;
    const [earlier] = await db
      .select({ id: report.id })
      .from(report)
      .where(
        and(
          eq(report.issueNumber, row.issueNumber),
          eq(report.repository, row.repository ?? ''),
          lt(report.createdAt, row.createdAt),
        ),
      )
      .limit(1);
    return !!earlier;
  }
  app.get(`${API_PREFIX}/feedback/settings`, async (req, reply) => {
    await admin(req);
    reply.header('cache-control', 'no-store');
    return settings();
  });
  app.put(`${API_PREFIX}/feedback/settings`, async (req) => {
    await admin(req);
    const value = FeedbackSettingsInput.parse(req.body);
    if (value.destination === 'github') {
      if (!value.repository) throw new HttpError('bad_request', 'Name a private repository.');
      // Without a token reports wait locally; delivery checks the repository again every time.
      if (config.FEEDBACK_GITHUB_TOKEN)
        try {
          await github.requirePrivate(value.repository);
        } catch {
          throw new HttpError(
            'bad_request',
            'Cannot verify the private repository. Check repository and server token.',
          );
        }
    }
    await db
      .insert(instanceSetting)
      .values({ key: 'feedback', value })
      .onConflictDoUpdate({ target: instanceSetting.key, set: { value, updatedAt: new Date() } });
    return settings();
  });
  app.get(`${API_PREFIX}/feedback/reports`, async (req, reply) => {
    await admin(req);
    reply.header('cache-control', 'no-store');
    const rows = await db.select().from(report).orderBy(desc(report.createdAt)).limit(100);
    return {
      items: rows.map((r) => ({
        ...receipt(r, 'admin'),
        report: r.report,
        reporter: r.reporter,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
  app.get<{ Params: { token: string } }>(
    `${API_PREFIX}/feedback/attachments/:token`,
    async (req, reply) => {
      if (!/^[a-f0-9]{64}$/.test(req.params.token))
        throw new HttpError('not_found', 'Attachment not found.');
      const [row] = await db
        .select()
        .from(attachment)
        .where(and(eq(attachment.id, req.params.token), gt(attachment.expiresAt, new Date())));
      if (!row?.reportId) throw new HttpError('not_found', 'Attachment not found.');
      reply
        .header('cache-control', 'private, no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-robots-tag', 'noindex, nofollow');
      reply.header('content-security-policy', "sandbox; default-src 'none'");
      reply.header(
        'content-disposition',
        `${row.kind === 'screenshot' ? 'inline' : 'attachment'}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(row.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
      );
      return reply.type(row.mime).send(await storage.read(key(row.id)));
    },
  );

  for (const prefix of [`${API_PREFIX}/feedback`, `${API_PREFIX}/guest/links/:linkId/feedback`]) {
    const guest = prefix.includes('/guest/');
    app.register(async (scope) => {
      const identities = new WeakMap<object, Reporter>();
      scope.addContentTypeParser(
        'application/octet-stream',
        { parseAs: 'buffer', bodyLimit: FEEDBACK_VIDEO_BYTES },
        (_req, body, done) => done(null, body),
      );
      scope.addHook('onRequest', async (req, reply) => {
        reply.header('cache-control', 'no-store');
        if (guest) {
          const { linkId } = req.params as { linkId: string };
          const ctx = await guests.requireGuest(req, reply, linkId);
          identities.set(req, {
            owner: `guest:${ctx.guest.id}`,
            name: ctx.guest.name ?? 'Guest',
            role: 'guest',
            guest: true,
          });
        } else {
          const actor = await requireActor(auth, req, db);
          const [row] = await db
            .select({ name: user.name })
            .from(user)
            .where(eq(user.id, actor.id));
          identities.set(req, {
            owner: `user:${actor.id}`,
            name: row?.name ?? 'Member',
            role: actor.role,
            guest: false,
          });
        }
        if (req.method === 'GET') return;
        const s = await settings();
        if (!enabled(s) || (guest && !s.guests))
          throw new HttpError('forbidden', 'Feedback is not enabled.');
        if (req.routeOptions.url?.endsWith('/attachments')) {
          const who = identities.get(req) as Reporter;
          if (
            !(guest ? guestUploads : uploads).take(who.owner) ||
            !instanceUploads.take('instance')
          )
            throw new HttpError('rate_limited', 'Too many uploads.');
          const kind = (req.query as { kind?: string }).kind;
          const max = guest
            ? 5 * 1024 * 1024
            : kind === 'video'
              ? FEEDBACK_VIDEO_BYTES
              : FEEDBACK_FILE_BYTES;
          if (Number(req.headers['content-length']) > max)
            throw new HttpError('payload_too_large', 'Attachment is too large.');
        }
      });
      scope.get(`${prefix}/status`, async () => {
        const s = await settings();
        const on = enabled(s) && (!guest || s.guests);
        return {
          enabled: on,
          guest,
          destination: on && s.destination !== 'off' ? s.destination : null,
          retentionDays: s.retentionDays,
        };
      });
      scope.post(
        `${prefix}/attachments`,
        { bodyLimit: guest ? 5 * 1024 * 1024 : FEEDBACK_VIDEO_BYTES },
        async (req, reply) => {
          const who = identities.get(req) as Reporter;
          const q = z
            .object({
              kind: z.enum(['screenshot', 'video', 'file']),
              name: z.string().min(1).max(180),
            })
            .parse(req.query);
          if (guest && q.kind !== 'screenshot')
            throw new HttpError('forbidden', 'Guests can attach only a screenshot.');
          if (!Buffer.isBuffer(req.body) || !req.body.length)
            throw new HttpError('bad_request', 'A binary attachment is required.');
          let bytes: Buffer = req.body;
          const max = guest
            ? 5 * 1024 * 1024
            : q.kind === 'video'
              ? FEEDBACK_VIDEO_BYTES
              : FEEDBACK_FILE_BYTES;
          if (bytes.length > max)
            throw new HttpError('payload_too_large', 'Attachment is too large.');
          const head = bytes.subarray(0, 512);
          let mime = sniffImage(head) ?? sniffVideo(head);
          if (!mime && head.subarray(0, 5).toString() === '%PDF-') mime = 'application/pdf';
          if (
            !mime &&
            !bytes.includes(0) &&
            !bytes.some((byte) => byte < 32 && ![9, 10, 13].includes(byte))
          )
            mime = 'text/plain';
          if (
            !mime ||
            (q.kind === 'screenshot' &&
              !['image/png', 'image/jpeg', 'image/webp'].includes(mime)) ||
            (q.kind === 'video' && !mime.startsWith('video/'))
          )
            throw new HttpError('bad_request', 'Unsupported attachment type.');
          // Re-encode screenshots: flatten edits and remove EXIF and other hidden source data.
          if (q.kind === 'screenshot') {
            try {
              bytes = await sharp(bytes, { limitInputPixels: 40_000_000 }).png().toBuffer();
              mime = 'image/png';
            } catch {
              throw new HttpError('bad_request', 'Invalid screenshot.');
            }
          }
          if (bytes.length > max)
            throw new HttpError('payload_too_large', 'Encoded screenshot is too large.');
          const id = randomBytes(32).toString('hex');
          const value = {
            id,
            owner: who.owner,
            kind: q.kind,
            name: [...q.name]
              .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
              .join(''),
            mime,
            bytes: bytes.length,
            expiresAt: new Date(Date.now() + DAY),
          };
          await storage.write(key(id), bytes, mime);
          try {
            await db.insert(attachment).values(value);
          } catch (error) {
            await storage.remove([key(id)]);
            throw error;
          }
          reply.code(201);
          return { id, kind: value.kind, name: value.name, mime, bytes: value.bytes };
        },
      );
      scope.post(prefix, async (req, reply) => {
        const who = identities.get(req) as Reporter;
        const input = CreateFeedback.parse(req.body);
        const s = await settings();
        if (
          guest &&
          (input.attachments.some((a) => a.kind !== 'screenshot') ||
            input.attachments.length > 1 ||
            Object.keys(input.diagnostics).some((k) => !['environment', 'page'].includes(k)) ||
            input.description.length > 4000)
        )
          throw new HttpError('bad_request', 'Guest report exceeds its limits.');
        if (
          input.attachments.filter((a) => a.kind === 'file').length > 5 ||
          input.attachments.filter((a) => a.kind === 'video').length > 1 ||
          input.attachments.filter((a) => a.kind === 'screenshot').length > 1 ||
          new Set(input.attachments.map((a) => a.id)).size !== input.attachments.length
        )
          throw new HttpError('bad_request', 'Too many attachments.');
        const clean = {
          ...input,
          diagnostics: Object.fromEntries(
            Object.entries(input.diagnostics).map(([k, v]) => [k, redactFeedback(v)]),
          ),
        };
        const name = (guest && input.guestName ? input.guestName : who.name)
          .replace(/\S+@\S+/g, '[redacted]')
          .trim()
          .split(/\s+/);
        const reporter = `${name[0] ?? 'Member'}${name[1] ? ` ${name[1][0]}.` : ''} (${who.role})`;
        const row = await db.transaction(async (tx) => {
          // One quota and idempotency decision across all API processes.
          await tx.execute(sql`select pg_advisory_xact_lock(338001)`);
          const [existing] = await tx
            .select()
            .from(report)
            .where(and(eq(report.owner, who.owner), eq(report.requestId, input.requestId)));
          if (existing) return existing;
          const window = gt(report.createdAt, new Date(Date.now() - HOUR));
          const [all] = await tx.select({ n: count() }).from(report).where(window);
          const [person] = await tx
            .select({ n: count() })
            .from(report)
            .where(and(window, eq(report.owner, who.owner)));
          if ((all?.n ?? 0) >= 100 || (person?.n ?? 0) >= (guest ? 2 : 5)) {
            // The oldest report of the window is the next to leave it.
            const [oldest] = await tx
              .select({ at: report.createdAt })
              .from(report)
              .where(
                and(
                  window,
                  (person?.n ?? 0) >= (guest ? 2 : 5) ? eq(report.owner, who.owner) : undefined,
                ),
              )
              .orderBy(asc(report.createdAt))
              .limit(1);
            const wait = (oldest?.at.getTime() ?? Date.now()) + HOUR - Date.now();
            reply.header('retry-after', Math.max(1, Math.ceil(wait / 1000)));
            throw new HttpError('rate_limited', 'Too many reports.');
          }
          for (const a of input.attachments) {
            const [stored] = await tx
              .select()
              .from(attachment)
              .where(
                and(
                  eq(attachment.id, a.id),
                  eq(attachment.owner, who.owner),
                  isNull(attachment.reportId),
                  gt(attachment.expiresAt, new Date()),
                ),
              )
              .for('update');
            if (
              !stored ||
              stored.kind !== a.kind ||
              stored.bytes !== a.bytes ||
              stored.mime !== a.mime ||
              stored.name !== a.name
            )
              throw new HttpError('bad_request', 'Invalid or expired attachment.');
          }
          const [saved] = await tx
            .insert(report)
            .values({
              owner: who.owner,
              requestId: input.requestId,
              reporter,
              report: clean,
              destination: s.destination,
              repository: s.repository,
              delivery: s.destination === 'github' ? 'pending' : 'inbox',
              signature: errorSignature(clean),
            })
            .returning();
          if (!saved) throw new Error('Report was not saved');
          const administrators = await tx
            .select({ id: user.id })
            .from(user)
            .where(and(eq(user.role, 'admin'), isNull(user.deactivatedAt)));
          if (administrators.length)
            await tx.insert(notification).values(
              administrators.map((person) => ({
                userId: person.id,
                type: 'feedback_received' as const,
                emailedAt: new Date(),
              })),
            );

          if (input.attachments.length)
            await tx
              .update(attachment)
              .set({ reportId: saved.id, expiresAt: new Date(Date.now() + s.retentionDays * DAY) })
              .where(
                inArray(
                  attachment.id,
                  input.attachments.map((a) => a.id),
                ),
              );
          return saved;
        });
        if (row.delivery === 'pending')
          await Promise.race([
            deliver(row.id).catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, DELIVERY_WAIT_MS).unref()),
          ]);
        const [current] = await db.select().from(report).where(eq(report.id, row.id));
        const final = current ?? row;
        reply.code(201);
        return receipt(final, who.role, await isRepeat(final));
      });
    });
  }

  /** One report at a time: nothing holds a database connection while GitHub is being called. */
  async function deliver(id: string) {
    if (!config.FEEDBACK_GITHUB_TOKEN) return;
    // The claim makes each report one process's job. A crash after it leaves "uncertain":
    // shortcut: an administrator checks those by hand, reconcile by the id marker if they pile up.
    const [row] = await db
      .update(report)
      .set({ delivery: 'uncertain' })
      .where(and(eq(report.id, id), eq(report.delivery, 'pending')))
      .returning();
    if (!row?.repository) return;
    const repository = row.repository;
    let writing = false;
    try {
      await github.requirePrivate(repository);
      let issueNumber: number | null = null;
      if (row.signature) {
        const [known] = await db
          .select({ issueNumber: report.issueNumber })
          .from(report)
          .where(
            and(
              eq(report.signature, row.signature),
              eq(report.repository, repository),
              eq(report.delivery, 'delivered'),
            ),
          )
          .orderBy(desc(report.createdAt))
          .limit(1);
        if (known?.issueNumber) {
          const issue = await github.request(repository, `/issues/${known.issueNumber}`);
          if (issue.state === 'open') issueNumber = known.issueNumber;
        }
      }
      const [stored] = await db
        .select({ expiresAt: attachment.expiresAt })
        .from(attachment)
        .where(eq(attachment.reportId, row.id))
        .limit(1);
      const context = {
        reporter: row.reporter,
        instance: (await readInstanceSettings(db, config)).name,
        publicUrl: config.PUBLIC_URL,
        id: row.id,
        signature: row.signature,
        expires: stored?.expiresAt ?? new Date(row.createdAt.getTime() + 90 * DAY),
      };
      writing = true;
      if (issueNumber)
        await github.request(repository, `/issues/${issueNumber}/comments`, {
          body: repeatComment(row.report, context),
        });
      else {
        const issue = await github.request(repository, '/issues', {
          title: issueTitle(row.report.title),
          body: issueBody(row.report, context),
          labels: ['from-app', row.report.type, `area:${row.report.area}`],
        });
        if (typeof issue.number !== 'number') throw new Error('Invalid GitHub response');
        issueNumber = issue.number;
      }
      await db
        .update(report)
        .set({ delivery: 'delivered', issueNumber })
        .where(eq(report.id, row.id));
    } catch (error) {
      // Before the write, or refused by GitHub: nothing exists there, so it can run again. A
      // connection lost during the write may have created the issue: keep it uncertain.
      const again = !writing || error instanceof GitHubRefused;
      await db
        .update(report)
        .set({
          delivery: again ? 'pending' : 'uncertain',
          attempts: row.attempts + 1,
          nextAttemptAt: new Date(
            Date.now() + Math.min(24 * HOUR, 60000 * 2 ** Math.min(row.attempts, 10)),
          ),
        })
        .where(eq(report.id, row.id));
      throw error;
    }
  }

  async function sweep() {
    const due = await db
      .select({ id: report.id })
      .from(report)
      .where(and(eq(report.delivery, 'pending'), lte(report.nextAttemptAt, new Date())))
      .orderBy(report.createdAt)
      .limit(5);
    for (const { id } of due) await deliver(id).catch(() => {});
    const expired = await db
      .select({ id: attachment.id })
      .from(attachment)
      .where(lt(attachment.expiresAt, new Date()))
      .limit(100);
    if (expired.length) {
      await storage.remove(expired.map((a) => key(a.id)));
      await db.delete(attachment).where(
        inArray(
          attachment.id,
          expired.map((a) => a.id),
        ),
      );
    }
  }
  const timer = setInterval(() => {
    void sweep().catch(() => deps.log.warn('Feedback maintenance failed'));
  }, 60000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}
