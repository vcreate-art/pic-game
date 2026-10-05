import { useEffect, useState } from 'react';
import { AVATAR_COLORS, AVATAR_FACES } from '@pic-game/shared';
import { MAX_NAME_LEN } from '../constants.js';
import { PROFILE_EVENT, loadProfile, saveProfile, type Profile } from '../net/socket.js';
import { Avatar } from './Avatar.js';

export interface Identity {
  name: string;
  avatar: { color: number; face: number };
}

/** The saved profile, or a blank name with a random avatar. */
export function initialIdentity(): Identity {
  const saved = loadProfile();
  return {
    name: saved?.name ?? '',
    avatar: {
      color: saved?.avatar.color ?? Math.floor(Math.random() * AVATAR_COLORS.length),
      face: saved?.avatar.face ?? Math.floor(Math.random() * AVATAR_FACES.length),
    },
  };
}

/** Name + avatar picker, shared by the landing page and the direct-invite flow.
 *  Pass `draft` and `onDraft` to hold the name and avatar outside, so two
 *  panels on one page stay in step; otherwise it keeps its own. */
export function JoinPanel({
  submitLabel,
  busy,
  error,
  onSubmit,
  draft,
  onDraft,
  autoFocus = true,
  children,
}: {
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (id: Identity) => void;
  draft?: Identity;
  onDraft?: (id: Identity) => void;
  autoFocus?: boolean;
  children?: React.ReactNode;
}) {
  const [own, setOwn] = useState(initialIdentity);
  const id = draft ?? own;
  const set = onDraft ?? setOwn;
  const { name } = id;
  const { color, face } = id.avatar;
  const setName = (n: string) => set({ ...id, name: n });
  const setColor = (c: number) => set({ ...id, avatar: { color: c, face } });
  const setFace = (f: number) => set({ ...id, avatar: { color, face: f } });

  // Edited from the header while this form is open: take the new values.
  useEffect(() => {
    const on = (e: Event) => {
      const p = (e as CustomEvent<Profile>).detail;
      set({ name: p.name, avatar: { color: p.avatar.color, face: p.avatar.face } });
    };
    window.addEventListener(PROFILE_EVENT, on);
    return () => window.removeEventListener(PROFILE_EVENT, on);
  }, [set]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const out: Identity = { name: n, avatar: { color, face } };
    saveProfile(out);
    onSubmit(out);
  };

  return (
    <form className="join" onSubmit={submit}>
      <div className="join__avatar">
        <Avatar data={{ color, face }} size={76} />
        <div className="join__cycle">
          <button type="button" onClick={() => setColor((color + 1) % AVATAR_COLORS.length)}>
            Colour
          </button>
          <button type="button" onClick={() => setFace((face + 1) % AVATAR_FACES.length)}>
            Face
          </button>
        </div>
      </div>

      <label className="field">
        <span className="field__label">Nickname</span>
        <input
          className="field__input"
          value={name}
          maxLength={MAX_NAME_LEN}
          placeholder="Your name"
          onChange={(e) => setName(e.target.value)}
          autoFocus={autoFocus}
        />
      </label>

      {children}

      {error && <p className="field__error">{error}</p>}

      <button className="btn btn--primary btn--lg" type="submit" disabled={busy || !name.trim()}>
        {busy ? 'Connecting…' : submitLabel}
      </button>
    </form>
  );
}
