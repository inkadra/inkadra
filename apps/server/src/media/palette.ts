/**
 * Dominant colours of an image by median cut over its pixels (RGB triplets), largest share
 * first. Pass a small rendition (64×64 is plenty): the cost is linear in the pixel count.
 */
export function palette(rgb: Uint8Array, count = 6): string[] {
  const n = Math.floor(rgb.length / 3);
  if (n === 0) return [];
  const value = (pixel: number, channel: number) => rgb[pixel * 3 + channel] ?? 0;

  let boxes: number[][] = [Array.from({ length: n }, (_, i) => i)];
  while (boxes.length < count) {
    // Split the box with the widest channel range.
    let best = -1;
    let channel = 0;
    let widest = 0;
    boxes.forEach((box, i) => {
      for (let c = 0; c < 3; c++) {
        let min = 255;
        let max = 0;
        for (const p of box) {
          const v = value(p, c);
          if (v < min) min = v;
          if (v > max) max = v;
        }
        if (max - min > widest) {
          widest = max - min;
          best = i;
          channel = c;
        }
      }
    });
    if (best < 0) break; // every box is a single colour
    const box = (boxes[best] ?? []).sort((a, b) => value(a, channel) - value(b, channel));
    // Cut at the value change nearest the median, so one colour never lands in two boxes.
    const changesAt = (i: number) =>
      i > 0 && i < box.length && value(box[i - 1] ?? 0, channel) !== value(box[i] ?? 0, channel);
    const median = box.length >> 1;
    let cut = median;
    for (let d = 0; d < box.length; d++) {
      if (changesAt(median - d)) {
        cut = median - d;
        break;
      }
      if (changesAt(median + d)) {
        cut = median + d;
        break;
      }
    }
    boxes = [...boxes.slice(0, best), box.slice(0, cut), box.slice(cut), ...boxes.slice(best + 1)];
  }

  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0').toUpperCase();
  const average = (box: number[], c: number) =>
    box.reduce((sum, p) => sum + value(p, c), 0) / box.length;
  return boxes
    .filter((b) => b.length > 0)
    .sort((a, b) => b.length - a.length)
    .map((box) => `#${hex(average(box, 0))}${hex(average(box, 1))}${hex(average(box, 2))}`)
    .filter((c, i, all) => all.indexOf(c) === i);
}
