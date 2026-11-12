// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, type PlanIcon, type PlanIconKind, STROKE_GRID } from '@inkadra/doc-schema';
import type * as Y from 'yjs';
import { createElement, listElements, updateElement } from './board.ts';
import { addFrame, addShape } from './film.ts';
import {
  addPlanIcon,
  addVariant,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  updatePlanItems,
} from './plan.ts';
import { attachIcon } from './plan-attach.ts';
import { roomWalls } from './plan-start.ts';
import { addPlanCircuit, addPlanOpening, addPlanWall, updatePlanWalls } from './plan-walls.ts';

/**
 * For tests and benchmarks of the set plan's sheet (decision 0111): a board made with the
 * document's own functions, so it stays valid when the schema moves. Every card gets a fixed
 * `createdAt`, so what follows creation order (the characters' colours, the setups' order) does
 * not depend on the random ids.
 */
export interface PlanSheetFixture {
  doc: Y.Doc;
  /** The base plan, then its two setups: the sheet's three pages. */
  planIds: [string, string, string];
  /** The background picture's asset id, which a test provides the bytes of. */
  backgroundId: string;
  /** Text only the team may read: the name of the character hidden from guests. */
  hiddenName: string;
  /** Notes in accented Latin, Polish and Cyrillic, as the sheet prints them. */
  notes: { accented: string; polish: string; cyrillic: string };
}

const opts = { userId: null };
const BOARD_ID = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const BACKGROUND = 'asset-fixture-floor-plan';

/** A point of the drawing in view units, as an icon's coordinates. */
const at = (x: number, y: number) => ({
  x: Math.round((x / PLAN_VIEW_W) * STROKE_GRID),
  y: Math.round((y / PLAN_VIEW_H) * STROKE_GRID),
});

function stamper(doc: Y.Doc) {
  let n = 0;
  return <T extends { id: string }>(el: T): T => {
    n += 1;
    updateElement(doc, el.id, { createdAt: 1_760_000_000_000 + n * 1000 });
    return el;
  };
}

function planOf(doc: Y.Doc, id: string): PlanElement {
  const plan = listElements(doc).find((el) => el.id === id);
  if (plan?.type !== 'plan') throw new Error(`No plan ${id}`);
  return plan;
}

function addIcon(doc: Y.Doc, planId: string, icon: Omit<PlanIcon, 'id'>): string {
  const id = addPlanIcon(doc, planId, icon);
  if (!id) throw new Error(`Plan ${planId} is full`);
  return id;
}

/** Attaches `itemId` to `baseId` as the editor does; throws when the table of 0104 refuses it. */
function attach(doc: Y.Doc, planId: string, itemId: string, baseId: string) {
  const icons = planOf(doc, planId).icons ?? [];
  const writes = attachIcon(icons, itemId, baseId);
  if (!writes.length) throw new Error(`${itemId} cannot attach to ${baseId}`);
  updatePlanItems(doc, planId, writes);
}

function updateIcon(doc: Y.Doc, planId: string, label: string, patch: Partial<PlanIcon>) {
  const icon = planOf(doc, planId).icons?.find((i) => i.label === label);
  if (!icon) throw new Error(`No icon ${label} on ${planId}`);
  updatePlanItems(doc, planId, [{ ...icon, ...patch }]);
}

/**
 * The mockup's scene: a 7 × 5 m diner (walls, two windows, a door), its counter, stools and
 * booth; three people, one seated and one walking a path of two positions; A cam on a dolly on
 * a track, moving between two positions, shooting a storyboard frame; B cam; a key light with a
 * softbox and a grid on a C-stand, gelled; a 2K outside a window; a tube; three practicals; a
 * flag; a floor plan under it all; two circuits; a scale; three setups. The characters and frames
 * the icons link to are cards of the board, one character hidden from guests.
 */
export function planSheetFixture(): PlanSheetFixture {
  return build(0);
}

/**
 * For benchmarks: the same board with the base filled to `count` icons (MAX_PLAN_ICONS is 300)
 * of mixed kinds (lights with beams, cameras with cones, people, furniture, grip), before its two
 * setups copy its cameras, lights and people.
 */
export function bigPlanFixture(count = 300): PlanSheetFixture {
  return build(count);
}

