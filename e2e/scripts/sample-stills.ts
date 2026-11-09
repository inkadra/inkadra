/**
 * The pictures of the sample projects "Last Train" and "Low Tide" (docs/demo-project.md), drawn
 * as SVG and rendered to JPEG in the browser, so the screenshots carry no third-party images or
 * fonts.
 *
 * Every still is built from the same layers: a graded sky, far, middle and near planes, glows
 * and haze blended with `screen`, wet reflections, then vignette, grade and grain. All of it is
 * deterministic: fixed seeds for the scattered details and for the grain.
 */

type Stop = [offset: number, color: string, opacity?: number];

const f = (n: number) => String(Math.round(n * 100) / 100);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The same scattered details on every run. */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function stopsOf(stops: Stop[]) {
  return stops
    .map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a ?? 1}"/>`)
    .join('');
}

/** Collects the gradients and clip paths of one picture while its layers are written. */
class Canvas {
  readonly w: number;
  readonly h: number;
  readonly defs: string[] = [];
  private n = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
  }

  id(prefix: string) {
    this.n += 1;
    return `${prefix}${this.n}`;
  }

  linear(stops: Stop[], [x1, y1, x2, y2] = [0, 0, 0, 1]) {
    const id = this.id('l');
    this.defs.push(
      `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stopsOf(stops)}</linearGradient>`,
    );
    return `url(#${id})`;
  }

  radial(stops: Stop[]) {
    const id = this.id('r');
    this.defs.push(`<radialGradient id="${id}">${stopsOf(stops)}</radialGradient>`);
    return `url(#${id})`;
  }

  /** A soft light: a bright core fading out, blended over what is behind it. */
  glow(x: number, y: number, r: number, color: string, strength = 1) {
    const fill = this.radial([
      [0, color, strength],
      [0.12, color, 0.8 * strength],
      [0.35, color, 0.32 * strength],
      [0.7, color, 0.08 * strength],
      [1, color, 0],
    ]);
    return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${fill}" style="mix-blend-mode:screen"/>`;
  }

  /**
   * A shape lit from behind: the shape in the light colour, then the shape again in its own
   * colour, moved away from the light, so a thin edge stays lit on one side. `light` is the
   * offset of that edge: positive lights the right side. `inner` is drawn on the shape, clipped.
   */
  rimmed(parts: string[], fill: string, rim: string, light: number, transform: string, inner = '') {
    const clip = this.id('c');
    const paths = (color: string) => parts.map((d) => `<path d="${d}" fill="${color}"/>`).join('');
    return `<g transform="${transform}" filter="url(#soft)">
      <clipPath id="${clip}">${parts.map((d) => `<path d="${d}"/>`).join('')}</clipPath>
      ${paths(rim)}
      <g clip-path="url(#${clip})"><g transform="translate(${-light} ${Math.abs(light) * 0.3})">${paths(fill)}${inner}</g></g>
    </g>`;
  }
}

// People, in a box 100 units high with the feet at y = 100 and the middle at x = 0.
const HEAD = 'M-5.2 8.6a5.2 6.3 0 1 0 10.4 0a5.2 6.3 0 1 0-10.4 0Z';
const NECK = 'M-2.2 13.5h4.4v5h-4.4Z';
const COAT =
  'M-10.5 21Q-10.5 17.2-6 16.6L6 16.6Q10.5 17.2 10.5 21L11.8 44L13.4 69L-13.4 69L-11.8 44Z';
const ARM_L = 'M-10.5 21Q-14 31-13.4 53L-10.8 53.6Q-10.8 36-8.6 26Z';
const ARM_R = 'M10.5 21Q14 31 13.4 53L10.8 53.6Q10.8 36 8.6 26Z';
const SWING_L = 'M-10.5 21Q-15.5 31-17 46L-14.4 47.2Q-12.4 34-8.6 26Z';
const SWING_R = 'M10.5 21Q14.4 31 17.6 44L15 46Q11.2 34 8.6 26Z';
const LEG_L = 'M-6.6 68L-5.9 97.6L-1.5 97.6L-0.9 68Z';
const LEG_R = 'M0.9 68L1.5 97.6L5.9 97.6L6.6 68Z';
const SHOE_L = 'M-6.4 96.6h5.4v3.4h-7.6q0.4-2.2 2.2-3.4Z';
const SHOE_R = 'M1 96.6h5.4q1.8 1.2 2.2 3.4h-7.6Z';
const WALK_L = 'M-5 67L-12.6 98.6L-8.4 100L-0.6 69Z';
const WALK_R = 'M1 67L8.2 99.4L12.4 98.4L6.4 66.4Z';
const BUN = 'M1.5 3.4a3.3 3.3 0 1 0 6.6 0a3.3 3.3 0 1 0-6.6 0Z';
const CAP = 'M-5.8 6Q-5.4 0.4 0 0.4Q5.4 0.4 5.8 6L9.6 7.2L-5.8 7.4Z';
const SCARF = 'M-6.2 15.6Q0 19.4 6.2 15.6L6.6 19.4Q0 23-6.6 19.4Z';
const SCARF_TAIL = 'M1.6 19.6L4.4 31L1.2 31.4L0.2 20.4Z';

interface Person {
  x: number;
  /** Where the feet are. */
  y: number;
  h: number;
  fill: string;
  rim?: string;
  /** Rim light: positive lights the right edge. */
  light?: number;
  walk?: boolean;
  bun?: boolean;
  cap?: boolean;
  scarf?: string;
  /** Wider shoulders. */
  broad?: boolean;
}

function personParts(p: Person) {
  return [
    HEAD,
    NECK,
    COAT,
    ...(p.walk ? [SWING_L, SWING_R, WALK_L, WALK_R] : [ARM_L, ARM_R, LEG_L, LEG_R, SHOE_L, SHOE_R]),
    ...(p.bun ? [BUN] : []),
    ...(p.cap ? [CAP] : []),
  ];
}

function person(c: Canvas, p: Person) {
  const s = p.h / 100;
  const transform = `translate(${f(p.x)} ${f(p.y - p.h)}) scale(${f(s * (p.broad ? 1.16 : 1))} ${f(s)})`;
  const scarf = p.scarf
    ? `<path d="${SCARF}" fill="${p.scarf}"/><path d="${SCARF_TAIL}" fill="${p.scarf}"/>`
    : '';
  if (!p.rim)
    return `<g transform="${transform}" fill="${p.fill}">${personParts(p)
      .map((d) => `<path d="${d}"/>`)
      .join('')}</g>`;
  return c.rimmed(personParts(p), p.fill, p.rim, p.light ?? 1.2, transform, scarf);
}

/** The reflection of a person on wet ground: upside down, rippled, faint. */
function reflection(c: Canvas, p: Person, opacity = 0.35) {
  return `<g filter="url(#ripple)" opacity="${opacity}" transform="translate(0 ${2 * p.y}) scale(1 -1)">${person(c, { ...p, rim: undefined, fill: '#000' })}</g>`;
}

/** Someone on a stool, seen from behind: for the counter of the diner. */
function seated(
  c: Canvas,
  o: {
    x: number;
    y: number;
    h: number;
    fill: string;
    rim: string;
    cap?: boolean;
    bun?: boolean;
    scarf?: string;
  },
) {
  const parts = [
    HEAD,
    NECK,
    'M-11.5 21Q-11.5 17-6 16.4L6 16.4Q11.5 17 11.5 21L10.8 54L12.6 62L-12.6 62L-10.8 54Z',
    'M-10 60L-10.6 86L-6.6 86L-5 62Z',
    'M5 62L6.6 86L10.6 86L10 60Z',
    'M-13 61.4a13 3.2 0 1 0 26 0a13 3.2 0 1 0-26 0Z',
    'M-1.4 63h2.8v37h-2.8Z',
    ...(o.cap ? [CAP] : []),
    ...(o.bun ? [BUN] : []),
  ];
  const s = o.h / 100;
  const scarf = o.scarf ? `<path d="${SCARF}" fill="${o.scarf}"/>` : '';
  return c.rimmed(
    parts,
    o.fill,
    o.rim,
    1.3,
    `translate(${f(o.x)} ${f(o.y - o.h)}) scale(${f(s)})`,
    scarf,
  );
}

// Head and shoulders in profile, facing right, in a 1000 × 1000 box.
const PROFILE =
  'M470 180C560 150 640 190 660 262C668 300 672 330 680 350L676 362C690 390 705 410 714 432L690 442C694 452 700 458 696 466L690 471C696 479 694 489 686 495C684 512 690 530 670 548C650 560 625 566 600 568C600 600 605 640 614 680C700 720 800 762 862 822L905 1000L195 1000L232 822C300 760 400 722 432 690C420 642 402 602 396 560C362 520 350 440 370 330C390 250 420 200 470 180Z';
const PROFILE_BUN = 'M318 262a66 66 0 1 0 132 0a66 66 0 1 0-132 0Z';
const PROFILE_CAP =
  'M360 318C362 196 452 142 548 146C632 150 676 206 682 300L800 318L798 336L360 340Z';
const PROFILE_CURLS = [
  'M352 268a62 62 0 1 0 124 0a62 62 0 1 0-124 0Z',
  'M430 196a66 66 0 1 0 132 0a66 66 0 1 0-132 0Z',
  'M520 200a56 56 0 1 0 112 0a56 56 0 1 0-112 0Z',
  'M330 380a58 58 0 1 0 116 0a58 58 0 1 0-116 0Z',
];

interface Finish {
  grade: string;
  gradeOpacity?: number;
  vignette?: number;
}

