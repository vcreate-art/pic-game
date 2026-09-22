import { AVATAR_COLORS, AVATAR_FACES, type Avatar as AvatarData } from '@pic-game/shared';

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

  return (
    <span className="avatar-wrap" style={{ width: size, height: size }}>
      <span
        className="avatar"
        style={{ background: color, fontSize: size * 0.34 }}
        aria-hidden="true"
      >
        {face}
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
