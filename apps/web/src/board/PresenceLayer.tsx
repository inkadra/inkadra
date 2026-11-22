import type { Rect } from '@inkadra/canvas-core';
import { type PeerSource, sameSelections, selections, usePeers } from './presence.ts';

/**
 * Other people on the board, drawn in board coordinates inside the world layer: an outline
 * around what each one selected and their pointer with a name tag, kept at screen size. Each
 * part reads the people itself, so a pointer moving redraws only the pointers.
 */
export function PresenceLayer({
  peers,
  zoom,
  rectOf,
}: {
  peers: PeerSource;
  zoom: number;
  rectOf: (id: string) => Rect | null;
}) {
  return (
    <>
      <PeerOutlines peers={peers} zoom={zoom} rectOf={rectOf} />
      <PeerCursors peers={peers} zoom={zoom} />
    </>
  );
}

function PeerOutlines({
  peers,
  zoom,
  rectOf,
}: {
  peers: PeerSource;
  zoom: number;
  rectOf: (id: string) => Rect | null;
}) {
  return usePeers(peers, selections, sameSelections).flatMap((p) =>
    [...new Set(p.selection)].map((id) => {
      const r = rectOf(id);
      if (!r) return null;
      return (
        <span
          key={`${p.clientId}-${id}`}
          className={p.editing === id ? 'peer-outline peer-outline--editing' : 'peer-outline'}
          style={{
            left: r.x,
            top: r.y,
            width: r.w,
            height: r.h,
            ['--peer' as string]: p.color,
            ['--zoom' as string]: zoom,
          }}
          aria-hidden="true"
        />
      );
    }),
  );
}

function PeerCursors({ peers, zoom }: { peers: PeerSource; zoom: number }) {
  return usePeers(peers).map((p) =>
    p.cursor ? (
      <span
        key={p.clientId}
        className="peer-cursor"
        style={{
          transform: `translate(${p.cursor.x}px, ${p.cursor.y}px) scale(${1 / zoom})`,
          ['--peer' as string]: p.color,
        }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 16 16"
          width="16"
          height="16"
          className="peer-cursor__arrow"
          aria-hidden="true"
        >
          <path d="M2 1.5l11 6.2-4.6 1.1L6.3 13.5z" />
        </svg>
        <span className="peer-cursor__name">{p.user.name}</span>
      </span>
    ) : null,
  );
}
