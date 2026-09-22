import { create } from 'zustand';
import { BRUSH_SIZES, PALETTE, type PenTool } from '@pic-game/shared';

interface ToolStore {
  tool: PenTool | 'fill';
  color: string;
  size: number;
  setTool: (t: PenTool | 'fill') => void;
  setColor: (c: string) => void;
  setSize: (s: number) => void;
}

export const useTools = create<ToolStore>((set) => ({
  tool: 'pen',
  color: PALETTE[0],
  size: BRUSH_SIZES[1],
  setTool: (tool) => set({ tool }),
  // Picking a colour implies you want to draw with it, not keep erasing.
  setColor: (color) => set((s) => ({ color, tool: s.tool === 'eraser' ? 'pen' : s.tool })),
  setSize: (size) => set({ size }),
}));
