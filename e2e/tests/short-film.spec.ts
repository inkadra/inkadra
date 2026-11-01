import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chooseSelect } from '../helpers/select.ts';

/**
 * Gate 0.3: a short film of 3 scenes and 30 shots is prepared entirely in Inkadra, from the
 * moodboard to the shot list. One story, told only through the UI, as a filmmaker would.
 */
const admin = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

/** A small PNG made of coloured bands, so the worker finds a palette in it. */
function bands(colors: Array<[number, number, number]>, width = 360, height = 240): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const band = colors[Math.floor((y / height) * colors.length)] as [number, number, number];
    const o = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) rows.set(band, o + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test.use({ actionTimeout: 15_000 });

/** Three scenes, 10 + 9 + 9 action paragraphs: one frame each, 28 in all. */
const screenplay = {
  scenes: [
    {
      heading: 'EXT. BINARIO 4 - NOTTE #1#',
      actions: [
        'La pioggia batte sulla pensilina vuota. Un tabellone gracchia: ultimo treno, ore 23:58.',
        'ELENA (30 anni, cappotto troppo leggero, valigia a rotelle) corre lungo il binario.',
        'Il capotreno MARCO fischia e alza la paletta. Le porte iniziano a chiudersi.',
        'Elena infila la valigia tra le porte e si butta dentro.',
        'Sul binario resta un biglietto bagnato, portato via dal vento.',
        'Il treno parte. Le luci della stazione scorrono sul vetro, una a una.',
        'Dentro, Elena riprende fiato appoggiata alla porta.',
        "Marco la guarda dall'altro capo del corridoio, la paletta sotto il braccio.",
        'Il neon della pensilina lampeggia e si spegne sul binario deserto.',
        'Un campanello lontano segna la mezzanotte.',
      ],
      lines: { 2: ['MARCO', 'Biglietto?'], 3: ['ELENA', 'Dopo. Per favore, dopo.'] },
    },
    {
      heading: 'INT. VAGONE ULTIMO TRENO - NOTTE #2#',
      actions: [
        'Il vagone è quasi vuoto. Una signora dorme, un ragazzo ascolta musica a occhi chiusi.',
        'Elena si siede e apre la valigia: dentro, una vecchia radio a valvole.',
        'Marco passa con la torcia e si ferma davanti a lei.',
        'Elena accende la radio. Dalle valvole esce una voce lontana, quasi una canzone.',
        'Marco riconosce la melodia e abbassa la torcia.',
        'Fuori dal finestrino, le campagne scorrono nere sotto la pioggia.',
        'Marco si siede di fronte a lei, senza chiedere.',
        'Il riflesso di Elena e Marco si sovrappone al paesaggio nel vetro.',
        'La radio tace di colpo. Restano il ritmo delle rotaie e il respiro dei due.',
      ],
      lines: {
        2: ['MARCO', 'Mia madre cantava questa.'],
        3: ['ELENA', 'Era di mio nonno, la radio.'],
      },
    },
    {
      heading: 'EXT. PIAZZALE DELLA STAZIONE - ALBA #3#',
      actions: [
        'Il treno entra piano nella stazione di arrivo, dorato dalla prima luce.',
        'Le porte si aprono. Scendono la signora e il ragazzo con le cuffie.',
        'Elena scende con la valigia e si guarda intorno nel piazzale vuoto.',
        'Marco si affaccia dalla porta e le porge il biglietto, asciutto.',
        'Elena sorride, lo prende e lo infila nella tasca del cappotto.',
        'Un taxi aspetta con il motore acceso, i fari nella foschia.',
        'Elena sale sul taxi. La radio, sul sedile, riprende a cantare.',
        'Marco resta sul marciapiede e la guarda allontanarsi.',
        'Il treno riparte vuoto verso il deposito, tra i primi raggi del sole.',
      ],
      lines: { 3: ['MARCO', 'Il tuo biglietto. Era valido da sempre.'] },
    },
  ],
};

function fountain(): string {
  const body = screenplay.scenes.map((scene) => {
    const lines = scene.lines as Record<number, string[]>;
    const blocks = scene.actions.map((action, i) => {
      const spoken = lines[i];
      return spoken ? `${action}\n\n${spoken[0]}\n${spoken[1]}` : action;
    });
    return `${scene.heading}\n\n${blocks.join('\n\n')}`;
  });
  return `Title: ULTIMO TRENO\nAuthor: Giulia Bianchi\n\n${body.join('\n\n')}\n`;
}

const references = [
  {
    name: 'binario-notte.png',
    colors: [
      [20, 30, 70],
      [200, 120, 30],
      [10, 10, 10],
    ],
  },
  {
    name: 'neon-stazione.png',
    colors: [
      [230, 40, 90],
      [30, 200, 220],
      [25, 25, 40],
    ],
  },
  {
    name: 'alba-vagone.png',
    colors: [
      [250, 200, 120],
      [120, 150, 200],
      [60, 50, 40],
    ],
  },
  {
    name: 'pioggia-vetro.png',
    colors: [
      [90, 110, 120],
      [40, 60, 70],
      [200, 210, 215],
    ],
  },
] as const;

/** Screenshots of the awkward moments, for the gate report; only when E2E_SHOTS names a folder. */
async function gap(page: Page, name: string) {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: join(dir, `${name}.png`) });
}

