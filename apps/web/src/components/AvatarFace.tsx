import type { ReactNode } from 'react';
import { AVATAR_FACE_PARTS } from '@pic-game/shared';

/**
 * Faces in the style of Boring Avatars' beam, drawn here so there can be
 * more of them: eyes, a mouth and glasses, each picked from an avatar's
 * face number. On beam's 36-unit grid, with the eyes about x 11.75 and
 * 23.75 and the mouth under them, centred.
 */

const EYE_X = [11.75, 23.75] as const;
/** The eyes sit a little higher, and the mouth a little lower, than beam's,
 *  for a gap between them. */
const EYE_Y = 13.4;
const MOUTH_DROP = 1.6;
/** Line weight, heavy enough to read on a small avatar. */
const STROKE = 1.4;

const EYES: ReadonlyArray<(x: number) => ReactNode> = [
  // Beam's own: a short rounded bar.
  (x) => <rect x={x - 1.1} y={EYE_Y - 1.4} width={2.2} height={2.8} rx={1.1} stroke="none" />,
  (x) => <circle cx={x} cy={EYE_Y} r={1.6} stroke="none" />,
  // Happy, shut in a smile.
  (x) => <path d={`M${x - 1.6} ${EYE_Y + 0.7}q1.6 -2 3.2 0`} fill="none" strokeWidth={STROKE} strokeLinecap="round" />,
];

const MOUTHS: ReadonlyArray<ReactNode> = [
  // Beam's two: a closed smile, and an open one.
  <path d="M14.6 19c2.2 1.2 4.6 1.2 6.8 0" fill="none" strokeWidth={STROKE} strokeLinecap="round" />,
  <path d="M13,19 a1,0.75 0 0,0 10,0" stroke="none" />,
  <path d="M15.2 19.8h5.6" fill="none" strokeWidth={STROKE} strokeLinecap="round" />,
  <circle cx={18} cy={20.2} r={1.8} stroke="none" />,
  // A wide grin.
  <path d="M13.5 18.6h9a4.5 3.6 0 0 1 -9 0z" stroke="none" />,
  // A cat's "w".
  <path d="M14.8 19q1.6 1.8 3.2 0q1.6 1.8 3.2 0" fill="none" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />,
];

const GLASSES: ReadonlyArray<ReactNode> = [
  null,
  <g fill="none" strokeWidth={1}>
    <circle cx={EYE_X[0]} cy={EYE_Y} r={2.7} />
    <circle cx={EYE_X[1]} cy={EYE_Y} r={2.7} />
    <path d={`M${EYE_X[0] + 2.7} ${EYE_Y}h${EYE_X[1] - EYE_X[0] - 5.4}`} />
  </g>,
  <g fill="none" strokeWidth={1} strokeLinejoin="round">
    <rect x={EYE_X[0] - 3} y={EYE_Y - 2.2} width={6} height={4.4} rx={0.8} />
    <rect x={EYE_X[1] - 3} y={EYE_Y - 2.2} width={6} height={4.4} rx={0.8} />
    <path d={`M${EYE_X[0] + 3} ${EYE_Y - 0.4}h${EYE_X[1] - EYE_X[0] - 6}`} />
  </g>,
  // Shades: dark lenses over the eyes, whatever the ink.
  <g strokeWidth={1}>
    <rect x={EYE_X[0] - 3} y={EYE_Y - 1.9} width={6} height={3.8} rx={1.6} fill="#15161d" />
    <rect x={EYE_X[1] - 3} y={EYE_Y - 1.9} width={6} height={3.8} rx={1.6} fill="#15161d" />
    <path d={`M${EYE_X[0] + 3} ${EYE_Y - 0.8}h${EYE_X[1] - EYE_X[0] - 6}`} fill="none" />
  </g>,
];

/** Which eyes, mouth and glasses a face number means: eyes change fastest. */
export function faceParts(face: number) {
  const { eyes, mouths, glasses } = AVATAR_FACE_PARTS;
  return {
    eyes: face % eyes,
    mouth: Math.floor(face / eyes) % mouths,
    glasses: Math.floor(face / (eyes * mouths)) % glasses,
  };
}

/** A face, in `ink`, on a transparent 36-unit square: the eyes in their own
 *  group so they can move apart from the rest as the avatar looks around. */
export function AvatarFace({ face, ink }: { face: number; ink: string }) {
  const p = faceParts(face);
  return (
    <svg viewBox="0 0 36 36" className="aface" fill={ink} stroke={ink} aria-hidden="true">
      <g className="aface__face">
        <g className="aface__eyes">
          {EYES[p.eyes]!(EYE_X[0])}
          {EYES[p.eyes]!(EYE_X[1])}
        </g>
        <g transform={`translate(0 ${MOUTH_DROP})`}>{MOUTHS[p.mouth]}</g>
        {/* Shades sit over the eyes; the frames move with the face. */}
        {GLASSES[p.glasses]}
      </g>
    </svg>
  );
}
