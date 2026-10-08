import { useEffect, useState } from 'react';
import { Bug, Eye, EyeOff, Pencil } from 'lucide-react';
import { maskOf } from '@pic-game/shared';
import { ACHIEVEMENTS, totalPlayed, totalWon, useStats } from '../../lib/achievements.js';
import { isPostHogEnabled } from '../../lib/posthog.js';
import { selectIsDrawer, selectSkribbl, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { ProfileBadges, ProfileEditor } from '../ProfileChip.js';
import { Timer } from '../Timer.js';
import { Slots } from '../WordMask.js';

/**
 * What the phone's guessing and drawing stages share: taking over the
 * screen, the header, you and your sheet, and senders' avatars in the chat.
 */

/**
 * While a stage is up it is the screen. The app's header steps aside: hidden
 * rather than removed, since its bug button is still what the bug-report
 * survey listens to, and the you sheet clicks it. And nothing under the stage
 * may scroll: with the keyboard open the visible window is smaller than the
 * page, and a drag that pans it makes Chrome's address bar collapse and
 * expand, which moves everything; a drawing stroke would scroll the page.
 * overscroll-behavior also keeps pull-to-refresh and the rubber band out of
 * a game in progress. All put back as it was when the stage goes.
 */
export function useStageChrome() {
  useEffect(() => {
    document.documentElement.classList.add('has-gstage');
    const els = [document.documentElement, document.body];
    const before = els.map((el) => [el.style.overflow, el.style.overscrollBehavior] as const);
    for (const el of els) {
      el.style.overflow = 'hidden';
      el.style.overscrollBehavior = 'none';
    }
    return () => {
      document.documentElement.classList.remove('has-gstage');
      els.forEach((el, i) => {
        el.style.overflow = before[i]![0];
        el.style.overscrollBehavior = before[i]![1];
      });
    };
  }, []);
}

/**
 * The stage's header, in place of the app's: the round, the blanks with any
 * hint letters, and the timer, all in sight while the
 * keyboard is up. Between turns it says what's happening instead.
 */
export function StageHead({ headRef }: { headRef: React.RefObject<HTMLElement> }) {
  const room = useGame(selectSkribbl);
  const isDrawer = useGame(selectIsDrawer);
  const secret = useGame((s) => s.secret);
  if (!room) return <header ref={headRef} className="gstage__head" />;
  const { phase, turn } = room;
  const drawer = room.players.find((p) => p.id === turn?.drawerId)?.name ?? 'The drawer';
  const status =
    phase === 'choosing' ? `${drawer} is choosing a word` : phase === 'gameEnd' ? 'Game over' : phase === 'turnEnd' ? 'Turn over' : '';

  return (
    <header ref={headRef} className="gstage__head">
      <span className="gstage__round" aria-label={`Round ${room.round} of ${room.settings.rounds}`}>
        {room.round}
        <small>/{room.settings.rounds}</small>
      </span>
      <div className="gstage__word">
        {phase === 'drawing' && isDrawer && secret ? (
          <DrawerWord word={secret} />
        ) : phase === 'drawing' && turn?.mask ? (
          <Slots mask={turn.mask} revealed={turn.revealed} />
        ) : (
          <span className="gstage__status">{status}</span>
        )}
      </div>
      <div className="gstage__clock">
        {phase === 'drawing' && turn && <Timer endsAt={turn.endsAt} total={room.settings.drawTime} />}
      </div>
    </header>
  );
}

/**
 * The word you're drawing, in the header, and an eye to hide it behind its
 * blanks from anyone looking over your shoulder. Every new word starts shown:
 * you can't draw what you can't read.
 */
function DrawerWord({ word }: { word: string }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => setHidden(false), [word]);
  return (
    <span className="gstage__drawword">
      {hidden ? <Slots mask={maskOf(word)} revealed={{}} /> : <span className="gstage__secret">{word}</span>}
      <button
        type="button"
        className="gstage__eye"
        aria-pressed={hidden}
        aria-label={hidden ? 'Show the word' : 'Hide the word'}
        onClick={() => setHidden((h) => !h)}
      >
        {hidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </button>
    </span>
  );
}

/** Your avatar beside the guess box. */
export const ME_AVATAR_PX = 34;

/** How big a sender's avatar is in the chat's gutter. */
export const SENDER_AVATAR_PX = 18;

/** You, as the room has you: your name and look as everyone sees them. */
export function useMe() {
  return useGame((s) => s.room?.players.find((p) => p.id === s.me));
}

/** Your avatar before the guess box, with your place in the game on it as
 *  a badge: opens the "you" sheet.
 *  preventDefault on pointerdown keeps it from taking focus off the box. */
export function MeButton({
  btnRef,
  on,
  onToggle,
}: {
  btnRef: React.RefObject<HTMLButtonElement>;
  on: boolean;
  onToggle: () => void;
}) {
  const me = useMe();
  // Where you stand, ranked as the players list ranks: by score.
  const rank = useGame((s) => {
    const ranked = [...(s.room?.players ?? [])].sort((a, b) => b.score - a.score);
    return ranked.findIndex((p) => p.id === s.me) + 1;
  });
  if (!me) return null;
  return (
    <button
      ref={btnRef}
      type="button"
      className={`gstage__mebtn ${on ? 'is-on' : ''}`}
      aria-pressed={on}
      aria-label={rank ? `You, in place ${rank}, and the room` : 'You and the room'}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onToggle}
    >
      <Avatar data={me.avatar} size={ME_AVATAR_PX} />
      {rank > 0 && (
        <span className="gstage__merank" aria-hidden="true">
          {rank}
        </span>
      )}
    </button>
  );
}

