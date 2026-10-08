import type { Vote } from '@pic-game/shared';
import posthog, { isPostHogEnabled } from '../lib/posthog.js';
import { getSocket } from '../net/socket.js';
import { selectSkribbl, useGame } from '../store/game.js';

/**
 * Where the drawing's thumbs stand: whether there's a drawing to react to,
 * your vote, the tally, and voting (the same vote again takes it back).
 * Null when there's nothing to react to.
 */
export function useReaction() {
  const room = useGame(selectSkribbl);
  const me = useGame((s) => s.me);
  const turn = room?.turn;
  if (!room || !turn || !me || (room.phase !== 'drawing' && room.phase !== 'turnEnd')) return null;

  const isDrawer = turn.drawerId === me;
  const mine: Vote | null = turn.likes.includes(me) ? 'like' : turn.dislikes.includes(me) ? 'dislike' : null;
  const vote = (v: Vote) => {
    const reaction = mine === v ? null : v;
    getSocket().emit('draw:react', { vote: reaction });
    if (isPostHogEnabled) posthog.capture('drawing_reaction_set', { reaction: reaction ?? 'cleared' });
  };
  return { isDrawer, mine, likes: turn.likes.length, dislikes: turn.dislikes.length, vote };
}

/**
 * Thumbs up or down on the drawing in front of everyone, while it is drawn
 * and while the word is shown after. The drawer sees the tally but cannot
 * vote on their own picture.
 */
export function Reactions() {
  const r = useReaction();
  if (!r) return null;
  const { isDrawer, mine, vote } = r;

  return (
    <div className="reactions" title={isDrawer ? 'What everyone thinks of your drawing' : 'Like this drawing?'}>
      {(['like', 'dislike'] as const).map((v) => (
        <button
          key={v}
          type="button"
          className={`reactions__btn reactions__btn--${v} ${mine === v ? 'is-on' : ''}`}
          disabled={isDrawer}
          aria-pressed={mine === v}
          aria-label={v === 'like' ? 'Like' : 'Dislike'}
          onClick={() => vote(v)}
        >
          <span aria-hidden="true">{v === 'like' ? '👍' : '👎'}</span>
          <b>{v === 'like' ? r.likes : r.dislikes}</b>
        </button>
      ))}
    </div>
  );
}
