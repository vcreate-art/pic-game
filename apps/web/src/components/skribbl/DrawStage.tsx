import { useEffect, useRef, useState } from 'react';
import { Eraser, PaintBucket, Pencil, Trash2, Undo2, Users } from 'lucide-react';
import { BRUSH_SIZES, PALETTE } from '@pic-game/shared';
import { CanvasBoard } from '../../canvas/CanvasBoard.js';
import { useVisualViewport } from '../../lib/useVisualViewport.js';
import { getSocket } from '../../net/socket.js';
import { selectSkribbl, useGame } from '../../store/game.js';
import { useTools } from '../../store/tools.js';
import { Podium } from '../Podium.js';
import { useReaction } from '../Reactions.js';
import { RoomMenu } from '../RoomPanel.js';
import { Scoreboard } from '../Scoreboard.js';
import { TurnResult } from '../TurnResult.js';
import { WordChoice } from '../WordChoice.js';
import { MeButton, SenderAvatar, SheetMe, StageHead, useStageChrome } from './stage.js';

/**
 * Drawing on a phone. The guessing stage's header (with the word you're
 * drawing in place of the blanks), the canvas as wide as the screen, the
 * guesses coming in below it rather than over it, and the tools along the
 * bottom: the whole palette, then the brush, pen, fill, eraser, undo and
 * clear, and your avatar and the players button. There's no keyboard to make
 * room for; the sheets rise over the tools, and a tap above one closes it.
 * Nothing scrolls, so a stroke never moves the page.
 */

type Sheet = 'players' | 'me' | null;

/** A sheet's height: about a keyboard's, capped for short screens. */
const SHEET_PX = 320;
const SHEET_RATIO = 0.55;

/** How long Clear waits for its second tap. */
const CLEAR_CONFIRM_MS = 3000;