/**
 * The sheet fixture with what its goldens did not cover (the server's PDF, step 2, slice 0):
 * the background placed, at 0.6 and in greys; locked icons and a locked wall; a text of three
 * lines; a piece of furniture wider than deep, turned 30°. Built on top of the same board, so
 * `planSheetFixture()` and its goldens stay as they are.
 */
export function planSheetFixtureFull(): PlanSheetFixture {
  const fixture = build(0);
  const { doc } = fixture;
  const planId = fixture.planIds[0];
  // A placed box, not the whole drawing, wider than the picture's 3:2, in greys.
  updateElement(doc, planId, {
    background: { assetId: BACKGROUND, opacity: 0.6, grey: true, x: 120, y: 90, w: 720, h: 400 },
  });
  addIcon(doc, planId, {
    kind: 'table',
    color: '#EDD963',
    ...at(680, 470),
    w: 140,
    h: 60,
    rotation: 30,
    label: 'Carrello',
  });
  updateIcon(doc, planId, 'Bancone', { locked: true });
  updateIcon(doc, planId, 'Booth', { locked: true });
  const walls = planOf(doc, planId).walls ?? [];
  updatePlanWalls(
    doc,
    planId,
    'walls',
    walls.map((w) => ({ ...w, locked: true })),
  );
  addShape(doc, planId, {
    kind: 'text',
    color: '#1C1C1E',
    width: 18,
    x0: 1300,
    y0: 3500,
    x1: 2300,
    y1: 3900,
    text: 'Uscita di sicurezza\nlasciare libera\nsempre',
  });
  return fixture;
}

const BIG_KINDS: readonly PlanIconKind[] = [
  'fresnel',
  'led',
  'camera',
  'actor',
  'chair',
  'table',
  'practical',
  'flag',
  'cstand',
  'monitor',
  'tube',
  'extra',
];

