import { useEffect, useState } from 'react';
import type { Drawing } from '@pic-game/shared';
import { downloadDrawing, drawingImage } from '../canvas/drawingImage.js';
import { useGame } from '../store/game.js';

function Item({ d, favourite }: { d: Drawing; favourite: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  // Painted after mount, a frame apart, so opening a big gallery stays smooth.
  useEffect(() => {
    const t = setTimeout(() => setSrc(drawingImage(d)), 0);
    return () => clearTimeout(t);
  }, [d]);

  return (
    <figure className={`gallery__item ${favourite ? 'is-fav' : ''}`}>
      <div className="gallery__pic">
        {src ? <img src={src} alt={`${d.word}, drawn by ${d.drawerName}`} /> : <span className="gallery__loading" />}
        {favourite && <span className="gallery__fav">Crowd favourite</span>}
      </div>
      <figcaption className="gallery__cap">
        <strong className="gallery__word">{d.word}</strong>
        <span className="gallery__by">by {d.drawerName} · round {d.round}</span>
        <span className="gallery__votes">
          <span title="Likes">👍 {d.likes.length}</span>
          <span title="Dislikes">👎 {d.dislikes.length}</span>
        </span>
        <button type="button" className="tool gallery__dl" onClick={() => downloadDrawing(d)}>
          Download
        </button>
      </figcaption>
    </figure>
  );
}

/** Every drawing of the last game, each one downloadable as a PNG. */
export function Gallery() {
  const gallery = useGame((s) => s.gallery);
  const open = useGame((s) => s.galleryOpen);
  const close = () => useGame.getState().setGalleryOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open || !gallery) return null;
  const score = (d: Drawing) => d.likes.length - d.dislikes.length;
  const best = Math.max(0, ...gallery.map(score));

  return (
    <div className="overlay overlay--page gallery" role="dialog" aria-modal="true" aria-label="Drawings" onClick={close}>
      <div className="gallery__panel" onClick={(e) => e.stopPropagation()}>
        <header className="gallery__head">
          <h3 className="overlay__title">The drawings</h3>
          <button type="button" className="btn btn--ghost" onClick={close}>Close</button>
        </header>
        {gallery.length === 0 ? (
          <p className="overlay__hint">Nothing got drawn this game.</p>
        ) : (
          <div className="gallery__grid">
            {gallery.map((d) => (
              <Item key={d.id} d={d} favourite={best > 0 && score(d) === best} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Opens the gallery; shown wherever the last game's drawings are to hand. */
export function GalleryButton({ className = 'btn' }: { className?: string }) {
  const count = useGame((s) => s.gallery?.length ?? 0);
  if (!count) return null;
  return (
    <button type="button" className={className} onClick={() => useGame.getState().setGalleryOpen(true)}>
      See all {count} drawing{count === 1 ? '' : 's'}
    </button>
  );
}
