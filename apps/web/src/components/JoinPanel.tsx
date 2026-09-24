import { useEffect, useState } from 'react';
import { AVATAR_COLORS, AVATAR_FACES } from '@pic-game/shared';
import { MAX_NAME_LEN } from '../constants.js';
import { PROFILE_EVENT, loadProfile, saveProfile, type Profile } from '../net/socket.js';
import { Avatar } from './Avatar.js';

export interface Identity {
  name: string;
  avatar: { color: number; face: number };
}

/** Name + avatar picker, shared by the landing page and the direct-invite flow. */
export function JoinPanel({
  submitLabel,
  busy,
  error,
  onSubmit,
  children,
}: {
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (id: Identity) => void;
  children?: React.ReactNode;
}) {
  const saved = loadProfile();
  const [name, setName] = useState(saved?.name ?? '');
  const [color, setColor] = useState(saved?.avatar.color ?? Math.floor(Math.random() * AVATAR_COLORS.length));
  const [face, setFace] = useState(saved?.avatar.face ?? Math.floor(Math.random() * AVATAR_FACES.length));

  // Edited from the header while this form is open: take the new values.
  useEffect(() => {
    const on = (e: Event) => {
      const p = (e as CustomEvent<Profile>).detail;
      setName(p.name);
      setColor(p.avatar.color);
      setFace(p.avatar.face);
    };
    window.addEventListener(PROFILE_EVENT, on);
    return () => window.removeEventListener(PROFILE_EVENT, on);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const id: Identity = { name: n, avatar: { color, face } };
    saveProfile(id);
    onSubmit(id);
  };

  return (
    <form className="join" onSubmit={submit}>
      <div className="join__avatar">
        <Avatar data={{ color, face }} size={76} />
        <div className="join__cycle">
          <button type="button" onClick={() => setColor((c) => (c + 1) % AVATAR_COLORS.length)}>
            Colour
          </button>
          <button type="button" onClick={() => setFace((f) => (f + 1) % AVATAR_FACES.length)}>
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
          autoFocus
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