function build(fill: number): PlanSheetFixture {
  const doc = createBoardDoc(BOARD_ID);
  const stamp = stamper(doc);
  const scene = stamp(
    createElement(
      doc,
      'scene',
      { x: 60, y: 900 },
      { number: '2', title: 'Rosa', location: 'Tavola calda', setting: 'int', time: 'night' },
      opts,
    ),
  );
  const master = stamp(addFrame(doc, scene.id, null, { action: 'Master', lens: '32mm' }, opts));
  const reverse = stamp(
    addFrame(doc, scene.id, null, { action: 'Controcampo', lens: '50mm' }, opts),
  );
  const insert = stamp(addFrame(doc, scene.id, null, { action: 'Tazza', lens: '85mm' }, opts));
  const leo = stamp(createElement(doc, 'character', { x: 700, y: 60 }, { name: 'Leo' }, opts));
  const hiddenName = 'Vittoria Segreta';
  const vittoria = stamp(
    createElement(
      doc,
      'character',
      { x: 700, y: 300 },
      { name: hiddenName, guestHidden: true },
      opts,
    ),
  );
  const location = stamp(
    createElement(
      doc,
      'location',
      { x: 1000, y: 60 },
      { name: 'Tavola calda Rosa', address: 'Via dei Mille 12, Torino' },
      opts,
    ),
  );

  const scale = 88;
  const base = stamp(
    createElement(
      doc,
      'plan',
      { x: 60, y: 60 },
      {
        w: 480,
        title: 'Bancone',
        sceneIds: [scene.id],
        locationId: location.id,
        scale,
        grid: '0.5',
        background: { assetId: BACKGROUND, opacity: 0.4 },
      },
      opts,
    ),
  );
  const planId = base.id;
  // The room: 7 × 5 m in the middle of the drawing, from (192, 113) to (808, 553).
  for (const wall of roomWalls('rect', 7, 5, scale)) addPlanWall(doc, planId, wall);
  const wallId = planOf(doc, planId).walls?.[0]?.id as string;
  addPlanOpening(doc, planId, { wall: wallId, kind: 'window', at: 150, width: 120 });
  addPlanOpening(doc, planId, { wall: wallId, kind: 'window', at: 430, width: 120 });
  addPlanOpening(doc, planId, { wall: wallId, kind: 'door', at: 1900, width: 80, side: 'right' });
  const circuitA = addPlanCircuit(doc, planId, { name: 'A', amps: 16 }) as string;
  const circuitB = addPlanCircuit(doc, planId, { name: 'B', amps: 10 }) as string;

  const icon = (
    kind: PlanIconKind,
    x: number,
    y: number,
    extra: Partial<Omit<PlanIcon, 'id' | 'kind' | 'x' | 'y'>> = {},
  ) => addIcon(doc, planId, { kind, color: '#9DB8F2', ...at(x, y), ...extra });

  // The Set: furniture.
  icon('counter', 500, 200, { label: 'Bancone', w: 260, h: 50 });
  const stool1 = icon('stool', 420, 260);
  icon('stool', 500, 260);
  icon('stool', 580, 260);
  icon('table', 300, 460, { label: 'Booth', w: 110, h: 70 });

  const accented = 'Più calda, già filtrata: è lì';
  const polish = 'Przez okno, łagodne światło';
  const cyrillic = 'Свет из окна, мягкий';

  // People.
  const marta = icon('actor', 420, 260, { label: 'Marta', pose: 'seated' });
  attach(doc, planId, marta, stool1);
  icon('actor', 640, 420, {
    label: 'vecchio',
    characterId: leo.id,
    rotation: 180,
    steps: [{ x: at(720, 500).x, y: at(720, 500).y, note: 'Entra dalla porta' }],
  });
  icon('actor', 300, 400, { characterId: vittoria.id, rotation: 90 });

  // Camera: A on a dolly on a track, two positions; B on its own.
  const track = icon('track', 500, 500, { w: 200 });
  const dolly = icon('dolly', 460, 500, {
    steps: [{ x: at(540, 500).x, y: at(540, 500).y }],
    dashed: true,
  });
  attach(doc, planId, dolly, track);
  const aCam = icon('camera', 460, 500, {
    label: 'A cam',
    rotation: 270,
    lens: 32,
    showLens: true,
    frameId: master.id,
  });
  attach(doc, planId, aCam, dolly);
  icon('camera', 700, 300, { label: 'B cam', rotation: 200, lens: 50, frameId: reverse.id });

  // Lights.
  const stand = icon('cstand', 260, 180);
  const key = icon('fresnel', 260, 180, {
    label: 'Key',
    rotation: 30,
    watts: 1000,
    kelvin: 3200,
    gel: 'CTO ½',
    role: 'key',
    circuit: circuitA,
    note: accented,
  });
  attach(doc, planId, key, stand);
  const softbox = icon('softbox', 270, 190);
  attach(doc, planId, softbox, key);
  const grid = icon('grid', 270, 190);
  attach(doc, planId, grid, key);
  icon('fresnel', 300, 60, {
    label: '2K',
    rotation: 90,
    watts: 2000,
    kelvin: 5600,
    circuit: circuitA,
    note: polish,
  });
  icon('tube', 760, 160, {
    label: 'Tubo',
    rotation: 180,
    watts: 50,
    circuit: circuitB,
    note: cyrillic,
  });
  for (const x of [400, 500, 600])
    icon('practical', x, 150, { label: 'Pratica', watts: 60, circuit: circuitB });
  icon('flag', 340, 230, { label: 'Bandiera 4×4', rotation: 45 });

  const placed = planOf(doc, planId).icons?.length ?? 0;
  for (let n = 0; n < fill - placed; n++) {
    const kind = BIG_KINDS[n % BIG_KINDS.length] as PlanIconKind;
    icon(kind, 210 + ((n * 37) % 580), 125 + ((n * 53) % 420), {
      rotation: (n * 30) % 360,
      label: `${kind} ${n + 1}`,
      ...(kind === 'fresnel' || kind === 'led' || kind === 'tube'
        ? { watts: 300, circuit: circuitB }
        : {}),
      ...(n % 10 === 0 ? { note: `Note ${n + 1}` } : {}),
    });
  }

  // Setups 2 and 3: the base's cameras, lights and people, then their own changes.
  const second = stamp({ id: addVariant(doc, planOf(doc, planId), 'Controcampo', opts) });
  updateIcon(doc, second.id, 'A cam', { frameId: reverse.id, rotation: 90, lens: 50 });
  const third = stamp({ id: addVariant(doc, planOf(doc, planId), 'Dettaglio', opts) });
  updateIcon(doc, third.id, 'B cam', { frameId: insert.id, lens: 85 });

  return {
    doc,
    planIds: [planId, second.id, third.id],
    backgroundId: BACKGROUND,
    hiddenName,
    notes: { accented, polish, cyrillic },
  };
}
