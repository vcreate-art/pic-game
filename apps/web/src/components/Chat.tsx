import { useEffect, useRef, useState } from 'react';
import { MAX_CHAT_LEN } from '../constants.js';
import { getSocket } from '../net/socket.js';
import { selectHaveGuessed, selectIsDrawer, selectSkribbl, useGame } from '../store/game.js';

/** Counts what the word mask counts: letters and digits, not spaces or hyphens,
 *  so "yo-yo" reads as 4 against 4 rather than 5. */
function letterCount(s: string): number {
  return (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

export function Chat() {
  const messages = useGame((s) => s.messages);
  const isDrawer = useGame(selectIsDrawer);
  const haveGuessed = useGame(selectHaveGuessed);
  const phase = useGame((s) => selectSkribbl(s)?.phase);
  const mask = useGame((s) => selectSkribbl(s)?.turn?.mask ?? '');
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const socket = getSocket();

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const drawing = phase === 'drawing';
  const locked = drawing && isDrawer;
  const placeholder = locked
    ? "You're drawing — no chatting!"
    : haveGuessed && drawing
      ? 'Chat with others who guessed it'
      : 'Type your guess...';

  const target = (mask.match(/_/g) ?? []).length;
  const typed = letterCount(text);
  const showCount = drawing && !locked && !haveGuessed && target > 0 && typed > 0;
  const matches = typed === target;

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || locked) return;
    socket.emit('chat:guess', { text: t });
    setText('');
  };

  return (
    <section className="chat card">
      <h2 className="card__title">Chat</h2>
      <div className="chat__list" ref={listRef}>
        {messages.map((m) => (
          <div key={m.id} className={`msg msg--${m.kind}`}>
            {m.kind === 'chat' && <strong className="msg__name">{m.name}</strong>}
            {m.kind === 'secret' && <strong className="msg__name">{m.name} (guessed)</strong>}
            <span className="msg__text">{m.text}</span>
          </div>
        ))}
        {messages.length === 0 && <p className="chat__empty">Messages show up here.</p>}
      </div>

      {/* No send button: a single-input form submits on Enter, and the on-screen
          keyboard's Go key does the same on a phone. The hidden button keeps that
          explicit for assistive tech. */}
      <form className="chat__form" onSubmit={send}>
        <div className="chat__field">
          <input
            className="chat__input"
            value={text}
            maxLength={MAX_CHAT_LEN}
            disabled={locked}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            aria-label="Your guess"
            autoComplete="off"
          />
          {showCount && (
            <span
              className={`chat__count ${matches ? 'is-match' : ''}`}
              title={matches ? 'Same length as the word' : 'Letters typed / letters in the word'}
            >
              {typed}/{target}
            </span>
          )}
        </div>
        <button type="submit" className="visually-hidden" tabIndex={-1}>
          Send
        </button>
      </form>
    </section>
  );
}