async function readPdf(path: string) {
  const pdf = await getDocument({ data: new Uint8Array(await readFile(path)) }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  const meta = await pdf.getMetadata();
  return { pages, title: (meta.info as { Title?: string }).Title ?? '' };
}

/** What the shooting crew sets on the first ten frames. */
const details = [
  { shot: 'ws', angle: 'high', movement: 'static', lens: '24mm', seconds: '5', cast: 'Elena' },
  { shot: 'fs', angle: 'eye', movement: 'handheld', lens: '35mm', seconds: '3', cast: 'Elena' },
  { shot: 'ms', angle: 'low', movement: 'dolly', lens: '50mm', seconds: '4', cast: 'Marco' },
  { shot: 'cu', angle: 'eye', movement: 'handheld', lens: '85mm', seconds: '3', cast: 'Elena' },
  { shot: 'insert', angle: 'overhead', movement: 'static', lens: '100mm', seconds: '2', cast: '' },
  { shot: 'ws', angle: 'eye', movement: 'tilt', lens: '24mm', seconds: '6', cast: '' },
  {
    shot: 'mcu',
    angle: 'ots',
    movement: 'steadicam',
    lens: '50mm',
    seconds: '4',
    cast: 'Elena, Marco',
  },
  { shot: 'ms', angle: 'pov', movement: 'pan', lens: '35mm', seconds: '3', cast: 'Marco' },
  { shot: 'ews', angle: 'high', movement: 'crane', lens: '18mm', seconds: '5', cast: '' },
  { shot: 'ecu', angle: 'dutch', movement: 'zoom', lens: '100mm', seconds: '2', cast: 'Elena' },
] as const;

/** The rows of an RFC 4180 file, as the CSV export writes it (every field quoted). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const body = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && body[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  if (field || row.length > 0) rows.push([...row, field]);
  return rows;
}

async function synced(page: Page) {
  await expect(page.getByRole('status').getByText('Sincronizzato')).toBeVisible();
}

test('a short film is prepared from the moodboard to the shot list', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240_000);

  await test.step('1. new project from the Film pre-production template', async () => {
    await page.goto('/login');
    // The instance may be new (this spec alone) or already have its administrator.
    const create = page.getByRole('button', { name: 'Crea account e accedi' });
    const signIn = page.getByRole('button', { name: 'Accedi', exact: true });
    await expect(create.or(signIn)).toBeVisible();
    if (await create.isVisible()) {
      await page.getByLabel('Nome').fill(admin.name);
      await page.getByLabel('Email').fill(admin.email);
      await page.getByLabel('Password').fill(admin.password);
      await page.getByRole('button', { name: 'Crea account e accedi' }).click();
    } else {
      await page.getByLabel('Email').fill(admin.email);
      await page.getByLabel('Password').fill(admin.password);
      await signIn.click();
    }
    await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();

    await page.getByRole('button', { name: 'Nuovo progetto' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Nuovo progetto' });
    await dialog.getByLabel('Nome del progetto').fill('Ultimo Treno');
    await dialog.getByRole('button', { name: /^Dettagli/ }).click();
    await dialog.getByRole('radio', { name: 'Cortometraggio' }).check();
    await dialog.getByRole('radio', { name: /Pre-produzione film/ }).check();
    await dialog.getByRole('button', { name: 'Crea progetto' }).click();
    await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await synced(page);
    // The template made five boards, linked from the project's first board.
    for (const title of ['Brief', 'Location', 'Casting', 'Moodboard', 'Storyboard e shotlist']) {
      await expect(page.locator('[data-type="board"]', { hasText: title })).toHaveCount(1);
    }
  });

  await test.step('2. moodboard: pictures, palette, note, link', async () => {
    await page.locator('[data-type="board"]', { hasText: /^Moodboard/ }).dblclick();
    await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}$/);
    await synced(page);
    const canvas = page.getByTestId('canvas');

    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('i');
    await (await chooser).setFiles(
      references.map((r) => ({
        name: r.name,
        mimeType: 'image/png',
        buffer: bands(r.colors as unknown as Array<[number, number, number]>),
      })),
    );
    const images = canvas.locator('[data-type="image"]');
    await expect(images).toHaveCount(4, { timeout: 60_000 });
    await expect(images.locator('img')).toHaveCount(4, { timeout: 60_000 });

    // The palette of a picture goes on the board as colour swatches.
    const swatches = canvas.locator('[data-type="color"]');
    const before = await swatches.count();
    // The four uploads land stacked at the centre of the board.
    await gap(page, 'moodboard-uploads-stacked');
    // Pull them apart, top one first, into the free area under the template's columns.
    const stack = (await images.first().boundingBox()) as { x: number; y: number };
    for (let i = 0; i < 4; i++) {
      await page.mouse.move(stack.x + 110 + i * 8, stack.y + 90 + i * 8);
      await page.mouse.down();
      await page.mouse.move(300 + i * 190, 280, { steps: 6 });
      await page.mouse.up();
    }
    await page.keyboard.press('Escape');
    await images.first().dblclick();
    const addColors = page.getByRole('button', { name: 'Aggiungi i colori alla board' });
    await expect(addColors).toBeVisible({ timeout: 60_000 });
    await addColors.click();
    await expect(addColors).toBeHidden();
    await expect.poll(() => swatches.count()).toBeGreaterThan(before);

    // A swatch of our own, named.
    const withOwn = await swatches.count();
    await page.keyboard.press('k');
    await expect(swatches).toHaveCount(withOwn + 1);
    const own = canvas.locator('[data-type="color"].is-selected');
    await own.getByLabel('Nome del colore').fill('Giallo sodio');
    await own.getByLabel('Nome del colore').press('Enter');
    await expect(own.getByLabel('Nome del colore')).toHaveValue('Giallo sodio');

    // A note and a link.
    await page.keyboard.press('Escape');
    await page.keyboard.press('n');
    await page.keyboard.type('Luce sodio contro blu bagnato, mai luce piena');
    await page.keyboard.press('Escape');
    const note = canvas.locator('[data-type="note"]', { hasText: 'Luce sodio contro blu bagnato' });
    await expect(note).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('l');
    await page
      .getByLabel('Indirizzo del link')
      .fill('https://example.org/riferimenti/notte-in-stazione');
    await page.keyboard.press('Enter');
    await expect(canvas.locator('[data-type="link"]')).toHaveCount(1);
    await expect(canvas.locator('[data-type="link"]')).toContainText('example.org');
    await synced(page);

    // The Moodboard view collects pictures, link and palette.
    await page.getByRole('tab', { name: 'Moodboard' }).click();
    const gallery = page.getByRole('region', { name: 'Moodboard', exact: true });
    await expect(gallery.locator('.moodboard__card--color')).toContainText('Giallo sodio');
    // Pictures without a caption are all "Immagine": the view cannot tell them apart by name.
    await expect(gallery.getByRole('button', { name: 'Apri Immagine' })).toHaveCount(4);
    await gap(page, 'moodboard-view');
    await page.getByRole('tab', { name: 'Lavagna' }).click();
  });
  await test.step('3. storyboard: screenplay import, 30 frames, details, pen, picture, reorder', async () => {
    await page.getByRole('banner').getByRole('link', { name: 'Ultimo Treno' }).click();
    await page.locator('[data-type="board"]', { hasText: 'Storyboard e shotlist' }).dblclick();
    await expect(page.getByRole('tab', { name: 'Storyboard', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await synced(page);
    const tiles = page.locator('.story__tile');
    // The template's sample scene with three empty frames goes: the script brings its own.
    await expect(tiles).toHaveCount(3);
    await page
      .getByRole('region', { name: 'Scena 1' })
      .getByRole('button', { name: 'Elimina la scena' })
      .click();
    await expect(tiles).toHaveCount(0);

    await page.getByRole('button', { name: 'Importa sceneggiatura…' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Importa una sceneggiatura' });
    await dialog.getByLabel('Scegli un file').setInputFiles({
      name: 'ultimo-treno.fountain',
      mimeType: 'text/plain',
      buffer: Buffer.from(fountain()),
    });
    await expect(dialog.getByText('ULTIMO TRENO', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/di Giulia Bianchi · 3 scene · 2 personaggi/)).toBeVisible();
    await chooseSelect(dialog.getByLabel('Al massimo per scena'), '12');
    await expect(dialog.getByText('Crea 3 scene e 28 inquadrature.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Importa', exact: true }).click();
    await expect(dialog).toBeHidden();
    for (const [n, count] of [
      ['1', 10],
      ['2', 9],
      ['3', 9],
    ] as const) {
      await expect(
        page.getByRole('region', { name: `Scena ${n}`, exact: true }).locator('.story__tile'),
      ).toHaveCount(count);
    }
    await expect(page.locator('.story__total').first()).toContainText('28 inquadrature');

    // Edit down and up to exactly 30: four new frames, then two removed.
    const scene1 = page.getByRole('region', { name: 'Scena 1', exact: true });
    const scene2 = page.getByRole('region', { name: 'Scena 2', exact: true });
    const scene3 = page.getByRole('region', { name: 'Scena 3', exact: true });
    const panel = page.getByRole('complementary', { name: 'Dettagli' });
    for (const scene of [scene1, scene1, scene2, scene2]) {
      await scene.getByRole('button', { name: 'Nuova inquadratura' }).last().click();
      await expect(panel).toBeVisible();
    }
    await expect(tiles).toHaveCount(32);
    for (let i = 0; i < 2; i++) {
      await scene3.locator('.story__tile-pic').last().click();
      await panel.getByRole('button', { name: 'Elimina l’inquadratura' }).click();
    }
    await expect(tiles).toHaveCount(30);
    await expect(page.locator('.story__total').first()).toContainText('30 inquadrature');
    await synced(page);
    // Shooting details on the first ten frames of scene 1.
    for (const [i, d] of details.entries()) {
      const label = `1${String.fromCharCode(65 + i)}`;
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(panel.locator('.film-panel__label')).toHaveText(label);
      await chooseSelect(panel.getByLabel('Campo', { exact: true }), d.shot);
      await chooseSelect(panel.getByLabel('Angolazione', { exact: true }), d.angle);
      await chooseSelect(panel.getByLabel('Movimento', { exact: true }), d.movement);
      await panel.getByLabel('Obiettivo', { exact: true }).fill(d.lens);
      await panel.getByLabel('Obiettivo', { exact: true }).press('Enter');
      await panel.getByLabel('Durata (s)').fill(d.seconds);
      await panel.getByLabel('Durata (s)').press('Enter');
      if (d.cast) {
        await panel.getByLabel('Personaggi', { exact: true }).fill(d.cast);
        await panel.getByLabel('Personaggi', { exact: true }).press('Enter');
      }
    }
    await expect(scene1.locator('.story__tile').nth(0)).toContainText('0:05');

    // A pen sketch on 1B.
    await page.getByRole('button', { name: '1B', exact: true }).click();
    await panel.getByRole('button', { name: 'Disegna' }).click();
    const pen = page.getByRole('dialog', { name: /Disegno dell’inquadratura 1B/ });
    const area = pen.locator('.pen__area');
    const box = await area.boundingBox();
    if (!box) throw new Error('no drawing area');
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(
        box.x + box.width * (0.2 + i * 0.06),
        box.y + box.height * (0.6 - i * 0.03),
      );
    }
    await page.mouse.up();
    await expect(area.locator('.frame-pic__ink path')).toHaveCount(1);
    await pen.getByRole('button', { name: 'Fatto' }).click();
    await expect(pen).toBeHidden();
    await expect(scene1.locator('.story__tile').nth(1).locator('.frame-pic__ink path')).toHaveCount(
      1,
    );

    // An uploaded picture on 1C.
    await page.getByRole('button', { name: '1C', exact: true }).click();
    const picker = page.waitForEvent('filechooser');
    await panel.getByRole('button', { name: 'Carica un’immagine' }).click();
    await (await picker).setFiles({
      name: 'sopralluogo-vagone.png',
      mimeType: 'image/png',
      buffer: bands([
        [60, 70, 90],
        [200, 170, 110],
        [30, 30, 35],
      ]),
    });
    await expect(scene1.locator('.story__tile').nth(2).locator('img')).toBeVisible({
      timeout: 60_000,
    });

    // Reorder by drag: 1D goes to the front of the scene.
    const dragged = scene1.locator('.story__tile').nth(3);
    await expect(dragged).toContainText('Elena infila la valigia');
    await dragged.dragTo(scene1.locator('.story__tile').first(), {
      targetPosition: { x: 6, y: 20 },
    });
    await expect(scene1.locator('.story__tile').first()).toContainText('Elena infila la valigia');
    await expect(scene1.locator('.story__tile').nth(1)).toContainText(
      'La pioggia batte sulla pensilina',
    );
    await page.getByRole('button', { name: 'Chiudi i dettagli' }).click();
    await synced(page);
  });
  await test.step('4. shot list: rows, filter, status, CSV', async () => {
    await page.getByRole('tab', { name: 'Shot list' }).click();
    await expect(page).toHaveURL(/view=shotlist/);
    const rows = page.locator('.shots__table tbody tr:not(.shots__scene):not(.shots__add-row)');
    const rowOf = (label: string) =>
      rows.filter({ has: page.getByRole('checkbox', { name: `Seleziona inquadratura ${label}` }) });
    await expect(rows).toHaveCount(30);
    await expect(page.locator('.shots__scene')).toHaveCount(3);
    // What was set in the storyboard is in the table: 1B is the old 1A.
    await expect(rowOf('1B').getByLabel('Obiettivo', { exact: true })).toHaveValue(details[0].lens);
    await expect(rowOf('1B').getByLabel('Campo', { exact: true })).toHaveAttribute(
      'data-value',
      details[0].shot,
    );

    // Filter by text: the frames that speak of the radio.
    const wanted = screenplay.scenes.flatMap((scene, n) => {
      const kept = n === 2 ? scene.actions.slice(0, -2) : scene.actions;
      const lines = scene.lines as Record<number, string[]>;
      return kept.filter((a, i) =>
        `${a} ${(lines[i] ?? []).join(' ')}`.toLowerCase().includes('radio'),
      );
    });
    const filter = page.getByLabel('Filtra le inquadrature');
    await filter.fill('radio');
    await expect(rows).toHaveCount(wanted.length);
    await filter.fill('');
    await expect(rows).toHaveCount(30);

    // Six shots to shoot, ticked and changed together; a seventh from its own row.
    for (const label of ['1A', '1B', '1C', '2A', '2B', '3A']) {
      await page.getByRole('checkbox', { name: `Seleziona inquadratura ${label}` }).check();
    }
    const bulk = page.getByRole('toolbar', { name: 'Azioni sulle righe selezionate' });
    await expect(bulk).toContainText('6 selezionate');
    await chooseSelect(bulk.getByLabel('Cambia stato'), 'todo');
    await bulk.getByRole('button', { name: 'Deseleziona' }).click();
    await chooseSelect(rowOf('3B').getByLabel('Stato', { exact: true }), 'todo');
    await rowOf('3B').getByLabel('Stato', { exact: true }).blur();
    const byStatus = page.locator('.story__bar').getByLabel('Stato', { exact: true });
    await chooseSelect(byStatus, 'todo');
    await expect(rows).toHaveCount(7);
    await chooseSelect(byStatus, '');
    await expect(rows).toHaveCount(30);

    // The CSV has a header and one row per shot, as the table.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Esporta CSV' }).click(),
    ]);
    const csvPath = info.outputPath('shotlist.csv');
    await download.saveAs(csvPath);
    const csv = parseCsv(await readFile(csvPath, 'utf8'));
    expect(csv[0]).toContain('Obiettivo');
    expect(csv).toHaveLength(31);
    const status = (csv[0] as string[]).indexOf('Stato');
    expect(csv.slice(1).filter((r) => r[status] === 'Da girare')).toHaveLength(7);
    expect(csv.slice(1).every((r) => r.length === (csv[0] as string[]).length)).toBe(true);
    await gap(page, 'shotlist');
  });

  await test.step('5. schedule: two shooting days and the call sheet', async () => {
    await page.getByRole('tab', { name: 'Piano riprese', exact: true }).click();
    const schedule = page.getByRole('region', { name: 'Piano riprese', exact: true });
    const days = schedule.locator('.schedule__day');
    const inspector = schedule.getByRole('complementary', {
      name: 'Dettagli del giorno di riprese',
    });
    const queue = schedule.locator('.schedule__queue .schedule__shot');
    await expect(queue).toHaveCount(30);
    const plan = [
      { date: '2026-11-09', location: 'Stazione di Ponte Rotto', shots: 8 },
      { date: '2026-11-10', location: 'Vagone storico, deposito', shots: 6 },
    ];
    for (const [n, day] of plan.entries()) {
      await schedule
        .getByRole('button', { name: 'Aggiungi giorno di riprese', exact: true })
        .first()
        .click();
      await expect(days).toHaveCount(n + 1);
      await inspector.getByLabel('Data', { exact: true }).fill(day.date);
      await inspector.getByLabel('Convocazione', { exact: true }).fill('07:30');
      await inspector.getByLabel('Location', { exact: true }).fill(day.location);
      await inspector.getByRole('button', { name: 'Salva giorno', exact: true }).click();
      await expect(
        inspector.getByRole('button', { name: 'Salva giorno', exact: true }),
      ).toBeEnabled();
      const target = days.filter({ hasText: `Giorno ${n + 1}` });
      // The first shot is dragged onto the day, the others added with a click.
      await queue.first().dragTo(target);
      await expect(target.locator('.schedule__block')).toHaveCount(1);
      for (let i = 1; i < day.shots; i++) {
        await queue.first().click();
        await expect(target.locator('.schedule__block')).toHaveCount(i + 1);
      }
    }
    await expect(schedule.locator('.story__bar .story__total')).toContainText(
      '2 giorni di riprese · 14 di 30 inquadrature pianificate',
    );
    await gap(page, 'schedule');

    await schedule.getByRole('button', { name: 'Foglio di lavorazione' }).click();
    const sheet = page.getByRole('dialog', { name: 'Foglio di lavorazione' });
    await sheet.getByRole('combobox', { name: 'Data', exact: true }).click();
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(2);
    await page.keyboard.press('Escape');
    const preview = sheet.getByRole('article', { name: 'Anteprima foglio di lavorazione' });
    // It opens on the day last edited; the other day is one choice away.
    await expect(preview).toContainText('Vagone storico, deposito');
    await gap(page, 'call-sheet');
    await chooseSelect(sheet.getByRole('combobox', { name: 'Data', exact: true }), { index: 0 });
    await expect(preview).toContainText('Stazione di Ponte Rotto');
    await expect(preview).toContainText('1A');
    await expect(sheet.getByRole('button', { name: 'Stampa / esporta' })).toBeEnabled();
    await sheet.getByRole('button', { name: 'Chiudi', exact: true }).click();
    await expect(sheet).toBeHidden();
  });

  await test.step('6. storyboard PDF for the team', async () => {
    await page.getByRole('tab', { name: 'Storyboard', exact: true }).click();
    await page.getByRole('button', { name: 'Esporta PDF' }).click();
    const dialog = page.getByRole('dialog', { name: 'Esporta' });
    await dialog.getByRole('radio', { name: 'Il team' }).click();
    const cover = dialog.getByRole('checkbox', { name: /Copertina/ });
    if (!(await cover.isChecked())) await cover.check();
    await dialog.getByRole('radio', { name: '6', exact: true }).click();
    // A title page and thirty frames, six to a page.
    await expect(dialog.getByText('6 pagine')).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Esporta', exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('Storyboard e shotlist.pdf');
    const pdfPath = info.outputPath('storyboard.pdf');
    await download.saveAs(pdfPath);
    const pdf = await readPdf(pdfPath);
    expect(pdf.title).toBe('Storyboard e shotlist');
    expect(pdf.pages).toHaveLength(6);
    expect(pdf.pages[0]).toContain('Ultimo Treno');
    expect(pdf.pages[1]).toContain('1A');
    expect(pdf.pages[1]).toContain('La pioggia batte sulla pensilina');
    expect(pdf.pages[1]).toContain('2 di 6');
    expect(pdf.pages[5]).toContain('3G');
    expect(pdf.pages[5]).toContain('6 di 6');
    await expect(dialog).toBeHidden();
  });

  await test.step('7. client link: guest approves a frame and comments', async () => {
    await page.getByRole('button', { name: 'Condividi' }).click();
    const share = page.getByRole('dialog', { name: /^Condividi/ });
    await share.getByRole('tab', { name: 'Link per ospiti' }).click();
    await share.getByRole('button', { name: 'Nuovo link per ospiti' }).click();
    await chooseSelect(share.getByLabel('Chi apre il link'), 'guest_approve');
    await share.getByLabel('Per chi è (facoltativo)').fill('Cliente');
    await share.getByRole('button', { name: 'Crea link per ospiti' }).click();
    const url = share.getByRole('textbox', { name: 'Link per ospiti “Cliente”' });
    await expect(url).toHaveValue(/\/s\/[\w-]{16,}$/);
    const guestUrl = await url.inputValue();
    await page.keyboard.press('Escape');

    const context = await browser.newContext({ locale: 'it-IT', colorScheme: 'dark' });
    const guest = await context.newPage();
    await guest.goto(guestUrl);
    await expect(guest.getByText('Ospite · può approvare')).toBeVisible();
    await expect(guest.locator('[data-el]').first()).toBeVisible({ timeout: 30_000 });
    await chooseSelect(guest.getByLabel('Card', { exact: true }), { label: '1B' });
    const panel = guest.getByRole('complementary', { name: 'Dettagli e commenti' });
    await panel.getByRole('button', { name: 'Approva' }).click();
    const naming = guest.getByRole('dialog', { name: 'Come ti chiami?' });
    await naming.getByLabel('Il tuo nome').fill('Luca Neri');
    await naming.getByRole('button', { name: 'Continua' }).click();
    await expect(panel.getByText('Card approvata.')).toBeVisible();
    await guest
      .getByLabel('Scrivi un commento')
      .fill('Il primo piano in 1B funziona: più luce sul volto.');
    await guest.getByRole('button', { name: 'Commenta' }).click();
    await expect(
      guest.locator('.guest-comment').filter({ hasText: 'più luce sul volto' }),
    ).toBeVisible();
    await context.close();

    // Back as the owner: the approval is on the frame and in the review view.
    const tile = page
      .locator('.story__tile')
      .filter({ has: page.getByRole('button', { name: '1B', exact: true }) });
    await expect(tile.getByRole('button', { name: /Revisione: Approvata/ })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: /^Commenti: 1 discussione aperta/ }).click();
    const comments = page.getByRole('complementary', { name: 'Commenti' });
    await expect(comments.getByText('più luce sul volto')).toBeVisible();
    await expect(comments.getByText('Ospite del link “Cliente”')).toBeVisible();
    await page.getByRole('tab', { name: 'Revisione', exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: 'Revisione', exact: true })
        .getByText('1 di 30 inquadrature approvate'),
    ).toBeVisible();
    await gap(page, 'review');
  });
});
