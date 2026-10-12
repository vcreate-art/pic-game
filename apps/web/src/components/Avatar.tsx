import { useEffect, useRef } from 'react';
import { AVATAR_COLORS, type Avatar as AvatarData } from '@pic-game/shared';
import { watch } from '../lib/avatarGaze.js';
import { AvatarFace } from './AvatarFace.js';

/** The face's ink: dark on the light colours (yellow, orange), white on the
 *  rest, by the colour's relative luminance. */
function inkFor(color: number): string {
  const n = parseInt(AVATAR_COLORS[color % AVATAR_COLORS.length]!.slice(1), 16);
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.3 ? '#1f2233' : '#ffffff';
}

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
  const dot = Math.min(16, Math.max(10, Math.round(size * 0.3)));
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => (ref.current ? watch(ref.current) : undefined), []);

  return (
    <span className="avatar-wrap" style={{ width: size, height: size }}>
      <span ref={ref} className={size < 40 ? 'avatar avatar--small' : 'avatar'} style={{ background: color }} aria-hidden="true">
        {/* Eyes, a mouth and glasses from the face number (AvatarFace). */}
        <AvatarFace face={data.face} ink={inkFor(data.color)} />
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
