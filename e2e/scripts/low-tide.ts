import { randomUUID } from 'node:crypto';
import { addFrame, addScene, createElement, moveIntoParent } from '@inkadra/canvas-core';
import { initBoardDoc, PlanIcon, readElement, roots } from '@inkadra/doc-schema';
import type { Browser } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from '../tests/perf/seed.ts';
import {
  account,
  api,
  checked,
  gx,
  gy,
  joinTeam,
  localDate,
  note,
  planIcon,
  planItemId,
  renderStills,
  request,
} from './sample-project.ts';
import { TIDE_NAMES } from './sample-stills.ts';

/**
 * The second sample project of the demo: "Low Tide", an editorial photo shoot on the coast, in
 * docs/demo-project.md. A moodboard with the brief, the looks and the palette, a shot list with
 * the day of the shoot, and the selects, shared with the client with photo proofing on: the
 * client has picked, rejected and starred part of them and left a comment.
 *
 * The project is made on the instance of Last Train by its first account, who hands it to the
 * photographer: everything in it is the photographer's or the stylist's.
 */

export const photographer = { name: 'Lia Moretti', email: 'lia@example.com', role: 'owner' };
const stylist = { name: 'Nora Conti', email: 'nora@example.com', role: 'editor' };
/** The client, who proofs the selects through a share link, without an account. */
const client = { link: 'Studio Maree', name: 'Irene Galli', password: 'sea-wall-red-coat' };

type Choice = [pick: 'picked' | 'rejected' | null, stars: number | null];
/** Studio Maree's proofing so far: 9 picks, 4 rejects and 20 pictures starred, 4.1 on average. */
const proofing: Record<string, Choice> = {
  LT_0405: [null, 5],
  LT_0409: ['picked', 5],
  LT_0412: ['picked', 5],
  LT_0418: [null, 4],
  LT_0421: ['rejected', null],
  LT_0427: ['picked', 5],
  LT_0431: ['picked', 4],
  LT_0440: [null, 4],
  LT_0446: ['picked', 4],
  LT_0451: ['picked', 5],
  LT_0457: ['rejected', 2],
  LT_0462: ['rejected', null],
  LT_0468: [null, 5],
  LT_0472: [null, 4],
  LT_0497: ['picked', 4],
  LT_0503: [null, 3],
  LT_0507: [null, 4],
  LT_0511: ['picked', 5],
  LT_0515: [null, 5],
  LT_0518: ['picked', 4],
  LT_0522: [null, 4],
  LT_0526: ['rejected', 1],
};

/**
 * The Troupe of the shoot: Lia's assistant, Nora, the two models in Cast and the client, who was
 * not on the beach. Phone numbers are made up on a prefix no Italian line uses.
 */
const TROUPE = [
  ['Lia Moretti', 'Photographer', 'Photography', '0201', 'lia@example.com', 'lia', ''],
  ['Pietro Sala', 'Photo assistant', 'Photography', '0202', 'pietro@example.com', null, ''],
  ['Nora Conti', 'Stylist, hair and make-up', 'Styling', '0203', 'nora@example.com', 'nora', ''],
  ['Mara', 'Model, looks 1 to 3', 'Cast', '0204', '', null, 'Hotel in Punta Grigia'],
  ['Ivo', 'Model, looks 2 and 3', 'Cast', '0205', '', null, ''],
  ['Irene Galli', 'Studio Maree', 'Client', '0206', 'irene@example.com', null, ''],
] as const;

export interface LowTide {
  /** The photographer's session: she owns the project. */
  cookie: string;
  project: { id: string; rootBoardId: string };
  shotList: { id: string };
  selects: { id: string };
  /** The client's proofing link of the selects. */
  proofingUrl: string;
}