function wrap(c: Canvas, body: string, finish: Finish) {
  const { w, h } = c;
  const vignette = c.radial([
    [0.55, '#000', 0],
    [1, '#000', finish.vignette ?? 0.6],
  ]);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".6"/></filter>
    <filter id="b3" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
    <filter id="b10" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
    <filter id="b30" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="30"/></filter>
    <filter id="b70" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="70"/></filter>
    <filter id="streak" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4 26"/></filter>
    <filter id="motion" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="30 1.5"/></filter>
    <filter id="ripple" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="turbulence" baseFrequency="0.006 0.11" numOctaves="2" seed="3" result="t"/>
      <feDisplacementMap in="SourceGraphic" in2="t" scale="26" xChannelSelector="R" yChannelSelector="G"/>
      <feGaussianBlur stdDeviation="1.5 6"/>
    </filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="11" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
    ${c.defs.join('\n    ')}
  </defs>
  ${body}
  <rect width="${w}" height="${h}" fill="${vignette}"/>
  <rect width="${w}" height="${h}" fill="${finish.grade}" opacity="${finish.gradeOpacity ?? 0.3}" style="mix-blend-mode:soft-light"/>
  <rect width="${w}" height="${h}" filter="url(#grain)" opacity=".18" style="mix-blend-mode:overlay"/>
</svg>`;
}

/** A block of buildings with windows lit at random, for the far city. */
function skyline(
  c: Canvas,
  x0: number,
  x1: number,
  base: number,
  seed: number,
  fill: string,
  lit: string,
) {
  const r = random(seed);
  let out = '';
  let x = x0;
  while (x < x1) {
    const w = 40 + r() * 90;
    const h = 40 + r() * 170;
    out += `<rect x="${f(x)}" y="${f(base - h)}" width="${f(w)}" height="${f(h + 4)}" fill="${fill}"/>`;
    for (let wy = base - h + 10; wy < base - 8; wy += 12)
      for (let wx = x + 6; wx < x + w - 6; wx += 10)
        if (r() > 0.86)
          out += `<rect x="${f(wx)}" y="${f(wy)}" width="4" height="5" fill="${lit}" opacity="${f(0.35 + r() * 0.5)}"/>`;
    x += w + 2;
  }
  return out + c.glow((x0 + x1) / 2, base, (x1 - x0) / 2, '#E07A3F', 0.16);
}

/** Rain: thin slanted strokes at three depths. */
function rain(n: number, seed: number, w: number, h: number, color: string, dx = 0, dy = 0) {
  const r = random(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    const near = r();
    const x = dx + r() * w;
    const y = dy + r() * h;
    const len = 18 + near * 60;
    out += `<path d="M${f(x)} ${f(y)}l${f(-len * 0.22)} ${f(len)}" stroke-width="${f(0.6 + near * 2.2)}" opacity="${f(0.12 + near * 0.4)}"/>`;
  }
  return `<g stroke="${color}" stroke-linecap="round">${out}</g>`;
}

/** Steps into the distance, evenly spaced on the ground: how far along (t) and how big (s). */
function depths(n: number, start = 1, step = 1) {
  return Array.from({ length: n }, (_, i) => {
    const z = start + i * step;
    return { t: 1 - 1 / z, s: 1 / z };
  });
}

const W = 1600;
const H = 900;

/** Platform 4 at night: the canopy and its lamps into the distance, Anna alone, wet ground. */
function platform() {
  const c = new Canvas(W, H);
  const vp = { x: 1130, y: 452 };
  const wallTop = (t: number) => lerp(238, vp.y - 44, t);
  const wallBottom = (t: number) => lerp(660, vp.y + 2, t);
  let lamps = '';
  let beams = '';
  let pools = '';
  let shine = '';
  let columns = '';
  for (const { t, s } of depths(12, 1.05, 0.9)) {
    const x = lerp(150, vp.x, t);
    const y = lerp(250, vp.y - 6, t);
    const fy = lerp(900, vp.y + 4, t) - 120 * s;
    const fx = lerp(330, vp.x, t);
    lamps += `<rect x="${f(x - 26 * s)}" y="${f(y - 8 * s)}" width="${f(52 * s)}" height="${f(8 * s)}" fill="#0B0F13"/>`;
    lamps += c.glow(x, y + 2 * s, 170 * s, '#F2A65A', 0.9);
    lamps += `<ellipse cx="${f(x)}" cy="${f(y + 1)}" rx="${f(20 * s + 1)}" ry="${f(3.5 * s + 0.6)}" fill="#FFE7B8"/>`;
    beams += `<path d="M${f(x - 24 * s)} ${f(y)}L${f(x + 24 * s)} ${f(y)}L${f(fx + 150 * s)} ${f(fy)}L${f(fx - 150 * s)} ${f(fy)}Z" fill="#F2A65A" opacity="${f(0.06 + 0.06 * s)}"/>`;
    pools += `<ellipse cx="${f(fx)}" cy="${f(fy)}" rx="${f(240 * s)}" ry="${f(40 * s)}" fill="#E8964F" opacity=".35"/>`;
    shine += `<rect x="${f(fx - 8 * s)}" y="${f(fy - 10 * s)}" width="${f(16 * s + 2)}" height="${f(300 * s)}" fill="#F2B36A" opacity=".75"/>`;
    const cx = lerp(560, vp.x, t);
    const top = lerp(222, vp.y - 10, t);
    columns += `<rect x="${f(cx - 9 * s)}" y="${f(top)}" width="${f(18 * s)}" height="${f(lerp(880, vp.y + 6, t) - top - 150 * s)}" fill="#090C10"/>`;
  }
  // The waiting room: lit windows along the wall, in perspective.
  const windows = depths(6, 1.25, 1.15)
    .map(({ t }) => {
      const t2 = t + (1 - t) * 0.22;
      const pt = (tt: number, k: number) =>
        `${f(lerp(0, vp.x, tt))} ${f(lerp(wallTop(tt), wallBottom(tt), k))}`;
      const glass = c.linear([
        [0, '#FFD59A'],
        [1, '#C9773A'],
      ]);
      const mid = (t + t2) / 2;
      return `<path d="M${pt(t, 0.3)}L${pt(t2, 0.3)}L${pt(t2, 0.72)}L${pt(t, 0.72)}Z" fill="${glass}" opacity=".7"/><path d="M${pt(mid, 0.3)}L${pt(mid, 0.72)}M${pt(t, 0.5)}L${pt(t2, 0.5)}" stroke="#0C1116" stroke-width="${f(10 * (1 - t))}"/>${c.glow(lerp(0, vp.x, (t + t2) / 2), lerp(wallTop(t), wallBottom(t), 0.5), 220 * (1 - t), '#F2A65A', 0.45)}`;
    })
    .join('');
  const wires = depths(9, 1.2, 1.3)
    .map(({ t, s }) => {
      const x = lerp(1660, vp.x + 6, t);
      const top = lerp(120, vp.y - 40, t);
      return `<rect x="${f(x - 7 * s)}" y="${f(top)}" width="${f(14 * s)}" height="${f(lerp(780, vp.y + 6, t) - top)}" fill="#070A0E"/><path d="M${f(x - 90 * s)} ${f(top + 30 * s)}h${f(100 * s)}" stroke="#070A0E" stroke-width="${f(6 * s + 0.5)}"/>`;
    })
    .join('');
  const anna: Person = {
    x: 790,
    y: 668,
    h: 210,
    fill: '#07090C',
    rim: '#F6B26B',
    light: -1.4,
    bun: true,
    scarf: '#B4302A',
  };
  const body = `
  <rect width="${W}" height="${H}" fill="${c.linear([
    [0, '#03070D'],
    [0.42, '#0B1B2A'],
    [0.52, '#24323A'],
    [0.6, '#101B24'],
    [1, '#070B10'],
  ])}"/>
  ${skyline(c, 1000, 1600, 470, 4, '#0B1621', '#F2C76E')}
  ${c.glow(vp.x + 40, vp.y, 520, '#E07A3F', 0.3)}
  <path d="M1600 120L${vp.x} ${vp.y - 40}" stroke="#0B0F14" stroke-width="2"/>
  <path d="M1600 150L${vp.x} ${vp.y - 36}" stroke="#0B0F14" stroke-width="1.5"/>
  ${wires}
  <path d="M1110 900L${vp.x} ${vp.y}L1600 ${vp.y + 120}L1600 900Z" fill="#06080B"/>
  <g stroke-linecap="round">
    <path d="M1210 900L${vp.x + 2} ${vp.y + 2}" stroke="#C98A55" stroke-width="5" opacity=".55"/>
    <path d="M1400 900L${vp.x + 4} ${vp.y + 2}" stroke="#C98A55" stroke-width="6" opacity=".45"/>
    <path d="M1560 900L${vp.x + 8} ${vp.y + 3}" stroke="#7FA6C4" stroke-width="4" opacity=".25"/>
  </g>
  <path d="M0 0L560 0L${vp.x} ${vp.y - 60}L${vp.x} ${vp.y - 46}L0 214Z" fill="${c.linear([
    [0, '#06090D'],
    [1, '#141C24'],
  ])}"/>
  <path d="M0 200L${vp.x} ${vp.y - 50}L${vp.x} ${vp.y - 44}L0 238Z" fill="#1A222A"/>
  <path d="M0 238L${vp.x} ${vp.y - 44}" stroke="#F2A65A" stroke-width="2" opacity=".5"/>
  <path d="M0 238L${vp.x} ${vp.y - 44}L${vp.x} ${vp.y + 2}L0 660Z" fill="${c.linear(
    [
      [0, '#121A21'],
      [1, '#0A0F14'],
    ],
    [0, 0, 1, 0],
  )}"/>
  ${windows}
  <path d="M0 660L${vp.x} ${vp.y + 2}L1040 900L0 900Z" fill="${c.linear([
    [0, '#2A2420'],
    [0.25, '#14181C'],
    [1, '#06080A'],
  ])}"/>
  <path d="M960 900L${vp.x} ${vp.y + 3}L1080 900Z" fill="#C9A440" opacity=".5"/>
  <path d="M1040 900L${vp.x} ${vp.y + 3}L1112 900Z" fill="#05070A"/>
  <g filter="url(#b30)">${pools}</g>
  <g filter="url(#streak)" style="mix-blend-mode:screen">${shine}</g>
  ${reflection(c, anna)}
  ${columns}
  <g filter="url(#b30)" style="mix-blend-mode:screen">${beams}</g>
  ${lamps}
  <g transform="translate(470 300)">
    <path d="M0 -40v26" stroke="#0B0F13" stroke-width="4"/>
    ${c.glow(0, 0, 110, '#FFE7B8', 0.4)}
    <circle r="27" fill="#0B0F13"/><circle r="22" fill="#F4E6C8"/>
    <path d="M0 0V-15M0 0L11 5" stroke="#1A1A1A" stroke-width="3" stroke-linecap="round"/>
  </g>
  ${person(c, anna)}
  ${c.glow(1480, 420, 30, '#3DDC84', 0.9)}
  ${c.glow(1182, 446, 14, '#FF4040', 0.9)}
  <rect width="${W}" height="${H}" fill="${c.linear([
    [0, '#9FC3D6', 0],
    [0.48, '#9FC3D6', 0.1],
    [0.62, '#9FC3D6', 0],
  ])}" style="mix-blend-mode:screen"/>`;
  return wrap(c, body, { grade: '#1F6C80', gradeOpacity: 0.35 });
}

