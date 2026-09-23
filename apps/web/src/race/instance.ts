import { RaceView } from './view.js';

let view: RaceView | null = null;

/** One per tab, fed by the socket bindings whether or not the stage is up. */
export function getRaceView(): RaceView {
  if (!view) view = new RaceView();
  return view;
}