/** You, at the top of the "you" sheet: your record, a way to change your
 *  name and look (editing takes their place) and to report a bug, then your
 *  achievements with the three most relevant, as the header menu has them,
 *  so the sheet fits the keyboard's height without scrolling. */
export function SheetMe() {
  const me = useMe();
  const [editing, setEditing] = useState(false);
  const stats = useStats();
  if (!me) return null;
  if (editing) return <ProfileEditor className="gsheet__edit" onDone={() => setEditing(false)} />;
  const played = totalPlayed(stats);
  return (
    <div className="gsheet__card">
      {/* No avatar here: yours is on the button just above, ringed while
          this sheet is open. */}
      <section className="gsheet__me">
        <span className="gsheet__mename">
          <span className="gsheet__nameline">
            <span className="gsheet__name">{me.name}</span>
            <button
              type="button"
              className="gsheet__icon-btn"
              aria-label="Edit name and look"
              title="Edit name and look"
              onClick={() => setEditing(true)}
            >
              <Pencil aria-hidden="true" />
            </button>
            {isPostHogEnabled && (
              <button
                type="button"
                className="gsheet__icon-btn"
                aria-label="Report a bug"
                title="Report a bug"
                onClick={() => document.getElementById('report-bug')?.click()}
              >
                <Bug aria-hidden="true" />
              </button>
            )}
          </span>
          <small>{played ? `${played} played, ${totalWon(stats)} won` : 'No games finished yet'}</small>
        </span>
        <span className="gsheet__count">
          <b>
            {ACHIEVEMENTS.filter((a) => stats.unlocked[a.id]).length} of {ACHIEVEMENTS.length}
          </b>
          <small>achievements</small>
        </span>
      </section>
      <ProfileBadges peek={3} shelf={false} count={false} />
    </div>
  );
}

/** A message's sender, small, in the chat's left gutter. */
export function SenderAvatar({ playerId }: { playerId?: string }) {
  const avatar = useGame((s) => s.room?.players.find((p) => p.id === playerId)?.avatar);
  if (!playerId || !avatar) return null;
  return (
    <span className="msg__avatar" aria-hidden="true">
      <Avatar data={avatar} size={SENDER_AVATAR_PX} />
    </span>
  );
}
