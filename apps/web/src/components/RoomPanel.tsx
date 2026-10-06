import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { CATEGORY_LABELS, GAME_CAPACITY, GAME_CATEGORY, GAME_LABELS, PLAYABLE_KINDS, type GameKind } from '@pic-game/shared';
import { ChevronDown, DoorOpen, Pause, Play, RotateCcw } from 'lucide-react';
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
 * and for the host, pausing, restarting, going back to the lobby or picking
 * another game. It wears the current game's colour.
 */
export function RoomPanel() {
  const room = useGame((s) => s.room);
  const me = useGame((s) => s.me);
  const isHost = useGame(selectIsHost);
  const leave = useLeaveRoom();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setPicking(false);
    setConfirm(null);
  }, []);
  useDismiss(box, open, close);

  if (!room || !me) return null;
  const { kind, players, hostId, meta } = room;
  const { can, paused, wins, games } = meta;
  const { icon: Icon, color } = GAME_ICONS[kind];
  const name = GAME_LABELS[kind].name;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'The host';
  const playing = !can.switch;
  const status = paused
    ? `Paused by ${paused.by === me ? 'you' : nameOf(paused.by)}`
    : playing
      ? 'Playing now'
      : can.restart
        ? 'Game over'
        : 'In the lobby';

  // Most wins first; otherwise the order people arrived in.
  const ranked = [...players].sort((a, b) => (wins[b.id] ?? 0) - (wins[a.id] ?? 0));

  const send = (event: 'room:pause' | 'room:resume' | 'game:restart' | 'game:toLobby') => {
    getSocket().emit(event);
    close();
  };
  // Throwing away a game in progress takes a second tap.
  const ask = (what: Confirm) => {
    if (playing) setConfirm(what);
    else send(what === 'restart' ? 'game:restart' : 'game:toLobby');
  };
  const switchTo = (next: GameKind) => {
    setBusy(true);
    getSocket().emit('room:switch', { kind: next }, (r) => {
      setBusy(false);
      if (r.ok) close();
      else useGame.getState().setNotice(r.message ?? 'Could not switch games.');
    });
  };

  return (
    <div className="room" ref={box} style={{ '--game': color } as CSSProperties}>
      <button
        type="button"
        className="room__chip"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${name}, ${players.length} in the room`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon className="room__chipicon" aria-hidden="true" />
        <span className="room__chipname">{name}</span>
        <span className="room__count" aria-hidden="true">{players.length}</span>
        <ChevronDown className="room__caret" aria-hidden="true" />
      </button>

      {open && (
        <>
          <div className="room__scrim" onClick={close} aria-hidden="true" />
          <div className="room__panel" role="dialog" aria-label="Room">
            <header className="room__head">
              <span className="room__tile" aria-hidden="true">
                <Icon />
              </span>
              <div className="room__titles">
                <p className="room__game">{name}</p>
                <p className={`room__status ${paused ? 'is-paused' : ''}`}>{status}</p>
              </div>
            </header>

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
                  {paused ? (
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
                  return (
                    <li key={p.id} className={p.connected ? '' : 'is-away'}>
                      <Avatar data={p.avatar} size={28} host={p.id === hostId} />
                      <span className="room__name">
                        {p.name}
                        {p.id === me && <em> (you)</em>}
                        {!p.connected && <span className="room__away">away</span>}
                      </span>
                      {n > 0 && <span className="room__wins">{n} {n === 1 ? 'win' : 'wins'}</span>}
                      {isHost && p.id !== hostId && <KickButton playerId={p.id} name={p.name} />}
                    </li>
                  );
                })}
              </ol>
            </section>

            {isHost ? (
              <section className="room__section">
                <button
                  type="button"
                  className="room__toggle"
                  aria-expanded={picking}
                  onClick={() => setPicking((v) => !v)}
                >
                  Play something else
                  <ChevronDown className="room__togglecaret" aria-hidden="true" />
                </button>
                {picking &&
                  (playing ? (
                    <p className="room__note">Finish this game, or go back to the lobby, to pick another.</p>
                  ) : (
                    <ul className="room__games">
                      {PLAYABLE_KINDS.filter((k) => k !== kind).map((k) => {
                        const { icon: GameIcon, color: c } = GAME_ICONS[k];
                        const tooBig = players.length > GAME_CAPACITY[k];
                        return (
                          <li key={k}>
                            <button
                              type="button"
                              className="room__pick"
                              style={{ '--game': c } as CSSProperties}
                              disabled={tooBig || busy}
                              onClick={() => switchTo(k)}
                            >
                              <GameIcon className="room__pickicon" aria-hidden="true" />
                              <span className="room__pickname">{GAME_LABELS[k].name}</span>
                              <span className="room__pickmeta">
                                {tooBig ? `Seats ${GAME_CAPACITY[k]}` : CATEGORY_LABELS[GAME_CATEGORY[k]]}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ))}
              </section>
            ) : (
              <p className="room__note">{nameOf(hostId)} is hosting, and picks what everyone plays next.</p>
            )}

            <button type="button" className="room__leave" onClick={leave}>
              Leave room
            </button>
          </div>
        </>
      )}
    </div>
  );
}
