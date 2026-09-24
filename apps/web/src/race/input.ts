import { RB } from '@pic-game/shared';

/** Up is climb, not jump: holding it on a wall would otherwise wall-jump off.
 *  Dash sits under the other hand's fingers, as on a pad's shoulder. */
export const RACE_KEYS: Record<string, number> = {
  KeyA: RB.LEFT,
  KeyD: RB.RIGHT,
  KeyW: RB.UP,
  KeyS: RB.DOWN,
  ArrowLeft: RB.LEFT,
  ArrowRight: RB.RIGHT,
  ArrowUp: RB.UP,
  ArrowDown: RB.DOWN,
  Space: RB.JUMP,
  KeyJ: RB.JUMP,
  KeyZ: RB.JUMP,
  ShiftLeft: RB.DASH,
  ShiftRight: RB.DASH,
  KeyK: RB.DASH,
  KeyX: RB.DASH,
  KeyL: RB.DASH,
};

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

/**
 * Keyboard and pad, read by the local sim each frame. Presses are collected
 * between frames so a tap shorter than a frame is still a jump.
 */
export class RaceInput {
  private keys = 0;
  private pad = 0;
  private padPrev = 0;
  private edges = 0;

  attach(): void {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.release);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.release);
    this.release();
  }

  private onDown = (e: KeyboardEvent) => {
    const bit = RACE_KEYS[e.code];
    if (!bit || typing(e.target) || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    if (e.repeat) return;
    if (!(this.keys & bit)) this.edges |= bit;
    this.keys |= bit;
  };

  private onUp = (e: KeyboardEvent) => {
    const bit = RACE_KEYS[e.code];
    if (bit) this.keys &= ~bit;
  };

  private release = () => {
    this.keys = 0;
    this.pad = 0;
  };

  private pollPad(): void {
    let bits = 0;
    for (const p of navigator.getGamepads?.() ?? []) {
      if (!p?.connected) continue;
      if (p.buttons[0]?.pressed) bits |= RB.JUMP;
      if (p.buttons[2]?.pressed || p.buttons[5]?.pressed || p.buttons[7]?.pressed) bits |= RB.DASH;
      if (p.buttons[12]?.pressed) bits |= RB.UP;
      if (p.buttons[13]?.pressed) bits |= RB.DOWN;
      if (p.buttons[14]?.pressed) bits |= RB.LEFT;
      if (p.buttons[15]?.pressed) bits |= RB.RIGHT;
      const [x = 0, y = 0] = p.axes;
      if (x < -0.4) bits |= RB.LEFT;
      if (x > 0.4) bits |= RB.RIGHT;
      if (y < -0.5) bits |= RB.UP;
      if (y > 0.5) bits |= RB.DOWN;
    }
    this.edges |= bits & ~this.padPrev;
    this.padPrev = bits;
    this.pad = bits;
  }

  /** This frame's controls: what is held, and what went down since last time. */
  read(): { held: number; pressed: number } {
    this.pollPad();
    const held = this.keys | this.pad;
    const pressed = this.edges;
    this.edges = 0;
    return { held: held | pressed, pressed };
  }
}
