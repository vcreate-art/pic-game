import type { TourneyState } from '@pic-game/shared';

const key = (a: string, b: string) => [a, b].sort().join('|');

/**
 * This lap's seating as a ring. Each line is a match between neighbours:
 * struck through once played, lit for the one on or up next.
 */
export function Circle({ t }: { t: TourneyState }) {
  const n = t.circle.length;
  if (n < 2) return null;
  const size = 300;
  const r = n > 10 ? 112 : 100;
  const at = (i: number) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: size / 2 + r * Math.cos(a), y: size / 2 + r * Math.sin(a), a };
  };
  const byId = new Map(t.entrants.map((e) => [e.id, e]));

  // How many times each pair has already met this lap (twice, with two players).
  const played = new Map<string, number>();
  for (const h of t.history) if (h.lap === t.lap) played.set(key(h.a, h.b), (played.get(key(h.a, h.b)) ?? 0) + 1);
  const live = t.current ? key(t.current.a, t.current.b) : t.queue[0] ? key(...t.queue[0]) : null;
  let liveShown = false;

  const edges = t.circle.map((id, i) => {
    const other = t.circle[(i + 1) % n]!;
    const k = key(id, other);
    const left = played.get(k) ?? 0;
    let state: 'done' | 'live' | 'out' | 'todo' = 'todo';
    if (left > 0) {
      state = 'done';
      played.set(k, left - 1);
    } else if (k === live && !liveShown) {
      state = 'live';
      liveShown = true;
    } else if (byId.get(id)?.outOnTurn != null || byId.get(other)?.outOnTurn != null) state = 'out';
    return { from: at(i), to: at((i + 1) % n), state, i };
  });

  return (
    <svg className="tcircle" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Lap ${t.lap} seating`}>
      {edges.map(({ from, to, state, i }) =>
        n === 2 && i === 1 ? (
          // Two players: the second meeting bows out so both lines show.
          <path key={i} className={`tcircle__edge is-${state}`} d={`M${from.x},${from.y} Q${size / 2 + 40},${size / 2} ${to.x},${to.y}`} />
        ) : (
          <line key={i} className={`tcircle__edge is-${state}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
        ),
      )}
      {t.circle.map((id, i) => {
        const p = at(i);
        const e = byId.get(id);
        const out = e?.outOnTurn != null;
        const inLive = live?.split('|').includes(id);
        const lx = size / 2 + (r + 22) * Math.cos(p.a);
        const ly = size / 2 + (r + 22) * Math.sin(p.a);
        const anchor = Math.abs(Math.cos(p.a)) < 0.3 ? 'middle' : Math.cos(p.a) > 0 ? 'start' : 'end';
        return (
          <g key={id} className={`tcircle__seat ${out ? 'is-out' : ''} ${inLive ? 'is-live' : ''}`}>
            <circle cx={p.x} cy={p.y} r={9} />
            <text x={lx} y={ly} dominantBaseline="middle" textAnchor={anchor}>
              {e?.name ?? '?'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
