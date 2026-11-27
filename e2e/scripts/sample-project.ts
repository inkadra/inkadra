import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addFrame,
  addScene,
  createArrow,
  createElement,
  moveIntoParent,
  newTable,
  updateElement,
} from '@inkadra/canvas-core';
import {
  initBoardDoc,
  PlanIcon,
  PlanOpening,
  PlanWall,
  readElement,
  roots,
  STROKE_GRID,
  type Stroke,
} from '@inkadra/doc-schema';
import type { Browser } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from '../tests/perf/seed.ts';
import { STILL_NAMES, stillSize, stillSvg } from './sample-stills.ts';

/**
 * The sample project of the screenshot scripts and of the demo, built on an empty instance:
 * "Last Train", a short film with a moodboard, a storyboard of three scenes and the second unit's,
 * the characters, locations and set plan of Cast and sets, the rushes, the production office and
 * the Production board with three shooting days from today and the Troupe, a crew who comment and
 * review, a client who decides through a share link, and the production company's next project.
 * docs/demo-project.md is its story bible: names, scenes and dates here follow it.
 *
 * The pictures on the boards are drawn in sample-stills.ts and the video, the voice note and
 * the script are made here, so the screenshots carry no third-party media. The video needs
 * ffmpeg on the PATH of this machine, and the instance the standard image.
 */

export const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
/** The crew of the bible who have an account, with their role in the project. */
export const team = {
  chiara: { name: 'Chiara Fontana', email: 'chiara@example.com', role: 'owner' },
  tommaso: { name: 'Tommaso Riva', email: 'tommaso@example.com', role: 'editor' },
  marco: { name: 'Marco Gallo', email: 'marco@example.com', role: 'editor' },
  ivo: { name: 'Ivo Santoro', email: 'ivo@example.com', role: 'editor' },
  sara: { name: 'Sara Leone', email: 'sara@example.com', role: 'commenter' },
  nadia: { name: 'Nadia Greco', email: 'nadia@example.com', role: 'viewer' },
} as const;
type Member = keyof typeof team;
/** The client who reviews the storyboard through a share link, without an account. */
const client = { link: 'Fondazione Cinema Costa', name: 'Elena Marino' };

/** Who made a card: Giulia unless said otherwise (set once she has signed in). */
let opts: { userId: string | null } = { userId: null };

export async function renderStills(
  browser: Browser,
  names: readonly string[] = STILL_NAMES,
  quality = 90,
): Promise<Record<string, Buffer>> {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const result: Record<string, Buffer> = {};
  for (const name of names) {
    await page.setViewportSize(stillSize(name));
    await page.setContent(`<body style="margin:0">${stillSvg(name)}</body>`);
    result[name] = await page.screenshot({ type: 'jpeg', quality });
  }
  await page.close();
  return result;
}

