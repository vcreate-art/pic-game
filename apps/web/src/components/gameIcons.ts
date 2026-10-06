import type { GameKind } from '@pic-game/shared';
import {
  ChessKnight, Crosshair, Footprints, Grid3x3, PawPrint, Pencil, Rocket, Spade, Swords, Trophy, VenetianMask,
  type LucideIcon,
} from 'lucide-react';

/** A Record rather than a lookup chain, so a new GameKind fails to compile
 *  until it has an icon and a color. Colors are spread around the wheel so
 *  neighbours in the grid don't blur together, and each one is dark enough
 *  to carry white text (4.5:1 or better). */
export const GAME_ICONS: Record<GameKind, { icon: LucideIcon; color: string }> = {
  skribbl: { icon: Pencil, color: '#b3245f' },
  kungfu: { icon: ChessKnight, color: '#0f6e66' },
  realms: { icon: Rocket, color: '#4b2fa8' },
  fight: { icon: Swords, color: '#b8231f' },
  race: { icon: Footprints, color: '#c4501a' },
  spies: { icon: VenetianMask, color: '#1d4f86' },
  bingo: { icon: Grid3x3, color: '#23803f' },
  cryptid: { icon: PawPrint, color: '#5a6b1f' },
  flip7: { icon: Spade, color: '#9a2a8f' },
  maze: { icon: Crosshair, color: '#2b3fbf' },
  tourney: { icon: Trophy, color: '#9a6a00' },
};
