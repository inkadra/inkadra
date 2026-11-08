import { randomUUID } from 'node:crypto';
import {
  addFrame,
  addScene,
  createArrow,
  createElement,
  moveIntoParent,
  updateElement,
} from '@inkadra/canvas-core';
import { initBoardDoc, type PlanIcon, readElement, roots, STROKE_GRID } from '@inkadra/doc-schema';
import type { Browser } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from '../tests/perf/seed.ts';
import { STILL_NAMES, stillSize, stillSvg } from './sample-stills.ts';

/**
 * The sample project of the screenshot scripts, built on an empty instance: "Last Train", a
 * short film with a moodboard, a storyboard of three scenes, a casting board, a set plan and
 * three shooting days from today. docs/demo-project.md is its story bible: names, scenes and
 * dates here follow it.
 *
 * The pictures on the boards are drawn in sample-stills.ts, so the screenshots carry no
 * third-party images.
 */

export const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};
const opts = { userId: null };

async function renderStills(browser: Browser): Promise<Record<string, Buffer>> {
  const page = await browser.newPage();
  const result: Record<string, Buffer> = {};
  for (const name of STILL_NAMES) {
    await page.setViewportSize(stillSize(name));
    await page.setContent(`<body style="margin:0">${stillSvg(name)}</body>`);
    result[name] = await page.screenshot({ type: 'jpeg', quality: 90 });
  }
  await page.close();
  return result;
}

