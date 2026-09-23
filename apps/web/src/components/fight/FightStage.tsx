import { useEffect, useRef } from 'react';
import type { FightSide } from '@pic-game/shared';
import { FightInput } from '../../fight/input.js';
import { getFightView } from '../../fight/instance.js';
import { VIEW_H, VIEW_W, type FightMeta } from '../../fight/renderer.js';
import { getSocket } from '../../net/socket.js';

interface Props {
  meta: FightMeta;
  /** Our side, if we are fighting. Spectators get no controller. */
  mySide: FightSide | null;
  live: boolean;
}

const touchOnly = () =>
  typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;

export function FightStage({ meta, mySide, live }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const view = getFightView();
    view.attach(canvas);
    return () => view.detach();
  }, []);

  // Rebuilt only when something in it changes, not on every render.
  const { picks, names, blood, roundsToWin } = meta;
  useEffect(() => {
    getFightView().setMeta({ picks, names, blood, roundsToWin });
  }, [picks.a, picks.b, names.a, names.b, blood, roundsToWin]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mySide || !live) return;
    const socket = getSocket();
    const input = new FightInput((u) => socket.emit('fight:input', u));
    input.attach();
    return () => input.detach();
  }, [mySide, live]);

  return (
    <div className="fstage" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
      <canvas ref={ref} className="fstage__canvas" />
      {mySide && touchOnly() && (
        <p className="fstage__note">Stick Kombat needs a keyboard or a gamepad.</p>
      )}
    </div>
  );
}
