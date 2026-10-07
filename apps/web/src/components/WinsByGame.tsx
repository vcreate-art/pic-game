import type { CSSProperties } from 'react';
import { GAME_LABELS, type GameKind } from '@pic-game/shared';
import { GAME_ICONS } from './gameIcons.js';

/** A player's wins this session, by game: each game's icon in its colour,
 *  with how many. Most wins first. Shows nothing until they have one. */
export function WinsByGame({ wins }: { wins?: Partial<Record<GameKind, number>> }) {
  const list = Object.entries(wins ?? {})
    .filter(([, n]) => n)
    .sort(([, a], [, b]) => b! - a!) as [GameKind, number][];
  if (!list.length) return null;
  return (
    <span className="winsby">
      {list.map(([kind, n]) => {
        const { icon: Icon, color } = GAME_ICONS[kind];
        const said = `${GAME_LABELS[kind].name}: ${n} ${n === 1 ? 'win' : 'wins'}`;
        return (
          <span key={kind} className="winsby__game" style={{ '--game': color } as CSSProperties} title={said}>
            <Icon aria-hidden="true" />
            <span aria-hidden="true">{n}</span>
            <span className="visually-hidden">{said}</span>
          </span>
        );
      })}
    </span>
  );
}