/** The last train going into the tunnel: red tail lights in the haze, rails catching them. */
function tunnel() {
  const c = new Canvas(W, H);
  const vp = { x: 800, y: 470 };
  const mouth = vp.y + 64;
  const rails = [-520, -150, 150, 520]
    .map((dx, i) => {
      const inner = i === 1 || i === 2;
      return `<path d="M${vp.x + dx * 2.4} 900L${vp.x + dx * 0.2} ${mouth}" stroke="${inner ? '#C4524B' : '#3A2224'}" stroke-width="${inner ? 6 : 4}" opacity="${inner ? 0.75 : 0.5}"/>`;
    })
    .join('');
  const sleepers = depths(16, 1, 0.5)
    .map(({ t, s }) => {
      const y = lerp(900, mouth, t);
      const half = lerp(560, 150, t);
      return `<rect x="${f(vp.x - half)}" y="${f(y - 10 * s)}" width="${f(half * 2)}" height="${f(16 * s + 1)}" fill="#160C0D"/>`;
    })
    .join('');
  const rings = depths(9, 1, 0.8)
    .map(({ t, s }) => {
      const r = lerp(820, 175, t);
      const base = lerp(900, mouth, t);
      return `<path d="M${f(vp.x - r)} ${f(base)}V${f(vp.y - r * 0.12)}A${f(r)} ${f(r * 0.9)} 0 0 1 ${f(vp.x + r)} ${f(vp.y - r * 0.12)}V${f(base)}" fill="none" stroke="#3A1E22" stroke-width="${f(16 * s + 1)}" opacity=".75"/>`;
    })
    .join('');
  const body = `
  <rect width="${W}" height="${H}" fill="${c.linear([
    [0, '#050407'],
    [0.6, '#0E0809'],
    [1, '#090607'],
  ])}"/>
  ${rings}
  <path d="M${vp.x - 175} ${mouth}V${vp.y - 20}A175 160 0 0 1 ${vp.x + 175} ${vp.y - 20}V${mouth}Z" fill="#020203"/>
  <rect x="${vp.x - 92}" y="${vp.y - 60}" width="184" height="124" rx="10" fill="#0B0708"/>
  <rect x="${vp.x - 70}" y="${vp.y - 40}" width="140" height="40" rx="4" fill="#281416"/>
  <g filter="url(#b70)" style="mix-blend-mode:screen" opacity=".6">
    <ellipse cx="${vp.x}" cy="${vp.y + 30}" rx="520" ry="210" fill="#B3262B"/>
  </g>
  ${c.glow(vp.x - 52, vp.y + 30, 240, '#FF2E2E', 0.85)}
  ${c.glow(vp.x + 52, vp.y + 30, 240, '#FF2E2E', 0.85)}
  <circle cx="${vp.x - 52}" cy="${vp.y + 30}" r="9" fill="#FFD6CF"/>
  <circle cx="${vp.x + 52}" cy="${vp.y + 30}" r="9" fill="#FFD6CF"/>
  <path d="M0 900L${vp.x - 175} ${mouth}L${vp.x + 175} ${mouth}L1600 900Z" fill="${c.linear([
    [0, '#1A0B0C'],
    [1, '#080506'],
  ])}"/>
  ${sleepers}
  ${rails}
  <g filter="url(#streak)" style="mix-blend-mode:screen" opacity=".85">
    <rect x="${vp.x - 64}" y="${mouth + 10}" width="24" height="360" fill="#FF4B42"/>
    <rect x="${vp.x + 40}" y="${mouth + 10}" width="24" height="360" fill="#FF4B42"/>
  </g>
  <rect x="244" y="380" width="12" height="440" fill="#070506"/>
  <rect x="232" y="350" width="36" height="56" rx="8" fill="#070506"/>
  ${c.glow(250, 366, 46, '#FF3B30', 1)}
  ${c.glow(1380, 300, 160, '#2D6F86', 0.3)}`;
  return wrap(c, body, { grade: '#7A2E2A', gradeOpacity: 0.25, vignette: 0.75 });
}

/** The forecourt in the rain: neon on the buildings, Anna running, everything doubled in the wet. */
function rainStill() {
  const c = new Canvas(W, H);
  const horizon = 520;
  const neon = [
    { x: 300, y: 250, w: 170, h: 34, color: '#FF4F7B' },
    { x: 1060, y: 300, w: 120, h: 26, color: '#56E0FF' },
    { x: 720, y: 180, w: 220, h: 30, color: '#F2A65A' },
  ];
  const blocks = [
    { x: 80, y: 120, w: 460 },
    { x: 600, y: 60, w: 420 },
    { x: 1040, y: 200, w: 480 },
  ];
  const r = random(5);
  let windows = '';
  for (const b of blocks)
    for (let y = b.y + 40; y < horizon - 40; y += 40)
      for (let x = b.x + 24; x < b.x + b.w - 30; x += 36)
        if (r() > 0.72)
          windows += `<rect x="${x}" y="${y}" width="12" height="16" fill="#F2C76E" opacity="${f(0.1 + r() * 0.3)}"/>`;
  const signs = neon
    .map(
      (n) =>
        `${c.glow(n.x + n.w / 2, n.y + n.h / 2, n.w * 1.3, n.color, 0.6)}<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.h / 2}" fill="none" stroke="${n.color}" stroke-width="5"/><rect x="${n.x + 14}" y="${n.y + n.h / 2 - 2}" width="${n.w - 28}" height="4" fill="${n.color}"/>`,
    )
    .join('');
  const reflections = neon
    .map(
      (n) =>
        `<rect x="${n.x + n.w * 0.3}" y="${horizon + (horizon - n.y) * 0.25}" width="${n.w * 0.4}" height="200" fill="${n.color}" opacity=".5"/>`,
    )
    .join('');
  const stripes = depths(7, 1, 0.6)
    .map(({ t, s }) => {
      const y = lerp(900, horizon + 20, t);
      return `<path d="M${f(800 - 760 * s)} ${f(y)}L${f(800 + 760 * s)} ${f(y)}L${f(800 + 730 * s)} ${f(y - 34 * s)}L${f(800 - 730 * s)} ${f(y - 34 * s)}Z" fill="#C9D6DE" opacity="${f(0.08 + 0.1 * s)}"/>`;
    })
    .join('');
  const anna: Person = {
    x: 860,
    y: 690,
    h: 230,
    fill: '#05080B',
    rim: '#FF7A9A',
    light: 1.5,
    walk: true,
    bun: true,
    scarf: '#B4302A',
  };
  const body = `
  <rect width="${W}" height="${H}" fill="${c.linear([
    [0, '#050C14'],
    [0.5, '#0F2536'],
    [1, '#09141D'],
  ])}"/>
  ${c.glow(800, 120, 700, '#2D6F86', 0.22)}
  ${blocks.map((b, i) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${horizon - b.y}" fill="${['#0B1620', '#0E1B26', '#0A141C'][i]}"/>`).join('')}
  ${windows}
  ${signs}
  <rect y="${horizon}" width="${W}" height="${H - horizon}" fill="${c.linear([
    [0, '#122634'],
    [1, '#04080C'],
  ])}"/>
  <g filter="url(#streak)" style="mix-blend-mode:screen"><g filter="url(#ripple)">${reflections}</g></g>
  ${stripes}
  ${c.glow(240, horizon - 10, 50, '#FF3B30', 0.9)}${c.glow(300, horizon - 10, 50, '#FF3B30', 0.9)}
  <g filter="url(#streak)" style="mix-blend-mode:screen" opacity=".6"><rect x="232" y="${horizon}" width="16" height="150" fill="#FF3B30"/><rect x="292" y="${horizon}" width="16" height="150" fill="#FF3B30"/></g>
  ${c.glow(1420, horizon - 6, 60, '#FFE2A8', 0.85)}
  ${reflection(c, anna, 0.45)}
  ${person(c, anna)}
  <g filter="url(#b3)">${rain(160, 7, W, H, '#BFE4F2')}</g>
  ${rain(220, 19, W, H, '#D7EEF7')}
  <rect width="${W}" height="${H}" fill="#7FB6CC" opacity=".05" style="mix-blend-mode:screen"/>`;
  return wrap(c, body, { grade: '#1B5E7A', gradeOpacity: 0.4 });
}

/** Over Anna's shoulder: the lit carriages pulling away, a blur of windows and lamps. */
function window_() {
  const c = new Canvas(W, H);
  const r = random(21);
  let carriages = '';
  for (let i = 0; i < 26; i++) {
    const x = 20 + i * 64;
    carriages += `<rect x="${x}" y="${312 + r() * 6}" width="${40 + r() * 10}" height="64" rx="6" fill="#F6D29A" opacity="${f(0.6 + r() * 0.35)}"/>`;
  }
  let lamps = '';
  for (let i = 0; i < 9; i++)
    lamps += c.glow(100 + i * 190, 120 + (i % 2) * 30, 70, '#F2A65A', 0.8);
  const t = 'translate(-60 150) scale(.92)';
  const scarf = `<path d="M560 640Q640 690 700 660L760 800Q640 850 520 800Z" fill="#9E2A25"/><path d="M600 720L640 720L620 820Z" fill="#7A1E1A"/>`;
  const body = `
  <rect width="${W}" height="${H}" fill="${c.linear([
    [0, '#05090E'],
    [0.5, '#0E1822'],
    [1, '#06090C'],
  ])}"/>
  <g filter="url(#b10)">${lamps}</g>
  <rect y="270" width="${W}" height="180" fill="#121A22"/>
  <rect y="290" width="${W}" height="10" fill="#B4302A" opacity=".6" filter="url(#motion)"/>
  <g filter="url(#motion)">${carriages}</g>
  <g filter="url(#b30)" style="mix-blend-mode:screen"><rect y="300" width="${W}" height="90" fill="#F2A65A" opacity=".3"/></g>
  ${c.glow(1460, 400, 130, '#FF2E2E', 0.9)}${c.glow(1540, 400, 130, '#FF2E2E', 0.9)}
  <rect y="450" width="${W}" height="450" fill="#07090B"/>
  <path d="M0 470H1600" stroke="#D9B44A" stroke-width="8" opacity=".4" filter="url(#b3)"/>
  <g filter="url(#streak)" opacity=".5" style="mix-blend-mode:screen"><rect x="200" y="470" width="1100" height="70" fill="#F2A65A"/></g>
  ${c.glow(800, 340, 900, '#F2A65A', 0.15)}
  <g filter="url(#b3)">${c.rimmed([PROFILE, PROFILE_BUN], '#040506', '#F6B26B', 12, t, scarf)}</g>`;
  return wrap(c, body, { grade: '#2A5E70', gradeOpacity: 0.35, vignette: 0.7 });
}

/** The doors closing: the last train at the platform, faces in the windows, Anna outside. */
function train() {
  const c = new Canvas(W, H);
  const r = random(33);
  let windows = '';
  for (let i = 0; i < 5; i++) {
    const x = 60 + i * 300;
    windows += `<rect x="${x - 6}" y="244" width="232" height="162" rx="20" fill="#14181C"/>`;
    windows += `<rect x="${x}" y="250" width="220" height="150" rx="16" fill="${c.linear([
      [0, '#FFF2D6'],
      [0.25, '#F0CF98'],
      [1, '#B9773E'],
    ])}"/>`;
    windows += `<rect x="${x + 10}" y="262" width="200" height="6" rx="3" fill="#FFFFFF" opacity=".7"/>`;
    if (r() > 0.35) {
      const px = x + 40 + r() * 140;
      windows += `<path d="M${px - 32} 400Q${px - 32} 340 ${px} 336Q${px + 32} 340 ${px + 32} 400Z" fill="#3A2A22"/><ellipse cx="${px}" cy="316" rx="17" ry="21" fill="#3A2A22"/>`;
    }
    windows += c.glow(x + 110, 325, 200, '#F2C98A', 0.25);
  }
  const anna: Person = {
    x: 1230,
    y: 900,
    h: 480,
    fill: '#050607',
    rim: '#F6B26B',
    light: 1.2,
    bun: true,
    scarf: '#9E2A25',
  };
  const body = `
  <rect width="${W}" height="${H}" fill="#0A0E12"/>
  <rect y="0" width="${W}" height="120" fill="#06080A"/>
  ${[200, 600, 1000, 1400].map((x) => c.glow(x, 60, 160, '#F2A65A', 0.5)).join('')}
  <rect y="120" width="${W}" height="560" fill="${c.linear([
    [0, '#2A3138'],
    [0.5, '#3B444C'],
    [1, '#1A1F24'],
  ])}"/>
  <rect y="430" width="${W}" height="16" fill="#B4302A"/>
  <rect y="190" width="${W}" height="6" fill="#596670"/>
  ${windows}
  <rect x="1380" y="210" width="180" height="470" fill="#20262C"/>
  <rect x="1384" y="214" width="84" height="462" fill="#2E363E"/><rect x="1472" y="214" width="84" height="462" fill="#2E363E"/>
  <rect x="1398" y="260" width="56" height="140" rx="10" fill="#E8C690" opacity=".85"/><rect x="1486" y="260" width="56" height="140" rx="10" fill="#E8C690" opacity=".85"/>
  <circle cx="1470" cy="196" r="8" fill="#FFB0A0"/>${c.glow(1470, 196, 70, '#FF5A3C', 1)}
  <rect y="680" width="${W}" height="220" fill="${c.linear([
    [0, '#1D1A17'],
    [1, '#07090B'],
  ])}"/>
  <rect y="680" width="${W}" height="12" fill="#C9A440" opacity=".5"/>
  <g filter="url(#streak)" style="mix-blend-mode:screen" opacity=".55">
    ${[60, 360, 660, 960, 1260].map((x) => `<rect x="${x + 40}" y="700" width="140" height="160" fill="#E8C690"/>`).join('')}
  </g>
  ${c.glow(800, 330, 1100, '#F2A65A', 0.14)}
  ${person(c, anna)}`;
  return wrap(c, body, { grade: '#3A6C78', gradeOpacity: 0.3 });
}

