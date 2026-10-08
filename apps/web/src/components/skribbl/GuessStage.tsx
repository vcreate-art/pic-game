import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Keyboard, Smile, Timer as TimerIcon, Users } from 'lucide-react';
import { MAX_CHAT_LEN } from '../../constants.js';
import { CanvasBoard } from '../../canvas/CanvasBoard.js';
import { noAutofill } from '../../lib/noAutofill.js';
import { lastKeyboardHeight, useVisualViewport } from '../../lib/useVisualViewport.js';
import { selectSkribbl, useGame } from '../../store/game.js';
import { useGuessBox } from '../Chat.js';
import { Podium } from '../Podium.js';
import { Reactions } from '../Reactions.js';
import { Scoreboard } from '../Scoreboard.js';
import { Timer } from '../Timer.js';
import { TurnResult } from '../TurnResult.js';
import { WordChoice } from '../WordChoice.js';
import { WordMask } from '../WordMask.js';

/**
 * Guessing on a phone. The canvas across the top, the chat rising over it
 * and fading as it climbs, the guess box, and a strip of tabs; under them the
 * keyboard, which is up by default, or the sheet a tab swapped in for it.
 *
 * The keyboard handling is the toys repo's mobile editor's: the stage is sized
 * to what the keyboard leaves, so the browser never scrolls anything under the
 * keys, and a sheet is built at the keyboard's own height before the keys are
 * sent away, so swapping one for the other moves nothing.
 */

type Sheet = 'players' | 'round' | 'react' | null;

/** A sheet's height before any keyboard has been seen: phone keyboards run
 *  about 260 to 340px. Capped against the screen for short windows. */
const FALLBACK_DOCK_PX = 300;
const FALLBACK_DOCK_RATIO = 0.45;
/** How long the space stays held after a sheet hands it back to the keys,
 *  which take a few hundred milliseconds to arrive. */
const DOCK_HOLD_MS = 600;
/** How long our own last word on the keyboard outranks the measurement,
 *  which lags behind it while the keys move. */
const KEYBOARD_GRACE_MS = 600;

