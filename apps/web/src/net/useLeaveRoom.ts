import { useNavigate } from '@tanstack/react-router';
import posthog, { isPostHogEnabled } from '../lib/posthog.js';
import { useGame } from '../store/game.js';
import { clearSeat, getSocket } from './socket.js';

/** Gives up the seat and goes home. One action wherever the button is, so
 *  the room screen and the header menu leave the same way. */
export function useLeaveRoom(): () => void {
  const navigate = useNavigate();
  return () => {
    getSocket().emit('room:leave');
    if (isPostHogEnabled) posthog.capture('room_left');
    clearSeat();
    useGame.getState().reset();
    void navigate({ to: '/' });
  };
}