export async function request<T>(
  base: string,
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      cookie,
      origin: base,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function api<T>(base: string, cookie: string, path: string, body: unknown): Promise<T> {
  return request<T>(base, cookie, 'POST', path, body);
}

const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

/**
 * Signs a crew member in, or up through an invitation link to the project (registration is
 * by invitation), and gives them their role. Runs again on an instance that has them already.
 */
export async function joinTeam(
  base: string,
  admin: string,
  projectId: string,
  { name, email, role }: { name: string; email: string; role: string },
) {
  const json = { 'content-type': 'application/json', origin: base };
  const credentials = JSON.stringify({ name, email, password: account.password });
  let res = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: json,
    body: credentials,
  });
  if (!res.ok) {
    const { invitation } = await api<{ invitation: { url: string } }>(base, admin, '/invitations', {
      kind: 'link',
      projectId,
      role: 'viewer',
    });
    const token = new URL(invitation.url).pathname.split('/').pop();
    const claim = await fetch(`${base}/api/v1/invitations/by-token/${token}/claim`, {
      method: 'POST',
      headers: json,
      body: '{}',
    });
    if (!claim.ok) throw new Error(`Invitation of ${email}: ${claim.status}`);
    // An instance takes three sign-ups every ten seconds from one address: wait when told to.
    for (;;) {
      res = await fetch(`${base}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { ...json, cookie: cookieOf(claim) },
        body: credentials,
      });
      if (res.status !== 429) break;
      const wait = Number(res.headers.get('retry-after') ?? 10);
      await new Promise((done) => setTimeout(done, wait * 1000 + 200));
    }
    if (!res.ok) throw new Error(`Sign up of ${email}: ${res.status} ${await res.text()}`);
  }
  const { user } = (await res.json()) as { user: { id: string } };
  await request(base, admin, 'PUT', `/projects/${projectId}/members/${user.id}`, { role });
  return { id: user.id, cookie: cookieOf(res) };
}

export function note(
  doc: Y.Doc,
  at: { x: number; y: number },
  lines: string[],
  w?: number,
  by = opts,
) {
  const el = createElement(doc, 'note', at, w ? { w } : {}, by);
  const body = roots(doc).elements.get(el.id)?.get('body') as Y.XmlFragment;
  lines.forEach((line, i) => {
    const heading = i === 0 && lines.length > 1;
    const node = new Y.XmlElement(heading ? 'heading' : 'paragraph');
    if (heading) node.setAttribute('level', 1 as unknown as string);
    node.insert(0, [new Y.XmlText(line)]);
    body.insert(i, [node]);
  });
  return el.id;
}

/** The same noise on every run. */
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return (s / 2147483648) * 2 - 1;
  };
}

/** Ivo's voice note: eight seconds of the sodium lamps' hum on the platform, as a WAV. */
function humWav(seconds = 8, rate = 22050): Buffer {
  const n = seconds * rate;
  const data = Buffer.alloc(n * 2);
  const hiss = noise(7);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const fade = Math.min(1, t / 0.6, (seconds - t) / 0.9);
    const swell = 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.25 * t);
    const v =
      swell *
        (0.22 * Math.sin(2 * Math.PI * 100 * t) +
          0.08 * Math.sin(2 * Math.PI * 200 * t) +
          0.04 * Math.sin(2 * Math.PI * 300 * t)) +
      0.025 * hiss();
    data.writeInt16LE(Math.round(v * fade * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** The shooting script as a small PDF: a title page and scene 2, in Courier. */
function scriptPdf(): Buffer {
  const pages = [
    [
      ...new Array<string>(14).fill(''),
      '                         LAST TRAIN',
      '',
      '                 written by Giulia Bianchi',
      '',
      '',
      '                 Shooting script, draft 3',
      '',
      ...new Array<string>(18).fill(''),
      'Lanterna Film',
    ],
    [
      "2   INT. ROSA'S DINER - NIGHT",
      '',
      'The only light still on in the station. Three',
      'pendants, a neon cup. ANNA (29) at the counter, coat',
      'still wet. ROSA (64) pours without asking.',
      '',
      'LEO (52), navy railway jacket, sits two stools away.',
      '',
      '                    LEO',
      '          Missed it too?',
      '',
      '                    ANNA',
      '          By about a minute.',
      '',
      '                    LEO',
      '          Then you have six hours.',
      '',
      'Two coffees. A ticket for a train that has gone.',
    ],
  ];
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  for (const [i, lines] of pages.entries()) {
    const text = lines.map((l) => `(${l.replace(/[()]/g, (c) => `\\${c}`)}) Tj T*`).join(' ');
    const stream = `BT /F1 12 Tf 14 TL 72 740 Td ${text} ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) pdf += `${String(at).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** The take of the rushes: a slow push in on the platform still, made with ffmpeg. */
function platformTake(still: Buffer): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'inkadra-sample-'));
  try {
    writeFileSync(join(dir, 'still.jpg'), still);
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-loop',
      '1',
      '-i',
      join(dir, 'still.jpg'),
      '-t',
      '6',
      '-vf',
      "zoompan=z='1+0.001*on':d=150:s=1280x720:fps=25,format=yuv420p",
      '-c:v',
      'libx264',
      join(dir, 'clip.mp4'),
    ]);
    return readFileSync(join(dir, 'clip.mp4'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface SampleProject {
  cookie: string;
  project: { id: string; rootBoardId: string };
  storyboard: { id: string };
  casting: { id: string };
  /** The second storyboard: the second unit's inserts. */
  secondUnit: { id: string };
  /** The board with the set plan of the diner (Cast and sets); its plan card is `planId`. */
  setPlan: { id: string };
  planId: string;
  /** The board with the uploaded take, the voice note and the teaser. */
  rushes: { id: string };
  /** Crew contacts, budget, maps and the script; hidden from guests. */
  production: { id: string };
  /** The Production board (decision 0123): the shooting days and the crew. */
  schedule: { id: string };
  /** Asset ids of the stills, by name. */
  asset: Record<string, string>;
  /** The client's share link of the project, with review decisions. */
  guestUrl: string;
  /** The second project of the production company. */
  next: { id: string; rootBoardId: string };
}

/** Local dates from today, like the app's: day 0 is today. */
export function localDate(offset: number) {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** Fractions of a picture as stroke points, with points in between so the line stays smooth. */
function strokeOf(id: string, path: Array<[number, number]>): Stroke {
  const points: number[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i] as [number, number], path[i + 1] as [number, number]];
    for (let k = 0; k < 8; k++) {
      const t = k / 8;
      points.push(
        Math.round((a[0] + (b[0] - a[0]) * t) * STROKE_GRID),
        Math.round((a[1] + (b[1] - a[1]) * t) * STROKE_GRID),
      );
    }
  }
  const last = path.at(-1) as [number, number];
  points.push(Math.round(last[0] * STROKE_GRID), Math.round(last[1] * STROKE_GRID));
  return { id: id.padEnd(12, 'x'), tool: 'pencil', color: '#E5484D', width: 3, points };
}

/**
 * The Troupe of the bible: the crew, with the account of those who have one, and the cast,
 * linked to their characters. Phone numbers are made up on a prefix no Italian line uses.
 */
const TROUPE: Array<{
  name: string;
  role: string;
  department: string;
  phone: string;
  email: string;
  pickup: string;
  notes: string;
  onSetContact: boolean;
  account?: Member | 'giulia';
  character?: string;
}> = [
  ...(
    [
      ['Giulia Bianchi', 'Director', 'Direction', '0101', 'giulia', ''],
      ['Marco Gallo', 'First AD', 'Direction', '0102', 'marco', ''],
      ['Chiara Fontana', 'Producer', 'Production', '0103', 'chiara', ''],
      ['Tommaso Riva', 'Cinematographer', 'Camera', '0104', 'tommaso', ''],
      ['Bruno Ferri', 'Second unit camera', 'Camera', '0105', undefined, 'Night of day 1 only.'],
      ['Luca Marchi', 'Drone pilot', 'Camera', '0106', undefined, 'Permit for Capo Bianco.'],
      ['Ivo Santoro', 'Sound recordist', 'Sound', '0107', 'ivo', ''],
      ['Sara Leone', 'Production designer', 'Art', '0108', 'sara', ''],
      ['Nadia Greco', 'Costume designer', 'Costume', '0109', 'nadia', ''],
    ] as const
  ).map(([name, role, department, phone, account, notes]) => ({
    name,
    role,
    department,
    phone: `+39 555 010 ${phone}`,
    email: account ? `${account}@example.com` : `${name.split(' ')[0]?.toLowerCase()}@example.com`,
    pickup: '',
    notes,
    onSetContact: account === 'marco' || account === 'chiara',
    ...(account ? { account } : {}),
  })),
  ...(
    [
      ['Marta Neri', 'Anna', 'Hotel Stazione'],
      ['Paolo Verdi', 'Leo', ''],
      ['Lucia Amato', 'Rosa', ''],
      ['Davide Russo', 'Sandro', ''],
    ] as const
  ).map(([name, character, pickup], i) => ({
    name,
    role: character,
    department: 'Cast',
    phone: '',
    email: 'lumen@example.com',
    pickup,
    notes: `Agenzia Lumen${i === 0 ? '. Second coat in the costume van.' : ''}`,
    onSetContact: false,
    character,
  })),
];

/** A set plan's drawing is 1000 view units wide and 1000 / 1.5 high, on the stroke grid. */
export const gx = (x: number) => Math.round((x / 1000) * STROKE_GRID);
export const gy = (y: number) => Math.round((y / (1000 / 1.5)) * STROKE_GRID);
/** Ids of plan items: readable names, long enough for an element id. */
export const planItemId = (name: string) => name.padEnd(13, 'A');
/** A set icon at a place of the drawing, in view units. */
export const planIcon = (
  name: string,
  kind: PlanIcon['kind'],
  color: string,
  x: number,
  y: number,
) => ({ id: planItemId(`icon${name}`), kind, color, x: gx(x), y: gy(y) });
/**
 * The items of a plan, checked one by one: a plan reads its lists leniently and would drop a
 * wrong item without a word, so the seed fails instead.
 */
export function checked<T>(schema: { parse: (value: unknown) => T }, items: unknown[]): T[] {
  return items.map((item) => schema.parse(item));
}

export async function seedSampleProject(browser: Browser, base: string): Promise<SampleProject> {
  const pictures = await renderStills(browser);
  const cookie = await signIn(base, account);
  const me = (await (await fetch(`${base}/api/v1/me`, { headers: { cookie } })).json()) as {
    id: string;
  };
  opts = { userId: me.id };
  const project = await api<{ id: string; rootBoardId: string }>(base, cookie, '/projects', {
    name: 'Last Train',
    type: 'short_film',
    icon: { shape: 'clapperboard', color: 'orange' },
    shootingStart: localDate(0),
    shootingEnd: localDate(3),
    // The project's clock: call sheets and the sun of the set plans read it.
    timeZone: 'Europe/Rome',
  });
  const people = {} as Record<Member, { id: string; cookie: string }>;
  for (const who of Object.keys(team) as Member[])
    people[who] = await joinTeam(base, cookie, project.id, team[who]);
  const by = (who: Member) => ({ userId: people[who].id });

  const board = (title: string, kind: 'board' | 'storyboard' | 'production' = 'board') =>
    api<{ id: string }>(base, cookie, `/projects/${project.id}/boards`, {
      parentBoardId: project.rootBoardId,
      kind,
      title,
    });
  const storyboard = await board('Storyboard', 'storyboard');
  // A second storyboard: the inserts of the second unit, on the same calendar (decision 0123).
  const secondUnit = await board('Second unit', 'storyboard');
  // The story bible on a canvas: characters, locations and the set plan of the diner, which
  // links its actors to the characters and itself to the diner's location card.
  const casting = await board('Cast and sets');
  const rushes = await board('Rushes');
  // The production office: a board of tables and maps.
  const production = await board('Office');
  // The Production board: the shooting days of both storyboards and the Troupe.
  const schedule = await board('Production', 'production');

  const asset: Record<string, string> = {};
  const upload = async (
    name: string,
    body: Buffer,
    type: string,
    projectId = project.id,
    who = cookie,
  ) => {
    const id = await uploadFile(base, who, projectId, { body, name, type });
    if (!id) throw new Error('This instance does not take uploads');
    return id;
  };
  for (const [name, body] of Object.entries(pictures))
    asset[name] = await upload(`${name}.jpg`, body, 'image/jpeg');
  const pic = (name: string) => asset[name] as string;
  // The take is Tommaso's, the voice note Ivo's: their names show on the files.
  const take = await upload(
    'platform-take-3.mp4',
    platformTake(pictures.platform as Buffer),
    'video/mp4',
    project.id,
    people.tommaso.cookie,
  );
  const hum = await upload(
    'voice-note-platform-4.wav',
    humWav(),
    'audio/wav',
    project.id,
    people.ivo.cookie,
  );
  const script = await upload('Last Train - shooting script.pdf', scriptPdf(), 'application/pdf');
  await waitForAssets(base, cookie, [...Object.values(asset), take, hum, script]);

  // The moodboard: the project's root board. Five columns with even gaps, so that it fits the
  // window of the screenshots without overlapping cards.
  const mood = new Y.Doc();
  initBoardDoc(mood, project.rootBoardId);
  const moodIds = mood.transact(() => {
    const intro = note(
      mood,
      { x: 0, y: 0 },
      [
        'Last Train',
        'A short film. One night, one platform, the last train out of the city.',
        'Sodium light against wet blue. Long lenses, little camera movement.',
        "The only warm things on screen: the lamps, Rosa's diner, Anna's scarf.",
      ],
      320,
    );
    createElement(mood, 'board', { x: 0, y: 210 }, { boardId: secondUnit.id, w: 320 }, opts);
    createElement(mood, 'board', { x: 0, y: 300 }, { boardId: casting.id, w: 320 }, opts);
    createElement(mood, 'board', { x: 0, y: 390 }, { boardId: rushes.id, w: 320 }, opts);
    // Contacts and money stay with the team: the client's link does not show these boards.
    createElement(
      mood,
      'board',
      { x: 0, y: 480 },
      { boardId: production.id, w: 320, guestHidden: true },
      opts,
    );
    // Under the moodboard, two tall cards that preview their board (decision 0121): the
    // storyboard's frames, and the Production board's next shooting day and Troupe.
    createElement(
      mood,
      'board',
      { x: 0, y: 900 },
      { boardId: storyboard.id, w: 320, h: 260 },
      opts,
    );
    createElement(
      mood,
      'board',
      { x: 360, y: 900 },
      { boardId: schedule.id, w: 520, h: 260, guestHidden: true },
      opts,
    );
    createElement(
      mood,
      'todo',
      { x: 0, y: 580 },
      {
        title: 'Before the shoot',
        items: [
          { id: 'shotstodo0001', text: 'Scout platform 4 with the station manager', done: true },
          {
            id: 'shotstodo0002',
            text: 'Night permit from the city',
            done: true,
            assigneeId: people.chiara.id,
          },
          {
            id: 'shotstodo0003',
            text: 'Confirm the diner for night 2',
            done: false,
            assigneeId: me.id,
            dueDate: localDate(0),
          },
          {
            id: 'shotstodo0004',
            text: 'Rent six sodium lamps',
            done: false,
            assigneeId: me.id,
            dueDate: localDate(1),
          },
          {
            id: 'shotstodo0005',
            text: 'Rain machine test on the forecourt',
            done: false,
            assigneeId: people.marco.id,
            dueDate: localDate(0),
          },
        ],
        w: 320,
      },
      opts,
    );

    // The groups of the Moodboard view: the night, the diner, the dawn.
    const group: Record<string, string> = {
      platform: 'Night',
      rain: 'Night',
      window: 'Night',
      tunnel: 'Night',
      train: 'Night',
      diner: "Rosa's diner",
      cups: "Rosa's diner",
      signalbox: 'Dawn',
      dawn: 'Dawn',
      sea: 'Dawn',
      field: 'Dawn',
    };
    const image = (name: string, x: number, y: number, w: number, caption?: string) =>
      createElement(
        mood,
        'image',
        { x, y },
        { assetId: pic(name), w, group: group[name], ...(caption ? { caption } : {}) },
        opts,
      ).id;
    image('platform', 360, 0, 520, 'Platform 4, 1:52 a.m.');
    const diner = image('diner', 360, 340, 520, "Rosa's, the only light still on");
    image('train', 360, 680, 250);
    image('cups', 630, 680, 250);
    image('rain', 920, 0, 300);
    image('window', 920, 193, 300);
    image('tunnel', 920, 386, 300);
    image('signalbox', 920, 579, 300);
    createElement(
      mood,
      'link',
      { x: 920, y: 772 },
      {
        url: 'https://en.wikipedia.org/wiki/Sodium-vapor_lamp',
        title: 'Sodium-vapor lamp',
        description: 'Why everything at night turns orange.',
        group: 'Night',
        w: 300,
      },
      opts,
    );

    const light = createElement(
      mood,
      'column',
      { x: 1260, y: 0 },
      { title: 'Light', w: 240, color: 'orange' },
      opts,
    );
    const kids = [
      ...(
        [
          ['dawn', ['dawn']],
          ['sea', ['dawn', 'drone']],
          ['field', ['dawn']],
        ] as const
      ).map(
        ([name, tags]) =>
          createElement(
            mood,
            'image',
            { x: 0, y: 0 },
            { assetId: pic(name), group: group[name], tags: [...tags] },
            opts,
          ).id,
      ),
      note(mood, { x: 0, y: 0 }, ['Blue hour for the ending, the sky still holding some warmth.']),
      note(mood, { x: 0, y: 0 }, [
        'Sound',
        'The lamps hum. That hum is the score until the diner: no music before the first train.',
      ]),
    ];
    moveIntoParent(mood, kids, light.id, 0);

    const palette = createElement(
      mood,
      'column',
      { x: 1540, y: 0 },
      { title: 'Palette', w: 160, color: 'blue' },
      opts,
    );
    const swatches = [
      ['#E07A3F', 'Sodium'],
      ['#1E3A4C', 'Wet night'],
      ['#F2C76E', 'Lamp'],
      ['#B4302A', 'Scarf'],
      ['#0A0F14', 'Shadow'],
    ].map(
      ([hex, label]) =>
        createElement(
          mood,
          'color',
          { x: 0, y: 0 },
          { hex: hex as string, label, group: 'Palette' },
          opts,
        ).id,
    );
    moveIntoParent(mood, swatches, palette.id, 0);
    return { intro, diner };
  });
  await pushBoardDoc(base, cookie, project.rootBoardId, mood);

  // The storyboard: three scenes, frames with a picture and the data of the shot.
  const story = new Y.Doc();
  initBoardDoc(story, storyboard.id);
  const shot: Record<string, string> = {};
  const scenes: Record<string, string> = {};
  story.transact(() => {
    type Frame = [label: string, picture: string, fields: Record<string, unknown>];
    const scene = (fields: Parameters<typeof addScene>[1], frames: Frame[], first = false) => {
      const s = addScene(story, fields, opts, first ? { x: 0, y: 0 } : undefined);
      scenes[fields.number as string] = s.id;
      for (const [label, p, f] of frames)
        shot[label] = addFrame(story, s.id, null, { assetId: pic(p), ...f }, opts).id;
    };
    scene(
      {
        number: '1',
        title: 'The last train',
        setting: 'ext',
        time: 'night',
        location: 'Central station',
        synopsis:
          'Anna runs across the forecourt in the rain, reaches platform 4 as the doors close and watches the last train go.',
      },
      [
        [
          '1A',
          'platform',
          {
            action: 'Platform 4 at 1:52. The lamps hum; nobody is left.',
            shot: 'ews',
            angle: 'eye',
            movement: 'static',
            lens: '24mm',
            status: 'shot',
            audio: 'Sodium hum, a far announcement',
            notes: 'Hold six seconds before she enters. Let the hum carry it.',
            // Where she enters: an arrow drawn over the picture.
            strokes: [
              strokeOf('enter1', [
                [0.16, 0.42],
                [0.34, 0.47],
                [0.56, 0.64],
              ]),
              strokeOf('enter2', [
                [0.49, 0.64],
                [0.56, 0.64],
                [0.55, 0.56],
              ]),
            ],
          },
        ],
        [
          '1B',
          'rain',
          {
            action: 'Anna crosses the forecourt in the rain, running.',
            shot: 'fs',
            angle: 'eye',
            movement: 'handheld',
            lens: '50mm',
            status: 'shot',
            cast: ['Anna'],
            notes: 'Second coat ready: the first one is soaked after two takes.',
          },
        ],
        [
          '1C',
          'train',
          {
            action: 'The doors close in front of her.',
            shot: 'ms',
            angle: 'eye',
            movement: 'static',
            lens: '35mm',
            status: 'ready',
            cast: ['Anna'],
            audio: 'Door chime, compressor hiss',
          },
        ],
        [
          '1D',
          'window',
          {
            action: 'Over her shoulder: the carriages pull away.',
            shot: 'mcu',
            angle: 'ots',
            movement: 'static',
            lens: '85mm',
            status: 'ready',
            cast: ['Anna'],
            notes: 'Rack focus from her scarf to the tail lights.',
          },
        ],
        [
          '1E',
          'tunnel',
          {
            action: 'The tail lights shrink into the tunnel.',
            shot: 'ws',
            angle: 'eye',
            movement: 'static',
            lens: '135mm',
            status: 'todo',
          },
        ],
      ],
      true,
    );
    scene(
      {
        number: '2',
        title: 'The diner',
        setting: 'int',
        time: 'night',
        location: "Rosa's diner",
        synopsis:
          'Waiting for the morning at the counter. Leo, the signalman, sits down next to her.',
      },
      [
        [
          '2A',
          'diner',
          {
            action: 'Two strangers, one counter. Rosa pours without asking.',
            shot: 'ws',
            angle: 'eye',
            movement: 'dolly',
            lens: '32mm',
            status: 'ready',
            cast: ['Anna', 'Leo', 'Rosa'],
            dialogue:
              'LEO: Missed it too?\nANNA: By about a minute.\nLEO: Then you have six hours.',
          },
        ],
        [
          '2B',
          'cups',
          {
            action: 'Two coffees and a ticket for a train that has gone.',
            shot: 'insert',
            angle: 'high',
            movement: 'static',
            lens: '100mm',
            status: 'todo',
          },
        ],
        [
          '2C',
          'dawn',
          {
            action: 'Dawn through the glass. Leo puts his cap on.',
            shot: 'ws',
            angle: 'eye',
            movement: 'static',
            lens: '35mm',
            status: 'draft',
            cast: ['Leo'],
          },
        ],
      ],
    );
    scene(
      {
        number: '3',
        title: 'The first train',
        setting: 'int-ext',
        time: 'dawn',
        location: 'Signal box, coast line',
        synopsis: 'Leo clears the line for the first train of the day. Anna is on it.',
      },
      [
        [
          '3A',
          'signalbox',
          {
            action: 'Leo pulls the lever for the first train.',
            shot: 'ms',
            angle: 'low',
            movement: 'static',
            lens: '35mm',
            status: 'draft',
            cast: ['Leo'],
            audio: 'The lever, the bell of the block instrument',
          },
        ],
        [
          '3B',
          'field',
          {
            action: 'The home signal turns green over the field.',
            shot: 'ws',
            angle: 'eye',
            movement: 'static',
            lens: '50mm',
            status: 'draft',
          },
        ],
        [
          '3C',
          'sea',
          {
            action: 'The first train runs along the sea.',
            shot: 'ews',
            angle: 'high',
            movement: 'drone',
            lens: '24mm',
            status: 'draft',
            cast: ['Anna'],
            notes: 'The train passes Capo Bianco at 5:52. One take, maybe two.',
          },
        ],
      ],
    );

    // What the scenes need, for the shooting days that shoot them.
    const list = (
      y: number,
      title: string,
      kind: 'wardrobe' | 'props' | 'equipment',
      scene: string,
      items: string[],
    ) =>
      createElement(
        story,
        'todo',
        { x: 940, y },
        {
          title,
          list: kind,
          sceneId: scenes[scene],
          items: items.map((text, i) => ({
            id: `need${scene}${kind}`.padEnd(12, 'x') + i,
            text,
            done: false,
          })),
        },
        opts,
      );
    list(0, 'Rain night', 'equipment', '1', ['Rain machine', 'Six sodium lamps', 'Haze machine']);
    list(220, 'Anna, night 1', 'wardrobe', '1', ['Grey wool coat ×2', 'Red scarf']);
    list(420, 'At the counter', 'props', '2', ['Two cups and saucers', 'Punched train ticket']);

    // The set plan of scene 3, placed under it as "New set plan" does: the coast line at dawn,
    // the drone camera on 3C, the sun at sunrise, the light in the carriage on batteries. It
    // prints on the call sheet of day 3 with its power.
    const third = readElement(roots(story).elements.get(scenes['3'] as string)!)!;
    const drone = planItemId('iconDrone');
    createElement(
      story,
      'plan',
      { x: third.x, y: third.y + (third.h ?? 0) + 40 },
      {
        w: 720,
        title: 'Coast line, scene 3',
        sceneIds: [scenes['3'] as string],
        north: 0,
        sun: { time: 6 * 60 + 58 },
        circuits: [{ id: planItemId('circuitBattery'), name: 'V-mount batteries', amps: 10 }],
        icons: checked(PlanIcon, [
          {
            ...planIcon('Sea', 'water', '#5E8CA6', 860, 333),
            rotation: 90,
            w: 667,
            h: 180,
            locked: true,
          },
          {
            ...planIcon('SeaWall', 'fence', '#8E8E93', 660, 333),
            rotation: 90,
            w: 640,
            h: 14,
            label: 'Sea wall',
            locked: true,
          },
          {
            ...planIcon('Rails', 'road', '#8E8E93', 560, 333),
            rotation: 90,
            w: 667,
            h: 40,
            label: 'Coast line',
            locked: true,
          },
          { ...planIcon('Train', 'mark', '#E5484D', 560, 150), label: 'First train, 5:52' },
          { ...planIcon('Anna', 'actor', '#B897F0', 560, 320), pose: 'seated', label: 'Anna' },
          {
            ...planIcon('Carriage', 'led', '#F2C76E', 590, 300),
            rotation: 180,
            label: 'LED in the carriage',
            watts: 100,
            role: 'key',
            circuit: planItemId('circuitBattery'),
          },
          { ...planIcon('Drone', 'drone', '#9DB8F2', 820, 220), label: 'Drone, 60 m' },
          {
            ...planIcon('DroneCam', 'camera', '#9DB8F2', 820, 220),
            rotation: 180,
            label: 'Drone cam',
            frameId: shot['3C'],
            on: drone,
            height: 60,
            tilt: -30,
          },
          { ...planIcon('Pilot', 'crew', '#8E8E93', 330, 520), label: 'Pilot' },
          { ...planIcon('Monitor', 'monitor', '#8E8E93', 380, 560), label: 'Monitor' },
          {
            ...planIcon('Sun', 'sun', '#F2C76E', 960, 460),
            rotation: 200,
            note: 'Sunrise 6:58: 3B after it',
          },
        ]),
      },
      opts,
    );
  });
  await pushBoardDoc(base, cookie, storyboard.id, story);

  // The second unit's storyboard: inserts at the station on the night of day 1, drawn by the
  // second unit's camera. 1H has no picture yet.
  const second = new Y.Doc();
  initBoardDoc(second, secondUnit.id);
  second.transact(() => {
    const s = addScene(
      second,
      {
        number: '1',
        title: 'Station inserts',
        setting: 'int',
        time: 'night',
        location: 'Central station',
        synopsis: 'The details of the station after the last train, for the cut of scene 1.',
      },
      opts,
      { x: 0, y: 0 },
    );
    shot['1F'] = addFrame(
      second,
      s.id,
      null,
      {
        label: '1F',
        assetId: pic('clock'),
        action: 'The station clock at 1:52.',
        shot: 'cu',
        angle: 'low',
        movement: 'static',
        lens: '100mm',
        status: 'ready',
      },
      opts,
    ).id;
    shot['1G'] = addFrame(
      second,
      s.id,
      null,
      {
        label: '1G',
        assetId: pic('departures'),
        action: 'The departures board: the 0:42 has gone.',
        shot: 'insert',
        angle: 'eye',
        movement: 'static',
        lens: '50mm',
        status: 'ready',
      },
      opts,
    ).id;
    shot['1H'] = addFrame(
      second,
      s.id,
      null,
      {
        label: '1H',
        action: "Anna's hand flat on the closed door.",
        shot: 'insert',
        angle: 'eye',
        movement: 'handheld',
        lens: '85mm',
        status: 'draft',
        cast: ['Anna'],
      },
      opts,
    ).id;
  });
  await pushBoardDoc(base, cookie, secondUnit.id, second);

  // Cast and sets: four character sheets, the four places of the shoot and the diner's set.
  const cast = new Y.Doc();
  initBoardDoc(cast, casting.id);
  let planId = '';
  cast.transact(() => {
    createElement(cast, 'section', { x: 0, y: 0 }, { title: 'Characters', w: 1600 }, opts);
    const character = (x: number, fields: { name: string } & Record<string, unknown>) =>
      createElement(cast, 'character', { x, y: 70 }, { w: 280, ...fields }, opts).id;
    const leo = character(880, {
      name: 'Leo',
      role: 'Supporting',
      age: '52',
      assetId: pic('leo'),
      actor: 'Paolo Verdi',
      profession: 'Night-shift signalman',
      origin: 'Born two streets from the station',
      appearance: 'Big hands, slow voice. Navy work jacket, cap pushed back.',
      description: 'Thirty years of nights in the signal box. Tonight is his last shift.',
      wants: 'To see one more train through before the line goes automatic.',
      fears: 'Mornings with nothing to do.',
      arc: 'From closing the line to letting someone else go.',
      costume: 'Navy jacket with the railway badge, cap, thermos.',
      contact: 'Agenzia Lumen · lumen@example.com',
      scenes: ['2', '3'],
    });
    const rosa = character(1320, {
      name: 'Rosa',
      role: 'Supporting',
      age: '64',
      assetId: pic('rosa'),
      actor: 'Lucia Amato',
      profession: 'Owner of the station diner',
      description: 'Keeps the diner open for the night staff. Knows every order.',
      costume: 'Cream apron over a burgundy cardigan.',
      scenes: ['2'],
    });
    const sandro = character(0, {
      name: 'Sandro',
      role: 'Small part',
      age: '41',
      assetId: pic('sandro'),
      actor: 'Davide Russo',
      profession: 'Station guard',
      description: 'Closes the gates after the last train, and lets Anna stay.',
      costume: 'Guard uniform, high-visibility vest.',
      scenes: ['1'],
    });
    const anna = character(440, {
      name: 'Anna',
      role: 'Lead',
      age: '29',
      assetId: pic('anna'),
      nickname: 'Annie',
      profession: 'Sound editor',
      origin: 'A town at the end of the line',
      actor: 'Marta Neri',
      appearance: 'Tired, quick to laugh. A coat one size too big.',
      description: 'Comes back to the city for one night and misses the last train out.',
      wants: 'To get home before morning.',
      fears: 'That nobody is waiting there.',
      arc: 'From running away to staying until dawn.',
      costume: 'Grey wool coat, red scarf.',
      references: [pic('rain'), pic('platform'), pic('window')],
      relations: [
        { characterId: leo, label: 'stranger at the counter' },
        { characterId: sandro, label: 'lets her stay' },
      ],
      contact: 'Agenzia Lumen · lumen@example.com',
      notes: 'Callback with Paolo on the 3rd: the counter scene works.',
      scenes: ['1', '2', '3'],
    });
    updateElement(cast, leo, {
      relations: [
        { characterId: anna, label: 'stranger at the counter' },
        { characterId: rosa, label: 'thirty years of night coffee' },
      ],
    });

    createElement(cast, 'section', { x: 0, y: 330 }, { title: 'Locations', w: 1600 }, opts);
    const location = (x: number, fields: { name: string } & Record<string, unknown>) =>
      createElement(cast, 'location', { x, y: 400 }, { w: 280, ...fields }, opts).id;
    const station = location(440, {
      name: 'Central station',
      setting: 'ext',
      assetId: pic('platform'),
      address: 'Piazza della Stazione 1',
      light: 'Sodium lamps on the canopy, blue hour from 6:40',
      availability: 'After the last train, 0:30–5:00',
      contact: 'Station manager, night desk',
      scenes: ['1'],
    });
    const diner = location(1320, {
      name: "Rosa's diner",
      setting: 'int',
      assetId: pic('diner'),
      address: 'Station hall, under the clock',
      light: 'Three pendants and the neon; the window goes blue at dawn',
      availability: 'Closed to the public 23:00–6:00',
      scenes: ['2'],
    });
    location(0, {
      name: 'Signal box',
      setting: 'int',
      assetId: pic('signalbox'),
      address: 'End of platform 4',
      light: 'One practical over the lever frame',
      availability: 'With a railway escort only',
      scenes: ['3'],
    });
    location(880, {
      name: 'Coast line',
      setting: 'ext',
      assetId: pic('sea'),
      address: 'Sea wall at Capo Bianco',
      light: 'Sunrise 6:58; the first train passes at 5:52',
      availability: 'Drone permit for the morning of day 3',
      scenes: ['3'],
    });

    const rect = (id: string) => {
      const el = readElement(roots(cast).elements.get(id)!)!;
      return { x: el.x, y: el.y, w: el.w, h: 200 };
    };
    const end = (id: string) => ({ elementId: id, ...rect(id) });
    // Who is what to whom, left to right as they meet in the story, and where they wait.
    createArrow(cast, end(sandro), end(anna), rect, { label: 'lets her stay' }, opts);
    createArrow(cast, end(anna), end(leo), rect, { label: 'strangers', heads: 'both' }, opts);
    createArrow(cast, end(leo), end(rosa), rect, { label: 'old friends', heads: 'both' }, opts);
    createArrow(cast, end(anna), end(station), rect, { label: 'waits here' }, opts);
    createArrow(cast, end(rosa), end(diner), rect, { label: 'her diner', line: 'dashed' }, opts);

    // The set of the diner from above, beside its location card: walls with the door and the
    // windows, the counter, the people playing the characters of this board, the practicals and
    // the sodium head on their circuits, two cameras. The walls and the counter are locked.
    createElement(cast, 'section', { x: 0, y: 680 }, { title: 'Sets', w: 1600 }, opts);
    const walls = [
      {
        id: planItemId('wallRoom'),
        points: [gx(140), gy(90), gx(860), gy(90), gx(860), gy(580), gx(140), gy(580)],
        thickness: 10,
        closed: true,
        label: "Rosa's diner",
        locked: true,
      },
    ];
    // Along the wall from its first corner, in view units: the top wall is 720 long, the right
    // one 490, then the bottom one runs back from x = 860.
    const openings = [
      { id: planItemId('openWin1'), wall: walls[0]!.id, kind: 'window', at: 180, width: 200 },
      { id: planItemId('openWin2'), wall: walls[0]!.id, kind: 'window', at: 500, width: 200 },
      {
        id: planItemId('openDoor'),
        wall: walls[0]!.id,
        kind: 'door',
        at: 720 + 490 + (860 - 240),
        width: 80,
        side: 'right',
        label: 'From the station hall',
        locked: true,
      },
    ];
    const grey = '#8E8E93';
    const lamp = '#EDD963';
    const stool1 = planItemId('iconStool1');
    const stool2 = planItemId('iconStool2');
    const icons = [
      { ...planIcon('Counter', 'counter', grey, 500, 250), w: 360, h: 70, locked: true },
      { ...planIcon('Coffee', 'kitchen', grey, 640, 135), w: 180, h: 40, label: 'Espresso bar' },
      { ...planIcon('Stool1', 'stool', grey, 420, 310), w: 34, h: 34 },
      { ...planIcon('Stool2', 'stool', grey, 580, 310), w: 34, h: 34 },
      { ...planIcon('Booth', 'table', grey, 770, 470), w: 90, h: 70 },
      { ...planIcon('Sofa', 'sofa', grey, 770, 540), w: 110, h: 36 },
      ...[360, 500, 640].map((x, i) => ({
        ...planIcon(`Pendant${i}`, 'pendant', lamp, x, 220),
        label: `Pendant ${i + 1}`,
        role: 'practical' as const,
        watts: 60,
        circuit: planItemId('circuitWall'),
      })),
      {
        ...planIcon('Neon', 'neon', '#E5484D', 760, 110),
        label: 'Neon cup',
        role: 'practical' as const,
        watts: 40,
        circuit: planItemId('circuitWall'),
      },
      {
        ...planIcon('Sodium', 'fresnel', '#F79B54', 640, 30),
        rotation: 110,
        reach: 160,
        label: 'Sodium 2K',
        power: '2K',
        watts: 2000,
        beam: 40,
        intensity: 0.6,
        role: 'key' as const,
        gel: 'CTO ½',
        stand: 'cstand' as const,
        circuit: planItemId('circuitDistro'),
      },
      {
        ...planIcon('Tube', 'tube', '#9DB8F2', 250, 400),
        rotation: 30,
        label: 'Tube',
        watts: 75,
        role: 'fill' as const,
        circuit: planItemId('circuitWall'),
      },
      { ...planIcon('Distro', 'distro', grey, 920, 520), label: 'Distro 32 A' },
      {
        ...planIcon('Rosa', 'actor', '#5FC2B5', 440, 160),
        rotation: 90,
        characterId: rosa,
      },
      {
        ...planIcon('Anna', 'actor', '#B897F0', 420, 310),
        rotation: 270,
        characterId: anna,
        pose: 'seated' as const,
        on: stool1,
      },
      {
        ...planIcon('Leo', 'actor', '#F79B54', 580, 310),
        rotation: 270,
        characterId: leo,
        pose: 'seated' as const,
        on: stool2,
        steps: [{ x: gx(240), y: gy(540), note: 'Comes in' }],
        stepNote: 'Sits next to her',
      },
      {
        ...planIcon('Cam', 'camera', '#9DB8F2', 500, 520),
        rotation: 270,
        label: 'A cam',
        lens: 32,
        showLens: true,
        support: 'dolly' as const,
        height: 1.2,
      },
      { ...planIcon('Track', 'track', grey, 500, 545), w: 300, h: 20 },
      {
        ...planIcon('CamB', 'camera', '#9DB8F2', 760, 330),
        rotation: 180,
        label: 'B cam',
        lens: 85,
        showLens: true,
        support: 'tripod' as const,
      },
      { ...planIcon('Boom', 'boom', grey, 660, 400), rotation: 225, label: 'Boom' },
    ];
    planId = createElement(
      cast,
      'plan',
      { x: 0, y: 750 },
      {
        w: 720,
        title: "Rosa's diner, scene 2",
        locationId: diner,
        walls: checked(PlanWall, walls),
        openings: checked(PlanOpening, openings),
        icons: checked(PlanIcon, icons),
        circuits: [
          { id: planItemId('circuitWall'), name: 'Wall sockets', amps: 16 },
          { id: planItemId('circuitDistro'), name: 'Distro', amps: 32 },
        ],
        // 80 view units a metre: the room is 9 by 6 metres.
        scale: 80,
        grid: '0.5',
      },
      opts,
    ).id;
  });
  await pushBoardDoc(base, cookie, casting.id, cast);

  // The rushes, in one column so that the take fills a phone: Tommaso's take of the platform, a frame grabbed from it, Ivo's voice note of the
  // lamps' hum and Chiara's link to the rough cut of the teaser (its thumbnail is a still).
  const rush = new Y.Doc();
  initBoardDoc(rush, rushes.id);
  rush.transact(() => {
    createElement(
      rush,
      'file',
      { x: 0, y: 0 },
      { assetId: take, w: 720, caption: 'Platform 4, take 3' },
      by('tommaso'),
    );
    createElement(
      rush,
      'image',
      { x: 0, y: 560 },
      {
        assetId: pic('platform'),
        w: 350,
        caption: 'Take 3 at 0:03: the hold before she enters',
        source: { kind: 'uploaded-video', assetId: take, timeSeconds: 3 },
      },
      by('tommaso'),
    );
    createElement(
      rush,
      'file',
      { x: 0, y: 870 },
      {
        assetId: hum,
        w: 350,
        caption: 'The hum at 1:50 a.m. This is the score until the diner.',
      },
      by('ivo'),
    );
    createElement(
      rush,
      'link',
      { x: 370, y: 560 },
      {
        url: 'https://www.youtube.com/watch?v=LastTrain24',
        title: 'Last Train, teaser (rough cut)',
        description: 'Unlisted until the festival.',
        imageAssetId: pic('tunnel'),
        w: 350,
      },
      by('chiara'),
    );
  });
  await pushBoardDoc(base, cookie, rushes.id, rush);

  // The production office, Chiara's: the crew and the budget as tables, the two maps of the
  // shoot (drawn, without a map server) and the shooting script.
  const office = new Y.Doc();
  initBoardDoc(office, production.id);
  office.transact(() => {
    const table = (
      at: { x: number; y: number },
      w: number,
      color: 'blue' | 'orange',
      rows: string[][],
      widths: number[] = [],
    ) => {
      const fields = newTable((rows[0] as string[]).length, rows.length);
      fields.rows.forEach((row, r) => {
        row.cells = Object.fromEntries(
          fields.columns.map((c, i) => [c.id, (rows[r] as string[])[i] ?? '']),
        );
      });
      widths.forEach((width, i) => {
        if (width) (fields.columns[i] as { width?: number }).width = width;
      });
      createElement(office, 'table', at, { ...fields, header: true, color, w }, by('chiara'));
    };
    const chiara = by('chiara');
    createElement(office, 'section', { x: 0, y: 0 }, { title: 'Crew and budget', w: 1120 }, chiara);
    table(
      { x: 0, y: 70 },
      700,
      'blue',
      [
        ['Role', 'Name', 'Email', 'On set'],
        ['Director', 'Giulia Bianchi', 'giulia@example.com', 'Days 1–3'],
        ['Producer', 'Chiara Fontana', 'chiara@example.com', 'Days 1–3'],
        ['Cinematographer', 'Tommaso Riva', 'tommaso@example.com', 'Days 1–3'],
        ['Production design', 'Sara Leone', 'sara@example.com', 'Days 1–2'],
        ['First AD', 'Marco Gallo', 'marco@example.com', 'Days 1–3'],
        ['Sound', 'Ivo Santoro', 'ivo@example.com', 'Days 1–3'],
        ['Costume', 'Nadia Greco', 'nadia@example.com', 'Days 1–2'],
      ],
      [150, 140, 0, 100],
    );
    table(
      { x: 740, y: 70 },
      380,
      'orange',
      [
        ['Budget', '€'],
        ['Camera and lenses, 3 days', '2,400'],
        ['Six sodium lamps', '660'],
        ['Rain and haze machines', '850'],
        ['The diner, two nights', '1,200'],
        ['Railway escort and drone permit', '540'],
        ['Catering, 3 nights', '1,350'],
        ['Total', '7,000'],
      ],
      [0, 90],
    );
    createElement(
      office,
      'section',
      { x: 0, y: 420 },
      { title: 'Maps and paperwork', w: 1120 },
      chiara,
    );
    const map = (x: number, name: string, address: string, picture: string) =>
      createElement(
        office,
        'map',
        { x, y: 490 },
        { name, address, imageAssetId: pic(picture), w: 360 },
        chiara,
      );
    map(0, 'Central station', 'Piazza della Stazione 1', 'map-station');
    map(380, 'Capo Bianco', 'Sea wall at Capo Bianco', 'map-coast');
    createElement(office, 'file', { x: 760, y: 490 }, { assetId: script, w: 360 }, opts);
  });
  await pushBoardDoc(base, cookie, production.id, office);

  // The Troupe, Chiara's: the crew with their accounts and the cast linked to the characters
  // of Cast and sets. The demo keeps it in last-train.crew.json, made by demo-seed.ts.
  const character = (name: string) => {
    const el = [...roots(cast).elements.values()]
      .map((m) => readElement(m))
      .find((e) => e?.type === 'character' && e.name === name);
    return el ? { boardId: casting.id, elementId: el.id } : null;
  };
  const crew = await api<{ items: Array<{ id: string; name: string }> }>(
    base,
    people.chiara.cookie,
    `/projects/${project.id}/crew/bulk`,
    {
      items: TROUPE.map(({ account: who, character: plays, ...row }, position) => ({
        ...row,
        userId: who === 'giulia' ? me.id : who ? people[who].id : null,
        character: plays ? character(plays) : null,
        position,
      })),
    },
  );
  const crewId = (name: string) => {
    const row = crew.items.find((r) => r.name === name);
    if (!row) throw new Error(`No crew row ${name}`);
    return row.id;
  };
  /** Calls of a day that differ from its call: [name, call or null, pick-up or null, absent?]. */
  const calls = (rows: Array<[string, string | null, string | null, boolean?]>) =>
    rows.map(([name, call, pickup, absent]) => ({
      crewMemberId: crewId(name),
      call,
      pickup,
      ...(absent === undefined ? {} : { absent }),
    }));

  // Three shooting days of the main unit from today, a rest day before the dawn one, and the
  // second unit's night at the station: the card on Home, the calendar and the call sheets, on
  // the Production board. A block names its frame and the storyboard that holds it (0123).
  const boardOf: Record<string, { id: string }> = {};
  for (const label of Object.keys(shot))
    boardOf[label] = ['1F', '1G', '1H'].includes(label) ? secondUnit : storyboard;
  const block = (
    type: string,
    title: string,
    duration: number,
    more: {
      start?: string;
      shot?: string;
      scene?: string;
      cast?: string[];
      departments?: string[];
      notes?: string;
    } = {},
  ) => ({
    id: randomUUID(),
    type,
    title,
    start: more.start ?? null,
    duration,
    shotId: more.shot ? (shot[more.shot] as string) : null,
    ...(more.shot ? { shotBoardId: boardOf[more.shot]?.id as string, shotLabel: more.shot } : {}),
    // A scene block plans a whole scene, drawn or not.
    ...(more.scene
      ? {
          sceneId: scenes[more.scene] as string,
          sceneBoardId: storyboard.id,
          sceneLabel: more.scene,
        }
      : {}),
    cast: more.cast ?? [],
    departments: more.departments ?? [],
    ...(more.notes ? { notes: more.notes } : {}),
  });
  const day = (offset: number, fields: Record<string, unknown>) =>
    api<{ id: string }>(base, cookie, `/boards/${schedule.id}/schedule`, {
      date: localDate(offset),
      ...fields,
    });
  await day(0, {
    callTime: '18:30',
    wrap: '04:00',
    location: 'Central station',
    notes:
      'The last train leaves at 0:42; platform 4 is ours from 0:30. Crew parking in Via dei Binari.',
    calls: calls([
      ['Ivo Santoro', '18:00', null],
      ['Marta Neri', '19:15', 'Hotel Stazione, 18:55'],
      ['Bruno Ferri', null, null, true],
    ]),
    blocks: [
      block('setup', 'Lamps, haze and rain machine', 90, {
        start: '18:30',
        departments: ['Lighting: six sodium heads on the canopy', 'SFX: rain on the forecourt'],
      }),
      block('shot', 'Anna crosses the forecourt in the rain', 90, {
        shot: '1B',
        cast: ['Anna'],
        departments: ['Costume: second coat standing by', 'Makeup: wet look'],
        notes: 'Rain on the forecourt only: keep the canopy and the lens dry.',
      }),
      block('break', 'Dinner', 45),
      block('move', 'Company moves to platform 4', 30),
      block('shot', 'The empty platform', 45, { start: '00:30', shot: '1A' }),
      block('shot', 'The doors close', 60, {
        shot: '1C',
        cast: ['Anna'],
        departments: ['Sound: door chime wild track'],
      }),
      block('shot', 'She watches the train go', 45, {
        shot: '1D',
        cast: ['Anna'],
        departments: ['Camera: 85mm, rack focus'],
      }),
      block('shot', 'Tail lights into the tunnel', 30, {
        shot: '1E',
        departments: ['Camera: B cam on the 135mm'],
      }),
    ],
  });
  // The second unit, the same night: its own column in the calendar. 1H books Anna while the
  // main unit shoots 1C with her: the calendar shows the conflict, for Marco to settle.
  await day(0, {
    callTime: '23:00',
    wrap: '02:30',
    location: 'Central station, the hall',
    notes: 'Second unit: Bruno on camera, one assistant. Stay off platform 4 until 2:15.',
    calls: calls([['Bruno Ferri', '22:30', null]]),
    blocks: [
      block('setup', 'Camera and a small LED kit in the hall', 30, { start: '23:00' }),
      block('shot', 'The station clock', 45, { shot: '1F', departments: ['Camera: 100mm'] }),
      block('shot', 'The departures board', 45, { shot: '1G' }),
      block('shot', "Anna's hand on the door", 30, {
        start: '01:15',
        shot: '1H',
        cast: ['Anna'],
        notes: 'Marta is with the main unit until 2:15: move this after 1D, or use a hand double.',
      }),
    ],
  });
  await day(1, {
    callTime: '19:00',
    wrap: '05:30',
    location: "Rosa's diner",
    notes: 'The diner closes to the public at 23:00. Keep the counter dressing overnight.',
    calls: calls([
      ['Sara Leone', '17:00', null],
      ['Paolo Verdi', '20:00', 'Via del Porto 12, 19:40'],
      ['Lucia Amato', '20:00', null],
      ['Bruno Ferri', null, null, true],
    ]),
    blocks: [
      block('setup', 'Pendants, neon and window rain', 120, {
        start: '19:00',
        departments: ['Art: dress the counter', 'Lighting: pendants on dimmers'],
      }),
      block('scene', 'Rehearsal at the counter', 30, {
        scene: '2',
        cast: ['Anna', 'Leo', 'Rosa'],
        notes: 'The whole scene once, for the dolly and the boom.',
      }),
      block('shot', 'Missed it too?', 150, { shot: '2A', cast: ['Anna', 'Leo', 'Rosa'] }),
      block('break', 'Dinner', 45),
      block('shot', 'Two coffees, one ticket', 45, { shot: '2B', departments: ['Props: cups'] }),
      block('shot', 'Dawn through the glass', 30, { start: '04:40', shot: '2C', cast: ['Leo'] }),
    ],
  });
  await day(3, {
    callTime: '03:30',
    wrap: '09:00',
    location: 'Signal box, coast line',
    notes: 'Railway escort from 3:30. Drone permit for Capo Bianco from 5:00 to 7:00.',
    calls: calls([
      ['Tommaso Riva', '03:00', null],
      ['Luca Marchi', '04:30', null],
      ['Marta Neri', '04:45', 'Hotel Stazione, 4:30'],
      ['Sara Leone', null, null, true],
      ['Nadia Greco', null, null, true],
      ['Bruno Ferri', null, null, true],
    ]),
    blocks: [
      // 03:30 + 45 + 45 + 30 ends at 05:30, before the train shot fixed at 05:45.
      block('setup', 'Signal box practicals', 45, { start: '03:30' }),
      block('shot', 'Leo pulls the lever', 45, { shot: '3A', cast: ['Leo'] }),
      block('move', 'Unit move to the coast', 30),
      block('shot', 'The first train along the sea', 30, {
        start: '05:45',
        shot: '3C',
        cast: ['Anna'],
        departments: ['Drone: two batteries charged', 'Production: train passes at 5:52'],
        notes: 'The train passes Capo Bianco at 5:52. One take, maybe two.',
      }),
      block('shot', 'The signal turns green', 45, { shot: '3B' }),
    ],
  });

  // The crew at work: comments with replies, a pin on a detail and a resolved thread, mentions
  // that reach Giulia's inbox, reactions, and the team's review of the frames.
  const as = (who: Member | 'giulia') => (who === 'giulia' ? cookie : people[who].cookie);
  const mention = (who: Member) => `@{${people[who].id}}`;
  const comment = (who: Member | 'giulia', boardId: string, body: Record<string, unknown>) =>
    api<{ id: string }>(base, as(who), `/boards/${boardId}/comments`, body);
  const moodThread = await comment('tommaso', project.rootBoardId, {
    elementId: moodIds.intro,
    body: 'Can we keep the sodium orange in the grade, or is it too much next to the blue?',
  });
  await comment('giulia', project.rootBoardId, {
    parentId: moodThread.id,
    body: 'Keep it. It is the only warm thing in the film until the ending.',
  });
  await comment('chiara', project.rootBoardId, {
    body: `Lamp rental confirmed for night 1. @{${me.id}} the diner is ours for night 2 as well: can you tick it on the list?`,
  });
  for (const who of ['chiara', 'sara'] as const)
    await request(
      base,
      as(who),
      'PUT',
      `/boards/${project.rootBoardId}/elements/${moodIds.diner}/reactions/${encodeURIComponent('❤️')}`,
    );
  const neon = await comment('sara', storyboard.id, {
    elementId: shot['2A'],
    pin: { x: 0.72, y: 0.36 },
    body: `The neon cup goes here, over Rosa's shoulder. ${mention('tommaso')} is it in the frame at 32mm?`,
  });
  await comment('tommaso', storyboard.id, {
    parentId: neon.id,
    body: 'Just. I will check it at the recce.',
  });
  const chime = await comment('marco', storyboard.id, {
    elementId: shot['1C'],
    body: `${mention('ivo')} do we have the door chime as a wild track?`,
  });
  await comment('ivo', storyboard.id, {
    parentId: chime.id,
    body: 'Recorded at the recce: it is on the Rushes board.',
  });
  await api(base, as('marco'), `/comments/${chime.id}/resolve`, {});
  await request(base, cookie, 'PUT', `/comments/${chime.id}/reactions/${encodeURIComponent('✅')}`);
  const review = (frame: string, status: string, note?: string) =>
    request(base, cookie, 'PUT', `/boards/${storyboard.id}/elements/${shot[frame]}/review`, {
      status,
      ...(note ? { note } : {}),
    });
  await review('1A', 'approved');
  await review('1B', 'approved');
  for (const frame of ['1C', '1D', '2A']) await review(frame, 'in_review', 'For the client');

  // The client: a share link of the project where guests decide, and Elena's decisions.
  const link = await api<{ id: string; url: string }>(
    base,
    cookie,
    `/boards/${project.rootBoardId}/share-links`,
    { role: 'guest_approve', label: client.link },
  );
  const guestUrl = link.url;
  const session = await fetch(`${base}/api/v1/guest/links/${link.id}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ token: new URL(guestUrl).pathname.split('/').pop(), name: client.name }),
  });
  if (!session.ok) throw new Error(`guest session: ${session.status} ${await session.text()}`);
  const guest = cookieOf(session);
  const decide = (frame: string, status: string, note?: string) =>
    request(
      base,
      guest,
      'PUT',
      `/guest/links/${link.id}/boards/${storyboard.id}/elements/${shot[frame]}/review`,
      { status, ...(note ? { note } : {}) },
    );
  await decide('1C', 'approved');
  await decide('2A', 'changes_requested', "We would like to see Rosa's face when she pours.");
  await api(base, guest, `/guest/links/${link.id}/boards/${storyboard.id}/comments`, {
    elementId: shot['2A'],
    body: 'Lovely light. Could Rosa turn towards the counter as she pours?',
  });

  // The storyboard as it was locked for the shoot, in its versions.
  await api(base, cookie, `/boards/${storyboard.id}/versions`, { name: 'Locked for the shoot' });

  // Lanterna Film's next project, still in development, and Giulia's groups on Home.
  const next = await api<{ id: string; rootBoardId: string }>(base, cookie, '/projects', {
    name: 'Salt Road',
    type: 'documentary',
    icon: { shape: 'drop', color: 'teal' },
  });
  await request(base, cookie, 'PUT', `/projects/${next.id}/members/${people.chiara.id}`, {
    role: 'owner',
  });
  const nextPic = {
    field: await upload('field.jpg', pictures.field as Buffer, 'image/jpeg', next.id),
    dawn: await upload('dawn.jpg', pictures.dawn as Buffer, 'image/jpeg', next.id),
  };
  await waitForAssets(base, cookie, Object.values(nextPic));
  const salt = new Y.Doc();
  initBoardDoc(salt, next.rootBoardId);
  salt.transact(() => {
    note(
      salt,
      { x: 0, y: 0 },
      [
        'Salt Road',
        'A documentary. The last salt pans along the coast line, worked by hand for one more summer.',
        'Same sea as Last Train, in daylight.',
      ],
      320,
    );
    createElement(
      salt,
      'todo',
      { x: 0, y: 200 },
      {
        title: 'Development',
        items: [
          { id: 'salttodo0001', text: 'Treatment, first draft', done: true },
          {
            id: 'salttodo0002',
            text: 'Call the salt workers cooperative',
            done: false,
            assigneeId: people.chiara.id,
          },
          { id: 'salttodo0003', text: 'Funding application', done: false },
        ],
        w: 320,
      },
      opts,
    );
    createElement(salt, 'image', { x: 360, y: 0 }, { assetId: nextPic.field, w: 420 }, opts);
    createElement(salt, 'image', { x: 360, y: 260 }, { assetId: nextPic.dawn, w: 420 }, opts);
    const palette = createElement(
      salt,
      'column',
      { x: 820, y: 0 },
      { title: 'Palette', w: 160, color: 'green' },
      opts,
    );
    const swatches = [
      ['#F3D3A8', 'Dawn'],
      ['#E9E4D8', 'Salt'],
      ['#5E8CA6', 'Sea'],
    ].map(
      ([hex, label]) =>
        createElement(salt, 'color', { x: 0, y: 0 }, { hex: hex as string, label }, opts).id,
    );
    moveIntoParent(salt, swatches, palette.id, 0);
  });
  await pushBoardDoc(base, cookie, next.rootBoardId, salt);
  const groups = [
    ['In production', 'orange', project.id],
    ['In development', 'teal', next.id],
  ] as const;
  for (const [name, color, projectId] of groups) {
    const g = await api<{ id: string }>(base, cookie, '/project-groups', { name, color });
    await request(base, cookie, 'PUT', `/projects/${projectId}/group`, { groupId: g.id });
  }
  await request(base, cookie, 'PUT', `/projects/${project.id}/pin`, { pinned: true });

  return {
    cookie,
    project,
    storyboard,
    casting,
    secondUnit,
    setPlan: casting,
    planId,
    rushes,
    production,
    schedule,
    asset,
    guestUrl,
    next,
  };
}
