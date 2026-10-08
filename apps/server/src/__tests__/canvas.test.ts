import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHOOSE_SECONDS, type CanvasOp } from '@pic-game/shared';
import { GAME_COUNTDOWN_MS } from '../config.js';
import { RoomManager } from '../core/RoomManager.js';
import type { SkribblRoom } from '../games/skribbl/SkribblRoom.js';
import { fakeIO } from './fakeIO.js';

const av = { color: 0, face: 0 };

/** A Draw & Guess turn under way, and who's drawing it. Uses fake timers. */
function drawing() {
  vi.useFakeTimers();
  const { io, sent } = fakeIO();
  const room = new RoomManager(io).create('skribbl') as SkribblRoom;
  const seats = Array.from({ length: 3 }, (_, i) => room.addPlayer(`P${i}`, av, `sock${i}`));
  room.startGame(seats[0]!.id);
  vi.advanceTimersByTime(GAME_COUNTDOWN_MS);
  vi.advanceTimersByTime(CHOOSE_SECONDS * 1000 + 50); // the drawer runs out of time and gets a word
  const secret = sent.find((m) => m.event === 'word:secret');
  const drawer = seats.find((p) => p.socketId === secret?.to)!;
  const guesser = seats.find((p) => p.id !== drawer.id)!;
  return { room, sent, drawer: drawer.id, guesser: guesser.id };
}

const stroke = (room: SkribblRoom, by: string, id: string) => {
  room.strokeStart(by, { id, tool: 'pen', color: '#000000', size: 10, pts: [1, 2] });
  room.strokeEnd(by, id);
};
const ids = (room: SkribblRoom) => room.ops.map((o: CanvasOp) => o.id);

afterEach(() => {
  vi.useRealTimers();
});

describe('undo and redo', () => {
  it('puts back what undo took, latest first', () => {
    const { room, drawer } = drawing();
    stroke(room, drawer, 'a');
    stroke(room, drawer, 'b');
    room.undo(drawer);
    room.undo(drawer);
    expect(ids(room)).toEqual([]);
    room.redo(drawer);
    expect(ids(room)).toEqual(['a']);
    room.redo(drawer);
    expect(ids(room)).toEqual(['a', 'b']);
    room.redo(drawer);
    expect(ids(room)).toEqual(['a', 'b']);
  });

  it('tells everyone the redone history', () => {
    const { room, sent, drawer } = drawing();
    stroke(room, drawer, 'a');
    room.undo(drawer);
    sent.length = 0;
    room.redo(drawer);
    const told = sent.find((m) => m.event === 'canvas:undone');
    expect((told?.args[0] as { ops: CanvasOp[] }).ops.map((o) => o.id)).toEqual(['a']);
  });

  it('has nothing to redo once something new is drawn, filled or cleared', () => {
    const { room, drawer } = drawing();
    stroke(room, drawer, 'a');
    room.undo(drawer);
    stroke(room, drawer, 'b');
    room.redo(drawer);
    expect(ids(room)).toEqual(['b']);

    room.undo(drawer);
    room.fill(drawer, 5, 5, '#ff0000');
    room.redo(drawer);
    expect(room.ops).toHaveLength(1);

    stroke(room, drawer, 'c');
    room.undo(drawer);
    room.clearCanvas(drawer);
    room.redo(drawer);
    expect(ids(room)).toEqual([]);
  });

  it('is the drawer’s alone', () => {
    const { room, drawer, guesser } = drawing();
    stroke(room, drawer, 'a');
    room.undo(drawer);
    room.redo(guesser);
    expect(ids(room)).toEqual([]);
  });
});

describe('stroke colours', () => {
  it('takes any #rrggbb colour, and draws anything else in black', async () => {
    const { cleanColor } = await import('../socket/index.js');
    expect(cleanColor('#ef4444')).toBe('#ef4444');
    expect(cleanColor('#A1B2C3')).toBe('#a1b2c3');
    for (const bad of ['red', '#fff', '#12345g', 'url(x)', '#1234567', 42, null]) {
      expect(cleanColor(bad)).toBe('#000000');
    }
  });
});