/** Rosa's diner after midnight: the counter, two strangers, the blue night in the window. */
function diner() {
  const c = new Canvas(W, H);
  const lampsAt = [420, 800, 1180];
  const lamps = lampsAt
    .map(
      (x) => `<path d="M${x} 0V120" stroke="#1A0F0A" stroke-width="3"/>
      <path d="M${x - 46} 160L${x - 260} 620L${x + 260} 620L${x + 46} 160Z" fill="#FFC47A" opacity=".1" filter="url(#b10)"/>
      <path d="M${x - 46} 160Q${x} 104 ${x + 46} 160Z" fill="#2A1A10"/>
      ${c.glow(x, 164, 260, '#FFB565', 0.75)}
      <ellipse cx="${x}" cy="162" rx="36" ry="6" fill="#FFE9C4"/>`,
    )
    .join('');
  const stools = [300, 1310]
    .map(
      (x) =>
        `<rect x="${x - 4}" y="690" width="8" height="210" fill="#0E0805"/><ellipse cx="${x}" cy="690" rx="52" ry="13" fill="#2B1810"/><ellipse cx="${x}" cy="686" rx="52" ry="10" fill="#6A3A22"/>`,
    )
    .join('');
  const rosa: Person = { x: 1080, y: 780, h: 360, fill: '#120A06', rim: '#FFB565', light: 1.2 };
  const body = `
  <rect width="${W}" height="${H}" fill="${c.linear([
    [0, '#140B07'],
    [0.6, '#2A170D'],
    [1, '#0D0705'],
  ])}"/>
  <rect x="120" y="150" width="1360" height="380" fill="${c.linear([
    [0, '#0A1B2A'],
    [0.7, '#14354A'],
    [1, '#1E4B5E'],
  ])}"/>
  <g filter="url(#b3)">${skyline(c, 120, 1480, 470, 9, '#0A1824', '#F2C76E')}</g>
  <g filter="url(#b3)">${rain(70, 3, 1360, 380, '#9FD4E6', 120, 150)}</g>
  ${c.glow(1320, 420, 140, '#56E0FF', 0.5)}
  ${[120, 460, 800, 1140, 1480].map((x) => `<rect x="${x - 8}" y="150" width="16" height="380" fill="#1A0F0A"/>`).join('')}
  <rect x="120" y="140" width="1360" height="16" fill="#1A0F0A"/>
  <g transform="translate(200 196)">
    ${c.glow(120, 34, 190, '#FF4F7B', 0.55)}
    <rect width="240" height="68" rx="34" fill="none" stroke="#FF6A8E" stroke-width="6"/>
    <path d="M86 22h52v22q0 10-10 10h-32q-10 0-10-10Z M138 28q14 0 14 10t-14 10" fill="none" stroke="#FF6A8E" stroke-width="5" stroke-linejoin="round"/>
  </g>
  ${person(c, rosa)}
  <g transform="translate(1340 470)"><rect width="60" height="70" rx="6" fill="#1A100A"/><rect x="8" y="-30" width="44" height="30" fill="#1A100A"/>${c.glow(30, 20, 34, '#FF6A3D', 0.8)}</g>
  <rect x="0" y="540" width="${W}" height="120" fill="#3B2014"/>
  <rect x="0" y="530" width="${W}" height="18" fill="#C9772E"/>
  <rect x="0" y="548" width="${W}" height="6" fill="#FFD9A0" opacity=".5"/>
  <g filter="url(#streak)" style="mix-blend-mode:screen" opacity=".5">${lampsAt.map((x) => `<rect x="${x - 50}" y="548" width="100" height="90" fill="#FFB565"/>`).join('')}</g>
  <path d="M440 530q0-18 18-18h22q18 0 18 18Z" fill="#E8D8C0" opacity=".9"/>
  <path d="M1180 530q0-18 18-18h22q18 0 18 18Z" fill="#E8D8C0" opacity=".9"/>
  <rect x="0" y="660" width="${W}" height="240" fill="${c.linear([
    [0, '#1F120B'],
    [1, '#0A0604'],
  ])}"/>
  ${lamps}
  ${stools}
  ${seated(c, { x: 620, y: 880, h: 460, fill: '#0B0604', rim: '#FFB565', bun: true, scarf: '#9E2A25' })}
  ${seated(c, { x: 930, y: 880, h: 480, fill: '#0B0604', rim: '#FFB565', cap: true })}
  ${c.glow(800, 300, 900, '#FF9A4A', 0.12)}`;
  return wrap(c, body, { grade: '#A0582A', gradeOpacity: 0.25 });
}

/** Two coffees and a ticket for a train that has gone: the insert on the counter. */
function cups() {
  const c = new Canvas(W, H);
  const shade = c.linear(
    [
      [0, '#000', 0.25],
      [0.35, '#000', 0],
      [0.7, '#000', 0],
      [1, '#000', 0.45],
    ],
    [0, 0, 1, 0],
  );
  const cup = (x: number, y: number, s: number) => `<g transform="translate(${x} ${y}) scale(${s})">
    <ellipse cx="0" cy="96" rx="150" ry="34" fill="#0C0705" opacity=".7" filter="url(#b10)"/>
    <ellipse cx="0" cy="84" rx="132" ry="26" fill="#E9DDCB"/>
    <path d="M-92 -10L-80 74Q0 100 80 74L92 -10Z" fill="#F1E6D4"/>
    <path d="M-92 -10L-80 74Q0 100 80 74L92 -10Z" fill="${shade}"/>
    <path d="M92 6Q150 10 140 40Q130 64 84 58" fill="none" stroke="#E2D4BF" stroke-width="14"/>
    <ellipse cx="0" cy="-10" rx="92" ry="20" fill="#E9DDCB"/>
    <ellipse cx="0" cy="-8" rx="80" ry="15" fill="#3A1D0E"/>
    <ellipse cx="-20" cy="-11" rx="30" ry="4" fill="#C98A55" opacity=".6"/>
    <path d="M-70 0L-62 60" stroke="#FFFFFF" stroke-width="8" opacity=".35" stroke-linecap="round"/>
  </g>`;
  const steam = `<g filter="url(#b10)" opacity=".22" fill="none" stroke="#FFF2DE" stroke-width="12" stroke-linecap="round">
    <path d="M540 400C500 340 580 300 540 240S560 140 530 90"/><path d="M590 400C630 330 560 290 600 220S580 120 620 70"/></g>`;
  const body = `
  <rect width="${W}" height="${H}" fill="${c.linear([
    [0, '#1A0E08'],
    [0.5, '#2C170C'],
    [1, '#120905'],
  ])}"/>
  ${c.glow(1200, 140, 520, '#2D6F86', 0.4)}
  ${c.glow(380, 100, 420, '#FFB565', 0.45)}
  <g filter="url(#b30)">${c.glow(1320, 210, 120, '#FF4F7B', 1)}${c.glow(1080, 170, 100, '#F2C76E', 1)}${c.glow(180, 230, 90, '#F2C76E', 0.9)}${c.glow(860, 120, 80, '#F2C76E', 0.8)}</g>
  <path d="M0 520L1600 470L1600 900L0 900Z" fill="${c.linear([
    [0, '#6A3A22'],
    [0.3, '#3B2014'],
    [1, '#150A06'],
  ])}"/>
  <path d="M0 520L1600 470" stroke="#FFD9A0" stroke-width="3" opacity=".4"/>
  <g filter="url(#streak)" style="mix-blend-mode:screen" opacity=".4"><rect x="300" y="520" width="200" height="160" fill="#FFB565"/></g>
  <g transform="translate(870 650) rotate(-9)">
    <rect x="-150" y="-60" width="300" height="120" rx="6" fill="#E6D7B8"/>
    <rect x="-150" y="-60" width="300" height="28" rx="6" fill="#B4302A"/>
    <path d="M-120 2h150M-120 24h110" stroke="#6A5A44" stroke-width="6" stroke-linecap="round"/>
    <circle cx="90" cy="14" r="26" fill="none" stroke="#7A3A5A" stroke-width="4" opacity=".7"/>
    ${[...Array(8)].map((_, i) => `<circle cx="${-130 + i * 37}" cy="58" r="4" fill="#2C170C"/>`).join('')}
  </g>
  ${steam}
  ${cup(560, 520, 1.25)}
  ${cup(1180, 470, 0.95)}
  ${c.glow(560, 300, 600, '#FFB565', 0.16)}`;
  return wrap(c, body, { grade: '#A0582A', gradeOpacity: 0.3 });
}

