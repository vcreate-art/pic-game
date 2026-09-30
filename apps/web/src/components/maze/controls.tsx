import { useEffect } from 'react';
import { create } from 'zustand';
import { getMazeClient, type MazeControls } from '../../maze/client.js';

const KEY = 'maze:controls';

function load(): MazeControls {
  try {
    return localStorage.getItem(KEY) === 'keys' ? 'keys' : 'mouse';
  } catch {
    return 'mouse';
  }
}

/** One copy for the whole page, so the lobby and the match agree. */
const useControlsStore = create<{ controls: MazeControls; set: (c: MazeControls) => void }>((set) => ({
  controls: load(),
  set: (controls) => {
    try {
      localStorage.setItem(KEY, controls);
    } catch {
      /* private mode: just not remembered */
    }
    set({ controls });
  },
}));

/** This player's control scheme: remembered in the browser, and handed to the
 *  match client whenever it changes. */
export function useMazeControls(): [MazeControls, (c: MazeControls) => void] {
  const controls = useControlsStore((s) => s.controls);
  const set = useControlsStore((s) => s.set);
  useEffect(() => getMazeClient().setControls(controls), [controls]);
  return [controls, set];
}

export const CONTROL_HELP: Record<MazeControls, string> = {
  mouse: 'WASD or arrows to move, mouse to aim, click to shoot.',
  keys: 'WASD to move, arrows to shoot (eight ways), Space fires ahead.',
};

export function ControlsPicker({ value, onChange }: { value: MazeControls; onChange: (c: MazeControls) => void }) {
  return (
    <div className="mzcontrols" role="radiogroup" aria-label="Controls">
      {(['mouse', 'keys'] as const).map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          className={`mzcontrols__opt ${value === c ? 'is-active' : ''}`}
          onClick={(e) => {
            onChange(c);
            // Off the button, so Space fires rather than pressing it again.
            e.currentTarget.blur();
          }}
        >
          {c === 'mouse' ? 'Mouse + keys' : 'Keyboard only'}
        </button>
      ))}
    </div>
  );
}
