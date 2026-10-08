import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { GAME_LABELS } from '@pic-game/shared';
import { ChevronDown, DoorOpen, Pause, Play, RotateCcw } from 'lucide-react';
import posthog, { isPostHogEnabled } from '../lib/posthog.js';
import { useDismiss } from '../lib/useDismiss.js';
import { getSocket } from '../net/socket.js';
import { useLeaveRoom } from '../net/useLeaveRoom.js';
import { selectIsHost, useGame } from '../store/game.js';
import { Avatar } from './Avatar.js';
import { KickButton } from './KickButton.js';
import { GAME_ICONS } from './gameIcons.js';

type Confirm = 'restart' | 'toLobby';

/**
 * Everything about the room rather than the game, from the header over every
 * screen: which game is on, who is here and how many each has won tonight,
 * and for the host, pausing, restarting or going back to the lobby. Picking
 * another game happens on the lobby's settings card. It wears the game's colour.
 */
export function RoomPanel() {
  const room = useGame((s) => s.room);
  const me = useGame((s) => s.me);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(box, open, close);

  if (!room || !me) return null;
  const { icon: Icon, color } = GAME_ICONS[room.kind];
  const name = GAME_LABELS[room.kind].name;

  return (
    <div className="room" ref={box} style={{ '--game': color } as CSSProperties}>
      <button
        type="button"
        className="room__chip"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${name}: room menu`}
        onClick={() => setOpen(!open)}
      >
        <span className="room__chiptile" aria-hidden="true">
          <Icon />
        </span>
        <span className="room__chipname">{name}</span>
        <ChevronDown className="room__caret" aria-hidden="true" />
      </button>

      {open && (
        <>
          <div className="room__scrim" onClick={close} aria-hidden="true" />
          <div className="room__panel" role="dialog" aria-label="Room">
            <RoomMenu onDone={close} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * What the room menu holds: the host's controls, tonight's standings, who is
 * hosting, and leaving. In the header's popover, and in the room sheet on the
 * phone's guessing stage, which lists the players itself and so can leave the
 * standings out.
 */
export function RoomMenu({ onDone, standings = true }: { onDone?: () => void; standings?: boolean }) {
  const room = useGame((s) => s.room);
  const me = useGame((s) => s.me);
  const isHost = useGame(selectIsHost);
  const leave = useLeaveRoom();
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  if (!room || !me) return null;
  const { players, hostId, meta } = room;
  const { can, paused, wins, played, games } = meta;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'The host';
  const playing = meta.stage === 'playing';
  // The lobby lists everyone already, so here it's only the standings: who
  // has played tonight, and how it went. Mid-game, when the screen is the
  // game, it's everyone.
  const inLobby = meta.stage === 'lobby';

  // Most wins first, then the same wins from fewer games; otherwise the
  // order people arrived in.
  const ranked = [...players]
    .sort((a, b) => (wins[b.id] ?? 0) - (wins[a.id] ?? 0) || (played[a.id] ?? 0) - (played[b.id] ?? 0))
    .filter((p) => !inLobby || (played[p.id] ?? 0) > 0);

  const send = (event: 'room:pause' | 'room:resume' | 'game:restart' | 'game:toLobby') => {
    getSocket().emit(event);
    if (isPostHogEnabled) posthog.capture('room_control_used', { control: event });
    setConfirm(null);
    onDone?.();
  };
  // Throwing away a game in progress takes a second tap.
  const ask = (what: Confirm) => {
    if (playing) setConfirm(what);
    else send(what === 'restart' ? 'game:restart' : 'game:toLobby');
  };

  return (
    <>
      {isHost && (can.pause || paused || can.restart || can.toLobby) && (
        confirm ? (
          <div className="room__confirm">
            <p>
              {confirm === 'restart' ? 'Start this game over?' : 'Go back to the lobby?'} The game in
              progress ends and nobody gets the win.
            </p>
            <div className="room__confirmrow">
              <button
                type="button"
                className="btn btn--primary room__go"
                onClick={() => send(confirm === 'restart' ? 'game:restart' : 'game:toLobby')}
              >
                {confirm === 'restart' ? 'Start over' : 'Back to the lobby'}
              </button>
              <button type="button" className="btn" onClick={() => setConfirm(null)}>
                Keep playing
              </button>
            </div>
          </div>
        ) : (
          <div className="room__controls">
            {/* A countdown runs out by itself; there's nothing to pause or resume. */}
            {meta.countdown ? null : paused ? (
              <button type="button" className="room__ctl is-on" onClick={() => send('room:resume')}>
                <Play aria-hidden="true" />
                Resume
              </button>
            ) : (
              can.pause && (
                <button type="button" className="room__ctl" onClick={() => send('room:pause')}>
                  <Pause aria-hidden="true" />
                  Pause
                </button>
              )
            )}
            {can.restart && (
              <button type="button" className="room__ctl" onClick={() => ask('restart')}>
                <RotateCcw aria-hidden="true" />
                {playing ? 'Restart' : 'Play again'}
              </button>
            )}
            {can.toLobby && (
              <button type="button" className="room__ctl" onClick={() => ask('toLobby')}>
                <DoorOpen aria-hidden="true" />
                Lobby
              </button>
            )}
          </div>
        )
      )}

      {standings && ranked.length > 0 && (
        <section className="room__section" aria-labelledby="room-tonight">
          <h2 id="room-tonight" className="room__h">
            Tonight
            <span className="room__hnote">
              {games > 0 ? `${games} ${games === 1 ? 'game' : 'games'} played` : 'No games finished yet'}
            </span>
          </h2>
          <ol className="room__people">
            {ranked.map((p) => {
              const n = wins[p.id] ?? 0;
              // Out of the games they were here for: some arrive late.
              const of = played[p.id] ?? 0;
              return (
                <li key={p.id} className={p.connected ? '' : 'is-away'}>
                  <Avatar data={p.avatar} size={28} host={p.id === hostId} />
                  <span className="room__name">
                    {p.name}
                    {p.id === me && <em> (you)</em>}
                    {!p.connected && <span className="room__away">away</span>}
                  </span>
                  {of > 0 && <span className="room__wins">{n} of {of} won</span>}
                  {isHost &&
                    (p.id !== hostId ? (
                      <KickButton playerId={p.id} name={p.name} />
                    ) : (
                      // Holds the button's place, so the host's count lines up.
                      <span className="kick is-spacer" aria-hidden="true">×</span>
                    ))}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {!isHost && (
        <p className="room__note">{nameOf(hostId)} is hosting, and picks what everyone plays next.</p>
      )}

      <button type="button" className="room__leave" onClick={leave}>
        Leave room
      </button>
    </>
  );
}
