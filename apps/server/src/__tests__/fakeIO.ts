import type { IO } from '../core/BaseRoom.js';

export interface Sent {
  to: string;
  event: string;
  args: unknown[];
}

/** Just enough of a socket.io server for a room to talk to: everything it
 *  sends is kept in `sent` to be looked at. */
export function fakeIO(): { io: IO; sent: Sent[] } {
  const sent: Sent[] = [];
  const target = (to: string) => {
    const emit = (event: string, ...args: unknown[]) => {
      sent.push({ to, event, args });
      return true;
    };
    // except() narrows who hears it; here everything is kept regardless.
    const self: { emit: typeof emit; volatile: { emit: typeof emit }; except: () => typeof self } = {
      emit,
      volatile: { emit },
      except: () => self,
    };
    return self;
  };
  return { io: { to: target } as unknown as IO, sent };
}
