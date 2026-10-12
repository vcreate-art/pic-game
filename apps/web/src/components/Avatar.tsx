import { useEffect, useRef } from 'react';
import { AVATAR_COLORS, AVATAR_FACES, type Avatar as AvatarData } from '@pic-game/shared';
import { watch } from '../lib/avatarGaze.js';

export function Avatar({
  data,
  size = 36,
  host = false,
}: {
  data: AvatarData;
  size?: number;
  host?: boolean;
}) {
  const color = AVATAR_COLORS[data.color % AVATAR_COLORS.length];
  const face = AVATAR_FACES[data.face % AVATAR_FACES.length];
  const dot = Math.min(16, Math.max(10, Math.round(size * 0.3)));
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => (ref.current ? watch(ref.current) : undefined), []);

  // Every face is an eye, a mouth and an eye, so the eyes can move apart
  // from the mouth as it looks around.
  const [eyeL, mouth, eyeR] = [...(face ?? AVATAR_FACES[0])];

  return (
    <span className="avatar-wrap" style={{ width: size, height: size }}>
      <span
        ref={ref}
        className="avatar"
        style={{ background: color, fontSize: size * 0.34 }}
        aria-hidden="true"
      >
        <span className="avatar__face">
          <span className="avatar__eye">{eyeL}</span>
          <span>{mouth}</span>
          <span className="avatar__eye">{eyeR}</span>
        </span>
      </span>
      {host && (
        <span className="avatar__host" style={{ width: dot, height: dot }} title="Host">
          {/* Colour alone is not an accessible marker. */}
          <span className="visually-hidden">Host</span>
        </span>
      )}
    </span>
  );
}
