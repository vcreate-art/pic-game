import type { CSSProperties } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AVATAR_COLORS, AVATAR_FACES, type Avatar as AvatarData } from '@pic-game/shared';
import { Avatar } from './Avatar.js';

/** Keyed by the colour itself, so a colour added to the list fails to
 *  compile until it has a name to be read out by. */
const COLOR_NAMES: Record<(typeof AVATAR_COLORS)[number], string> = {
  '#ef4444': 'Red',
  '#f97316': 'Orange',
  '#eab308': 'Yellow',
  '#22c55e': 'Green',
  '#14b8a6': 'Teal',
  '#3b82f6': 'Blue',
  '#8b5cf6': 'Purple',
  '#ec4899': 'Pink',
};

/** The theme an avatar's colour gives a form around it (the join card, the
 *  profile editor): its colour darkened a third, so white text and thin
 *  icons on it still read, yellow and orange included. */
export function avatarAccent(color: number): CSSProperties {
  return { '--accent': `color-mix(in srgb, ${AVATAR_COLORS[color % AVATAR_COLORS.length]} 68%, #000)` } as CSSProperties;
}

/**
 * Choosing an avatar: arrows either side of it step through the faces, both
 * ways, and every colour sits below as a swatch to pick outright. On the join
 * card and in the profile editor alike.
 */
export function AvatarPicker({
  value,
  onChange,
  size,
}: {
  value: AvatarData;
  onChange: (avatar: AvatarData) => void;
  size: number;
}) {
  const faces = AVATAR_FACES.length;
  const step = (by: number) => onChange({ ...value, face: (value.face + by + faces) % faces });

  return (
    <div className="avpick">
      <div className="avpick__face">
        <button type="button" className="btn btn--outline avpick__step" onClick={() => step(-1)} aria-label="Previous face">
          <ChevronLeft aria-hidden="true" />
        </button>
        <Avatar data={value} size={size} />
        <button type="button" className="btn btn--outline avpick__step" onClick={() => step(1)} aria-label="Next face">
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
      <div className="avpick__colors" role="group" aria-label="Colour">
        {AVATAR_COLORS.map((c, i) => (
          <button
            key={c}
            type="button"
            className="avpick__swatch"
            style={{ '--swatch': c } as CSSProperties}
            aria-label={COLOR_NAMES[c]}
            aria-pressed={i === value.color}
            onClick={() => onChange({ ...value, color: i })}
          />
        ))}
      </div>
    </div>
  );
}
