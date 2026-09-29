import { useEffect, useState } from 'react';
import { MK11_ROSTER, type Entrant, type TourneyState } from '@pic-game/shared';

export const pts = (n: number) => n.toLocaleString('en-US');

/** An MK11 character, or nobody. */
export function MainSelect({
  value, onChange, disabled, label = 'Main', blank = 'No main',
}: {
  value: string | null;
  onChange: (main: string | null) => void;
  disabled?: boolean;
  label?: string;
  blank?: string;
}) {
  return (
    <select
      className="tmain"
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{blank}</option>
      {MK11_ROSTER.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

/**
 * A number the host types in. Sent when they are done with it (Enter or
 * leaving the box) rather than per keystroke: every change is broadcast to
 * the room, and the server rations how often the host may send.
 */
export function NumberField({
  value, onCommit, disabled, min, max, step = 10, label,
}: {
  value: number;
  onCommit: (n: number) => void;
  disabled?: boolean;
  min: number;
  max: number;
  step?: number;
  label: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n === value) return setDraft(String(value));
    onCommit(Math.max(min, Math.min(max, Math.round(n))));
  };
  return (
    <input
      className="tnum"
      type="number"
      inputMode="numeric"
      aria-label={label}
      value={draft}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

export function Who({ e, small }: { e: Entrant | undefined; small?: boolean }) {
  if (!e) return null;
  return (
    <span className={`twho ${small ? 'twho--small' : ''} ${e.outOnTurn !== null ? 'is-out' : ''}`}>
      <span className="twho__name">{e.name}</span>
      {e.main && <span className="twho__main">{e.main}</span>}
    </span>
  );
}

// ------------------------------------------------------------ host backup

const BACKUP_KEY = 'pic-game:tourney-backup';

export interface Backup {
  savedAt: number;
  code: string;
  state: TourneyState;
}

/** The host's browser keeps the latest state, in case the server restarts.
 *  Storage can be missing or full; the tournament runs fine without it. */
export function saveBackup(code: string, state: TourneyState): void {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ savedAt: Date.now(), code, state }));
  } catch {
    /* no storage: nothing to fall back on, which is the status quo */
  }
}

export function loadBackup(): Backup | null {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    const b = raw ? (JSON.parse(raw) as Backup) : null;
    return b && typeof b.savedAt === 'number' && b.state?.settings ? b : null;
  } catch {
    return null;
  }
}

export function forgetBackup(): void {
  try {
    localStorage.removeItem(BACKUP_KEY);
  } catch {
    /* nothing stored */
  }
}
