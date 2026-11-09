import { randomUUID } from 'node:crypto';
import { addFrame, addScene, createElement, moveIntoParent } from '@inkadra/canvas-core';
import { initBoardDoc } from '@inkadra/doc-schema';
import type { Browser } from '@playwright/test';
import * as Y from 'yjs';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from '../tests/perf/seed.ts';
import {
  account,
  api,
  joinTeam,
  localDate,
  note,
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
  });
  const lia = await joinTeam(base, admin, project.id, photographer);
  const nora = await joinTeam(base, admin, project.id, stylist);
  const cookie = lia.cookie;
  const by = { userId: lia.id };

  const board = (title: string, kind: 'board' | 'storyboard' = 'board') =>
    api<{ id: string }>(base, cookie, `/projects/${project.id}/boards`, {
      parentBoardId: project.rootBoardId,
      kind,
      title,
    });
  const shotList = await board('Shot list', 'storyboard');
  const selects = await board('Selects');

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
    const scenes = [
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
    list(0, 'Look 1', 'wardrobe', 1, ['Red wool coat (Studio Maree)', 'Red scarf', 'Black boots']);
    list(200, 'Look 2', 'wardrobe', 2, ['Cream knit', 'Wide trousers', 'Ivo: slate shirt']);
    list(400, 'Look 3', 'wardrobe', 3, ['Pale linen dress', 'Ivo: slate shirt, sleeves rolled']);
    list(580, 'On the beach', 'equipment', 2, ['Silver reflector', 'Wellies', 'Towels']);
  });
  await pushBoardDoc(base, cookie, shotList.id, story);

  // The day of the shoot, two days ago: call sheet and order of the day.
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
  await api(base, cookie, `/boards/${shotList.id}/schedule`, {
    date: localDate(-2),
    callTime: '06:00',
    wrap: '12:30',
    location: 'Punta Grigia',
    notes: 'Sunrise 7:05, low water 7:42. Hair and make-up in the van at the beach car park.',
    blocks: [
      block('setup', 'Van, wardrobe rail, reflector', 30, { start: '06:00' }),
      block('setup', 'Hair and make-up', 45, {
        start: '06:30',
        cast: ['Mara'],
        departments: ['Wardrobe: the coat stays dry'],
      }),
      block('shot', 'Look 1 on the sea wall', 45, { shot: '1A', cast: ['Mara'] }),
      block('shot', 'Look 2 on the wet sand', 60, {
        shot: '2A',
        cast: ['Mara', 'Ivo'],
        departments: ['Low water at 7:42'],
      }),
      block('break', 'Coffee and change', 30),
      block('move', 'Walk to the dunes', 15),
      block('shot', 'Look 3 in the dunes', 75, { shot: '3A', cast: ['Mara', 'Ivo'] }),
      block('shot', 'Pick-ups at the shore', 45, { shot: '3C', cast: ['Ivo'] }),
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
