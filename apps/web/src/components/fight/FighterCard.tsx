import { useEffect, useRef } from 'react';
import { FIGHTERS, type FighterId } from '@pic-game/shared';
import { drawPortrait } from '../../fight/portrait.js';

interface Props {
  id: FighterId;
  /** Which sides have picked this fighter, as P1 / P2 badges. */
  pickedBy: ('a' | 'b')[];
  mine: boolean;
  disabled: boolean;
  onPick: () => void;
  onLook: () => void;
}

export function FighterCard({ id, pickedBy, mine, disabled, onPick, onLook }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const def = FIGHTERS[id];

  useEffect(() => {
    let raf = 0;
    let clock = Math.random() * 100; // so four idle bobs are not in lockstep
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (ref.current) drawPortrait(ref.current, id, clock++);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [id]);

  return (
    <button
      type="button"
      className={`fcard ${mine ? 'is-mine' : ''} ${pickedBy.length ? 'is-picked' : ''}`}
      style={{ ['--fc' as string]: def.color }}
      disabled={disabled}
      aria-pressed={mine}
      onClick={onPick}
      onMouseEnter={onLook}
      onFocus={onLook}
    >
      <canvas ref={ref} className="fcard__art" aria-hidden="true" />
      <strong className="fcard__name">{def.name}</strong>
      <span className="fcard__blurb">{def.blurb}</span>
      {pickedBy.length > 0 && (
        <span className="fcard__badges">
          {pickedBy.map((s) => (
            <span key={s} className={`fcard__badge fcard__badge--${s}`}>{s === 'a' ? 'P1' : 'P2'}</span>
          ))}
        </span>
      )}
    </button>
  );
}
