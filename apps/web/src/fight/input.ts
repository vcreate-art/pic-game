import { BTN } from '@pic-game/shared';

export interface InputUpdate {
  seq: number;
  held: number;
  pressed: number;
}

/** Keyboard layout. The four attack keys sit in a square the way the face
 *  buttons do on a pad: 1 top-left, 2 top-right, 3 bottom-left, 4 bottom-right. */
export const KEYMAP: Record<string, number> = {
  KeyW: BTN.UP,
  KeyS: BTN.DOWN,
  KeyA: BTN.LEFT,
  KeyD: BTN.RIGHT,
  ArrowUp: BTN.UP,
  ArrowDown: BTN.DOWN,
  ArrowLeft: BTN.LEFT,
  ArrowRight: BTN.RIGHT,
  KeyU: BTN.FP,
  KeyI: BTN.BP,
  KeyJ: BTN.FK,
  KeyK: BTN.BK,
  KeyL: BTN.BLOCK,
  Space: BTN.BLOCK,
  KeyH: BTN.THROW,
  KeyO: BTN.FATAL,
};

/** Standard-mapping gamepad: face buttons laid out as on an MK11 pad, with
 *  block on the right trigger and Fatal Blow on the left. */
const PAD: [number, number][] = [
  [2, BTN.FP],
  [3, BTN.BP],
  [0, BTN.FK],
  [1, BTN.BK],
  [7, BTN.BLOCK],
  [5, BTN.BLOCK],
  [4, BTN.THROW],
  [6, BTN.FATAL],
  [12, BTN.UP],
  [13, BTN.DOWN],
  [14, BTN.LEFT],
  [15, BTN.RIGHT],
];
const DEADZONE = 0.5;

/** Module-wide rather than per instance: the server drops any update not
 *  newer than the last, so a remounted controller must not start again at 1.
 *  A page reload is a new socket, and the server forgets the old count then. */
let seq = 0;

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/**
 * Turns keys and pads into controller updates, sent the moment anything
 * changes rather than on a timer. Waiting for the next animation frame would
 * add up to 16 ms of lag to every button for no gain.
 */
export class FightInput {
  private keys = 0;
  private pad = 0;
  private held = 0;
  private raf = 0;

  constructor(private readonly send: (u: InputUpdate) => void) {}

  attach(): void {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.release);
    document.addEventListener('visibilitychange', this.release);
    const poll = () => {
      this.raf = requestAnimationFrame(poll);
      this.pollPad();
    };
    this.raf = requestAnimationFrame(poll);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.release);
    document.removeEventListener('visibilitychange', this.release);
    cancelAnimationFrame(this.raf);
    this.release();
  }

  private onDown = (e: KeyboardEvent) => {
    const bit = KEYMAP[e.code];
    if (!bit || typing(e.target) || e.metaKey || e.ctrlKey) return;
    e.preventDefault(); // arrows and space would scroll the page
    if (e.repeat) return;
    this.keys |= bit;
    this.flush();
  };

  private onUp = (e: KeyboardEvent) => {
    const bit = KEYMAP[e.code];
    if (!bit) return;
    this.keys &= ~bit;
    this.flush();
  };

  /** Losing focus drops every key, or a fighter walks off forever on a keyup
   *  the page never saw. */
  private release = () => {
    this.keys = 0;
    this.pad = 0;
    this.flush();
  };

  private pollPad(): void {
    const pads = navigator.getGamepads?.() ?? [];
    let bits = 0;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      for (const [i, bit] of PAD) if (p.buttons[i]?.pressed) bits |= bit;
      const [x = 0, y = 0] = p.axes;
      if (x < -DEADZONE) bits |= BTN.LEFT;
      if (x > DEADZONE) bits |= BTN.RIGHT;
      if (y < -DEADZONE) bits |= BTN.UP;
      if (y > DEADZONE) bits |= BTN.DOWN;
    }
    if (bits !== this.pad) {
      this.pad = bits;
      this.flush();
    }
  }

  private flush(): void {
    const next = this.keys | this.pad;
    if (next === this.held) return;
    const pressed = next & ~this.held;
    this.held = next;
    this.send({ seq: ++seq, held: next, pressed });
  }
}
