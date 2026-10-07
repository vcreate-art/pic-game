import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** How long it blinks awake before it gets up. */
const WAKE_MS = 550;
/** Walking pace, in pixels a second. */
const WALK_SPEED = 150;

type Phase = 'asleep' | 'waking' | 'gone';

/**
 * A cat asleep on the top edge of the join card, its tail hanging over the
 * front. It breathes, its tail sways, and z's drift off it; point at it and
 * an ear twitches. The first keystroke (`stirred` changing) disturbs it: it
 * blinks awake, hops down to the bottom of the window and walks off the left
 * edge, not to return until the page loads again. Purely for fun, so it's
 * hidden from screen readers.
 *
 * Drawn on a 120×80 grid: y = 56 is the card's top edge, so everything above
 * sits on the card and the tail below it hangs down the card's face.
 */
export function SleepingCat({ stirred }: { stirred: unknown }) {
  const [phase, setPhase] = useState<Phase>('asleep');
  const [from, setFrom] = useState<DOMRect | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  // What the fields held on arrival: only a change from that is a keystroke.
  const atRest = useRef(stirred);

  useEffect(() => {
    if (phase === 'asleep' && stirred !== atRest.current) setPhase('waking');
  }, [stirred, phase]);

  useEffect(() => {
    if (phase !== 'waking') return;
    const up = setTimeout(() => {
      if (svg.current) setFrom(svg.current.getBoundingClientRect());
      setPhase('gone');
    }, WAKE_MS);
    return () => clearTimeout(up);
  }, [phase]);

  return (
    <>
      <svg
        ref={svg}
        className={`cat ${phase === 'waking' ? 'is-awake' : ''} ${phase === 'gone' ? 'is-gone' : ''}`}
        viewBox="0 0 120 80"
        aria-hidden="true"
        focusable="false"
      >
        <path className="cat__tail" d="M103 52 C114 51 117 60 113 68 C110 74 104 75 102.5 70.5" />
        <g className="cat__breath">
          <path className="cat__fur" d="M40 56 C38 40 52 30 72 30 C94 30 106 40 106 56 Z" />
          <g className="cat__head">
            <path className="cat__fur cat__ear cat__ear--left" d="M23 39 L25 25 L32.5 33 Z" />
            <path className="cat__fur cat__ear" d="M36 32.5 L44 26 L45.5 38.5 Z" />
            <path className="cat__inner" d="M25.6 35.5 L26.6 29 L30.2 33.2 Z" />
            <path className="cat__inner" d="M38.6 32.8 L42.6 29.8 L43.4 36.2 Z" />
            <circle className="cat__fur" cx="34" cy="44" r="12" />
            <g className="cat__shut">
              <path className="cat__eye" d="M27 45 q2.5 2.2 5 0" />
              <path className="cat__eye" d="M36 45 q2.5 2.2 5 0" />
            </g>
            <g className="cat__open">
              <ellipse className="cat__iris" cx="29.5" cy="44" rx="2.6" ry="2.9" />
              <ellipse className="cat__iris" cx="38.5" cy="44" rx="2.6" ry="2.9" />
              <ellipse className="cat__pupil" cx="29.5" cy="44.2" rx=".9" ry="2.3" />
              <ellipse className="cat__pupil" cx="38.5" cy="44.2" rx=".9" ry="2.3" />
            </g>
            <circle className="cat__inner" cx="34" cy="49" r="1" />
          </g>
          <ellipse className="cat__fur" cx="45" cy="54.6" rx="8" ry="2.6" />
        </g>
        <text className="cat__z" x="16" y="26">z</text>
        <text className="cat__z" x="16" y="26">z</text>
        <text className="cat__z" x="16" y="26">z</text>
      </svg>
      {from && createPortal(<WalkingCat from={from} onDone={() => setFrom(null)} />, document.body)}
    </>
  );
}

/**
 * The cat up on its feet, from where it slept to off the left edge: a hop
 * down to the bottom of the window, a little squash as it lands, then a walk.
 * Two nested boxes so the hop can be one curve across and another up and down.
 */
