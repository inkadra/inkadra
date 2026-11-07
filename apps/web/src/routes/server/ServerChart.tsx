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
  index: number;
  label: string;
}

const PAD = { left: 40, right: 6, top: 8, bottom: 20 };

/** Points of a series, split where values are missing so the line does not lie across a gap. */
function segments(
  values: Array<number | null>,
  x: (i: number) => number,
  y: (v: number) => number,
) {
  const out: string[][] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) out.push(current);
      current = [];
    } else current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
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
  const pad = compact ? { left: 0, right: 0, top: 2, bottom: 2 } : PAD;
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const zero = mirrored ? pad.top + innerH / 2 : pad.top + innerH;
  const scale = mirrored ? innerH / 2 : innerH;
  const x = (i: number) => pad.left + (n > 1 ? (i / (n - 1)) * innerW : innerW);
  const y = (v: number, below = false) =>
    zero + (below ? 1 : -1) * (Math.min(v, max) / (max || 1)) * scale;

  const move = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const at = ((clientX - rect.left - pad.left) / innerW) * (n - 1);
    setActive(Math.max(0, Math.min(n - 1, Math.round(at))));
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

  return (
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
                key={text}
                className="server-chart__tick"
                x={i === 0 ? pad.left : i === 1 ? pad.left + innerW / 2 : width - pad.right}
                y={height - 4}
                textAnchor={i === 0 ? 'start' : i === 1 ? 'middle' : 'end'}
              >
                {text}
              </text>
            ))}
          {series.map((s) =>
            segments(s.values, x, (v) => y(v, s.below)).map((points) => (
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
            markers.map((m) => (
              <g key={`${m.index}-${m.label}`} className="server-chart__marker">
                <line x1={x(m.index)} x2={x(m.index)} y1={pad.top} y2={pad.top + innerH} />
                <text
                  x={Math.min(x(m.index) + 4, width - 4)}
                  y={pad.top + 10}
                  textAnchor={x(m.index) > width - 120 ? 'end' : 'start'}
                >
                  {m.label}
                </text>
              </g>
            ))}
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
          <div className="server-chart__tip-time">
            {formatDateTime(time, { dateStyle: 'short', timeStyle: 'short' })}
          </div>
          {series.map((s) => {
            const v = s.values[active];
            return (
              <div key={s.tone}>
                {s.label}: <b>{v === null || v === undefined ? '—' : format(v)}</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
