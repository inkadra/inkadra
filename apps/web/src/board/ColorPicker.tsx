import { swallowOutsidePress } from '@inkadra/ui';
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { CopyHexButton } from './cards.tsx';
import { hexToHsv, hexToRgb, hsvToHex, parseHex, rgbToHex } from './colors.ts';

/**
 * The colour picker of a swatch (#308): a saturation and value square, a hue slider, hex and
 * RGB fields with copy, and the colours already on the board. It opens beside the card `id`
 * (as a sheet above the toolbar on phones) and closes on Escape or a press outside both.
 */
export function ColorPicker({
  id,
  hex,
  used,
  onChange,
  onCopied,
  onClose,
}: {
  id: string;
  hex: string;
  /** Colours of the board's swatches, to pick again. */
  used: readonly string[];
  onChange: (hex: string) => void;
  onCopied?: ((text: string) => void) | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const square = useRef<HTMLDivElement>(null);
  // The hue stays put while the colour is grey or black, where the hex no longer holds it.
  const [hsv, setHsv] = useState(() => hexToHsv(hex));
  // The hex this picker last showed: a different one came from the fields or someone else.
  const [shown, setShown] = useState(hex);
  if (hex !== shown) {
    const next = hexToHsv(hex);
    setShown(hex);
    setHsv(next[1] === 0 || next[2] === 0 ? [hsv[0], next[1], next[2]] : next);
  }
  const [h, s, v] = hsv;
  const set = (next: [number, number, number]) => {
    const value = hsvToHex(...next);
    setHsv(next);
    setShown(value);
    if (value !== hex) onChange(value);
  };

  // Beside the card, on the side with room; a sheet above the toolbar on a phone.
  useLayoutEffect(() => {
    const el = ref.current;
    const room = el?.offsetParent as HTMLElement | null;
    const card = room?.querySelector(`[data-el="${id}"]`);
    if (!el || !room || !card) return;
    const r = room.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    if (room.clientWidth < 768) {
      el.style.left = '10px';
      el.style.top = `${Math.max(8, room.clientHeight - el.offsetHeight - 80)}px`;
      return;
    }
    const right = c.right - r.left + 8;
    const left =
      right + el.offsetWidth > room.clientWidth - 8 ? c.left - r.left - 8 - el.offsetWidth : right;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, Math.min(c.top - r.top, room.clientHeight - el.offsetHeight - 8))}px`;
  });

  useEffect(() => {
    square.current?.focus({ preventScroll: true });
    const away = (e: globalThis.PointerEvent) => {
      const target = e.target as Element;
      if (ref.current?.contains(target) || target.closest?.(`[data-el="${id}"]`)) return;
      swallowOutsidePress(e);
      onClose();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [id, onClose]);

  /** Pointer drags on the square and the slider, from where they were pressed. */
  const drag = (pick: (x: number, y: number) => void) => (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const at = (p: { clientX: number; clientY: number }) => {
      const b = el.getBoundingClientRect();
      const clamp = (n: number) => Math.max(0, Math.min(1, n));
      pick(clamp((p.clientX - b.left) / b.width), clamp((p.clientY - b.top) / b.height));
    };
    el.setPointerCapture(e.pointerId);
    el.focus({ preventScroll: true });
    at(e);
    el.onpointermove = (m) => at(m);
    el.onpointerup = () => {
      el.onpointermove = null;
    };
  };
  /** Arrow keys step 1% (or 1° of hue), 10 with Shift. */
  const keys = (move: (dx: number, dy: number) => void) => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[
      e.key
    ];
    if (!d) return;
    e.preventDefault();
    move((d[0] ?? 0) * step, (d[1] ?? 0) * step);
  };
  const unit = (n: number) => Math.max(0, Math.min(1, n));
  const rgb = hexToRgb(hex);
  const channels = [t('board.color.red'), t('board.color.green'), t('board.color.blue')];

  return (
    <div
      ref={ref}
      className="colorpicker"
      role="dialog"
      aria-label={t('board.color.picker')}
      data-chrome
      onKeyDown={(e) => {
        // The board's own keys (nudge, delete, tools) stay out of the picker.
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div
        ref={square}
        className="colorpicker__square"
        style={{ backgroundColor: hsvToHex(h, 1, 1) }}
        role="slider"
        tabIndex={0}
        aria-label={t('board.color.square')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(s * 100)}
        aria-valuetext={t('board.color.squareValue', {
          s: Math.round(s * 100),
          v: Math.round(v * 100),
        })}
        onPointerDown={drag((x, y) => set([h, x, 1 - y]))}
        onKeyDown={keys((dx, dy) => set([h, unit(s + dx / 100), unit(v + dy / 100)]))}
      >
        <i style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: hex }} />
      </div>
      <div
        className="colorpicker__hue"
        role="slider"
        tabIndex={0}
        aria-label={t('board.color.hue')}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(h)}
        onPointerDown={drag((x) => set([Math.min(359.9, x * 360), s, v]))}
        onKeyDown={keys((dx, dy) => set([(h + dx + dy + 360) % 360, s, v]))}
      >
        <i style={{ left: `${(h / 360) * 100}%`, background: hsvToHex(h, 1, 1) }} />
      </div>
      <div className="colorpicker__fields">
        <label>
          <input
            key={hex}
            className="ink-mono"
            defaultValue={hex}
            spellCheck={false}
            aria-label={t('board.color.hex')}
            onBlur={(e) => {
              const next = parseHex(e.target.value);
              if (next && next !== hex) onChange(next);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <small aria-hidden="true">Hex</small>
        </label>
        {channels.map((name, i) => (
          <label key={name}>
            <input
              className="ink-mono"
              type="number"
              inputMode="numeric"
              min={0}
              max={255}
              value={rgb[i]}
              aria-label={name}
              onChange={(e) => {
                if (e.target.value === '') return;
                onChange(rgbToHex(rgb.map((c, j) => (j === i ? Number(e.target.value) : c))));
              }}
            />
            <small aria-hidden="true">{'RGB'[i]}</small>
          </label>
        ))}
        <div>
          <CopyHexButton hex={hex} onCopied={onCopied} />
          <small aria-hidden="true">&nbsp;</small>
        </div>
      </div>
      {used.length > 0 && (
        <>
          <p className="colorpicker__label ink-muted">{t('board.color.fromBoard')}</p>
          <div className="colorpicker__used">
            {used.map((c) => (
              <button
                key={c}
                type="button"
                style={{ background: c, color: c }}
                aria-label={t('board.color.use', { hex: c })}
                aria-pressed={c === hex}
                data-ink-tooltip={c}
                onClick={() => onChange(c)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