/** Dawn through the diner glass: the yard, the wires, the sky warming, the glass misted. */
function dawn() {
  const c = new Canvas(W, H);
  const masts = depths(7, 1, 0.7)
    .map(({ t, s }) => {
      const x = lerp(180, 1040, t);
      return `<rect x="${f(x)}" y="${f(lerp(180, 470, t))}" width="${f(12 * s + 1)}" height="${f(lerp(440, 90, t))}" fill="#2A1E2C"/><path d="M${f(x - 60 * s)} ${f(lerp(200, 476, t))}h${f(140 * s)}" stroke="#2A1E2C" stroke-width="${f(5 * s + 0.5)}"/>`;
    })
    .join('');
  const body = `
  <rect width="${W}" height="${H}" fill="${c.linear([
    [0, '#2B2A4C'],
    [0.38, '#7A5A78'],
    [0.6, '#E39A7E'],
    [0.72, '#F6C98A'],
    [1, '#3D2B3F'],
  ])}"/>
  ${c.glow(1120, 600, 560, '#FFD9A0', 0.8)}
  <circle cx="1120" cy="600" r="64" fill="#FFF0CF"/>
  <g filter="url(#b3)">
    <path d="M0 640Q400 590 800 630T1600 610L1600 900L0 900Z" fill="#4A3044"/>
    ${skyline(c, 0, 900, 640, 13, '#3D2A3C', '#FFD9A0')}
    <path d="M0 610Q500 560 1600 520" stroke="#2A1E2C" stroke-width="2" fill="none"/>
    <path d="M0 630Q500 580 1600 540" stroke="#2A1E2C" stroke-width="1.5" fill="none"/>
    ${masts}
    <path d="M0 700L1600 660L1600 900L0 900Z" fill="#2A1C26"/>
    <g stroke="#E8B48A" stroke-width="4" opacity=".55"><path d="M0 760L1600 690"/><path d="M0 820L1600 720"/></g>
  </g>
  <rect y="420" width="${W}" height="260" fill="${c.linear([
    [0, '#FFE6D0', 0],
    [1, '#FFE6D0', 0.22],
  ])}"/>
  <rect x="0" y="0" width="${W}" height="40" fill="#120A0A"/>
  <rect x="770" y="0" width="34" height="680" fill="#120A0A"/>
  <rect x="0" y="660" width="${W}" height="240" fill="${c.linear([
    [0, '#2A1810'],
    [1, '#0C0604'],
  ])}"/>
  <rect x="0" y="660" width="${W}" height="10" fill="#E8A86A" opacity=".5"/>
  <g transform="translate(320 640)"><path d="M-40 0L-34 50Q0 62 34 50L40 0Z" fill="#170C08"/><path d="M40 12Q66 14 62 32Q58 46 36 42" stroke="#170C08" stroke-width="9" fill="none"/><ellipse cx="0" cy="0" rx="40" ry="8" fill="#2A1810"/></g>
  <g filter="url(#streak)" style="mix-blend-mode:screen" opacity=".5"><rect x="1080" y="680" width="80" height="160" fill="#FFD9A0"/></g>`;
  return wrap(c, body, { grade: '#C77A6A', gradeOpacity: 0.25 });
}

/** The first train along the sea at dawn, the sun's path on the water. */
function sea() {
  const c = new Canvas(W, H);
  const horizon = 520;
  const r = random(55);
  let path = '';
  for (let i = 0; i < 80; i++) {
    const y = horizon + 6 + r() ** 1.6 * 360;
    const spread = (y - horizon) * 0.9 + 20;
    const x = 420 + (r() - 0.5) * spread;
    path += `<rect x="${f(x)}" y="${f(y)}" width="${f(16 + (y - horizon) * 0.5 * r())}" height="${f(2 + (y - horizon) / 90)}" fill="#FFE2B0" opacity="${f(0.3 + r() * 0.6)}"/>`;
  }
  let waves = '';
  for (let i = 0; i < 12; i++) {
    const y = horizon + 20 + i * i * 2.6;
    waves += `<path d="M0 ${f(y)}Q400 ${f(y - 4)} 800 ${f(y + 2)}" stroke="#8FA6C0" stroke-width="${f(1 + i * 0.2)}" opacity=".18" fill="none"/>`;
  }
  let windows = '';
  for (let i = 0; i < 18; i++)
    windows += `<rect x="${760 + i * 34}" y="566" width="22" height="12" rx="2" fill="#FFE2A8" opacity="${f(0.6 + r() * 0.4)}"/>`;
  const poles = [700, 900, 1100, 1300, 1500]
    .map(
      (x) =>
        `<rect x="${x}" y="470" width="5" height="120" fill="#151E2A"/><path d="M${x - 20} 478h45" stroke="#151E2A" stroke-width="3"/>`,
    )
    .join('');
  const body = `
  <rect width="${W}" height="${horizon + 2}" fill="${c.linear([
    [0, '#1F2E45'],
    [0.55, '#5D7290'],
    [0.85, '#D9A486'],
    [1, '#F3C99A'],
  ])}"/>
  <g filter="url(#b10)" opacity=".5"><ellipse cx="1000" cy="300" rx="300" ry="14" fill="#C99A9A"/><ellipse cx="700" cy="360" rx="220" ry="10" fill="#E3B49A"/></g>
  ${c.glow(420, horizon - 30, 440, '#FFD9A0', 0.75)}
  <circle cx="420" cy="${horizon - 28}" r="44" fill="#FFF0CF"/>
  <path d="M0 ${horizon - 30}Q160 ${horizon - 60} 300 ${horizon - 6}L0 ${horizon + 2}Z" fill="#5A5A70" opacity=".6"/>
  <rect y="${horizon}" width="${W}" height="${H - horizon}" fill="${c.linear([
    [0, '#4B5F78'],
    [0.4, '#22324A'],
    [1, '#0E1724'],
  ])}"/>
  ${waves}
  <g filter="url(#b3)" style="mix-blend-mode:screen">${path}</g>
  <path d="M640 ${horizon + 80}L1600 ${horizon + 20}L1600 900L520 900Z" fill="${c.linear(
    [
      [0, '#26303E'],
      [0.4, '#121A24'],
      [1, '#0A1018'],
    ],
    [0, 0, 1, 1],
  )}"/>
  <path d="M520 900L640 ${horizon + 80}" stroke="#C99A7A" stroke-width="3" opacity=".35"/>
  <path d="M640 ${horizon + 80}L1600 ${horizon + 20}" stroke="#C99A7A" stroke-width="3" opacity=".6"/>
  <path d="M1180 ${horizon + 50}L1600 ${horizon - 120}L1600 ${horizon + 30}Z" fill="#101A24"/>
  ${poles}
  <path d="M680 474H1600" stroke="#151E2A" stroke-width="1.5"/>
  <rect x="740" y="556" width="640" height="34" rx="8" fill="#1A2533"/>
  <path d="M740 590h640" stroke="#C99A7A" stroke-width="2" opacity=".5"/>
  ${windows}
  ${c.glow(744, 578, 70, '#FFF2D6', 1)}
  <g filter="url(#b10)" style="mix-blend-mode:screen" opacity=".5"><rect x="760" y="600" width="600" height="30" fill="#FFE2A8" opacity=".35"/></g>
  <rect width="${W}" height="${H}" fill="${c.linear([
    [0, '#F3D3A8', 0],
    [0.55, '#F3D3A8', 0.12],
    [0.7, '#F3D3A8', 0],
  ])}" style="mix-blend-mode:screen"/>`;
  return wrap(c, body, { grade: '#3E5E7E', gradeOpacity: 0.3, vignette: 0.5 });
}

/** The field behind the station at first light: the home signal, the station roof far away. */
function field() {
  const c = new Canvas(W, H);
  const r = random(61);
  let grass = '';
  for (let i = 0; i < 360; i++) {
    const x = r() * W;
    const y = 640 + r() ** 0.7 * 260;
    const h = 10 + (y - 620) * 0.25;
    grass += `<path d="M${f(x)} ${f(y)}q${f(r() * 8 - 4)} ${f(-h / 2)} ${f(r() * 12 - 6)} ${f(-h)}" stroke-width="${f(1 + (y - 620) / 120)}"/>`;
  }
  const body = `
  <rect width="${W}" height="${H}" fill="${c.linear([
    [0, '#3C6E8F'],
    [0.45, '#8DB5C9'],
    [0.66, '#E9D7A6'],
    [1, '#E9D7A6'],
  ])}"/>
  ${c.glow(260, 600, 620, '#FFE6B0', 0.7)}
  <g filter="url(#b10)" opacity=".55" fill="#F3E6CC">
    <ellipse cx="1100" cy="210" rx="300" ry="18"/><ellipse cx="1180" cy="190" rx="160" ry="14"/>
    <ellipse cx="560" cy="150" rx="220" ry="12"/><ellipse cx="700" cy="250" rx="180" ry="10"/>
  </g>
  <path d="M0 610Q400 580 800 600T1600 590L1600 900L0 900Z" fill="#9C8C58"/>
  <g opacity=".6"><path d="M700 600L760 576L1000 576L1060 600Z" fill="#6A6A70"/><rect x="760" y="570" width="240" height="8" fill="#5A5A62"/></g>
  <g filter="url(#b30)" opacity=".7"><rect y="560" width="${W}" height="80" fill="#F3E6CC"/></g>
  <path d="M0 660Q800 620 1600 660L1600 900L0 900Z" fill="${c.linear([
    [0, '#B8A15A'],
    [1, '#6E5E2C'],
  ])}"/>
  <path d="M0 760Q800 690 1600 740L1600 900L0 900Z" fill="#8C7A3C" opacity=".8"/>
  <path d="M0 800L1600 700" stroke="#3A3020" stroke-width="10" opacity=".6"/>
  <path d="M0 840L1600 724" stroke="#3A3020" stroke-width="10" opacity=".6"/>
  <g stroke="#3E3418" opacity=".7" fill="none">${grass}</g>
  <g transform="translate(1180 330)">
    <rect x="-6" y="0" width="12" height="320" fill="#2A2418"/>
    <rect x="-36" y="20" width="72" height="20" fill="#2A2418"/>
    <rect x="-22" y="-60" width="44" height="80" rx="10" fill="#2A2418"/>
    ${c.glow(0, -38, 60, '#3DDC84', 0.9)}<circle cx="0" cy="-38" r="9" fill="#C6FFD8"/>
    <circle cx="0" cy="-8" r="8" fill="#401818"/>
  </g>
  <rect width="${W}" height="${H}" fill="#FFE6B0" opacity=".08" style="mix-blend-mode:screen"/>`;
  return wrap(c, body, { grade: '#C9A060', gradeOpacity: 0.2, vignette: 0.45 });
}