describe('snapping a stroke to a shape', () => {
  it('swaps the drawer’s stroke for the shape and tells everyone else', () => {
    const { room, sent, drawer } = drawing();
    stroke(room, drawer, 'a');
    sent.length = 0;
    room.replaceStroke(drawer, 'a', [10, 20, 30, 40]);
    const op = room.ops.find((o: CanvasOp) => o.id === 'a');
    expect(op?.kind === 'stroke' && op.pts).toEqual([10, 20, 30, 40]);
    const told = sent.find((m) => m.event === 'draw:replace');
    expect(told?.args[0]).toEqual({ id: 'a', pts: [10, 20, 30, 40] });
  });

  it('is the drawer’s alone, and only for a stroke', () => {
    const { room, drawer, guesser } = drawing();
    stroke(room, drawer, 'a');
    room.fill(drawer, 5, 5, '#ff0000');
    const fillId = room.ops[1]!.id;
    room.replaceStroke(guesser, 'a', [1, 1, 2, 2]);
    room.replaceStroke(drawer, fillId, [1, 1, 2, 2]);
    room.replaceStroke(drawer, 'missing', [1, 1, 2, 2]);
    const op = room.ops[0]!;
    expect(op.kind === 'stroke' && op.pts).toEqual([1, 2]);
    expect(room.ops[1]!.kind).toBe('fill');
  });

  it('takes the stroke back to as drawn and on, when drawing carries on', () => {
    const { room, sent, drawer } = drawing();
    room.strokeStart(drawer, { id: 'a', tool: 'pen', color: '#000000', size: 10, pts: [1, 2] });
    room.strokeAppend(drawer, 'a', [3, 4, 5, 6]);
    room.replaceStroke(drawer, 'a', [10, 20, 30, 40]); // snapped
    room.replaceStroke(drawer, 'a', [1, 2, 3, 4, 5, 6]); // drawn on: back as drawn
    room.strokeAppend(drawer, 'a', [7, 8]);
    room.strokeEnd(drawer, 'a');
    const op = room.ops[0]!;
    expect(op.kind === 'stroke' && op.pts).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sent.filter((m) => m.event === 'draw:replace')).toHaveLength(2);
  });

  it('undo takes the snapped shape, as any stroke', () => {
    const { room, drawer } = drawing();
    stroke(room, drawer, 'a');
    room.replaceStroke(drawer, 'a', [10, 20, 30, 40]);
    room.undo(drawer);
    expect(ids(room)).toEqual([]);
    room.redo(drawer);
    const op = room.ops[0]!;
    expect(op.kind === 'stroke' && op.pts).toEqual([10, 20, 30, 40]);
  });
});

describe('undoing a clear', () => {
  it('brings back what the clear set aside, and redo clears it again', () => {
    const { room, drawer } = drawing();
    stroke(room, drawer, 'a');
    stroke(room, drawer, 'b');
    room.clearCanvas(drawer);
    expect(ids(room)).toEqual([]);
    room.undo(drawer);
    expect(ids(room)).toEqual(['a', 'b']);
    room.redo(drawer);
    expect(ids(room)).toEqual([]);
  });

  it('steps back in order: what came after the clear first, then the clear', () => {
    const { room, drawer } = drawing();
    stroke(room, drawer, 'a');
    room.clearCanvas(drawer);
    stroke(room, drawer, 'b');
    room.undo(drawer);
    expect(ids(room)).toEqual([]);
    room.undo(drawer);
    expect(ids(room)).toEqual(['a']);
    room.undo(drawer);
    expect(ids(room)).toEqual([]);
    // And forward again: a, the clear, then b.
    room.redo(drawer);
    expect(ids(room)).toEqual(['a']);
    room.redo(drawer);
    expect(ids(room)).toEqual([]);
    room.redo(drawer);
    expect(ids(room)).toEqual(['b']);
  });

  it('undoes clears one at a time, latest first', () => {
    const { room, drawer } = drawing();
    stroke(room, drawer, 'a');
    room.clearCanvas(drawer);
    stroke(room, drawer, 'b');
    room.clearCanvas(drawer);
    room.undo(drawer);
    expect(ids(room)).toEqual(['b']);
    room.undo(drawer);
    expect(ids(room)).toEqual([]);
    room.undo(drawer);
    expect(ids(room)).toEqual(['a']);
  });

  it('tells everyone the brought-back drawing', () => {
    const { room, sent, drawer } = drawing();
    stroke(room, drawer, 'a');
    room.clearCanvas(drawer);
    sent.length = 0;
    room.undo(drawer);
    const told = sent.find((m) => m.event === 'canvas:undone');
    expect((told?.args[0] as { ops: CanvasOp[] }).ops.map((o) => o.id)).toEqual(['a']);
  });
});
