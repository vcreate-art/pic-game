import { useEffect, useRef, useState } from 'react';
import { MAX_CHAT_LEN } from '../constants.js';
import { getSocket } from '../net/socket.js';
import { selectHaveGuessed, selectIsDrawer, useGame } from '../store/game.js';

export function Chat() {
  const messages = useGame((s) => s.messages);
  const isDrawer = useGame(selectIsDrawer);
  const haveGuessed = useGame(selectHaveGuessed);
  const phase = useGame((s) => s.room?.phase);
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
        {messages.length === 0 && <p className="chat__empty">Guesses show up here.</p>}
      </div>
      <form className="chat__form" onSubmit={send}>
        <input
          className="chat__input"
          value={text}
          maxLength={MAX_CHAT_LEN}
          disabled={locked}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          aria-label="Your guess"
        />
        <button className="chat__send" type="submit" disabled={locked || !text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
