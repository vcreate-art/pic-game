import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SmilePlus, Users } from 'lucide-react';
import { MAX_CHAT_LEN } from '../../constants.js';
import { CanvasBoard } from '../../canvas/CanvasBoard.js';
import { useDismiss } from '../../lib/useDismiss.js';
import { lastKeyboardHeight, useVisualViewport } from '../../lib/useVisualViewport.js';
import { selectSkribbl, useGame } from '../../store/game.js';
import { useGuessBox } from '../Chat.js';
import { Podium } from '../Podium.js';
import { useReaction } from '../Reactions.js';
import { RoomMenu } from '../RoomPanel.js';
import { Scoreboard } from '../Scoreboard.js';
import { TurnResult } from '../TurnResult.js';
import { WordChoice } from '../WordChoice.js';
import { MeButton, SENDER_AVATAR_PX, SenderAvatar, SheetMe, StageHead, useStageChrome } from './stage.js';

/**
 * Guessing on a phone. A header of its own in place of the app's (the round,
 * the blanks and the timer, always in sight), the canvas, the chat rising
 * over it and fading as it climbs, each line with its sender's avatar in the
 * gutter, and the guess box, with your avatar inside it and the players
 * button beside it; under them the keyboard, which is up by default, or the
 * sheet one of those swaps in for it. The players button's is the scores;
 * your avatar's is you (your name and look) and what the app's header held:
 * reporting a bug and the room menu. Not playing on your phone: this is the
 * phone.
 *
 * The keyboard handling is the toys repo's mobile editor's: the stage is sized
 * to what the keyboard leaves, so the browser never scrolls anything under the
 * keys, and a sheet is built at the keyboard's own height before the keys are
 * sent away, so swapping one for the other moves nothing.
 */

/** 'players' is the scores; 'me' is you and the room's controls, behind your
 *  own avatar so a look at the scores never puts Leave under a thumb. */
type Sheet = 'players' | 'me' | null;

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
/** As the open chat folds, the lines it's about to hide fade out: the one
 *  furthest from the guess box fastest, the nearest slowest. */
const FOLD_OUT_FAST_MS = 150;
const FOLD_OUT_SLOW_MS = 450;
/** How long lines that went out, but show again once folded, take to come back. */
const FOLD_IN_MS = 450;
/** Opening is the fold in reverse: the older lines it shows fade in, the one
 *  nearest the guess box fastest, the furthest slowest. */
