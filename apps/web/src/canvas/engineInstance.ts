import { CanvasEngine } from './engine.js';

let engine: CanvasEngine | null = null;

/** One engine per tab. Created lazily so it never runs during SSR or module load. */
export function getEngine(): CanvasEngine {
  if (!engine) engine = new CanvasEngine();
  return engine;
}
