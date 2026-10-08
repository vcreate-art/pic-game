import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, PaintBucket, Pencil, Redo2, Trash2, Undo2, Users } from 'lucide-react';
import { BRUSH_SIZES } from '@pic-game/shared';
import { CanvasBoard } from '../../canvas/CanvasBoard.js';
import { useGuessBox } from '../Chat.js';
import { useDismiss } from '../../lib/useDismiss.js';
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
 * drawing in place of the blanks), the canvas as wide as the screen with a
 * colour bar down its right edge, the tools right under it (the brush, pen,
 * fill and eraser, undo and redo, and clear, grouped by spacing), and the
 * guesses filling the rest, and at the bottom the guessing stage's row:
 * your avatar, the guess box (shut while you draw), and the players button. There's no keyboard to make room for; the sheets rise
 * over the tools, and a tap above one closes it.
 * Nothing scrolls, so a stroke never moves the page.
 */

type Sheet = 'players' | 'me' | null;

/** A sheet's height: about a keyboard's, capped for short screens. */
const SHEET_PX = 320;
const SHEET_RATIO = 0.55;

/** How long the note on a tap of the shut guess box stays. */
const NO_CHAT_MS = 2200;

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
  const box = useGuessBox();
  // When the shut box was last tapped: its note shows for a moment after.
  const [noChat, setNoChat] = useState(0);
  // Gone after a moment, or as soon as anything else is touched (a sheet
  // opening, the tools, the drawing) or the page is left, so it never hangs
  // over what comes next.
  useEffect(() => {
    if (!noChat) return;
    const dismiss = () => setNoChat(0);
    const t = setTimeout(dismiss, NO_CHAT_MS);
    const away = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.('.dstage__foot .chat__input')) dismiss();
    };
    const hidden = () => document.hidden && dismiss();
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', dismiss);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', dismiss);
    };
  }, [noChat]);
  useEffect(() => {
    if (sheet) setNoChat(0);
  }, [sheet]);

  if (!room) return null;
  const phase = room.phase;
  const toggle = (kind: Exclude<Sheet, null>) => setSheet((s) => (s === kind ? null : kind));

  return (
    <div className={`gstage dstage ${sheet ? 'has-sheet' : ''}`} style={{ top: vv.offsetTop, height: vv.height }}>
      <StageHead headRef={headRef} />

      <div className="gstage__board board__wrap">
        <CanvasBoard />
        {phase === 'drawing' && <ColorBar />}
        <Tally />
        {phase === 'choosing' && <WordChoice />}
        {phase === 'turnEnd' && <TurnResult />}
        {phase === 'gameEnd' && <Podium />}
      </div>

      {/* The tools right under the drawing, where the hand already is. */}
      {phase === 'drawing' && (
        <div className="dtools">
          <DrawActions />
        </div>
      )}

      {/* The guesses, newest at the bottom, under the drawing, never on it;
          then the same bottom row as when guessing. */}
      <div className="dstage__middle">
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
      </div>

      {sheet && (
        <>
          {/* Above the sheet: a tap here closes it, and never draws. */}
          <div className="dstage__scrim" onClick={() => setSheet(null)} aria-hidden="true" />
          {/* Above the chat bar, which stays where it is at the bottom. */}
          <div
            className={`gsheet dstage__sheet ${sheet === 'me' ? 'gsheet--me' : ''}`}
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

      {/* The chat bar, as on the guessing stage: you, the guess box
          (shut while you draw, and saying so, as the desktop's does), and
          the players. */}
      <div className="gstage__form dstage__foot">
        <MeButton btnRef={meRef} on={sheet === 'me'} onToggle={() => toggle('me')} />
        <div className="chat__field">
          <div
            className="chat__input chat__input--editable"
            role="textbox"
            aria-disabled="true"
            aria-label="Your guess"
            data-empty=""
            data-placeholder={box.placeholder}
            // As tapping the guess box does when guessing: back to the chat;
            // with no sheet to close, a word on why it won't type.
            onClick={() => (sheet ? setSheet(null) : setNoChat(Date.now()))}
          />
          {noChat > 0 && (
            <span key={noChat} className="dstage__nochat" role="status">
              You can’t chat while you’re drawing
            </span>
          )}
        </div>
        <button
          type="button"
          className={`gstage__roombtn ${sheet === 'players' ? 'is-on' : ''}`}
          aria-pressed={sheet === 'players'}
          aria-label="Players and scores"
          onClick={() => toggle('players')}
        >
          <Users aria-hidden="true" />
          <span className="gstage__roomcount">{room.players.length}</span>
        </button>
      </div>


    </div>
  );
}

/**
 * The brush (a tap opens its sizes above it), pen, fill and eraser, undo and
 * redo, and clear, which wants a second tap within a few seconds, since it
 * can't be undone. Grouped by spacing, spread across the screen.
 */
function DrawActions() {
  const { tool, color, size, setTool, setSize } = useTools();
  const socket = getSocket();
  const [clearing, setClearing] = useState(false);
  const [sizes, setSizes] = useState(false);
  const pick = useRef<HTMLDivElement>(null);
  const closeSizes = useCallback(() => setSizes(false), []);
  useDismiss(pick, sizes, closeSizes);
  useEffect(() => {
    if (!clearing) return;
    const t = setTimeout(() => setClearing(false), CLEAR_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [clearing]);
  const ink = tool === 'eraser' ? '#94a3b8' : color;
  const dot = (s: number) => Math.max(4, Math.min(24, s / 1.5));
  const toolBtn = (t: 'pen' | 'fill' | 'eraser', label: string, Icon: typeof Pencil) => (
    <button
      type="button"
      className={`dtools__btn ${tool === t ? 'is-active' : ''}`}
      aria-label={label}
      aria-pressed={tool === t}
      onClick={() => setTool(t)}
    >
      <Icon aria-hidden="true" />
    </button>
  );

  return (
    <div className="dtools__row">
      <div className="dtools__group brushpick" ref={pick}>
        <button
          type="button"
          className={`dtools__btn ${sizes ? 'is-on' : ''}`}
          aria-label={`Brush size ${size}`}
          aria-expanded={sizes}
          onClick={() => setSizes(!sizes)}
        >
          <span className="dtools__dot" style={{ width: dot(size), height: dot(size), background: ink }} />
        </button>
        {sizes && (
          <div className="dtools__sizes" role="group" aria-label="Brush size">
            {BRUSH_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                className={`dtools__btn ${size === s ? 'is-active' : ''}`}
                aria-label={`Brush size ${s}`}
                aria-pressed={size === s}
                onClick={() => {
                  setSize(s);
                  closeSizes();
                }}
              >
                <span className="dtools__dot" style={{ width: dot(s), height: dot(s), background: ink }} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="dtools__group" role="group" aria-label="Drawing tool">
        {toolBtn('pen', 'Pen', Pencil)}
        {toolBtn('fill', 'Fill', PaintBucket)}
        {toolBtn('eraser', 'Eraser', Eraser)}
      </div>
      <div className="dtools__group" role="group" aria-label="History">
        <button type="button" className="dtools__btn" aria-label="Undo" onClick={() => socket.emit('canvas:undo')}>
          <Undo2 aria-hidden="true" />
        </button>
        <button type="button" className="dtools__btn" aria-label="Redo" onClick={() => socket.emit('canvas:redo')}>
          <Redo2 aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        className={`dtools__btn dtools__btn--danger ${clearing ? 'is-asking' : ''}`}
        aria-label={clearing ? 'Tap again to clear the drawing' : 'Clear the drawing'}
        onClick={() => {
          if (!clearing) return setClearing(true);
          socket.emit('canvas:clear');
          setClearing(false);
        }}
      >
        <Trash2 aria-hidden="true" />
        {clearing && <span className="dtools__ask">Clear?</span>}
      </button>
    </div>
  );
}

/** The colour bar, top to bottom: white, the rainbow, brown, black. */
const BAR_STOPS: readonly (readonly [number, string])[] = [
  [0, '#ffffff'],
  [0.07, '#ff3030'],
  [0.18, '#ff9500'],
  [0.29, '#ffd60a'],
  [0.41, '#34c759'],
  [0.52, '#00c2b8'],
  [0.62, '#0a84ff'],
  [0.71, '#5e5ce6'],
  [0.8, '#bf5af2'],
  [0.88, '#ff4fa3'],
  [0.94, '#8b5a2b'],
  [1, '#000000'],
];
const BAR_GRADIENT = `linear-gradient(to bottom, ${BAR_STOPS.map(([t, c]) => `${c} ${t * 100}%`).join(', ')})`;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The colour at a point down the bar, 0 at the top to 1 at the bottom. */
function colorAt(t: number): string {
  const i = Math.max(1, BAR_STOPS.findIndex(([at]) => at >= t));
  const [t0, c0] = BAR_STOPS[i - 1]!;
  const [t1, c1] = BAR_STOPS[i]!;
  const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  const a = rgb(c0);
  const b = rgb(c1);
  return `#${a.map((v, j) => Math.round(v + (b[j]! - v) * k).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Colour as WhatsApp and Instagram do it: a bar down the drawing's right
 * edge, touched or dragged for any colour along it, with a big drop of the
 * colour beside the finger while it moves, so the finger doesn't hide it.
 * Its presses are its own: they never draw. Arrow keys step along it too.
 */
function ColorBar() {
  const { color, setColor } = useTools();
  const bar = useRef<HTMLDivElement>(null);
  // Where along the bar the colour came from; black, at the bottom, to start.
  const [at, setAt] = useState(1);
  const [dragging, setDragging] = useState(false);
  const pick = (t: number) => {
    const c = Math.min(1, Math.max(0, t));
    setAt(c);
    setColor(colorAt(c));
  };
  const fromPointer = (y: number) => {
    const r = bar.current!.getBoundingClientRect();
    pick((y - r.top) / r.height);
  };

  return (
    <div
      ref={bar}
      className={`colorbar ${dragging ? 'is-dragging' : ''}`}
      style={{ background: BAR_GRADIENT }}
      role="slider"
      tabIndex={0}
      aria-label="Colour"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(at * 100)}
      aria-valuetext={color}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        fromPointer(e.clientY);
      }}
      onPointerMove={(e) => dragging && fromPointer(e.clientY)}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        pick(at + (e.key === 'ArrowDown' ? 0.02 : -0.02));
      }}
    >
      <span className="colorbar__thumb" style={{ top: `${at * 100}%`, background: color }} />
      {dragging && <span className="colorbar__drop" style={{ top: `${at * 100}%`, background: color }} />}
    </div>
  );
}

/** What everyone thinks of your drawing, faint in its top-left corner, the
 *  one the colour bar leaves free. Only once someone has reacted, and only
 *  the counts that aren't zero. Yours to see, not to vote on; strokes pass
 *  through it. */
function Tally() {
  const r = useReaction();
  if (!r || !r.isDrawer || r.likes + r.dislikes === 0) return null;
  return (
    <div className="dstage__tally" aria-label={`${r.likes} likes, ${r.dislikes} dislikes`}>
      {r.likes > 0 && (
        <span>
          <span aria-hidden="true">👍</span> {r.likes}
        </span>
      )}
      {r.dislikes > 0 && (
        <span>
          <span aria-hidden="true">👎</span> {r.dislikes}
        </span>
      )}
    </div>
  );
}
