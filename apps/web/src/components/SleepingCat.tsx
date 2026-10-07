import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { chosenCatPack, type CatPack } from './catPacks.js';

/** How long it blinks awake before it gets up. */
const WAKE_MS = 550;
/** A beat on its feet, crouched, before the jump. */
const CROUCH_MS = 250;
/** Walking pace, in pixels a second. */
const WALK_SPEED = 120;

type Phase = 'asleep' | 'waking' | 'gone';

/** Cycles through `frames` at `fps` while `playing`, from the first. */
function useFrame(frames: string[], fps: number, playing = true): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (!playing || frames.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % frames.length), 1000 / fps);
    return () => clearInterval(t);
  }, [frames, fps, playing]);
  return frames[i % frames.length];
}

/**
 * A cat asleep on the top edge of the join card, drawn from a sprite pack
 * (see catPacks.ts; `?cat=` picks one). The first keystroke (`stirred`
 * changing) disturbs it: it blinks awake, crouches, jumps down to the bottom
 * of the window and walks off the left edge, not to return until the page
 * loads again. Purely for fun, so it's hidden from screen readers.
 */
export function SleepingCat({ stirred }: { stirred: unknown }) {
  const [pack] = useState(chosenCatPack);
  const [phase, setPhase] = useState<Phase>('asleep');
  const [from, setFrom] = useState<DOMRect | null>(null);
  const img = useRef<HTMLImageElement>(null);
  // What the fields held on arrival: only a change from that is a keystroke.
  const atRest = useRef(stirred);

  // Every frame loaded up front, so nothing blinks blank the first time it shows.
  useEffect(() => {
    for (const src of [...pack.sleep, ...pack.wake, pack.crouch, pack.leap, ...pack.walk]) new Image().src = src;
  }, [pack]);

  useEffect(() => {
    if (phase === 'asleep' && stirred !== atRest.current) setPhase('waking');
  }, [stirred, phase]);

  useEffect(() => {
    if (phase !== 'waking') return;
    const up = setTimeout(() => {
      if (img.current) setFrom(img.current.getBoundingClientRect());
      setPhase('gone');
    }, WAKE_MS);
    return () => clearTimeout(up);
  }, [phase]);

  const frame = useFrame(phase === 'asleep' ? pack.sleep : pack.wake, pack.fps / 3);
  return (
    <>
      <div className={`cat is-${phase}`} style={sizeOf(pack)} aria-hidden="true">
        <img ref={img} className="cat__sprite" src={frame} alt="" draggable={false} />
        {phase === 'asleep' && (
          <span className="cat__zs" style={{ left: `${pack.head.x * 100}%`, top: `${pack.head.y * 100}%` }}>
            <span className="cat__z">z</span>
            <span className="cat__z">z</span>
            <span className="cat__z">z</span>
          </span>
        )}
      </div>
      {from && createPortal(<WalkingCat pack={pack} from={from} onDone={() => setFrom(null)} />, document.body)}
    </>
  );
}

function sizeOf(pack: CatPack): CSSProperties {
  return { width: pack.frame.w * pack.scale, height: pack.frame.h * pack.scale };
}

/**
 * The cat up on its feet, from where it slept to off the left edge: a crouch,
 * a jump down to the bottom of the window, then a walk. Two nested boxes so
 * the jump can be one curve across and another up and down.
 */
function WalkingCat({ pack, from, onDone }: { pack: CatPack; from: DOMRect; onDone: () => void }) {
  const across = useRef<HTMLDivElement>(null);
  const updown = useRef<HTMLDivElement>(null);
  const [pose, setPose] = useState<'crouch' | 'leap' | 'walk'>('crouch');
  // Read when it finishes, so a new callback (the page re-rendering as you
  // type) doesn't restart the walk.
  const done = useRef(onDone);
  done.current = onDone;
  const walkFrame = useFrame(pack.walk, pack.fps, pose === 'walk');

  // Before paint, so it never shows a frame at the window's corner.
  useLayoutEffect(() => {
    const x = across.current;
    const y = updown.current;
    if (!x || !y) return;
    x.style.transform = `translate(${from.left}px, ${from.top}px)`;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const fade = x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
      fade.onfinish = () => done.current();
      return () => fade.cancel();
    }

    const startX = from.left;
    const startY = from.top;
    const groundY = window.innerHeight - from.height - 6;
    const drop = Math.max(0, groundY - startY);
    const hopX = -Math.min(120, 40 + drop * 0.25);
    const hopMs = 420 + Math.min(380, drop * 0.6);
    const walkTo = -(startX + hopX) - from.width - 40;
    const walkMs = (Math.abs(walkTo) / WALK_SPEED) * 1000;

    const opts = { duration: hopMs, delay: CROUCH_MS, fill: 'forwards' } as const;
    const hop = x.animate(
      [
        { transform: `translate(${startX}px, ${startY}px)` },
        { transform: `translate(${startX + hopX}px, ${startY}px)` },
      ],
      { ...opts, easing: 'cubic-bezier(.3, .1, .6, 1)' },
    );
    // Up first, slowing at the top, then falling faster and faster.
    const landed = y.animate(
      [
        { transform: 'translateY(0)', easing: 'cubic-bezier(.3, .7, .6, 1)' },
        { transform: 'translateY(-30px)', offset: 0.3, easing: 'cubic-bezier(.5, 0, .9, .6)' },
        { transform: `translateY(${drop}px)` },
      ],
      opts,
    );
    const anims: Animation[] = [hop, landed];
    const leap = setTimeout(() => setPose('leap'), CROUCH_MS);
    landed.onfinish = () => {
      setPose('walk');
      const walk = x.animate(
        [
          { transform: `translate(${startX + hopX}px, ${startY}px)` },
          { transform: `translate(${startX + hopX + walkTo}px, ${startY}px)` },
        ],
        { duration: walkMs, easing: 'linear', fill: 'forwards' },
      );
      walk.onfinish = () => done.current();
      anims.push(walk);
    };
    return () => {
      clearTimeout(leap);
      anims.forEach((a) => a.cancel());
    };
  }, [from]);

  const src = pose === 'crouch' ? pack.crouch : pose === 'leap' ? pack.leap : walkFrame;
  return (
    <div ref={across} className="walker" style={sizeOf(pack)} aria-hidden="true">
      <div ref={updown}>
        <img className="cat__sprite" src={src} alt="" draggable={false} />
      </div>
    </div>
  );
}
