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
/** How many messages show over the drawing while the keys or a sheet leave
 *  it little room (older ones are a scroll away); with the whole screen, the
 *  chat fills the gap instead. */
const CRAMPED_MESSAGES = 3;
/** How far from the bottom still counts as reading the newest, so a new
 *  message scrolls into view rather than waiting under the fold. */
const STICK_PX = 24;
/** How long the chat waits, back at the newest message, before it folds:
 *  a moment for the momentum of a scroll to finish. */
const FOLD_MS = 500;
/** How much of the stage the chat may take while someone reads back. */
const READING_RATIO = 0.7;
/** How far over the drawing the chat fades out, once it reaches it. */
const FADE_PX = 96;

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

  // The drawing's and the foot's heights, for the gap between them: the
  // room the chat has before it starts covering the drawing.
  const boardRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const [boardHeight, setBoardHeight] = useState(0);
  const [footHeight, setFootHeight] = useState(0);
  useLayoutEffect(() => {
    const board = boardRef.current;
    const foot = footRef.current;
    if (!board || !foot) return;
    const measure = () => {
      setBoardHeight(board.getBoundingClientRect().height);
      setFootHeight(foot.getBoundingClientRect().height);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(board);
    ro.observe(foot);
    return () => ro.disconnect();
    // Again once the room arrives: before it, there's nothing to measure.
  }, [Boolean(room)]);

  // The chat scrolls. Cramped, it's as tall as its last few messages; and
  // whoever is reading the newest keeps up with them as more arrive.
  const chatRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  // Scrolling back through the chat opens it: taller, and without the fade,
  // so older lines are readable. It stays open for as long as they read,
  // and folds once they scroll back down to the newest, or tap, type or send
  // to get on with guessing. Only their own scrolling opens it: the chat
  // following new messages doesn't.
  const [reading, setReading] = useState(false);
  const touching = useRef(false);
  const byHand = useRef(false);
  const foldTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fold = () => {
    clearTimeout(foldTimer.current);
    atBottom.current = true;
    setReading(false);
  };
  /** Folds once they've stayed at the newest, finger lifted, for a moment. */
  const foldAtNewest = () => {
    clearTimeout(foldTimer.current);
    foldTimer.current = setTimeout(() => {
      if (!touching.current && atBottom.current) fold();
    }, FOLD_MS);
  };
  useEffect(() => () => clearTimeout(foldTimer.current), []);
  const [crampedHeight, setCrampedHeight] = useState(0);
  const shownHeight = useRef(0);
  useLayoutEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const rows = el.children;
    const first = rows[Math.max(0, rows.length - CRAMPED_MESSAGES)] as HTMLElement | undefined;
    const last = rows[rows.length - 1] as HTMLElement | undefined;
    const pad = parseFloat(getComputedStyle(el).paddingBottom) || 0;
    setCrampedHeight(first && last ? last.offsetTop + last.offsetHeight - first.offsetTop + pad : 0);
    // Opening and folding move the chat's top edge; this keeps the lines
    // where they were on screen, or at the newest for whoever is there.
    const grew = el.clientHeight - shownHeight.current;
    shownHeight.current = el.clientHeight;
    if (atBottom.current) el.scrollTop = el.scrollHeight;
    else if (grew) el.scrollTop -= grew;
  });

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

  // Nothing under the stage may scroll while it's up. With the keyboard open
  // the visible window is smaller than the page, and a drag that pans it
  // makes Chrome's address bar collapse and expand, which moves everything.
  // As toys' storefront does for its stage; overscroll-behavior also keeps
  // pull-to-refresh and the rubber band out of a game in progress. Put back
  // as it was when the stage goes, so other pages scroll as normal.
  useEffect(() => {
    const els = [document.documentElement, document.body];
    const before = els.map((el) => [el.style.overflow, el.style.overscrollBehavior] as const);
    for (const el of els) {
      el.style.overflow = 'hidden';
      el.style.overscrollBehavior = 'none';
    }
    return () =>
      els.forEach((el, i) => {
        el.style.overflow = before[i]![0];
        el.style.overscrollBehavior = before[i]![1];
      });
  }, []);

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
  // With the keys or a sheet up, a few lines over the drawing; with neither,
  // as many as fit, solid down the gap and fading only once over the drawing.
  const cramped = dockHeight > 0;
  const gap = Math.max(0, stageHeight - boardHeight - footHeight);
  const tapStage = () => {
    fold();
    if (sheet) closeSheet();
    else if (!keyboardIsUp()) focusInput();
  };

  return (
    <div className="gstage" style={{ top: stageTop, height: stageHeight }}>
      {/* A tap on the drawing asks for the keyboard, like tapping a text. */}
      <div ref={boardRef} className="gstage__board board__wrap" onClick={tapStage}>
        <CanvasBoard />
        {phase === 'choosing' && <WordChoice />}
        {phase === 'turnEnd' && <TurnResult />}
        {phase === 'gameEnd' && <Podium />}
      </div>

      <div ref={footRef} className="gstage__foot">
      {/* Newest at the bottom, just over the guess box; older lines climb and
          fade, over the drawing if they reach it. */}
      <div
        ref={chatRef}
        className={`gstage__chat ${cramped ? '' : 'is-roomy'} ${reading ? 'is-reading' : ''}`}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
          if (!byHand.current) return;
          if (atBottom.current) return foldAtNewest();
          clearTimeout(foldTimer.current);
          setReading(true);
        }}
        onTouchStart={() => {
          touching.current = true;
          byHand.current = true;
        }}
        onTouchEnd={() => {
          touching.current = false;
          if (atBottom.current) foldAtNewest();
        }}
        onTouchCancel={() => {
          touching.current = false;
          if (atBottom.current) foldAtNewest();
        }}
        onWheel={() => (byHand.current = true)}
        onClick={tapStage}
        style={{
          maxHeight: reading
            ? Math.max(Math.round(stageHeight * READING_RATIO), cramped ? crampedHeight : gap + FADE_PX)
            : cramped
              ? crampedHeight || undefined
              : gap + FADE_PX,
          ['--solid' as string]: `${gap}px`,
          ['--fade' as string]: `${FADE_PX}px`,
        }}
      >
        {messages.slice(-50).map((m) =>
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

      <form
        className="gstage__form"
        onSubmit={(e) => {
          fold();
          box.send(e);
        }}
      >
        <div className="chat__field">
          <input
            ref={input}
            className="chat__input"
            value={box.text}
            maxLength={MAX_CHAT_LEN}
            disabled={box.locked}
            placeholder={box.placeholder}
            onChange={(e) => box.setText(e.target.value)}
            onFocus={() => {
              fold();
              if (sheet) setSheet(null);
            }}
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
