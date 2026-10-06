import { FightView } from './renderer.js';

let view: FightView | null = null;

/** One view per tab, like the drawing engine: socket bindings feed it whether
 *  or not the stage happens to be mounted. */
export function getFightView(): FightView {
  if (!view) view = new FightView();
  return view;
}

/** Drops the view, so the next game of this kind starts from nothing. */
export function disposeFightView(): void {
  view?.detach();
  view = null;
}
