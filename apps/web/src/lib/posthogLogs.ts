import type { GameKind } from '@pic-game/shared';
import posthog, { isPostHogEnabled } from './posthog.js';

export function logGameEntry(outcome: 'created' | 'joined', gameKind: GameKind, entryPoint: 'landing' | 'invite') {
  if (!isPostHogEnabled) return;
  posthog.logger.info('game room entry succeeded', {
    outcome,
    game_kind: gameKind,
    entry_point: entryPoint,
  });
}
