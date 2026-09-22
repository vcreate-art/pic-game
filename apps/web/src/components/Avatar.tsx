import { AVATAR_COLORS, AVATAR_FACES, type Avatar as AvatarData } from '@pic-game/shared';

export function Avatar({ data, size = 36 }: { data: AvatarData; size?: number }) {
  const color = AVATAR_COLORS[data.color % AVATAR_COLORS.length];
  const face = AVATAR_FACES[data.face % AVATAR_FACES.length];
  return (
    <div
      className="avatar"
      style={{ background: color, width: size, height: size, fontSize: size * 0.34 }}
      aria-hidden="true"
    >
      {face}
    </div>
  );
}