function WalkingCat({ from, onDone }: { from: DOMRect; onDone: () => void }) {
  const across = useRef<HTMLDivElement>(null);
  const updown = useRef<HTMLDivElement>(null);
  const [pose, setPose] = useState<'standing' | 'hopping' | 'walking'>('standing');
  // Read when it finishes, so a new callback (the page re-rendering as you
  // type) doesn't restart the walk.
  const done = useRef(onDone);
  done.current = onDone;

  // Before paint, so it never shows a frame at the window's corner.
  useLayoutEffect(() => {
    const x = across.current;
    const y = updown.current;
    if (!x || !y) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const fade = x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
      fade.onfinish = () => done.current();
      return () => fade.cancel();
    }

    // Standing, the cat is 100×70 with its feet at the bottom; it starts where
    // it lay, feet on the card's edge.
    const startX = from.left + 10;
    const startY = from.top + from.height * 0.7 - 70;
    const groundY = window.innerHeight - 70 - 6;
    const drop = Math.max(0, groundY - startY);
    const hopX = -Math.min(120, 40 + drop * 0.25);
    const hopMs = 420 + Math.min(380, drop * 0.6);
    const walkTo = -(startX + hopX) - 120;
    const walkMs = (Math.abs(walkTo) / WALK_SPEED) * 1000;

    x.style.transform = `translate(${startX}px, ${startY}px)`;
    // A beat on its feet, then the hop: across in a straight line, up and
    // down on a curve that rises first.
    const hop = x.animate(
      [
        { transform: `translate(${startX}px, ${startY}px)` },
        { transform: `translate(${startX + hopX}px, ${startY}px)` },
      ],
      { duration: hopMs, delay: 250, easing: 'cubic-bezier(.3, .1, .6, 1)', fill: 'forwards' },
    );
    const landed = y.animate(
      [
        { transform: 'translateY(0)' },
        { transform: 'translateY(-34px)', offset: 0.28, easing: 'cubic-bezier(.4, 0, 1, 1)' },
        { transform: `translateY(${drop}px)` },
      ],
      { duration: hopMs, delay: 250, easing: 'cubic-bezier(.2, .6, .4, 1)', fill: 'forwards' },
    );
    const anims: Animation[] = [hop, landed];
    const leap = setTimeout(() => setPose('hopping'), 250);
    landed.onfinish = () => {
      setPose('walking');
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

  return (
    <div ref={across} className="walker" aria-hidden="true">
      <div ref={updown}>
        <svg className={`walker__cat is-${pose}`} viewBox="0 0 100 70" focusable="false">
          <path className="walker__tail" d="M77 38 C91 34 93 18 87 10" />
          <line className="walker__leg walker__leg--a" x1="38" y1="42" x2="38" y2="66" />
          <line className="walker__leg walker__leg--b" x1="45" y1="42" x2="45" y2="66" />
          <line className="walker__leg walker__leg--b" x1="66" y1="42" x2="66" y2="66" />
          <line className="walker__leg walker__leg--a" x1="73" y1="42" x2="73" y2="66" />
          <ellipse className="cat__fur" cx="56" cy="38" rx="25" ry="11.5" />
          <path className="cat__fur" d="M19 23 L20 10 L27.5 18 Z" />
          <path className="cat__fur" d="M30 17.5 L37.5 9.5 L38.5 22 Z" />
          <path className="cat__inner" d="M21 20 L21.6 13.6 L25.2 17.8 Z" />
          <path className="cat__inner" d="M32.4 17.6 L36.2 13.4 L36.8 19.8 Z" />
          <circle className="cat__fur" cx="28" cy="28" r="11" />
          <ellipse className="cat__iris" cx="24" cy="27.5" rx="2.2" ry="2.6" />
          <ellipse className="cat__iris" cx="32" cy="27.5" rx="2.2" ry="2.6" />
          <ellipse className="cat__pupil" cx="23.6" cy="27.7" rx=".8" ry="2" />
          <ellipse className="cat__pupil" cx="31.6" cy="27.7" rx=".8" ry="2" />
          <circle className="cat__inner" cx="28" cy="32" r=".9" />
        </svg>
      </div>
    </div>
  );
}