export async function seedLowTide(browser: Browser, base: string): Promise<LowTide> {
  // Flat illustrations: a lower quality keeps 24 pictures small in the demo archive.
  const pictures = await renderStills(browser, TIDE_NAMES, 80);
  const admin = await signIn(base, account);
  // The shoot was two days ago: the selects are with the client.
  const project = await api<{ id: string; rootBoardId: string }>(base, admin, '/projects', {
    name: 'Low Tide',
    type: 'photo_shoot',
    icon: { shape: 'moon', color: 'teal' },
    shootingStart: localDate(-2),
    shootingEnd: localDate(-2),
    timeZone: 'Europe/Rome',
  });
  const lia = await joinTeam(base, admin, project.id, photographer);
  const nora = await joinTeam(base, admin, project.id, stylist);
  const cookie = lia.cookie;
  const by = { userId: lia.id };

  const board = (title: string, kind: 'board' | 'storyboard' | 'production' = 'board') =>
    api<{ id: string }>(base, cookie, `/projects/${project.id}/boards`, {
      parentBoardId: project.rootBoardId,
      kind,
      title,
    });
  const shotList = await board('Shot list', 'storyboard');
  const selects = await board('Selects');
  // The day of the shoot and the Troupe, as "Add → Production" makes the board (0123).
  const production = await board('Production', 'production');

  const asset: Record<string, string> = {};
  for (const name of TIDE_NAMES) {
    const id = await uploadFile(base, cookie, project.id, {
      body: pictures[name] as Buffer,
      name: `${name}.jpg`,
      type: 'image/jpeg',
    });
    if (!id) throw new Error('This instance does not take uploads');
    asset[name] = id;
  }
  await waitForAssets(base, cookie, Object.values(asset));
  const pic = (name: string) => asset[name] as string;

  // The moodboard, the project's root: the brief, the boards, the lists, the looks, the palette.
  const mood = new Y.Doc();
  initBoardDoc(mood, project.rootBoardId);
  const moodIds = mood.transact(() => {
    const brief = note(
      mood,
      { x: 0, y: 0 },
      [
        'Low Tide',
        'Editorial for Studio Maree. Three looks on the coast in one day: the sea wall, dawn, the dunes.',
        'Cold light, wet sand, one red coat.',
      ],
      320,
      by,
    );
    createElement(mood, 'board', { x: 0, y: 210 }, { boardId: shotList.id, w: 320 }, by);
    createElement(mood, 'board', { x: 0, y: 300 }, { boardId: selects.id, w: 320 }, by);
    const todo = (
      y: number,
      key: string,
      title: string,
      items: Array<[string, boolean, string?]>,
    ) =>
      createElement(
        mood,
        'todo',
        { x: 0, y },
        {
          title,
          items: items.map(([text, done, assigneeId], i) => ({
            id: `tide${key}todo000${i}`,
            text,
            done,
            ...(assigneeId ? { assigneeId } : {}),
          })),
          w: 320,
        },
        by,
      );
    todo(400, 'before', 'Before the shoot', [
      ['Beach permit from the town hall', true],
      ['Model call: Mara at 6:30', true],
      ['Tide times: low water at 7:42', true],
      ['Hair and make-up in the van', true, nora.id],
      ['Spare batteries, towels', true],
    ]);
    todo(660, 'after', 'After the shoot', [
      ['Send the proofing link to Studio Maree', true, lia.id],
      ['Retouch the picks', false, lia.id],
      ['Return the coat to Studio Maree', false, nora.id],
      ['Deliver the finals', false, lia.id],
    ]);

    const image = (name: string, x: number, y: number, w: number, group: string, caption = '') =>
      createElement(
        mood,
        'image',
        { x, y },
        { assetId: pic(name), w, group, ...(caption ? { caption } : {}) },
        by,
      ).id;
    const seawall = image('LT_0412', 360, 0, 520, 'Look 1 · Sea wall', 'Look 1 · Sea wall');
    image('LT_0518', 360, 340, 250, 'Look 1 · Sea wall');
    image('LT_0503', 630, 340, 250, 'Look 2 · Dawn');
    // The day of the shoot and the Troupe, previewed on a tall card (decision 0121).
    createElement(
      mood,
      'board',
      { x: 360, y: 660 },
      { boardId: production.id, w: 520, h: 260, guestHidden: true },
      by,
    );
    createElement(
      mood,
      'link',
      { x: 360, y: 520 },
      {
        url: 'https://example.com/tides',
        title: 'Tide times for the coast',
        description: 'Low water at 7:42 on the day of the shoot.',
        w: 520,
      },
      by,
    );

    const looks = createElement(
      mood,
      'column',
      { x: 920, y: 0 },
      { title: 'Looks', w: 260, color: 'green' },
      by,
    );
    const lookCards = (
      [
        ['LT_0431', 'Look 2 · Dawn', 'dawn'],
        ['LT_0457', 'Look 3 · Dunes', 'dunes'],
        ['LT_0526', 'Look 3 · Dunes', 'fog'],
      ] as const
    ).map(
      ([name, group, tag]) =>
        createElement(
          mood,
          'image',
          { x: 0, y: 0 },
          { assetId: pic(name), group, tags: [tag], caption: group },
          by,
        ).id,
    );
    moveIntoParent(mood, lookCards, looks.id, 0);

    const palette = createElement(
      mood,
      'column',
      { x: 1220, y: 0 },
      { title: 'Palette', w: 160, color: 'blue' },
      by,
    );
    const swatches = [
      ['#8FA9A3', 'Sea glass'],
      ['#B49A7A', 'Wet sand'],
      ['#6E2A2A', 'Red coat'],
      ['#D9DCD6', 'Fog'],
      ['#3E4E5E', 'Slate sea'],
    ].map(
      ([hex, label]) =>
        createElement(
          mood,
          'color',
          { x: 0, y: 0 },
          { hex: hex as string, label, group: 'Palette' },
          by,
        ).id,
    );
    moveIntoParent(mood, swatches, palette.id, 0);
    return { brief, seawall };
  });
  await pushBoardDoc(base, cookie, project.rootBoardId, mood);

  // The shot list: a scene for each look, a frame for each set-up, what each look needs.
  const story = new Y.Doc();
  initBoardDoc(story, shotList.id);
  const shot: Record<string, string> = {};
  const looks: string[] = [];
  story.transact(() => {
    type Setup = [label: string, picture: string, fields: Record<string, unknown>];
    const look = (fields: Parameters<typeof addScene>[1], setups: Setup[], first = false) => {
      const s = addScene(story, fields, by, first ? { x: 0, y: 0 } : undefined);
      for (const [label, p, f] of setups)
        shot[label] = addFrame(story, s.id, null, { assetId: pic(p), status: 'shot', ...f }, by).id;
      return s.id;
    };
    const frame = (action: string, size: string, lens: string, cast: string[], more = {}) => ({
      action,
      shot: size,
      angle: 'eye',
      lens,
      ...(cast.length ? { cast } : {}),
      ...more,
    });
    const scenes: string[] = [
      look(
        {
          number: '1',
          title: 'Look 1 · Sea wall',
          setting: 'ext',
          time: 'day',
          location: 'Sea wall, Punta Grigia',
          synopsis: 'Mara in the red coat on the wall, into the wind. Overcast: keep it cold.',
        },
        [
          ['1A', 'LT_0405', frame('Mara walks the wall into the wind.', 'fs', '35mm', ['Mara'])],
          [
            '1B',
            'LT_0412',
            frame('Turned to the sea, the coat open.', 'ms', '50mm', ['Mara'], {
              notes: 'The cover, if the light holds.',
            }),
          ],
          [
            '1C',
            'LT_0518',
            frame('Profile, hair blown back, the red scarf.', 'mcu', '85mm', ['Mara']),
          ],
          ['1D', 'LT_0421', frame('Small on the wall, all sky.', 'ws', '24mm', ['Mara'])],
          [
            '1E',
            'LT_0511',
            frame('Closer: the scarf, the wind in her hair.', 'cu', '100mm', ['Mara']),
          ],
        ],
        true,
      ),
      look(
        {
          number: '2',
          title: 'Look 2 · Dawn',
          setting: 'ext',
          time: 'dawn',
          location: 'Beach at low water',
          synopsis: 'The first sun on the wet sand: the sky in the sand, two figures far off.',
        },
        [
          [
            '2A',
            'LT_0431',
            frame('Two figures on the wet sand.', 'ews', '24mm', ['Mara', 'Ivo'], {
              notes: 'Low water at 7:42: the sand mirrors best just after.',
            }),
          ],
          ['2B', 'LT_0436', frame('Ivo at the edge of the water.', 'ws', '35mm', ['Ivo'])],
          ['2C', 'LT_0497', frame('Mara among the rock pools.', 'ms', '50mm', ['Mara'])],
          [
            '2D',
            'LT_0427',
            frame('Mara walks out along the low-water line.', 'fs', '50mm', ['Mara']),
          ],
        ],
      ),
      look(
        {
          number: '3',
          title: 'Look 3 · Dunes',
          setting: 'ext',
          time: 'day',
          location: 'Dunes behind the beach',
          synopsis: 'The pale dress in the tall grass, the fog coming in from the sea.',
        },
        [
          [
            '3A',
            'LT_0457',
            frame('Through the tall grass, the pale dress.', 'fs', '50mm', ['Mara', 'Ivo']),
          ],
          ['3B', 'LT_0451', frame('Mara in the grass, the wind in it.', 'ms', '85mm', ['Mara'])],
          [
            '3C',
            'LT_0526',
            frame('The old pier posts in the fog.', 'ws', '35mm', [], {
              notes: 'Pick-up at the shore when the fog came in.',
            }),
          ],
          ['3D', 'LT_0468', frame('Mara turns back to the sea.', 'fs', '50mm', ['Mara'])],
          [
            '3E',
            'LT_0472',
            frame('The fog over the dunes, two figures in it.', 'ews', '24mm', ['Mara', 'Ivo']),
          ],
        ],
      ),
    ];
    const list = (
      y: number,
      title: string,
      kind: 'wardrobe' | 'props' | 'equipment',
      scene: number,
      items: string[],
    ) =>
      createElement(
        story,
        'todo',
        { x: 940, y },
        {
          title,
          list: kind,
          sceneId: scenes[scene - 1],
          items: items.map((text, i) => ({
            id: `tide${scene}${kind}`.padEnd(12, 'x') + i,
            text,
            done: true,
          })),
        },
        by,
      );
    looks.push(...scenes);
    list(0, 'Look 1', 'wardrobe', 1, ['Red wool coat (Studio Maree)', 'Red scarf', 'Black boots']);
    list(200, 'Look 2', 'wardrobe', 2, ['Cream knit', 'Wide trousers', 'Ivo: slate shirt']);
    list(400, 'Look 3', 'wardrobe', 3, ['Pale linen dress', 'Ivo: slate shirt, sleeves rolled']);
    list(580, 'On the beach', 'equipment', 2, ['Silver reflector', 'Wellies', 'Towels']);

    // The set-up of look 2 on the beach, under its scene: the low-water line, the sun at
    // sunrise behind the models, the reflector, the camera on 2A and the battery light.
    const dawnLook = readElement(roots(story).elements.get(scenes[1] as string)!)!;
    createElement(
      story,
      'plan',
      { x: dawnLook.x, y: dawnLook.y + (dawnLook.h ?? 0) + 40 },
      {
        w: 720,
        title: 'Look 2 on the wet sand',
        sceneIds: [scenes[1] as string],
        north: 0,
        sun: { time: 7 * 60 + 5 },
        circuits: [{ id: planItemId('circuitPack'), name: 'Battery pack', amps: 10 }],
        icons: checked(PlanIcon, [
          { ...planIcon('Sea', 'water', '#3E4E5E', 500, 80), w: 1000, h: 160, locked: true },
          {
            ...planIcon('LowWater', 'mark', '#8FA9A3', 500, 200),
            label: 'Low water, 7:42',
            locked: true,
          },
          {
            ...planIcon('Mara', 'actor', '#B897F0', 430, 300),
            rotation: 90,
            label: 'Mara',
            steps: [{ x: gx(200), y: gy(410), note: 'Walks out from the rocks' }],
            stepNote: 'Stops at the water line',
          },
          { ...planIcon('Ivo', 'actor', '#5FC2B5', 640, 250), rotation: 90, label: 'Ivo' },
          {
            ...planIcon('Sun', 'sun', '#F2C76E', 900, 120),
            rotation: 160,
            note: 'Sunrise 7:05, behind them',
          },
          {
            ...planIcon('Reflector', 'reflector', '#D9DCD6', 420, 400),
            rotation: 300,
            label: 'Silver reflector',
          },
          {
            ...planIcon('Fill', 'led', '#F2C76E', 600, 420),
            rotation: 270,
            label: 'LED fill',
            watts: 150,
            role: 'fill',
            circuit: planItemId('circuitPack'),
          },
          {
            ...planIcon('Cam', 'camera', '#9DB8F2', 520, 560),
            rotation: 270,
            label: 'Lia, 24mm',
            frameId: shot['2A'],
            support: 'handheld',
          },
          { ...planIcon('Rocks', 'mark', '#B49A7A', 180, 420), label: 'Rock pools' },
          { ...planIcon('Pietro', 'crew', '#8E8E93', 700, 600), label: 'Pietro' },
        ]),
      },
      by,
    );
  });
  await pushBoardDoc(base, cookie, shotList.id, story);

  // The Troupe, Lia's: the team, the models in Cast and the client.
  const crew = await api<{ items: Array<{ id: string; name: string }> }>(
    base,
    cookie,
    `/projects/${project.id}/crew/bulk`,
    {
      items: TROUPE.map(([name, role, department, phone, email, who, pickup], position) => ({
        name,
        role,
        department,
        phone: `+39 555 010 ${phone}`,
        email,
        pickup,
        notes: '',
        userId: who === 'lia' ? lia.id : who === 'nora' ? nora.id : null,
        character: null,
        onSetContact: who === 'lia',
        position,
      })),
    },
  );
  const crewId = (name: string) => crew.items.find((r) => r.name === name)?.id as string;

  // The day of the shoot, two days ago, on the Production board: a scene block for each look,
  // planned as a whole, and the pick-ups as a frame of look 3.
  const block = (
    type: string,
    title: string,
    duration: number,
    more: {
      start?: string;
      look?: number;
      shot?: string;
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
    ...(more.shot ? { shotBoardId: shotList.id, shotLabel: more.shot } : {}),
    ...(more.look
      ? {
          sceneId: looks[more.look - 1] as string,
          sceneBoardId: shotList.id,
          sceneLabel: String(more.look),
        }
      : {}),
    cast: more.cast ?? [],
    departments: more.departments ?? [],
    ...(more.notes ? { notes: more.notes } : {}),
  });
  await api(base, cookie, `/boards/${production.id}/schedule`, {
    date: localDate(-2),
    callTime: '06:00',
    wrap: '12:30',
    location: 'Punta Grigia',
    notes: 'Sunrise 7:05, low water 7:42. Hair and make-up in the van at the beach car park.',
    calls: [
      { crewMemberId: crewId('Nora Conti'), call: '05:45', pickup: null },
      { crewMemberId: crewId('Mara'), call: '06:30', pickup: 'Hotel in Punta Grigia, 6:15' },
      { crewMemberId: crewId('Ivo'), call: '07:15', pickup: null },
      { crewMemberId: crewId('Irene Galli'), call: null, pickup: null, absent: true },
    ],
    blocks: [
      block('setup', 'Van, wardrobe rail, reflector', 30, { start: '06:00' }),
      block('setup', 'Hair and make-up', 45, {
        start: '06:30',
        cast: ['Mara'],
        departments: ['Wardrobe: the coat stays dry'],
      }),
      block('scene', 'Look 1 on the sea wall', 45, {
        look: 1,
        cast: ['Mara'],
        notes: "The coat is Studio Maree's only sample: no salt water on it.",
      }),
      block('scene', 'Look 2 on the wet sand', 60, {
        look: 2,
        cast: ['Mara', 'Ivo'],
        departments: ['Low water at 7:42'],
        notes: 'The sand mirrors best just after low water: be there at 7:40.',
      }),
      block('break', 'Coffee and change', 30),
      block('move', 'Walk to the dunes', 15),
      block('scene', 'Look 3 in the dunes', 75, { look: 3, cast: ['Mara', 'Ivo'] }),
      block('shot', 'Pick-ups at the shore', 45, {
        shot: '3C',
        cast: ['Ivo'],
        notes: 'When the fog comes in: the pier posts, the rock pools, a portrait.',
      }),
    ],
  });

  // The selects: Lia's note and the 24 pictures, six to a row, in the order they were shot.
  const sel = new Y.Doc();
  initBoardDoc(sel, selects.id);
  const frames: Record<string, string> = {};
  sel.transact(() => {
    note(
      sel,
      { x: 0, y: 0 },
      [
        'Selects',
        'Twenty-four frames from the three looks for Studio Maree, with photo proofing on: they pick, reject and star them.',
        'Retouch only the picks.',
      ],
      560,
      by,
    );
    TIDE_NAMES.forEach((name, i) => {
      frames[name] = createElement(
        sel,
        'image',
        { x: (i % 6) * 300, y: 220 + Math.floor(i / 6) * 210 },
        { assetId: pic(name), w: 280 },
        by,
      ).id;
    });
  });
  await pushBoardDoc(base, cookie, selects.id, sel);

  // The team: Nora's worry about the only sample of the coat, Lia's answer, a reaction.
  const thread = await api<{ id: string }>(
    base,
    nora.cookie,
    `/boards/${project.rootBoardId}/comments`,
    {
      elementId: moodIds.brief,
      body: 'The coat is the only sample Studio Maree has: no salt water on it, please.',
    },
  );
  await api(base, cookie, `/boards/${project.rootBoardId}/comments`, {
    parentId: thread.id,
    body: 'Noted. Look 1 stays on the wall, and the towels are in the van.',
  });
  await request(
    base,
    nora.cookie,
    'PUT',
    `/boards/${project.rootBoardId}/elements/${moodIds.seawall}/reactions/${encodeURIComponent('❤️')}`,
  );
  await api(base, cookie, `/boards/${shotList.id}/versions`, { name: 'Sent to Studio Maree' });

  // The client: the selects with photo proofing, a password and an end date, previews only.
  const link = await api<{ id: string; url: string }>(
    base,
    cookie,
    `/boards/${selects.id}/share-links`,
    {
      role: 'guest_comment',
      label: client.link,
      password: client.password,
      expiresInDays: 14,
      allowDownload: false,
      proofing: true,
    },
  );
  const session = await fetch(`${base}/api/v1/guest/links/${link.id}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({
      token: new URL(link.url).pathname.split('/').pop(),
      name: client.name,
      password: client.password,
    }),
  });
  if (!session.ok) throw new Error(`guest session: ${session.status} ${await session.text()}`);
  const guest = session.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  for (const [name, [pick, stars]] of Object.entries(proofing))
    await request(
      base,
      guest,
      'PUT',
      `/guest/links/${link.id}/boards/${selects.id}/elements/${frames[name]}/pick`,
      { pick, stars },
    );
  await api(base, guest, `/guest/links/${link.id}/boards/${selects.id}/comments`, {
    elementId: frames.LT_0412,
    body: 'This is the cover. Can the retouch keep the coat exactly this red?',
  });

  return { cookie, project, shotList, selects, proofingUrl: link.url };
}