export function GuessStage() {
  const room = useGame(selectSkribbl);
  const messages = useGame((s) => s.messages);
  const box = useGuessBox();
  const vv = useVisualViewport();
  const keyboardOpen = vv.keyboardInset > 0;

  const [sheet, setSheet] = useState<Sheet>(null);
  const [dock, setDock] = useState(0);
  const [held, setHeld] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const wanted = useRef(false);
  const changedAt = useRef(0);

  // Where the app's top bar ends: the stage starts under it.
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const bar = document.querySelector('.topbar');
    const measure = () => setTop(bar ? bar.getBoundingClientRect().height : 0);
    measure();
    const ro = bar ? new ResizeObserver(measure) : null;
    if (bar) ro!.observe(bar);
    return () => ro?.disconnect();
  }, []);

  // The bottom of the screen is held by the keyboard, or by the sheet that
  // took its place at its height; for a moment during a swap, both.
  const dockHeight = Math.max(vv.keyboardInset, sheet || held ? dock : 0);
  const stageTop = Math.max(vv.offsetTop, top);
  const stageBottom = vv.offsetTop + vv.height - (dockHeight - vv.keyboardInset);
  const stageHeight = Math.max(0, stageBottom - stageTop);

  useEffect(() => {
    if (!held) return;
    if (keyboardOpen) return setHeld(false);
    const t = setTimeout(() => setHeld(false), DOCK_HOLD_MS);
    return () => clearTimeout(t);
  }, [held, keyboardOpen]);

  /** Asks for the keyboard. Only from inside a tap: phones raise it only for
   *  a focus() inside a user gesture. Dropped and retaken if already focused,
   *  since a focus taken on load holds the box and raises nothing. */
  const focusInput = useCallback(() => {
    const el = input.current;
    if (!el) return;
    wanted.current = true;
    changedAt.current = performance.now();
    if (document.activeElement === el) el.blur();
    el.focus({ preventScroll: true });
  }, []);

  const dismissKeyboard = useCallback(() => {
    wanted.current = false;
    changedAt.current = performance.now();
    input.current?.blur();
  }, []);

  /** Whether the keys are up, trusting our own last instruction while the
   *  measurement is still catching up with it. */
  const keyboardIsUp = () =>
    performance.now() - changedAt.current < KEYBOARD_GRACE_MS ? wanted.current : keyboardOpen;

  // Best effort on arrival: a desktop browser focuses; a phone waits for the
  // first tap, since it won't raise the keyboard without one.
  useEffect(() => {
    const el = input.current;
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, []);

  /** Measure, then build, then blur: the sheet takes the keyboard's exact
   *  height before the keys are told to go, so nothing above it moves. */
  function openSheet(kind: Exclude<Sheet, null>) {
    setDock(lastKeyboardHeight() || Math.min(FALLBACK_DOCK_PX, Math.round(vv.height * FALLBACK_DOCK_RATIO)));
    dismissKeyboard();
    setSheet(kind);
  }

  /** Hands the space back to the keyboard, straight from the closing tap. */
  function closeSheet() {
    setSheet(null);
    setHeld(true);
    focusInput();
  }

  const toggle = (kind: Exclude<Sheet, null>) => (sheet === kind ? closeSheet() : openSheet(kind));
  const toggleKeyboard = () => {
    if (sheet) return closeSheet();
    if (keyboardIsUp()) dismissKeyboard();
    else focusInput();
  };

  if (!room) return null;
  const phase = room.phase;
  const guessing = !sheet && keyboardIsUp();

  return (
    <div className="gstage" style={{ top: stageTop, height: stageHeight }}>
      {/* A tap on the drawing asks for the keyboard, like tapping a text. */}
      <div className="gstage__board board__wrap" onClick={() => (sheet ? closeSheet() : !keyboardIsUp() && focusInput())}>
        <CanvasBoard />
        {phase === 'choosing' && <WordChoice />}
        {phase === 'turnEnd' && <TurnResult />}
        {phase === 'gameEnd' && <Podium />}
      </div>

      <div className="gstage__foot">
      {/* Newest at the bottom, just over the guess box; older lines climb and
          fade, over the drawing if they reach it. */}
      <div className="gstage__chat" aria-live="polite" style={{ maxHeight: Math.round(stageHeight * 0.7) }}>
        {messages.slice(-30).map((m) =>
          m.kind === 'divider' ? (
            <div key={m.id} className="msg--divider" role="separator">
              <span>{m.text}</span>
            </div>
          ) : (
            <div key={m.id} className={`msg msg--${m.kind}`}>
              {m.kind === 'chat' && <strong className="msg__name">{m.name}</strong>}
              {m.kind === 'secret' && <strong className="msg__name">{m.name} (guessed)</strong>}
              <span className="msg__text">{m.text}</span>
            </div>
          ),
        )}
      </div>

      <form className="gstage__form" onSubmit={box.send}>
        <div className="chat__field">
          <input
            ref={input}
            className="chat__input"
            value={box.text}
            maxLength={MAX_CHAT_LEN}
            disabled={box.locked}
            placeholder={box.placeholder}
            onChange={(e) => box.setText(e.target.value)}
            onFocus={() => sheet && setSheet(null)}
            aria-label="Your guess"
            enterKeyHint="send"
            {...noAutofill}
          />
          {box.showCount && (
            <span className={`chat__count ${box.matches ? 'is-match' : ''}`}>
              {box.typed}/{box.target}
            </span>
          )}
        </div>
        <button type="submit" className="visually-hidden" tabIndex={-1}>
          Send
        </button>
      </form>

      {/* The tabs. Each swaps the keyboard for its sheet; tapped again, or
          Guess, brings the keyboard back. preventDefault on pointerdown keeps a
          tab from taking focus off the guess box on its way. */}
      <nav className="gstage__tabs" aria-label="Game">
        {(
          [
            ['guess', 'Guess', Keyboard],
            ['players', 'Players', Users],
            ['round', 'Round', TimerIcon],
            ['react', 'React', Smile],
          ] as const
        ).map(([kind, label, Icon]) => {
          const on = kind === 'guess' ? guessing : sheet === kind;
          return (
            <button
              key={kind}
              type="button"
              className={`gstage__tab ${on ? 'is-on' : ''}`}
              aria-pressed={on}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => (kind === 'guess' ? toggleKeyboard() : toggle(kind))}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
      </div>

      {sheet && (
        <div className="gsheet" style={{ height: dock }}>
          {sheet === 'players' && <Scoreboard />}
          {sheet === 'round' && (
            <div className="gsheet__round">
              <p className="gsheet__label">Round {room.round} of {room.settings.rounds}</p>
              <WordMask />
              {phase === 'drawing' && room.turn && <Timer endsAt={room.turn.endsAt} total={room.settings.drawTime} />}
            </div>
          )}
          {sheet === 'react' && (
            <div className="gsheet__react">
              <p className="gsheet__label">What do you think of this drawing?</p>
              <Reactions />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