const OPEN_IN_FAST_MS = 150;
const OPEN_IN_SLOW_MS = 450;
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
  const input = useRef<HTMLDivElement>(null);
  const wanted = useRef(false);
  const changedAt = useRef(0);

  useStageChrome();

  // The drawing's and the foot's heights, for the gap between them: the
  // room the chat has before it starts covering the drawing.
  const headRef = useRef<HTMLElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const [headHeight, setHeadHeight] = useState(0);
  const [boardHeight, setBoardHeight] = useState(0);
  const [footHeight, setFootHeight] = useState(0);
  useLayoutEffect(() => {
    const head = headRef.current;
    const board = boardRef.current;
    const foot = footRef.current;
    if (!head || !board || !foot) return;
    const measure = () => {
      setHeadHeight(head.getBoundingClientRect().height);
      setBoardHeight(board.getBoundingClientRect().height);
      setFootHeight(foot.getBoundingClientRect().height);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(head);
    ro.observe(board);
    ro.observe(foot);
    return () => ro.disconnect();
    // Again once the room arrives: before it, there's nothing to measure.
  }, [Boolean(room)]);

  // The chat scrolls. Cramped, it's as tall as its last few messages; and
  // whoever is reading the newest keeps up with them as more arrive.
  const chatRef = useRef<HTMLDivElement>(null);
  const meRef = useRef<HTMLButtonElement>(null);
  const myName = useGame((s) => s.room?.players.find((p) => p.id === s.me)?.name ?? '');
  const myId = useGame((s) => s.me);
  // While a sent line is in flight: the newest message when it left. Lines of
  // yours after that one wait unseen, so the real line, back from the server
  // before the flight lands, doesn't show twice; it fades in as it lands.
  const [landing, setLanding] = useState<{ after: string | undefined; landed: boolean } | null>(null);
  const standIns = useRef<HTMLElement[]>([]);
  const dropStandIns = () => {
    for (const el of standIns.current) el.remove();
    standIns.current = [];
  };
  // Landed, the stand-ins give way to the real line in the same frame: it's
  // in their exact place, so nothing moves or dims. If it isn't back from the
  // server yet, they wait for it, a while.
  const realBack =
    !!landing && messages.findIndex((m) => m.id === landing.after) < messages.findLastIndex((m) => m.playerId === myId);
  useLayoutEffect(() => {
    if (!landing?.landed) return;
    if (realBack) {
      dropStandIns();
      setLanding(null);
      return;
    }
    const t = setTimeout(() => {
      dropStandIns();
      setLanding(null);
    }, LANDING_WAIT_MS);
    return () => clearTimeout(t);
  }, [landing, realBack]);
  useEffect(() => dropStandIns, []);

  /**
   * Sending, shown: the line lifts off the guess box and your avatar off its
   * button, and both fly up to where the line lands in the chat, the avatar
   * shrinking into the gutter, then fade as the real line fades in. Stand-ins
   * on the page's top layer, so nothing in the chat moves for them.
   */
  const flySent = () => {
    const text = box.text.trim();
    const field = input.current;
    const chat = chatRef.current;
    if (!text || box.locked || !field || !chat) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    dropStandIns();
    const from = field.getBoundingClientRect();
    const into = chat.getBoundingClientRect();
    const gutter = parseFloat(getComputedStyle(chat).paddingLeft) || 0;
    const bottomPad = parseFloat(getComputedStyle(chat).paddingBottom) || 0;

    // The line as it will show, built at its landing spot, then sent back to
    // the guess box to start from.
    const line = document.createElement('div');
    line.className = 'msg msg--chat gstage__flying';
    const who = document.createElement('strong');
    who.className = 'msg__name';
    who.textContent = myName;
    const said = document.createElement('span');
    said.className = 'msg__text';
    said.textContent = text;
    line.append(who, said);
    document.body.append(line);
    const size = line.getBoundingClientRect();
    const landX = into.left + gutter;
    const landY = into.bottom - bottomPad - size.height;
    line.style.left = `${landX}px`;
    line.style.top = `${landY}px`;
    standIns.current.push(line);
    // Held where they land (fill: forwards) until the real line takes over.
    const fly: KeyframeAnimationOptions = { duration: 340, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'forwards' };
    setLanding({ after: messages.at(-1)?.id, landed: false });
    line
      .animate(
        [{ transform: `translate(${from.left - landX}px, ${from.top + (from.height - size.height) / 2 - landY}px)`, opacity: 0.6 }, { transform: 'none', opacity: 1 }],
        fly,
      )
      .finished.then(() => setLanding((l) => l && { ...l, landed: true }), () => {});

    // The avatar, from beside the guess box down to gutter size beside the
    // line, scaled from its corner so it lands exactly on the real one.
    const face = meRef.current?.querySelector<HTMLElement>('.avatar-wrap');
    if (!face) return;
    const start = face.getBoundingClientRect();
    const ghost = face.cloneNode(true) as HTMLElement;
    ghost.classList.add('gstage__flying-face');
    ghost.style.left = `${start.left}px`;
    ghost.style.top = `${start.top}px`;
    document.body.append(ghost);
    standIns.current.push(ghost);
    const endX = into.left + (gutter - SENDER_AVATAR_PX) / 2;
    const endY = landY + (size.height - SENDER_AVATAR_PX) / 2;
    ghost.animate(
      [{ transform: 'none' }, { transform: `translate(${endX - start.left}px, ${endY - start.top}px) scale(${SENDER_AVATAR_PX / start.width})` }],
      fly,
    );
  };
  const atBottom = useRef(true);

  // Scrolling back through the chat opens it: taller, and without the fade,
  // so older lines are readable. It stays open for as long as they read,
  // and folds once they scroll back down to the newest, or tap, type or send
  // to get on with guessing. Only their own scrolling opens it: the chat
  // following new messages doesn't.
  const [reading, setReading] = useState(false);
  // A light veil over the drawing while the chat is open, so the lines read
  // against it rather than the drawing. It goes as soon as a fold starts,
  // not once the fold is done.
  const [veiled, setVeiled] = useState(false);
  const touching = useRef(false);
  const byHand = useRef(false);
  const foldTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Folding changes the chat's height and where it's scrolled to at once,
  // which can't ease as it is. So the lines it's about to hide fade out
  // first, top to bottom, and it folds once they're gone. Lines that stay
  // in view stay put; folding from further back, where every line in view
  // gives way to the newest, all of them go, and the newest fade in.
  const foldingRows = useRef<HTMLElement[]>([]);
  /** Scrolled back while a fold was fading lines out: it's off, and they
   *  come back. */
  const callOffFold = () => {
    clearTimeout(foldTimer.current);
    for (const row of foldingRows.current) {
      row.style.transition = `opacity ${OPEN_IN_FAST_MS}ms ease`;
      row.style.opacity = '';
    }
    foldingRows.current = [];
  };
  const fold = () => {
    clearTimeout(foldTimer.current);
    setVeiled(false);
    const el = chatRef.current;
    if (!reading || !el) {
      atBottom.current = true;
      return;
    }
    const box = el.getBoundingClientRect();
    const keep = atBottom.current ? (cramped ? crampedHeight : gap + FADE_PX) : 0;
    const span = Math.max(1, box.height - keep);
    const fading: HTMLElement[] = [];
    for (const row of Array.from(el.children) as HTMLElement[]) {
      const r = row.getBoundingClientRect();
      if (r.bottom <= box.top || r.top >= box.bottom) continue;
      if (r.top >= box.bottom - keep - 1) continue;
      const far = Math.min(1, Math.max(0, (box.bottom - r.bottom - keep) / span));
      const ms = Math.round(FOLD_OUT_SLOW_MS - (FOLD_OUT_SLOW_MS - FOLD_OUT_FAST_MS) * far);
      row.style.transition = `opacity ${ms}ms ease`;
      row.style.opacity = '0';
      fading.push(row);
    }
    foldingRows.current = fading;
    foldTimer.current = setTimeout(
      () => {
        foldingRows.current = [];
        atBottom.current = true;
        setReading(false);
        // After the fold has rendered: whatever went out and still shows
        // comes back; the rest is out of view by now.
        requestAnimationFrame(() => {
          for (const row of fading) {
            row.style.transition = `opacity ${FOLD_IN_MS}ms ease`;
            row.style.opacity = '';
            row.addEventListener('transitionend', () => (row.style.transition = ''), { once: true });
          }
        });
      },
      fading.length ? FOLD_OUT_SLOW_MS : 0,
    );
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

  // Opening, the fold in reverse: the lines it brings into view fade in from
  // the guess box up. Before paint, so they never show at full strength
  // first. Lines a fold was still fading out come back the same way.
  useLayoutEffect(() => {
    const el = chatRef.current;
    if (!reading || !el) return;
    const box = el.getBoundingClientRect();
    const keep = cramped ? crampedHeight : gap + FADE_PX;
    const span = Math.max(1, box.height - keep);
    const rows: [HTMLElement, number][] = [];
    for (const row of Array.from(el.children) as HTMLElement[]) {
      const r = row.getBoundingClientRect();
      if (r.bottom <= box.top || r.top >= box.bottom) continue;
      if (r.top >= box.bottom - keep - 1 && row.style.opacity !== '0') continue;
      const far = Math.min(1, Math.max(0, (box.bottom - r.bottom - keep) / span));
      rows.push([row, Math.round(OPEN_IN_FAST_MS + (OPEN_IN_SLOW_MS - OPEN_IN_FAST_MS) * far)]);
      row.style.transition = 'none';
      row.style.opacity = '0';
    }
    let started = false;
    const frame = requestAnimationFrame(() => {
      started = true;
      for (const [row, ms] of rows) {
        row.style.transition = `opacity ${ms}ms ease`;
        row.style.opacity = '';
        row.addEventListener('transitionend', () => (row.style.transition = ''), { once: true });
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      if (started) return;
      for (const [row] of rows) {
        row.style.transition = '';
        row.style.opacity = '';
      }
    };
    // Only as it opens; the sizes are read as they are at that moment.
  }, [reading]);

  // The bottom of the screen is held by the keyboard, or by the sheet that
  // took its place at its height; for a moment during a swap, both.
  const dockHeight = Math.max(vv.keyboardInset, sheet || held ? dock : 0);
  const stageTop = vv.offsetTop;
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
    handBack();
    focusInput();
  }

  /** The sheet goes and its space stays held for the keys on their way, so
   *  the guess box waits where it is. Also from a tap on the guess box
   *  itself, which focuses it and so is already asking for the keys. */
  function handBack() {
    setSheet(null);
    setHeld(true);
    wanted.current = true;
    changedAt.current = performance.now();
  }

  const toggleSheet = (kind: Exclude<Sheet, null>) => (sheet === kind ? closeSheet() : openSheet(kind));

  if (!room) return null;
  const phase = room.phase;
  // With the keys or a sheet up, a few lines over the drawing; with neither,
  // as many as fit, solid down the gap and fading only once over the drawing.
  const cramped = dockHeight > 0;
  const gap = Math.max(0, stageHeight - headHeight - boardHeight - footHeight);
  const tapStage = () => {
    fold();
    if (sheet) closeSheet();
    else if (!keyboardIsUp()) focusInput();
  };

  return (
    <div className="gstage" style={{ top: stageTop, height: stageHeight }}>
      <StageHead headRef={headRef} />

      {/* A tap on the drawing asks for the keyboard, like tapping a text. */}
      <div ref={boardRef} className="gstage__board board__wrap" onClick={tapStage}>
        <CanvasBoard />
        <ReactButton />
        {phase === 'choosing' && <WordChoice />}
        {phase === 'turnEnd' && <TurnResult />}
        {phase === 'gameEnd' && <Podium />}
      </div>

      <div className={`gstage__veil ${veiled ? 'is-on' : ''}`} aria-hidden="true" />

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
          callOffFold();
          setReading(true);
          setVeiled(true);
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
        {messages.slice(-50).map((m, i, shown) =>
          m.kind === 'divider' ? (
            <div key={m.id} className="msg--divider" role="separator">
              <span>{m.text}</span>
            </div>
          ) : (
            <div
              key={m.id}
              className={`msg msg--${m.kind} ${
                landing && m.playerId === myId && i > shown.findIndex((x) => x.id === landing.after) ? 'is-landing' : ''
              }`}
            >
              <SenderAvatar playerId={m.playerId} />
              {m.kind === 'chat' && <strong className="msg__name">{m.name}</strong>}
              {m.kind === 'secret' && <strong className="msg__name">{m.name} (guessed)</strong>}
              <span className="msg__text">{m.text}</span>
            </div>
          ),
        )}
      </div>

      {/* Not a form: Chrome on Android puts its autofill bar (passwords,
          cards, addresses) over the keyboard for boxes in a form, whatever
          autocomplete says. Enter, the keyboard's Send, sends instead. */}
      <div className="gstage__form">
        {/* You, beside the guess box and in line with the senders in the
            chat's gutter: your profile and the room's controls. */}
        <MeButton btnRef={meRef} on={sheet === 'me'} onToggle={() => toggleSheet('me')} />
        <div className="chat__field">
          <GuessField
            inputRef={input}
            text={box.text}
            setText={box.setText}
            disabled={box.locked}
            placeholder={box.placeholder}
            onFocus={() => {
              fold();
              if (sheet) handBack();
            }}
            onEnter={() => {
              fold();
              flySent();
              box.send();
            }}
          />
          {box.showCount && (
            <span className={`chat__count ${box.matches ? 'is-match' : ''}`}>
              {box.typed}/{box.target}
            </span>
          )}
        </div>
        {/* Swaps the keyboard for the room sheet, and back. preventDefault on
            pointerdown keeps it from taking focus off the guess box. */}
        <button
          type="button"
          className={`gstage__roombtn ${sheet === 'players' ? 'is-on' : ''}`}
          aria-pressed={sheet === 'players'}
          aria-label="Players and scores"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => toggleSheet('players')}
        >
          <Users aria-hidden="true" />
          <span className="gstage__roomcount">{room.players.length}</span>
        </button>
      </div>
      </div>

      {sheet && (
        <div className={`gsheet ${sheet === 'me' ? 'gsheet--me' : ''}`} style={{ height: dock }}>
          {sheet === 'players' ? (
            <Scoreboard />
          ) : (
            <>
              <SheetMe />
              <RoomMenu standings={false} leaveTile />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Whether this browser takes contenteditable="plaintext-only" (Firefox only
 *  since 136); setting a value it doesn't know throws. */
const PLAINTEXT_ONLY = (() => {
  try {
    const probe = document.createElement('div');
    probe.contentEditable = 'plaintext-only';
    return probe.contentEditable === 'plaintext-only';
  } catch {
    return false;
  }
})();

function caretToEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/**
 * The guess box, as an editable div rather than an input. Chrome on Android
 * puts its autofill bar (passwords, cards, addresses) over the keyboard for
 * text inputs, form or no form and whatever autocomplete says, and sometimes
 * without telling the page, so it covered the tabs. It leaves editable divs
 * alone. What an input did by itself is done here: one line of plain text,
 * the length limit, the placeholder, and Enter (the keyboard's Send) sends.
 */
function GuessField({
  inputRef,
  text,
  setText,
  disabled,
  placeholder,
  onFocus,
  onEnter,
}: {
  inputRef: React.RefObject<HTMLDivElement>;
  text: string;
  setText: (t: string) => void;
  disabled: boolean;
  placeholder: string;
  onFocus: () => void;
  onEnter: () => void;
}) {
  // The box holds its own text; this brings it in step when the text changes
  // from outside, as when a send clears it. Typing already matches.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || el.textContent === text) return;
    el.textContent = text;
    if (document.activeElement === el) caretToEnd(el);
  }, [text, inputRef]);

  return (
    <div
      ref={inputRef}
      className="chat__input chat__input--editable"
      contentEditable={disabled ? false : PLAINTEXT_ONLY ? 'plaintext-only' : true}
      suppressContentEditableWarning
      role="textbox"
      aria-label="Your guess"
      aria-placeholder={placeholder}
      aria-disabled={disabled || undefined}
      data-placeholder={placeholder}
      data-empty={text === '' || undefined}
      enterKeyHint="send"
      inputMode="text"
      autoCorrect="off"
      spellCheck={false}
      onFocus={() => {
        // A focus() from code puts the caret at the start.
        const el = inputRef.current;
        if (el?.textContent) caretToEnd(el);
        onFocus();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        // Never a new line; mid-word, the keyboard finishes the word first.
        e.preventDefault();
        if (!e.nativeEvent.isComposing) onEnter();
      }}
      onPaste={(e) => {
        // Plain text only, on one line, wherever it was copied from.
        e.preventDefault();
        const pasted = e.clipboardData.getData('text/plain').replace(/\s+/g, ' ');
        document.execCommand('insertText', false, pasted);
      }}
      onInput={(e) => {
        const el = e.currentTarget;
        let t = (el.textContent ?? '').replace(/\n/g, ' ');
        if (t.length > MAX_CHAT_LEN) t = t.slice(0, MAX_CHAT_LEN);
        if (t !== el.textContent) {
          el.textContent = t;
          caretToEnd(el);
        }
        setText(t);
      }}
    />
  );
}


/**
 * Thumbs up or down, as one button in the drawing's top corner: faint until
 * it's wanted, then the two thumbs with their counts. Shows your vote once
 * you've given one. Taps on it stay off the drawing, which would raise the
 * keyboard.
 */
function ReactButton() {
  const r = useReaction();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(box, open, close);
  if (!r || r.isDrawer) return null;
  const { mine, likes, dislikes, vote } = r;

  return (
    <div
      ref={box}
      className={`gstage__react ${open ? 'is-open' : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      {open &&
        (['like', 'dislike'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={`gstage__reactopt ${mine === v ? 'is-on' : ''}`}
            aria-pressed={mine === v}
            aria-label={v === 'like' ? 'Like' : 'Dislike'}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              vote(v);
              close();
            }}
          >
            <span aria-hidden="true">{v === 'like' ? '👍' : '👎'}</span>
            <b>{v === 'like' ? likes : dislikes}</b>
          </button>
        ))}
      <button
        type="button"
        className="gstage__reactbtn"
        aria-expanded={open}
        aria-label={mine ? `You ${mine === 'like' ? 'liked' : 'disliked'} this drawing` : 'React to the drawing'}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => setOpen(!open)}
      >
        {mine ? <span aria-hidden="true">{mine === 'like' ? '👍' : '👎'}</span> : <SmilePlus aria-hidden="true" />}
      </button>
    </div>
  );
}


/** How long sent stand-ins wait, landed, for the real line from the server. */
const LANDING_WAIT_MS = 1500;