/** The signal box at night: the lever frame, the track diagram, Leo at the levers. */
function signalbox() {
  const c = new Canvas(W, H);
  const levers = [...Array(12)]
    .map((_, i) => {
      const x = 200 + i * 78;
      const pulled = [3, 4, 8].includes(i);
      const top = ['#B4302A', '#B4302A', '#1E4E8C', '#B4302A', '#E0B84A'][i % 5];
      return `<g transform="translate(${x} 760) rotate(${pulled ? 9 : -4})"><rect x="-7" y="-250" width="14" height="250" fill="#2A2E33"/><rect x="-7" y="-250" width="4" height="250" fill="#8A929C" opacity=".5"/><rect x="-9" y="-272" width="18" height="40" rx="4" fill="${top}"/></g>`;
    })
    .join('');
  const diagram = `<g transform="translate(200 190)">
    <rect width="1000" height="160" rx="8" fill="#14191E"/>
    <path d="M40 90H960M220 90L330 50H690L800 90M370 50L430 125H730" stroke="#9AA6B2" stroke-width="6" fill="none"/>
    ${[150, 280, 480, 640, 860]
      .map(
        (x, i) =>
          `${c.glow(x, 90, 30, i === 2 ? '#3DDC84' : '#FF4040', 1)}<circle cx="${x}" cy="90" r="6" fill="${i === 2 ? '#C6FFD8' : '#FFC8C8'}"/>`,
      )
      .join('')}
    ${c.glow(560, 50, 50, '#F2C76E', 1)}<circle cx="560" cy="50" r="5" fill="#FFF0C0"/>
  </g>`;
  const leo: Person = {
    x: 1330,
    y: 960,
    h: 520,
    fill: '#06080A',
    rim: '#F2C76E',
    light: -1.2,
    cap: true,
    broad: true,
  };
  const body = `
  <rect width="${W}" height="${H}" fill="${c.linear([
    [0, '#0A0E12'],
    [1, '#151A1F'],
  ])}"/>
  <rect x="80" y="60" width="1440" height="96" fill="#0F2233"/>
  <g filter="url(#b3)">${rain(60, 23, 1440, 96, '#7FA6C4', 80, 60)}</g>
  ${c.glow(1300, 110, 130, '#F2A65A', 0.7)}
  ${[80, 440, 800, 1160, 1520].map((x) => `<rect x="${x - 6}" y="56" width="12" height="104" fill="#07090B"/>`).join('')}
  ${diagram}
  <g transform="translate(160 420)">${c.glow(0, 4, 220, '#FFE7B8', 0.6)}<path d="M-30 0h60l-12 -40h-36Z" fill="#2A2418"/><ellipse cx="0" cy="2" rx="26" ry="5" fill="#FFF0C0"/></g>
  ${c.glow(700, 420, 800, '#F2C76E', 0.12)}
  <rect y="760" width="${W}" height="140" fill="#0A0C0E"/>
  <rect y="752" width="${W}" height="14" fill="#3A3F45"/>
  ${levers}
  ${person(c, leo)}`;
  return wrap(c, body, { grade: '#4A6A5A', gradeOpacity: 0.25 });
}

/** A casting portrait: a profile lit from behind, the character's world out of focus. */
function portrait(o: {
  bg: [string, string];
  bokeh: string[];
  rim: string;
  hair: string[];
  coat: string;
  accent?: string;
  seed: number;
}) {
  const c = new Canvas(1200, 1200);
  const r = random(o.seed);
  let bokeh = '';
  for (let i = 0; i < 26; i++) {
    const color = o.bokeh[i % o.bokeh.length] as string;
    bokeh += `<circle cx="${f(r() * 1200)}" cy="${f(r() * 900)}" r="${f(30 + r() * 70)}" fill="${color}" opacity="${f(0.15 + r() * 0.35)}"/>`;
  }
  const face = c.linear(
    [
      [0, o.rim, 0],
      [1, o.rim, 0.4],
    ],
    [0, 0, 1, 0],
  );
  const inner = `
    <ellipse cx="660" cy="420" rx="120" ry="190" fill="${face}" filter="url(#b30)"/>
    <path d="M150 760C300 720 420 700 460 690L600 690C700 720 800 762 880 830L940 1000L150 1000Z" fill="${o.coat}"/>
    ${o.accent ? `<path d="M420 660Q520 720 640 670L660 760Q530 810 400 750Z" fill="${o.accent}"/>` : ''}`;
  const body = `
  <rect width="1200" height="1200" fill="${c.linear([
    [0, o.bg[0]],
    [1, o.bg[1]],
  ])}"/>
  <g filter="url(#b10)" style="mix-blend-mode:screen">${bokeh}</g>
  ${c.glow(940, 420, 700, o.rim, 0.35)}
  ${c.rimmed([PROFILE, ...o.hair], '#0A0B0D', o.rim, 14, 'translate(20 130) scale(1.08)', inner)}`;
  return wrap(c, body, { grade: o.rim, gradeOpacity: 0.12, vignette: 0.7 });
}

/** Pixel size of the map pictures, like the ones the server composites (decision 0053). */
const MAP_W = 1024;
const MAP_H = 560;

/**
 * A flat street map of the invented town, centred on the place of the map card (the card draws
 * the pin in the middle): blocks, streets, the railway and the sea. No tiles from a map server.
 */
function townMap(place: 'station' | 'coast'): string {
  const rnd = random(place === 'station' ? 31 : 47);
  const ground = '#ECE7DE';
  const block = '#DDD6CA';
  const park = '#CFE1C4';
  const sea = '#A9C8DA';
  const road = '#FFFFFF';
  const rail = '#8A8F96';
  const parts: string[] = [`<rect width="${MAP_W}" height="${MAP_H}" fill="${ground}"/>`];
  const blocks = (x0: number, y0: number, x1: number, y1: number) => {
    for (let x = x0; x < x1; x += 92)
      for (let y = y0; y < y1; y += 74) {
        const w = 70 + rnd() * 10;
        const h = 52 + rnd() * 10;
        parts.push(
          `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="3" fill="${rnd() < 0.08 ? park : block}"/>`,
        );
      }
  };
  const street = (d: string, width: number) =>
    parts.push(
      `<path d="${d}" fill="none" stroke="#D2CBBF" stroke-width="${width + 3}" stroke-linecap="round"/>`,
      `<path d="${d}" fill="none" stroke="${road}" stroke-width="${width}" stroke-linecap="round"/>`,
    );
  const railway = (d: string) =>
    parts.push(
      `<path d="${d}" fill="none" stroke="${rail}" stroke-width="5"/>`,
      `<path d="${d}" fill="none" stroke="${ground}" stroke-width="2.4" stroke-dasharray="9 9"/>`,
    );
  const label = (x: number, y: number, text: string, size = 15, color = '#5C5F66') =>
    parts.push(
      `<text x="${f(x)}" y="${f(y)}" font-family="sans-serif" font-size="${size}" fill="${color}" text-anchor="middle">${text}</text>`,
    );
  if (place === 'station') {
    blocks(10, 10, 1010, 200);
    blocks(10, 340, 1010, 560);
    // The station building and its platforms, the square in front.
    parts.push(`<rect x="300" y="244" width="600" height="34" rx="4" fill="#C9C0B2"/>`);
    parts.push(`<rect x="400" y="300" width="224" height="50" rx="6" fill="${park}"/>`);
    railway('M-10 214H1034');
    railway('M-10 226H1034');
    street('M0 296H1024', 12);
    street('M512 290V560', 10);
    street('M140 0V200M330 0V200M700 0V200M880 0V200', 7);
    street('M240 340V560M780 340V560', 7);
    label(770, 266, 'Central station', 15, '#3F4248');
    label(512, 330, 'Piazza della Stazione', 13);
    label(860, 312, 'Via dei Binari', 13);
  } else {
    parts.push(`<path d="M0 330C180 312 300 352 470 320S780 270 1024 300V560H0Z" fill="${sea}"/>`);
    parts.push(
      `<path d="M0 330C180 312 300 352 470 320S780 270 1024 300" fill="none" stroke="#C7BCA8" stroke-width="10"/>`,
    );
    blocks(560, 10, 1010, 160);
    parts.push(`<path d="M0 0H520V200C380 230 160 250 0 260Z" fill="${park}" opacity=".7"/>`);
    railway('M-10 296C180 280 300 318 470 288S780 240 1034 268');
    street('M-10 250C200 236 330 262 520 230S800 190 1034 210', 10);
    street('M700 0V200', 7);
    label(512, 452, 'Mare', 18, '#6E8FA3');
    label(300, 230, 'Capo Bianco', 15, '#3F4248');
    label(860, 182, 'Via del Faro', 13);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MAP_W}" height="${MAP_H}" viewBox="0 0 ${MAP_W} ${MAP_H}">${parts.join('')}</svg>`;
}

// Low Tide, the photo shoot (docs/demo-project.md): the coast in cold morning light. Models are
// drawn like the people of Last Train, with the outfit in its own colour and hair in the wind.
const WIND_HAIR = 'M-3.4 3.6Q-11 1.6-19.6 5.4Q-12 6.2-4.6 9.6Z';
const COAT_WIND =
  'M-10.5 21Q-10.5 17.2-6 16.6L6 16.6Q10.5 17.2 10.5 21L11.8 44L12.8 72L-5 72Q-13 68-21 62Q-14.6 46-12 30Z';
const DRESS =
  'M-9.6 21Q-9.6 17.2-5.4 16.6L5.4 16.6Q9.6 17.2 9.6 21L10.4 40L13 76L-6 76Q-14 72-22 66Q-13 52-11 34Z';
const SHIRT = 'M-11.5 21Q-11.5 17-6 16.4L6 16.4Q11.5 17 11.5 21L11.4 54L-11.4 54Z';
const TROUSERS = 'M-11 52L-9 98L-1 98L0 62L1 98L9 98L11 52Z';

