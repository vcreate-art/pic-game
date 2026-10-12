import { useEffect, useState } from 'react';
import { AVATAR_COLORS, AVATAR_FACES, type Avatar } from '@pic-game/shared';
import { MAX_NAME_LEN } from '../constants.js';
import { PROFILE_EVENT, loadProfile, saveProfile, type Profile } from '../net/socket.js';
import { AvatarPicker, avatarAccent } from './AvatarPicker.js';
import { noAutofill } from '../lib/noAutofill.js';

/** Set while a form saves the avatar it was just given, so no form takes
 *  that save for an edit from the header and resets the name being typed.
 *  Module-wide: the front page has two forms sharing one draft. */
let savingAvatar = false;

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
  children,
}: {
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (id: Identity) => void;
  draft?: Identity;
  onDraft?: (id: Identity) => void;
  children?: React.ReactNode;
}) {
  const [own, setOwn] = useState(initialIdentity);
  const id = draft ?? own;
  const set = onDraft ?? setOwn;
  const { name } = id;
  const { color, face } = id.avatar;
  const setName = (n: string) => set({ ...id, name: n });
  const setAvatar = (avatar: Avatar) => {
    set({ ...id, avatar });
    // Kept as soon as it's picked, not only on joining, so it survives a
    // reload and the header shows it. Under the name already saved, so a
    // name half typed isn't kept; with none saved yet, the one typed.
    const keep = loadProfile()?.name || name.trim();
    if (!keep) return;
    savingAvatar = true;
    try {
      saveProfile({ name: keep, avatar });
    } finally {
      savingAvatar = false;
    }
  };

  // Edited from the header while this form is open: take the new values.
  useEffect(() => {
    const on = (e: Event) => {
      if (savingAvatar) return;
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
    // The avatar's colour themes the form: its arrows, its fields' edges and
    // the button.
    <form className="join" onSubmit={submit} style={avatarAccent(color)}>
      <AvatarPicker value={{ color, face }} onChange={setAvatar} size={76} />

      <label className="field">
        <span className="field__label">Nickname</span>
        <input
          className="field__input"
          value={name}
          maxLength={MAX_NAME_LEN}
          placeholder="Your name"
          onChange={(e) => setName(e.target.value)}
          autoFocus
          {...noAutofill}
        />
      </label>

      {children}

      {error && <p className="field__error">{error}</p>}

      <button className="btn btn--primary btn--lg" type="submit" disabled={busy || !name.trim()}>
        <span className="btn__label">{busy ? 'Connecting…' : submitLabel}</span>
      </button>
    </form>
  );
}