export function DrawStage() {
  useStageChrome();
  const room = useGame(selectSkribbl);
  const messages = useGame((s) => s.messages);
  const vv = useVisualViewport();
  const [sheet, setSheet] = useState<Sheet>(null);
  const meRef = useRef<HTMLButtonElement>(null);
  const headRef = useRef<HTMLElement>(null);

  if (!room) return null;
  const phase = room.phase;
  const toggle = (kind: Exclude<Sheet, null>) => setSheet((s) => (s === kind ? null : kind));

  return (
    <div className="gstage dstage" style={{ top: vv.offsetTop, height: vv.height }}>
      <StageHead headRef={headRef} />

      <div className="gstage__board board__wrap">
        <CanvasBoard />
        <Tally />
        {phase === 'choosing' && <WordChoice />}
        {phase === 'turnEnd' && <TurnResult />}
        {phase === 'gameEnd' && <Podium />}
      </div>

      {/* The guesses, newest at the bottom, under the drawing, never on it. */}
      <div className="gstage__chat dstage__feed" aria-live="polite">
        {messages.slice(-30).map((m) =>
          m.kind === 'divider' ? (
            <div key={m.id} className="msg--divider" role="separator">
              <span>{m.text}</span>
            </div>
          ) : (
            <div key={m.id} className={`msg msg--${m.kind}`}>
              <SenderAvatar playerId={m.playerId} />
              {m.kind === 'chat' && <strong className="msg__name">{m.name}</strong>}
              {m.kind === 'secret' && <strong className="msg__name">{m.name} (guessed)</strong>}
              <span className="msg__text">{m.text}</span>
            </div>
          ),
        )}
      </div>

      <div className="dtools">
        {phase === 'drawing' && <DrawTools />}
        <div className="dtools__row">
          {phase === 'drawing' && <DrawActions />}
          <span className="dtools__spacer" />
          <MeButton btnRef={meRef} on={sheet === 'me'} onToggle={() => toggle('me')} />
          <button
            type="button"
            className={`gstage__roombtn dtools__players ${sheet === 'players' ? 'is-on' : ''}`}
            aria-pressed={sheet === 'players'}
            aria-label="Players and scores"
            onClick={() => toggle('players')}
          >
            <Users aria-hidden="true" />
            <span className="gstage__roomcount">{room.players.length}</span>
          </button>
        </div>
      </div>

      {sheet && (
        <>
          {/* Above the sheet: a tap here closes it, and never draws. */}
          <div className="dstage__scrim" onClick={() => setSheet(null)} aria-hidden="true" />
          <div
            className={`gsheet ${sheet === 'me' ? 'gsheet--me' : ''}`}
            style={{ height: Math.min(SHEET_PX, Math.round(vv.height * SHEET_RATIO)) }}
          >
            {sheet === 'players' ? (
              <Scoreboard />
            ) : (
              <>
                <SheetMe />
                <RoomMenu standings={false} leaveTile />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** The whole palette, two rows across the screen: one tap to a colour. */
function DrawTools() {
  const { tool, color, setColor } = useTools();
  return (
    <div className="dtools__palette">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          className={`swatch ${color === c && tool !== 'eraser' ? 'is-active' : ''}`}
          style={{ background: c }}
          onClick={() => setColor(c)}
          aria-label={`Colour ${c}`}
        />
      ))}
    </div>
  );
}

/**
 * The brush (a tap steps through the sizes, shown as a dot in the colour),
 * pen, fill and eraser, undo, and clear, which wants a second tap within a
 * few seconds, since it can't be undone.
 */
function DrawActions() {
  const { tool, color, size, setTool, setSize } = useTools();
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    if (!clearing) return;
    const t = setTimeout(() => setClearing(false), CLEAR_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [clearing]);
  const next = BRUSH_SIZES[(BRUSH_SIZES.indexOf(size as (typeof BRUSH_SIZES)[number]) + 1) % BRUSH_SIZES.length]!;
  const dot = Math.max(4, Math.min(22, size / 1.6));

  return (
    <>
      <button type="button" className="dtools__btn" aria-label={`Brush size ${size}, tap for ${next}`} onClick={() => setSize(next)}>
        <span className="dtools__dot" style={{ width: dot, height: dot, background: tool === 'eraser' ? '#94a3b8' : color }} />
      </button>
      <button
        type="button"
        className={`dtools__btn ${tool === 'pen' ? 'is-active' : ''}`}
        aria-label="Pen"
        aria-pressed={tool === 'pen'}
        onClick={() => setTool('pen')}
      >
        <Pencil aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`dtools__btn ${tool === 'fill' ? 'is-active' : ''}`}
        aria-label="Fill"
        aria-pressed={tool === 'fill'}
        onClick={() => setTool('fill')}
      >
        <PaintBucket aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`dtools__btn ${tool === 'eraser' ? 'is-active' : ''}`}
        aria-label="Eraser"
        aria-pressed={tool === 'eraser'}
        onClick={() => setTool('eraser')}
      >
        <Eraser aria-hidden="true" />
      </button>
      <button type="button" className="dtools__btn" aria-label="Undo" onClick={() => getSocket().emit('canvas:undo')}>
        <Undo2 aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`dtools__btn dtools__btn--danger ${clearing ? 'is-asking' : ''}`}
        aria-label={clearing ? 'Tap again to clear the drawing' : 'Clear the drawing'}
        onClick={() => {
          if (!clearing) return setClearing(true);
          getSocket().emit('canvas:clear');
          setClearing(false);
        }}
      >
        <Trash2 aria-hidden="true" />
        {clearing && <span className="dtools__ask">Clear?</span>}
      </button>
    </>
  );
}

/** What everyone thinks of your drawing, in its top corner where guessers
 *  have their react button. Yours to see, not to vote on. */
function Tally() {
  const r = useReaction();
  if (!r || !r.isDrawer) return null;
  return (
    <div className="dstage__tally" aria-label={`${r.likes} likes, ${r.dislikes} dislikes`}>
      <span aria-hidden="true">👍</span>
      <b>{r.likes}</b>
      <span aria-hidden="true">👎</span>
      <b>{r.dislikes}</b>
    </div>
  );
}