interface Model {
  x: number;
  /** Where the feet are. */
  y: number;
  h: number;
  outfit: 'coat' | 'dress' | 'knit' | 'shirt';
  color: string;
  walk?: boolean;
  /** Mara's hair in the wind; Ivo's is short. */
  hair?: boolean;
  flip?: boolean;
}

function model(m: Model, dark = '#15171B') {
  const s = m.h / 100;
  const legs =
    m.outfit === 'knit' || m.outfit === 'shirt'
      ? []
      : m.walk
        ? [WALK_L, WALK_R]
        : [LEG_L, LEG_R, SHOE_L, SHOE_R];
  const arms = m.walk ? [SWING_L, SWING_R] : [ARM_L, ARM_R];
  const body = {
    coat: [COAT_WIND],
    dress: [DRESS],
    knit: [SHIRT, TROUSERS],
    shirt: [SHIRT, TROUSERS],
  }[m.outfit];
  const paths = (list: string[]) => list.map((d) => `<path d="${d}"/>`).join('');
  return `<g transform="translate(${f(m.x)} ${f(m.y - m.h)}) scale(${f(m.flip ? -s : s)} ${f(s)})">
    <g fill="${dark}">${paths([HEAD, NECK, ...legs, ...(m.hair ? [WIND_HAIR] : [])])}</g>
    <g fill="${m.color}">${paths([...body, ...arms])}</g>
  </g>`;
}

/** A model reflected in wet sand or a pool: upside down, rippled, faint. */
function mirrored(m: Model, opacity = 0.3) {
  return `<g filter="url(#ripple)" opacity="${opacity}" transform="translate(0 ${f(2 * m.y)}) scale(1 -1)">${model({ ...m, color: '#000' }, '#000')}</g>`;
}

/** The looks of the bible: Mara's red coat, cream knit and pale dress, Ivo's slate shirt. */
const LOOK = {
  coat: { outfit: 'coat', color: '#8E2F2A', hair: true },
  knit: { outfit: 'knit', color: '#E3D7C3', hair: true },
  dress: { outfit: 'dress', color: '#ECE6DA', hair: true },
  ivo: { outfit: 'shirt', color: '#3E4E5E' },
} as const;

/** Flat lines on the water, thinner and closer together towards the horizon. */
function swell(c: Canvas, top: number, bottom: number, seed: number, color = '#C9D2D8') {
  const r = random(seed);
  let out = '';
  for (let i = 0; i < 26; i++) {
    const t = (i / 26) ** 1.7;
    const y = lerp(top + 4, bottom, t);
    const x = r() * W * 0.6;
    out += `<path d="M${f(x - 200)} ${f(y)}H${f(x + 600 + r() * 900)}" stroke="${color}" stroke-width="${f(0.8 + t * 2.4)}" opacity="${f(0.1 + t * 0.18)}"/>`;
  }
  return `<g>${out}</g>${c.glow(W / 2, top, 900, '#E8EDEE', 0.06)}`;
}

/** Look 1: the sea wall under a low grey sky, Mara in the red coat. */
function tideSeawall(v = 0) {
  const c = new Canvas(W, H);
  const horizon = 470;
  const wall = (x: number) => lerp(730, 630, x / W);
  const poses: Array<Omit<Model, 'y' | 'outfit' | 'color'>> = [
    { x: 1060, h: 170 },
    { x: 700, h: 360, walk: true },
    { x: 960, h: 230, flip: true },
    { x: 1250, h: 190 },
    { x: 470, h: 84, walk: true },
  ];
  const pose = poses[v % poses.length] as (typeof poses)[number];
  const mara: Model = { ...LOOK.coat, ...pose, y: wall(pose.x) + 4 };
  const r = random(70 + v);
  let glitter = '';
  for (let i = 0; i < 40; i++) {
    const y = horizon + 10 + r() ** 1.4 * 200;
    glitter += `<rect x="${f(1120 + (r() - 0.5) * (y - horizon) * 0.8)}" y="${f(y)}" width="${f(10 + r() * 30)}" height="2" fill="#EEF2F2" opacity="${f(0.2 + r() * 0.5)}"/>`;
  }
  const seams = [140, 420, 700, 980, 1260, 1540]
    .map(
      (x) =>
        `<path d="M${x} ${f(wall(x) + 6)}L${x - 14} 900" stroke="#0C0F12" stroke-width="2" opacity=".6"/>`,
    )
    .join('');
  const body = `
  <rect width="${W}" height="${horizon + 2}" fill="${c.linear([
    [0, '#1C2532'],
    [0.5, '#4E6078'],
    [0.86, '#AEB3B0'],
    [1, '#D8D3C4'],
  ])}"/>
  ${c.glow(1150, horizon - 20, 620, '#EDE6D2', 0.55)}
  <g filter="url(#b30)" opacity=".35" fill="#8C9AAA"><ellipse cx="500" cy="180" rx="520" ry="40"/><ellipse cx="1200" cy="120" rx="420" ry="30"/></g>
  <path d="M0 ${horizon - 6}Q160 ${horizon - 30} 360 ${horizon - 22}T720 ${horizon - 2}L720 ${horizon + 2}L0 ${horizon + 2}Z" fill="#4A5462" filter="url(#b3)"/>
  <rect y="${horizon}" width="${W}" height="${H - horizon}" fill="${c.linear([
    [0, '#6F8196'],
    [0.5, '#3F5168'],
    [1, '#1E2A38'],
  ])}"/>
  ${swell(c, horizon, 760, 71 + v)}
  <g filter="url(#b3)" style="mix-blend-mode:screen">${glitter}</g>
  <path d="M0 ${wall(0)}L${W} ${wall(W)}L${W} ${H}L0 ${H}Z" fill="${c.linear([
    [0, '#323A44'],
    [1, '#101419'],
  ])}"/>
  <path d="M0 ${wall(0)}L${W} ${wall(W)}" stroke="#A7B0B8" stroke-width="3" opacity=".7"/>
  ${seams}
  ${model(mara)}
  <rect width="${W}" height="${H}" fill="#DCE3E6" opacity=".05" style="mix-blend-mode:screen"/>`;
  return wrap(c, body, { grade: '#3E5E7E', gradeOpacity: 0.25, vignette: 0.3 });
}

/** Look 2: first sun on the wet sand at low water, the sky in the sand. */
function tideDawn(v = 0) {
  const c = new Canvas(W, H);
  const horizon = 440;
  const shore = 476;
  const casts: Model[][] = [
    [
      { ...LOOK.knit, x: 700, y: 640, h: 74 },
      { ...LOOK.ivo, x: 790, y: 648, h: 82 },
    ],
    [{ ...LOOK.knit, x: 820, y: 860, h: 300, walk: true }],
    [{ ...LOOK.ivo, x: 1010, y: 720, h: 170, flip: true }],
    [
      { ...LOOK.knit, x: 540, y: 720, h: 130, walk: true },
      { ...LOOK.ivo, x: 640, y: 730, h: 140 },
    ],
  ];
  const people = casts[v % casts.length] as Model[];
  const r = random(80 + v);
  let ripples = '';
  for (let i = 0; i < 30; i++) {
    const y = shore + 20 + r() ** 1.5 * 400;
    ripples += `<path d="M${f(r() * W)} ${f(y)}h${f(60 + r() * 260)}" stroke="#F4E2CC" stroke-width="${f(1 + (y - shore) / 120)}" opacity="${f(0.12 + r() * 0.2)}"/>`;
  }
  const body = `
  <rect width="${W}" height="${shore}" fill="${c.linear([
    [0, '#3A4658'],
    [0.5, '#8F8B9A'],
    [0.85, '#E3BFA2'],
    [1, '#F2D6B8'],
  ])}"/>
  ${c.glow(1150, horizon - 10, 520, '#FFE4BE', 0.75)}
  <circle cx="1150" cy="${horizon - 12}" r="30" fill="#FFF3DC"/>
  <rect y="${horizon}" width="${W}" height="${shore - horizon}" fill="#7C8794"/>
  ${swell(c, horizon, shore, 81 + v, '#F2E0CA')}
  <rect y="${shore}" width="${W}" height="${H - shore}" fill="${c.linear([
    [0, '#D6B9A0'],
    [0.3, '#A8968E'],
    [1, '#5E5658'],
  ])}"/>
  <g filter="url(#streak)" style="mix-blend-mode:screen" opacity=".3"><rect x="1110" y="${shore}" width="80" height="380" fill="#FFE4BE"/></g>
  ${ripples}
  ${people.map((m) => mirrored(m, 0.28)).join('')}
  ${people.map((m) => model(m)).join('')}`;
  return wrap(c, body, { grade: '#C9A08A', gradeOpacity: 0.2, vignette: 0.3 });
}

/** Look 3: the dunes and their tall grass, the fog coming in, the pale dress. */
function tideDunes(v = 0) {
  const c = new Canvas(W, H);
  const casts: Array<{ people: Model[]; fog: number }> = [
    {
      people: [
        { ...LOOK.dress, x: 690, y: 560, h: 190 },
        { ...LOOK.ivo, x: 860, y: 572, h: 206 },
      ],
      fog: 0.3,
    },
    { people: [{ ...LOOK.dress, x: 900, y: 540, h: 170, walk: true }], fog: 0.3 },
    { people: [{ ...LOOK.dress, x: 780, y: 1120, h: 700 }], fog: 0.25 },
    {
      people: [
        { ...LOOK.dress, x: 500, y: 500, h: 90 },
        { ...LOOK.ivo, x: 570, y: 506, h: 98 },
      ],
      fog: 0.35,
    },
    { people: [{ ...LOOK.dress, x: 600, y: 640, h: 260, flip: true }], fog: 0.3 },
    {
      people: [
        { ...LOOK.dress, x: 980, y: 470, h: 54 },
        { ...LOOK.ivo, x: 1020, y: 474, h: 58 },
      ],
      fog: 0.7,
    },
  ];
  const { people, fog } = casts[v % casts.length] as (typeof casts)[number];
  const r = random(90 + v);
  let grass = '';
  for (let i = 0; i < 300; i++) {
    const x = r() * W;
    const y = 520 + r() ** 0.8 * 400;
    const h = 30 + (y - 500) * 0.35;
    grass += `<path d="M${f(x)} ${f(y)}q${f(r() * 10 - 6)} ${f(-h / 2)} ${f(r() * 20 - 14)} ${f(-h)}" stroke-width="${f(1 + (y - 500) / 140)}"/>`;
  }
  const body = `
  <rect width="${W}" height="${H}" fill="${c.linear([
    [0, '#4F5B68'],
    [0.45, '#AEB8BE'],
    [0.62, '#D3D5CE'],
    [1, '#D3D5CE'],
  ])}"/>
  ${c.glow(1100, 420, 640, '#F2F0E6', 0.45)}
  <path d="M0 470Q300 440 620 462T1600 446L1600 900L0 900Z" fill="#C9B590" opacity=".75"/>
  <path d="M0 540Q420 470 820 520T1600 500L1600 900L0 900Z" fill="${c.linear([
    [0, '#C2A878'],
    [1, '#9C8256'],
  ])}"/>
  <path d="M0 690Q520 620 1000 660T1600 650L1600 900L0 900Z" fill="#A68B5E"/>
  ${people.map((m) => model(m)).join('')}
  <g stroke="#5F5630" opacity=".75" fill="none">${grass}</g>
  <g filter="url(#b70)" opacity="${fog}"><rect x="-200" y="320" width="2000" height="260" fill="#E6E8E2"/></g>`;
  return wrap(c, body, { grade: '#8A8A70', gradeOpacity: 0.2, vignette: 0.3 });
}

