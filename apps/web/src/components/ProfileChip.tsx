import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Lock, Pencil, Smartphone, Trophy } from 'lucide-react';
import { AVATAR_COLORS, AVATAR_FACES } from '@pic-game/shared';
import { MAX_NAME_LEN } from '../constants.js';
import { PROFILE_EVENT, getSocket, loadProfile, saveProfile, type Profile } from '../net/socket.js';
import { useGame } from '../store/game.js';
import { useDismiss } from '../lib/useDismiss.js';
import { ACHIEVEMENTS, byRelevance, totalPlayed, totalWon, useStats } from '../lib/achievements.js';
import { Avatar } from './Avatar.js';
import { PhoneHandoff } from './PhoneHandoff.js';
import { noAutofill } from '../lib/noAutofill.js';

/** How many badges the menu shows before handing over to the full page. */
const PEEK = 3;

/**
 * Who you are, in the header. It opens on your stats and latest badges, with
 * a way to change your name and look. Outside a room an edit just updates
 * what the join form will use next; inside one, the rename goes to the server
 * and everyone sees the new name at once.
 */
export function ProfileChip() {
  const [profile, setProfile] = useState<Profile | null>(() => loadProfile());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(false);
  const stats = useStats();
  const inRoom = useGame((s) => !!s.room && !!s.me);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const on = (e: Event) => setProfile((e as CustomEvent<Profile>).detail);
    window.addEventListener(PROFILE_EVENT, on);
    return () => window.removeEventListener(PROFILE_EVENT, on);
  }, []);

  useDismiss(box, open, close);

  // Once the seat has moved to the phone, this tab has nothing to hand over.
  useEffect(() => {
    if (!inRoom && phone) {
      setPhone(false);
      setOpen(false);
    }
  }, [inRoom, phone]);

  // Nothing to show until a name has been picked on the landing page.
  if (!profile) return null;

  const toggle = () => {
    setEditing(false);
    setPhone(false);
    setOpen((o) => !o);
  };

  const edit = () => setEditing(true);

  const played = totalPlayed(stats);
  const won = totalWon(stats);

  return (
    <div className="profile" ref={box}>
      <button type="button" className="profile__chip" onClick={toggle} aria-expanded={open}>
        <Avatar data={profile.avatar} size={26} />
        <span className="profile__name">{profile.name}</span>
        <span className="visually-hidden">(your profile and achievements)</span>
      </button>

      {open && !editing && !phone && (
        <div className="profile__pop card">
          <div className="profile__who">
            <Avatar data={profile.avatar} size={44} />
            <div className="profile__whotext">
              <span className="profile__whoname">{profile.name}</span>
              <span className="profile__record">
                {played ? `${played} played, ${won} won` : 'No games finished yet'}
              </span>
            </div>
            <button type="button" className="profile__edit" onClick={edit} title="Edit name and avatar">
              <Pencil aria-hidden="true" />
              <span className="visually-hidden">Edit name and avatar</span>
            </button>
          </div>

          <ProfileBadges peek={PEEK} />

          {/* Following a link out of a room would leave it, so not from there. */}
          {inRoom ? (
            <>
              <button type="button" className="btn btn--outline profile__phone" onClick={() => setPhone(true)}>
                <Smartphone aria-hidden="true" /> Play on your phone
              </button>
              <p className="profile__note">The full list of achievements is on the front page, once this game is over.</p>
            </>
          ) : (
            <Link to="/achievements" className="btn btn--outline" onClick={() => setOpen(false)}>
              See all achievements
            </Link>
          )}
        </div>
      )}

      {open && phone && <PhoneHandoff onBack={() => setPhone(false)} />}

      {open && editing && <ProfileEditor className="profile__pop card" onDone={() => setEditing(false)} />}
    </div>
  );
}

/**
 * Changing your name and look: in the header's profile menu, and in the
 * phone's "you" sheet. Outside a room an edit just updates what the join
 * form will use next; inside one, the rename goes to the server and everyone
 * sees the new name at once.
 */
export function ProfileEditor({ className, onDone }: { className?: string; onDone: () => void }) {
  const [start] = useState(() => loadProfile());
  const [name, setName] = useState(start?.name ?? '');
  const [color, setColor] = useState(start?.avatar.color ?? 0);
  const [face, setFace] = useState(start?.avatar.face ?? 0);
  const inRoom = useGame((s) => !!s.room && !!s.me);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN);
    if (!n) return;
    const next: Profile = { name: n, avatar: { color, face } };
    saveProfile(next);
    if (inRoom) getSocket().emit('player:rename', next);
    onDone();
  };

  return (
    <form className={className} onSubmit={save}>
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
          {...noAutofill}
        />
      </label>
      <div className="profile__actions">
        <button type="button" className="btn btn--ghost" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={!name.trim()}>Save</button>
      </div>
      {inRoom && <p className="profile__note">Everyone in the room sees the change.</p>}
    </form>
  );
}

/**
 * Your achievements: how many of them, as a count and a shelf with one
 * segment each, and the badges, most relevant first. The header menu peeks
 * at a few; the phone's "you" sheet, which scrolls, shows them all.
 */
export function ProfileBadges({ peek }: { peek?: number }) {
  const stats = useStats();
  const earned = ACHIEVEMENTS.filter((a) => stats.unlocked[a.id]).length;
  const badges = byRelevance(stats);
  return (
    <div className="profile__badges">
      <p className="profile__count">{earned} of {ACHIEVEMENTS.length} achievements</p>
      {/* One segment per achievement, so the bar is the whole shelf. */}
      <div className="profile__shelf" aria-hidden="true">
        {ACHIEVEMENTS.map((a, i) => (
          <span key={a.id} className={i < earned ? 'is-earned' : ''} />
        ))}
      </div>
      <ul>
        {(peek ? badges.slice(0, peek) : badges).map((a) => {
          const at = stats.unlocked[a.id];
          const n = Math.min(a.progress(stats), a.goal);
          return (
            <li key={a.id} className={at ? 'is-earned' : ''}>
              <span className="profile__badge" aria-hidden="true">{at ? <Trophy /> : <Lock />}</span>
              <span className="profile__badgename">{a.title}</span>
              {!at && a.goal > 1 && <span className="profile__badgeat">{n} of {a.goal}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
