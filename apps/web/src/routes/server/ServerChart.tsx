import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { formatDateTime } from '../../lib/datetime.ts';

/** Series colours come from tokens through these names (server.css): never a literal colour. */
export type Tone = 'cpu' | 'memory' | 'in' | 'out';

export interface ChartSeries {
  label: string;
  tone: Tone;
  values: Array<number | null>;
  /** Drawn downwards from the middle line (traffic sent, in the advanced network chart). */
  below?: boolean;
}

export interface ChartMarker {
  /** When it happened (ISO). */
  t: string;
  label: string;
}

/** The window the chart spans, in ms, and how far apart its points are. */
export interface ChartSpan {
  from: number;
  to: number;
  step: number;
}

const PAD = { left: 52, right: 6, top: 8, bottom: 20 };

/**
 * Points of a series, split where values are missing or no sample came for a while (a stopped
 * server), so the line does not lie across a gap.
 */
export function segments(
  values: Array<number | null>,
  at: number[],
  gap: number,
  x: (i: number) => number,
  y: (v: number) => number,
) {
  const out: string[][] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    const after = (at[i] ?? 0) - (at[i - 1] ?? Number.NEGATIVE_INFINITY) > gap;
    if ((v === null || after) && current.length) {
      out.push(current);
      current = [];
    }
    if (v !== null) current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (current.length) out.push(current);
  return out;
}

/**
 * A small line chart drawn with SVG and theme tokens (#514): grid, the series with a light area
 * under a single one, markers for events, and a crosshair with the values on hover or with the
 * arrow keys. `mirrored` puts the `below` series under a middle axis.
 */
export function ServerChart({
  label,
  times,
  span,
  series,
  max,
  ticks,
  format,
  xLabels,
  markers = [],
  height = 170,
  mirrored = false,
  compact = false,
}: {
  label: string;
  times: string[];
  span: ChartSpan;
  series: ChartSeries[];
  max: number;
  ticks: number[];
  format: (value: number) => string;
  xLabels: [string, string, string];
  markers?: ChartMarker[];
  height?: number;
  mirrored?: boolean;
  /** A sparkline: no axes, no hover. */
  compact?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = times.length;
  const at = times.map((t) => new Date(t).getTime());
  const pad = compact ? { left: 0, right: 0, top: 2, bottom: 2 } : PAD;
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const zero = mirrored ? pad.top + innerH / 2 : pad.top + innerH;
  const scale = mirrored ? innerH / 2 : innerH;
  // By time, not by index: a slice without samples leaves its room empty.
  const xAt = (ms: number) =>
    pad.left +
    Math.max(0, Math.min(1, (ms - span.from) / Math.max(1, span.to - span.from))) * innerW;
  const x = (i: number) => xAt(at[i] ?? span.to);
  const y = (v: number, below = false) =>
    zero + (below ? 1 : -1) * (Math.min(v, max) / (max || 1)) * scale;

  const move = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const px = clientX - rect.left;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setActive(best);
  };
  const onKey = (e: KeyboardEvent) => {
    if (n === 0) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = e.key === 'ArrowLeft' ? -1 : 1;
      setActive((i) => Math.max(0, Math.min(n - 1, (i ?? n - 1) + step)));
    } else if (e.key === 'Escape') setActive(null);
  };
  const time = active !== null ? times[active] : undefined;
  const values = (i: number) =>
    series.map((s) => {
      const v = s.values[i];
      return { label: s.label, text: v === null || v === undefined ? '—' : format(v) };
    });
  const when = time ? formatDateTime(time, { dateStyle: 'short', timeStyle: 'short' }) : '';

  return (
    <>
      <div
        ref={box}
        className={compact ? 'server-chart server-chart--compact' : 'server-chart'}
        // The chart is one image for assistive technology; the arrow keys read its points.
        role="img"
        aria-label={label}
        tabIndex={compact ? undefined : 0}
        onKeyDown={compact ? undefined : onKey}
        onBlur={() => setActive(null)}
        onPointerMove={compact ? undefined : (e) => move(e.clientX)}
        onPointerLeave={() => setActive(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            {!compact &&
              ticks.flatMap((tick) =>
                (mirrored && tick ? [false, true] : [false]).map((below) => (
                  <g key={`${tick}-${below}`}>
                    <line
                      className="server-chart__grid"
                      x1={pad.left}
                      x2={width - pad.right}
                      y1={y(tick, below)}
                      y2={y(tick, below)}
                    />
                    <text
                      className="server-chart__tick"
                      x={pad.left - 6}
                      y={y(tick, below) + 4}
                      textAnchor="end"
                    >
                      {format(tick)}
                    </text>
                  </g>
                )),
              )}
            {!compact &&
              xLabels.map((text, i) => (
                <text
                  // biome-ignore lint/suspicious/noArrayIndexKey: three fixed places, texts may repeat
                  key={i}
                  className="server-chart__tick"
                  x={i === 0 ? pad.left : i === 1 ? pad.left + innerW / 2 : width - pad.right}
                  y={height - 4}
                  textAnchor={i === 0 ? 'start' : i === 1 ? 'middle' : 'end'}
                >
                  {text}
                </text>
              ))}
            {series.map((s) =>
              segments(s.values, at, span.step * 2.5, x, (v) => y(v, s.below)).map((points) => (
                <g key={`${s.tone}-${points[0]}`}>
                  {(series.length === 1 || mirrored) && !compact && points.length > 1 && (
                    <polygon
                      className={`server-chart__area server-chart__area--${s.tone}`}
                      points={`${points[0]?.split(',')[0]},${zero} ${points.join(' ')} ${points.at(-1)?.split(',')[0]},${zero}`}
                    />
                  )}
                  <polyline
                    className={`server-chart__line server-chart__line--${s.tone}`}
                    points={points.join(' ')}
                  />
                </g>
              )),
            )}
            {!compact &&
              markers.map((m) => {
                const mx = xAt(new Date(m.t).getTime());
                return (
                  <g key={`${m.t}-${m.label}`} className="server-chart__marker">
                    <line x1={mx} x2={mx} y1={pad.top} y2={pad.top + innerH} />
                    <text
                      x={Math.min(mx + 4, width - 4)}
                      y={pad.top + 10}
                      textAnchor={mx > width - 120 ? 'end' : 'start'}
                    >
                      {m.label}
                    </text>
                  </g>
                );
              })}
            {active !== null && (
              <g>
                <line
                  className="server-chart__cross"
                  x1={x(active)}
                  x2={x(active)}
                  y1={pad.top}
                  y2={pad.top + innerH}
                />
                {series.map((s) => {
                  const v = s.values[active];
                  return v === null || v === undefined ? null : (
                    <circle
                      key={s.tone}
                      className={`server-chart__dot server-chart__dot--${s.tone}`}
                      cx={x(active)}
                      cy={y(v, s.below)}
                      r={4}
                    />
                  );
                })}
              </g>
            )}
          </svg>
        )}
        {active !== null && time && (
          <div
            className="server-chart__tip"
            style={{ left: Math.min(Math.max(0, width - 170), x(active) + 12) }}
          >
            <div className="server-chart__tip-time">{when}</div>
            {values(active).map((v) => (
              <div key={v.label}>
                {v.label}: <b>{v.text}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      {!compact && (
        // Beside the image, whose children assistive technology skips: the point the arrow
        // keys reach is read from here.
        <span className="ink-sr-only" aria-live="polite">
          {active !== null && time
            ? `${when}: ${values(active)
                .map((v) => `${v.label} ${v.text}`)
                .join(', ')}`
            : ''}
        </span>
      )}
    </>
  );
}
