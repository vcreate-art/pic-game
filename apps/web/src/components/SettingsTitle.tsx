import type { ReactNode } from 'react';
import { SwitchGame } from './SwitchGame.js';

/** A lobby's settings card heading, with the host's way to change game in
 *  its corner: the settings are for this game, and that's where you'd look
 *  for another. */
export function SettingsTitle({ children }: { children: ReactNode }) {
  return (
    <div className="card__head">
      <h2 className="card__title">{children}</h2>
      <SwitchGame />
    </div>
  );
}