export async function api<T>(
  base: string,
  cookie: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${base}/api/v1${path}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export function note(doc: Y.Doc, at: { x: number; y: number }, lines: string[], w?: number) {
  const el = createElement(doc, 'note', at, w ? { w } : {}, opts);
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

export interface SampleProject {
  cookie: string;
  project: { id: string; rootBoardId: string };
  storyboard: { id: string };
  casting: { id: string };
  /** The board with the set plan; its plan card is `planId`. */
  setPlan: { id: string };
  planId: string;
  /** Asset ids of the stills, by name. */
  asset: Record<string, string>;
}

/** Local dates from today, like the app's: day 0 is today. */
function localDate(offset: number) {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

export async function seedSampleProject(browser: Browser, base: string): Promise<SampleProject> {
  const pictures = await renderStills(browser);
  const cookie = await signIn(base, account);
  const me = (await (
    await fetch(`${base}/api/v1/me`, { headers: { cookie } })
  ).json()) as { id: string };
  const project = await api<{ id: string; rootBoardId: string }>(base, cookie, '/projects', {
    name: 'Last Train',
  });
  const board = (title: string, kind: 'board' | 'storyboard' = 'board') =>
    api<{ id: string }>(base, cookie, `/projects/${project.id}/boards`, {
      parentBoardId: project.rootBoardId,
      kind,
      title,
    });
  const storyboard = await board('Storyboard', 'storyboard');
  const casting = await board('Casting');
  const setPlan = await board('Set plan');

  const asset: Record<string, string> = {};
  for (const [name, body] of Object.entries(pictures)) {
    const id = await uploadFile(base, cookie, project.id, {
      body,
      name: `${name}.jpg`,
      type: 'image/jpeg',
    });
    if (!id) throw new Error('This instance does not take uploads');
    asset[name] = id;
  }
  await waitForAssets(base, cookie, Object.values(asset));
  const pic = (name: string) => asset[name] as string;

  // The moodboard: the project's root board. Five columns with even gaps, so that it fits the
  // window of the screenshots without overlapping cards.
  const mood = new Y.Doc();
  initBoardDoc(mood, project.rootBoardId);
  mood.transact(() => {
    note(
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
    createElement(mood, 'board', { x: 0, y: 210 }, { boardId: storyboard.id, w: 320 }, opts);
    createElement(mood, 'board', { x: 0, y: 300 }, { boardId: casting.id, w: 320 }, opts);
    createElement(mood, 'board', { x: 0, y: 390 }, { boardId: setPlan.id, w: 320 }, opts);
    createElement(
      mood,
      'todo',
      { x: 0, y: 490 },
      {
        title: 'Before the shoot',
        items: [
          { id: 'shotstodo0001', text: 'Scout platform 4 with the station manager', done: true },
          { id: 'shotstodo0002', text: 'Night permit from the city', done: true },
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
          { id: 'shotstodo0005', text: 'Rain machine test on the forecourt', done: false },
        ],
        w: 320,
      },
      opts,
    );

    const image = (name: string, x: number, y: number, w: number, caption?: string) =>
      createElement(
        mood,
        'image',
        { x, y },
        { assetId: pic(name), w, ...(caption ? { caption } : {}) },
        opts,
      );
    image('platform', 360, 0, 520, 'Platform 4, 1:52 a.m.');
    image('diner', 360, 340, 520, "Rosa's, the only light still on");
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
      createElement(mood, 'image', { x: 0, y: 0 }, { assetId: pic('dawn') }, opts).id,
      createElement(mood, 'image', { x: 0, y: 0 }, { assetId: pic('sea') }, opts).id,
      createElement(mood, 'image', { x: 0, y: 0 }, { assetId: pic('field') }, opts).id,
      note(mood, { x: 0, y: 0 }, [
        'Blue hour for the ending, the sky still holding some warmth.',
      ]),
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
        createElement(mood, 'color', { x: 0, y: 0 }, { hex: hex as string, label }, opts).id,
    );
    moveIntoParent(mood, swatches, palette.id, 0);
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
            dialogue: 'LEO: Missed it too?\nANNA: By about a minute.\nLEO: Then you have six hours.',
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
            lens: '100mm macro',
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
      x: number,
      title: string,
      kind: 'wardrobe' | 'props' | 'equipment',
      scene: string,
      items: string[],
    ) =>
      createElement(
        story,
        'todo',
        { x, y: 1400 },
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
    list(280, 'Anna, night 1', 'wardrobe', '1', ['Grey wool coat ×2', 'Red scarf']);
    list(560, 'At the counter', 'props', '2', ['Two cups and saucers', 'Punched train ticket']);
  });
  await pushBoardDoc(base, cookie, storyboard.id, story);

  // The casting board: four character sheets and the four places of the shoot.
  const cast = new Y.Doc();
  initBoardDoc(cast, casting.id);
  cast.transact(() => {
    createElement(cast, 'section', { x: 0, y: 0 }, { title: 'Characters', w: 1240 }, opts);
    const character = (x: number, fields: Record<string, unknown>) =>
      createElement(cast, 'character', { x, y: 70 }, { w: 280, ...fields }, opts).id;
    const leo = character(320, {
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
    const rosa = character(640, {
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
    const sandro = character(960, {
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
    const anna = character(0, {
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

    createElement(cast, 'section', { x: 0, y: 330 }, { title: 'Locations', w: 1240 }, opts);
    const location = (x: number, fields: Record<string, unknown>) =>
      createElement(cast, 'location', { x, y: 400 }, { w: 280, ...fields }, opts).id;
    const station = location(0, {
      name: 'Central station',
      setting: 'ext',
      assetId: pic('platform'),
      address: 'Piazza della Stazione 1',
      light: 'Sodium lamps on the canopy, blue hour from 6:40',
      availability: 'After the last train, 0:30–5:00',
      contact: 'Station manager, night desk',
      scenes: ['1'],
    });
    location(320, {
      name: "Rosa's diner",
      setting: 'int',
      assetId: pic('diner'),
      address: 'Station hall, under the clock',
      light: 'Three pendants and the neon; the window goes blue at dawn',
      availability: 'Closed to the public 23:00–6:00',
      scenes: ['2'],
    });
    location(640, {
      name: 'Signal box',
      setting: 'int',
      assetId: pic('signalbox'),
      address: 'End of platform 4',
      light: 'One practical over the lever frame',
      availability: 'With a railway escort only',
      scenes: ['3'],
    });
    location(960, {
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
    createArrow(cast, end(anna), end(station), rect, { label: 'waits here' }, opts);
  });
  await pushBoardDoc(base, cookie, casting.id, cast);

  // The set plan of the diner: walls and window, the counter, stools and a booth, the people,
  // the practicals, the sodium light through the window and two cameras.
  const planDoc = new Y.Doc();
  initBoardDoc(planDoc, setPlan.id);
  const planId = planDoc.transact(() => {
    const gx = (x: number) => Math.round((x / 1000) * STROKE_GRID);
    const gy = (y: number) => Math.round((y / (1000 / 1.5)) * STROKE_GRID);
    const id = (name: string) => name.padEnd(13, 'A');
    const wall = (n: number, x0: number, y0: number, x1: number, y1: number) => ({
      id: id(`wall${n}`),
      kind: 'line' as const,
      color: '#8E8E93',
      width: 6,
      x0: gx(x0),
      y0: gy(y0),
      x1: gx(x1),
      y1: gy(y1),
    });
    const icon = (name: string, kind: PlanIcon['kind'], color: string, x: number, y: number) => ({
      id: id(`icon${name}`),
      kind,
      color,
      x: gx(x),
      y: gy(y),
    });
    const grey = '#8E8E93';
    return createElement(
      planDoc,
      'plan',
      { x: 0, y: 0 },
      {
        w: 720,
        title: "Rosa's diner, scene 2",
        shapes: [
          wall(0, 140, 90, 860, 90),
          wall(1, 860, 90, 860, 580),
          wall(2, 860, 580, 140, 580),
          wall(3, 140, 580, 140, 90),
        ],
        icons: [
          { ...icon('Window1', 'window', grey, 320, 90), w: 220, h: 16 },
          { ...icon('Window2', 'window', grey, 640, 90), w: 220, h: 16 },
          { ...icon('Door', 'door', grey, 140, 480), rotation: 90, w: 70, h: 70 },
          { ...icon('Counter', 'table', grey, 500, 250), w: 360, h: 80 },
          { ...icon('Stool1', 'chair', grey, 420, 310), w: 34, h: 34 },
          { ...icon('Stool2', 'chair', grey, 580, 310), w: 34, h: 34 },
          { ...icon('Booth', 'table', grey, 770, 470), w: 90, h: 70 },
          { ...icon('Sofa', 'sofa', grey, 770, 540), w: 110, h: 36 },
          { ...icon('Lamp1', 'practical', '#EDD963', 360, 220), size: 'L' as const },
          icon('Lamp2', 'practical', '#EDD963', 500, 220),
          icon('Lamp3', 'practical', '#EDD963', 640, 220),
          {
            ...icon('Sodium', 'fresnel', '#F79B54', 480, 30),
            rotation: 90,
            label: 'Sodium 2K',
            power: '2K',
            beam: 40,
            intensity: 0.6,
          },
          { ...icon('Bounce', 'bounce', grey, 250, 400), rotation: 30 },
          { ...icon('Rosa', 'actor', '#5FC2B5', 500, 190), rotation: 90, label: 'Rosa' },
          { ...icon('Anna', 'actor', '#B897F0', 420, 340), rotation: 270, label: 'Anna' },
          {
            ...icon('Leo', 'actor', '#F79B54', 580, 340),
            rotation: 270,
            label: 'Leo',
            steps: [{ x: gx(180), y: gy(480), note: 'Comes in' }],
            note: 'Sits next to her',
          },
          {
            ...icon('Cam', 'camera', '#9DB8F2', 500, 520),
            rotation: 270,
            label: 'A cam',
            lens: 32,
            showLens: true,
          },
          { ...icon('Track', 'track', grey, 500, 545), w: 300, h: 20 },
          {
            ...icon('CamB', 'camera', '#9DB8F2', 760, 330),
            rotation: 180,
            label: 'B cam',
            lens: 85,
            showLens: true,
          },
          { ...icon('Boom', 'boom', grey, 660, 400), rotation: 225 },
        ],
      },
      opts,
    ).id;
  });
  await pushBoardDoc(base, cookie, setPlan.id, planDoc);

  // Three shooting nights from today: the card on Home, the schedule and the call sheets.
  const block = (
    type: string,
    title: string,
    duration: number,
    more: { start?: string; shot?: string; cast?: string[]; departments?: string[] } = {},
  ) => ({
    id: randomUUID(),
    type,
    title,
    start: more.start ?? null,
    duration,
    shotId: more.shot ? (shot[more.shot] as string) : null,
    cast: more.cast ?? [],
    departments: more.departments ?? [],
  });
  const day = (offset: number, fields: Record<string, unknown>) =>
    api(base, cookie, `/boards/${storyboard.id}/schedule`, { date: localDate(offset), ...fields });
  await day(0, {
    callTime: '18:30',
    wrap: '04:00',
    location: 'Central station',
    notes:
      'The last train leaves at 0:42; platform 4 is ours from 0:30. Crew parking in Via dei Binari.',
    blocks: [
      block('setup', 'Lamps, haze and rain machine', 90, {
        start: '18:30',
        departments: ['Lighting: six sodium heads on the canopy', 'SFX: rain on the forecourt'],
      }),
      block('shot', 'Anna crosses the forecourt in the rain', 90, {
        shot: '1B',
        cast: ['Anna'],
        departments: ['Costume: second coat standing by', 'Makeup: wet look'],
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
  await day(1, {
    callTime: '19:00',
    wrap: '05:30',
    location: "Rosa's diner",
    notes: 'The diner closes to the public at 23:00. Keep the counter dressing overnight.',
    blocks: [
      block('setup', 'Pendants, neon and window rain', 120, {
        start: '19:00',
        departments: ['Art: dress the counter', 'Lighting: pendants on dimmers'],
      }),
      block('shot', 'Missed it too?', 150, { shot: '2A', cast: ['Anna', 'Leo', 'Rosa'] }),
      block('break', 'Dinner', 45),
      block('shot', 'Two coffees, one ticket', 45, { shot: '2B', departments: ['Props: cups'] }),
      block('shot', 'Dawn through the glass', 30, { start: '04:40', shot: '2C', cast: ['Leo'] }),
    ],
  });
  await day(2, {
    callTime: '03:30',
    wrap: '09:00',
    location: 'Signal box, coast line',
    notes: 'Railway escort from 3:30. Drone permit for Capo Bianco from 5:00 to 7:00.',
    blocks: [
      block('setup', 'Signal box practicals', 60, { start: '03:30' }),
      block('shot', 'Leo pulls the lever', 60, { shot: '3A', cast: ['Leo'] }),
      block('move', 'Unit move to the coast', 40),
      block('shot', 'The first train along the sea', 30, {
        start: '05:45',
        shot: '3C',
        cast: ['Anna'],
        departments: ['Drone: two batteries charged', 'Production: train passes at 5:52'],
      }),
      block('shot', 'The signal turns green', 45, { shot: '3B' }),
    ],
  });

  return { cookie, project, storyboard, casting, setPlan, planId, asset };
}
