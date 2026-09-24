import { useEffect, useRef, useState } from 'react';
import { AVATAR_COLORS, AVATAR_FACES } from '@pic-game/shared';
import { MAX_NAME_LEN } from '../constants.js';
import { PROFILE_EVENT, getSocket, loadProfile, saveProfile, type Profile } from '../net/socket.js';
import { useGame } from '../store/game.js';
import { Avatar } from './Avatar.js';

/**
 * Who you are, in the header, and a way to change it. Outside a room it just
 * updates what the join form will use next; inside one, the rename goes to
 * the server and everyone sees the new name at once.
 */
export function ProfileChip() {
  const [profile, setProfile] = useState<Profile | null>(() => loadProfile());
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(0);
  const [face, setFace] = useState(0);
  const inRoom = useGame((s) => !!s.room && !!s.me);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = (e: Event) => setProfile((e as CustomEvent<Profile>).detail);
    window.addEventListener(PROFILE_EVENT, on);
    return () => window.removeEventListener(PROFILE_EVENT, on);
  }, []);

  // Close on a click outside or on Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  // Nothing to show until a name has been picked on the landing page.
  if (!profile) return null;

  const start = () => {
    setName(profile.name);
    setColor(profile.avatar.color);
    setFace(profile.avatar.face);
    setOpen(true);
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN);
    if (!n) return;
    const next: Profile = { name: n, avatar: { color, face } };
    saveProfile(next);
    if (inRoom) getSocket().emit('player:rename', next);
    setOpen(false);
  };

  return (
    <div className="profile" ref={box}>
      <button type="button" className="profile__chip" onClick={() => (open ? setOpen(false) : start())} aria-expanded={open}>
        <Avatar data={profile.avatar} size={26} />
        <span className="profile__name">{profile.name}</span>
        <span className="visually-hidden">(edit your name)</span>
      </button>

      {open && (
        <form className="profile__pop card" onSubmit={save}>
          <div className="profile__avatar">
            <Avatar data={{ color, face }} size={56} />
            <div className="join__cycle">
              <button type="button" onClick={() => setColor((c) => (c + 1) % AVATAR_COLORS.length)}>Colour</button>
              <button type="button" onClick={() => setFace((f) => (f + 1) % AVATAR_FACES.length)}>Face</button>
            </div>
          </div>
          <label className="field">
            <span className="field__label">Nickname</span>
            <input
              className="field__input"
              value={name}
              maxLength={MAX_NAME_LEN}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="profile__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={!name.trim()}>Save</button>
          </div>
          {inRoom && <p className="profile__note">Everyone in the room sees the change.</p>}
        </form>
      )}
    </div>
  );
}
