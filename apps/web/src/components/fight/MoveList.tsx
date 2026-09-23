import {
  BTN, BUTTON_LABEL, FIGHTERS, moveOf, notation, type AttackBtn, type FighterDef,
  type FighterId, type KrushWhen,
} from '@pic-game/shared';

/** Where each string starts: the four standing normals. */
const STARTERS: [string, AttackBtn][] = [
  ['jab', BTN.FP],
  ['cross', BTN.BP],
  ['fkick', BTN.FK],
  ['bkick', BTN.BK],
];

const label = (b: AttackBtn) => BUTTON_LABEL[b] ?? '?';

/** Every string a fighter has, as "1, 1, 2", named by its last hit. */
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
            <dd><kbd>{notation(sp.motion, sp.button)}</kbd></dd>
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
          <dd><kbd>{notation(fat.motion, fat.button)}</kbd></dd>
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
        <li><kbd>U</kbd> 1 front punch · <kbd>I</kbd> 2 back punch</li>
        <li><kbd>J</kbd> 3 front kick · <kbd>K</kbd> 4 back kick</li>
        <li><kbd>L</kbd> or <kbd>Space</kbd>: block (hold <kbd>S</kbd> too for lows)</li>
        <li><kbd>H</kbd> or <kbd>1 + 3</kbd>: throw · <kbd>O</kbd>: Fatal Blow</li>
      </ul>
      <ul className="controls__keys controls__keys--soft">
        <li><kbd>D + 2</kbd> uppercut · <kbd>B + 4</kbd> sweep · <kbd>F + 2</kbd> overhead</li>
        <li>Tap block during a special to amplify it (1 bar)</li>
        <li><kbd>F + block</kbd> while blocking: Breaker (2 bars)</li>
        <li>F and B mean toward and away from your opponent. A gamepad works too.</li>
      </ul>
    </div>
  );
}
