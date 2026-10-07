import shepCrouch from '../assets/cats/shepardskin/crouch.png';
import shepIdle from '../assets/cats/shepardskin/idle.png';
import shepLeap from '../assets/cats/shepardskin/leap.png';
import shepSleep from '../assets/cats/shepardskin/sleep.png';
import shepWalk0 from '../assets/cats/shepardskin/walk0.png';
import shepWalk1 from '../assets/cats/shepardskin/walk1.png';
import shepWalk2 from '../assets/cats/shepardskin/walk2.png';
import shepWalk3 from '../assets/cats/shepardskin/walk3.png';
import shepWalk4 from '../assets/cats/shepardskin/walk4.png';
import shepWalk5 from '../assets/cats/shepardskin/walk5.png';

/**
 * A cat drawn as sprite frames, for the cat on the join card. Every frame of
 * a pack is the same size, the cat's feet on its bottom row, facing left.
 */
export interface CatPack {
  /** Frame size in the artwork's own pixels. */
  frame: { w: number; h: number };
  /** How many screen pixels each art pixel takes. */
  scale: number;
  /** Asleep on the card. */
  sleep: string[];
  /** Blinking awake, still on the card. */
  wake: string[];
  /** Gathering itself to jump, then in the air. */
  crouch: string;
  leap: string;
  walk: string[];
  /** Frames a second while walking; the sleep loop runs at a third of it. */
  fps: number;
  /** Where the z's float from, as a share of the frame from its left and top. */
  head: { x: number; y: number };
}

export const CAT_PACKS = {
  /** Shepardskin's "Cat Sprites", CC0: https://opengameart.org/content/cat-sprites */
  shepardskin: {
    frame: { w: 20, h: 16 },
    scale: 4,
    sleep: [shepSleep],
    wake: [shepIdle],
    crouch: shepCrouch,
    leap: shepLeap,
    walk: [shepWalk0, shepWalk1, shepWalk2, shepWalk3, shepWalk4, shepWalk5],
    fps: 9,
    head: { x: 0.2, y: 0.05 },
  },
} satisfies Record<string, CatPack>;

export type CatPackId = keyof typeof CAT_PACKS;

/** The pack named by `?cat=` in the address, for trying them side by side,
 *  else the default. */
export function chosenCatPack(): CatPack {
  const asked = new URLSearchParams(window.location.search).get('cat');
  return asked && asked in CAT_PACKS ? CAT_PACKS[asked as CatPackId] : CAT_PACKS.shepardskin;
}
