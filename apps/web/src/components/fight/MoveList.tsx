import {
  BTN, FIGHTERS, moveOf, type AttackBtn, type Dir, type FighterDef,
  type FighterId, type KrushWhen,
} from '@pic-game/shared';

/** Where each string starts: the four standing normals. */
const STARTERS: [string, AttackBtn][] = [
  ['jab', BTN.FP],
  ['cross', BTN.BP],
  ['fkick', BTN.FK],
  ['bkick', BTN.BK],
];

/** The keys as they are on the keyboard, not MK's 1–4. */
const KEY: Record<AttackBtn, string> = { [BTN.FP]: 'U', [BTN.BP]: 'I', [BTN.FK]: 'J', [BTN.BK]: 'K' };
const label = (b: AttackBtn) => KEY[b] ?? '?';

/** Directions as arrows, drawn as if facing right: a letter would read as
 *  a key, and "D" is the key for walking right, not down. */
const ARROW: Record<Dir, string> = { F: '→', B: '←', D: '↓', U: '↑' };
const keys = (motion: Dir[], b: AttackBtn) => `${motion.map((d) => ARROW[d]).join(' ')} + ${label(b)}`;

/** Every string a fighter has, as "U, U, I", named by its last hit. */
function stringsOf(def: FighterDef): { keys: string; name: string }[] {
  const out: { keys: string; name: string }[] = [];
  const walk = (move: string, keys: string[]) => {
    const next = def.strings[move];
    const entries = next ? Object.entries(next) : [];
    if (!entries.length) {
      if (keys.length > 1) out.push({ keys: keys.join(', '), name: moveOf(def.id, move)?.name ?? move });
      return;
    }
    for (const [btn, to] of entries) if (to) walk(to, [...keys, label(Number(btn) as AttackBtn)]);
  };
  for (const [move, btn] of STARTERS) walk(move, [label(btn)]);
  return out;
}

const KRUSH_WHEN: Record<KrushWhen, string> = {
  counter: 'on a counter hit',
  punish: 'punishing a miss',
  combo3: 'as the third hit of a combo',
};

const RANGE_LABEL = { close: 'close', mid: 'mid-screen', far: 'full screen' } as const;

export function MoveList({ id }: { id: FighterId }) {
  const def = FIGHTERS[id];
  const fat = def.fatality;

  return (
    <div className="moves" style={{ ['--fc' as string]: def.color }}>
      <h3 className="moves__title">{def.name}'s moves</h3>
      <dl className="moves__list">
        {def.specials.map((sp) => (
          <div key={sp.move} className="moves__row">
            <dt>{moveOf(id, sp.move)?.name}</dt>
            <dd><kbd>{keys(sp.motion, sp.button)}</kbd></dd>
          </div>
        ))}
        {stringsOf(def).map((s) => (
          <div key={s.keys} className="moves__row">
            <dt>{s.name} <em>string</em></dt>
            <dd><kbd>{s.keys}</kbd></dd>
          </div>
        ))}
        <div className="moves__row">
          <dt>{def.fatalBlow} <em>Fatal Blow, below 30% health</em></dt>
          <dd><kbd>O</kbd></dd>
        </div>
        {def.krush.map((k) => (
          <div key={k.move} className="moves__row">
            <dt>Krushing Blow <em>{moveOf(id, k.move)?.name}, {KRUSH_WHEN[k.when]}</em></dt>
            <dd />
          </div>
        ))}
        <div className="moves__row moves__row--fatality">
          <dt>{fat.name} <em>Fatality, {RANGE_LABEL[fat.range]}</em></dt>
          <dd><kbd>{keys(fat.motion, fat.button)}</kbd></dd>
        </div>
      </dl>
    </div>
  );
}

/** What every fighter can do, and which key does it. */
export function Controls() {
  return (
    <div className="controls">
      <h3 className="moves__title">Controls</h3>
      <ul className="controls__keys">
        <li><kbd>W A S D</kbd> or arrows: move, jump, crouch</li>
        <li><kbd>U</kbd> front punch · <kbd>I</kbd> back punch</li>
        <li><kbd>J</kbd> front kick · <kbd>K</kbd> back kick</li>
        <li><kbd>L</kbd> or <kbd>Space</kbd>: block (hold <kbd>S</kbd> too for lows)</li>
        <li><kbd>H</kbd> or <kbd>U + J</kbd>: throw · <kbd>O</kbd>: Fatal Blow</li>
      </ul>
      <ul className="controls__keys controls__keys--soft">
        <li><kbd>↓ + I</kbd> uppercut · <kbd>← + K</kbd> sweep · <kbd>→ + I</kbd> overhead</li>
        <li>Tap block during a special to amplify it (1 bar)</li>
        <li><kbd>→ + block</kbd> while blocking: Breaker (2 bars)</li>
        <li>Arrows are shown facing right. On the right-hand side, flip ← and →: they always mean away from and toward your opponent. A gamepad works too.</li>
      </ul>
    </div>
  );
}
