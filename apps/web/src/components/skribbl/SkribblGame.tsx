import { CanvasBoard } from '../../canvas/CanvasBoard.js';
import { selectIsDrawer, selectSkribbl, useGame } from '../../store/game.js';
import { Chat } from '../Chat.js';
import { Gallery } from '../Gallery.js';
import { Podium } from '../Podium.js';
import { Reactions } from '../Reactions.js';
import { Scoreboard } from '../Scoreboard.js';
import { Timer } from '../Timer.js';
import { Toolbar } from '../Toolbar.js';
import { TurnResult } from '../TurnResult.js';
import { WordChoice } from '../WordChoice.js';
import { WordMask } from '../WordMask.js';

/** The draw-and-guess play surface. The room route picks this or the chess
 *  board off `room.kind`; neither knows the other exists. */
export function SkribblGame() {
  const room = useGame(selectSkribbl);
  const isDrawer = useGame(selectIsDrawer);
  if (!room) return null;
  const phase = room.phase;

  return (
    <div className="game game--skribbl">
      {/* Three tracks, with the word in the middle one, so it centres against
          the header itself rather than against whatever space is left over. */}
      <div className="game__head">
        <div className="game__head-side">
          <span className="game__round">
            Round {room.round}/{room.settings.rounds}
          </span>
          <Reactions />
        </div>
        <WordMask />
        <div className="game__head-side game__head-side--end">
          {phase === 'drawing' && room.turn && (
            <Timer endsAt={room.turn.endsAt} total={room.settings.drawTime} />
          )}
        </div>
      </div>

      <div className="game__body">
        <Scoreboard />

        <div className="game__stage">
          <div className="board__wrap">
            <CanvasBoard />
            {phase === 'choosing' && <WordChoice />}
            {phase === 'turnEnd' && <TurnResult />}
            {phase === 'gameEnd' && <Podium />}
          </div>
          {isDrawer && phase === 'drawing' && <Toolbar />}
        </div>

        <Chat />
      </div>
      <Gallery />
    </div>
  );
}