/** Rock pools at low tide holding the sky, and Mara in one shot among them. */
function tidePools(v = 0) {
  const c = new Canvas(W, H);
  const horizon = 360;
  const r = random(100 + v);
  const sky = c.linear([
    [0, '#5C6C7E'],
    [1, '#D5D8D2'],
  ]);
  const pool = c.linear([
    [0, '#C4CCCC'],
    [1, '#73848F'],
  ]);
  /** A low rock: an irregular outline around its middle, flattened by the distance. */
  const outline = (x: number, y: number, rx: number, ry: number, n = 9) =>
    Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2;
      const j = 0.75 + r() * 0.4;
      return `${k ? 'L' : 'M'}${f(x + Math.cos(a) * rx * j)} ${f(y + Math.sin(a) * ry * j)}`;
    }).join('') + 'Z';
  let rocks = '';
  let pools = '';
  for (let i = 0; i < 14; i++) {
    const x = r() * W;
    const y = horizon + 70 + r() ** 0.8 * 470;
    const s = 0.4 + (y - horizon) / 400;
    const rx = 150 * s + r() * 70;
    const ry = 36 * s + r() * 16;
    rocks += `<path d="${outline(x, y, rx, ry)}" fill="#2E302E"/><path d="${outline(x, y - ry * 0.4, rx * 0.8, ry * 0.5)}" fill="#4A4840" opacity=".6"/>`;
    pools += `<path d="${outline(x + (r() - 0.5) * 40, y + ry * 0.9, rx * 0.7, ry * 0.45, 12)}" fill="${pool}" opacity=".85"/>`;
  }
  const mara: Model = { ...LOOK.knit, x: 1120, y: 620, h: 130 };
  const body = `
  <rect width="${W}" height="${horizon + 2}" fill="${sky}"/>
  ${c.glow(600, horizon - 20, 600, '#F4F2EA', 0.45)}
  <rect y="${horizon}" width="${W}" height="40" fill="#76889A"/>
  ${swell(c, horizon, horizon + 40, 101 + v)}
  <rect y="${horizon + 40}" width="${W}" height="${H - horizon - 40}" fill="${c.linear([
    [0, '#5A5650'],
    [1, '#2A2724'],
  ])}"/>
  ${pools}
  ${rocks}
  ${v % 2 === 1 ? `${mirrored(mara, 0.35)}${model(mara)}` : ''}
  <rect width="${W}" height="${H}" fill="#E6EAE6" opacity=".05" style="mix-blend-mode:screen"/>`;
  return wrap(c, body, { grade: '#6E8A8A', gradeOpacity: 0.2, vignette: 0.3 });
}

/** Mara in profile against the sea, hair blown back, the red scarf. */
function tidePortrait(v = 0) {
  const c = new Canvas(W, H);
  const horizon = 520;
  const frames = [
    { x: 380, y: 240, s: 0.66 },
    { x: 560, y: 140, s: 0.8 },
    { x: 520, y: 30, s: 0.94 },
    { x: 760, y: 260, s: 0.64 },
  ];
  const fr = frames[v % frames.length] as (typeof frames)[number];
  const strands = [
    'M440 300L150 250L420 336Z',
    'M420 350L170 400L436 392Z',
    'M440 396L260 500L458 430Z',
  ];
  const inner = `
    <path d="M150 760C300 720 420 700 460 690L600 690C700 720 800 762 880 830L940 1000L150 1000Z" fill="#17181C"/>
    <path d="M420 660Q520 720 640 670L660 760Q530 810 400 750Z" fill="#8E2F2A"/>`;
  const body = `
  <rect width="${W}" height="${horizon + 2}" fill="${c.linear([
    [0, '#46525E'],
    [0.7, '#B9C0C0'],
    [1, '#DCDCD2'],
  ])}"/>
  ${c.glow(1000, horizon - 40, 760, '#F2F0E8', 0.4)}
  <rect y="${horizon}" width="${W}" height="${H - horizon}" fill="${c.linear([
    [0, '#6C7C8C'],
    [1, '#2A3644'],
  ])}"/>
  ${swell(c, horizon, H, 111 + v)}
  ${c.rimmed([PROFILE, ...strands], '#121317', '#E8E6DE', 9, `translate(${fr.x} ${fr.y}) scale(${fr.s})`, inner)}`;
  return wrap(c, body, { grade: '#4E6A7E', gradeOpacity: 0.2, vignette: 0.3 });
}

/** The old pier: a line of wooden posts running into the fog, Ivo at the water in one shot. */
function tidePier(v = 0) {
  const c = new Canvas(W, H);
  const horizon = 500;
  const fog = [0.5, 0.45, 0.75][v % 3] as number;
  const posts = depths(16, 1, 0.45)
    .map(({ t, s }) => {
      const x = lerp(1240, 560, t);
      const y = lerp(820, horizon + 6, t);
      const h = 300 * s;
      const w = 30 * s + 2;
      return `<rect x="${f(x - w / 2)}" y="${f(y - h)}" width="${f(w)}" height="${f(h)}" fill="#2B2724" opacity="${f(lerp(1, 0.18, t) * (1.2 - fog))}"/><rect x="${f(x - w / 2)}" y="${f(y - 3 * s)}" width="${f(w)}" height="${f(14 * s)}" fill="#C6CCCB" opacity="${f(0.25 * (1 - t))}"/>`;
    })
    .join('');
  const ivo: Model = { ...LOOK.ivo, x: 980, y: 760, h: 210, flip: true };
  const body = `
  <rect width="${W}" height="${horizon + 2}" fill="${c.linear([
    [0, '#8F9A9E'],
    [1, '#D4D8D4'],
  ])}"/>
  <rect y="${horizon}" width="${W}" height="${H - horizon}" fill="${c.linear([
    [0, '#B8C0C0'],
    [0.4, '#7E8A8E'],
    [1, '#4A5458'],
  ])}"/>
  ${swell(c, horizon, H, 121 + v, '#E6EAE8')}
  ${posts}
  ${v % 3 === 1 ? `${mirrored(ivo, 0.3)}${model(ivo)}` : ''}
  <g filter="url(#b70)" opacity="${fog}"><rect x="-200" y="300" width="2000" height="320" fill="#E4E7E4"/></g>`;
  return wrap(c, body, { grade: '#7A8A8A', gradeOpacity: 0.2, vignette: 0.3 });
}

/**
 * The pictures of Low Tide, named as the photographer's files: the six of the website keep their
 * numbers (LT_0412 is the sea wall), the others are frames around them from the same set-ups.
 */
const tideStills: Record<string, () => string> = {
  LT_0405: () => tideSeawall(1),
  LT_0409: () => tideSeawall(2),
  LT_0412: () => tideSeawall(0),
  LT_0418: () => tideSeawall(3),
  LT_0421: () => tideSeawall(4),
  LT_0427: () => tideDawn(1),
  LT_0431: () => tideDawn(0),
  LT_0436: () => tideDawn(2),
  LT_0440: () => tideDawn(3),
  LT_0446: () => tideDunes(1),
  LT_0451: () => tideDunes(2),
  LT_0457: () => tideDunes(0),
  LT_0462: () => tideDunes(3),
  LT_0468: () => tideDunes(4),
  LT_0472: () => tideDunes(5),
  LT_0497: () => tidePools(1),
  LT_0503: () => tidePools(0),
  LT_0507: () => tidePortrait(1),
  LT_0511: () => tidePortrait(2),
  LT_0515: () => tidePortrait(3),
  LT_0518: () => tidePortrait(0),
  LT_0522: () => tidePier(1),
  LT_0526: () => tidePier(0),
  LT_0530: () => tidePier(2),
};

export const TIDE_NAMES = Object.keys(tideStills);

const stills: Record<string, () => string> = {
  platform,
  tunnel,
  rain: rainStill,
  window: window_,
  train,
  diner,
  cups,
  dawn,
  sea,
  field,
  signalbox,
  anna: () =>
    portrait({
      bg: ['#0C1B2A', '#05090E'],
      bokeh: ['#F2A65A', '#F2C76E', '#2D6F86'],
      rim: '#F6B26B',
      hair: [PROFILE_BUN],
      coat: '#2A2D33',
      accent: '#A3302A',
      seed: 3,
    }),
  leo: () =>
    portrait({
      bg: ['#0E1512', '#060807'],
      bokeh: ['#3DDC84', '#FF4040', '#F2C76E'],
      rim: '#F2C76E',
      hair: [PROFILE_CAP],
      coat: '#1C2A3A',
      seed: 8,
    }),
  rosa: () =>
    portrait({
      bg: ['#2A160C', '#0D0705'],
      bokeh: ['#FFB565', '#FF4F7B', '#F2C76E'],
      rim: '#FFC88A',
      hair: PROFILE_CURLS,
      coat: '#5A2A22',
      accent: '#E8DCC8',
      seed: 12,
    }),
  sandro: () =>
    portrait({
      bg: ['#0A1622', '#04070B'],
      bokeh: ['#56E0FF', '#2D6F86', '#F2A65A'],
      rim: '#9FD4E6',
      hair: [PROFILE_CAP],
      coat: '#1A2230',
      accent: '#D9C24A',
      seed: 17,
    }),
  'map-station': () => townMap('station'),
  'map-coast': () => townMap('coast'),
};

export const STILL_NAMES = Object.keys(stills);

export function stillSvg(name: string): string {
  const draw = stills[name] ?? tideStills[name];
  if (!draw) throw new Error(`no still ${name}`);
  return draw();
}

/** Pixel size of a still: portraits are square, maps as the server makes them, the rest 16:9. */
export function stillSize(name: string) {
  if (name.startsWith('map-')) return { width: MAP_W, height: MAP_H };
  return ['anna', 'leo', 'rosa', 'sandro'].includes(name)
    ? { width: 1200, height: 1200 }
    : { width: W, height: H };
}
